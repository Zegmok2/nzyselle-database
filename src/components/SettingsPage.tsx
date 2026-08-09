import { useEffect, useState } from "react";
import type { BackupRecord, Workspace } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { Badge, ConfirmDialog, PageToolbar, PlatformBadge, PrimaryButton, SecondaryButton, type BadgeTone } from "./dashboard/Toolbar";
import { APP_VERSION, CHANGELOG, type ChangeKind } from "../lib/changelog";
import { isRunningInTauri } from "../lib/tauriBackend";
import { Eye, EyeOff } from "lucide-react";

const CHANGE_KIND_TONE: Record<ChangeKind, BadgeTone> = {
  feature: "info",
  fix: "warning",
  optimization: "success",
};
const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  feature: "Feature",
  fix: "Fix",
  optimization: "Optimization",
};

type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "up-to-date" }
  | { phase: "available"; version: string; notes: string | null }
  | { phase: "downloading" }
  | { phase: "ready" }
  | { phase: "error"; message: string };

/** "Check for updates" widget for the About section. Uses
 * tauri-plugin-updater to compare against the manifest published at each
 * GitHub release (src-tauri/tauri.conf.json's plugins.updater.endpoints) --
 * outside the built app (npm test, dev preview) it just reports that
 * checking isn't available here, rather than pretending to check. */
function UpdateChecker() {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const [pendingUpdate, setPendingUpdate] = useState<{ downloadAndInstall: () => Promise<void> } | null>(null);

  async function handleCheck() {
    if (!isRunningInTauri()) {
      setState({ phase: "error", message: "Update checking only works in the installed app, not this preview." });
      return;
    }
    setState({ phase: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setPendingUpdate(update);
        setState({ phase: "available", version: update.version, notes: update.body ?? null });
      } else {
        setState({ phase: "up-to-date" });
      }
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : "Couldn't check for updates." });
    }
  }

  async function handleInstall() {
    if (!pendingUpdate) return;
    setState({ phase: "downloading" });
    try {
      await pendingUpdate.downloadAndInstall();
      setState({ phase: "ready" });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : "Update install failed." });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SecondaryButton onClick={handleCheck} disabled={state.phase === "checking" || state.phase === "downloading"}>
          {state.phase === "checking" ? "Checking…" : "Check for updates"}
        </SecondaryButton>
        {state.phase === "up-to-date" && <span style={{ fontSize: "var(--text-sm)", color: "var(--success)" }}>You're on the latest version.</span>}
        {state.phase === "error" && <span style={{ fontSize: "var(--text-sm)", color: "var(--error)" }}>{state.message}</span>}
      </div>
      {state.phase === "available" && (
        <div
          style={{
            padding: 12,
            background: "var(--panel-strong)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-sm)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div>
            Version <strong>{state.version}</strong> is available.{state.notes ? ` ${state.notes}` : ""}
          </div>
          <div>
            <PrimaryButton onClick={handleInstall}>Download and install</PrimaryButton>
          </div>
        </div>
      )}
      {state.phase === "downloading" && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Downloading update…</span>}
      {state.phase === "ready" && <span style={{ fontSize: "var(--text-sm)", color: "var(--success)" }}>Installed. Restarting…</span>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel-soft)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "8px 10px",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
  fontFamily: "inherit",
  width: "100%",
};

export function SettingsPage({ workspace, onUpdated }: { workspace: Workspace; onUpdated: (w: Workspace) => void }) {
  const backend = useBackend();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [accentColor, setAccentColor] = useState(workspace.accentColor ?? "#A98BFF");
  const [defaultWatchFolder, setDefaultWatchFolder] = useState(workspace.defaultWatchFolder ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupPath, setBackupPath] = useState("");
  const [restorePath, setRestorePath] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);

  const [configuredCredentials, setConfiguredCredentials] = useState<string[]>([]);
  const [credentialInputs, setCredentialInputs] = useState<Record<string, { clientId: string; clientSecret: string }>>({});
  const [secretVisible, setSecretVisible] = useState<Record<string, boolean>>({});
  const [credentialSaving, setCredentialSaving] = useState<string | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);

  useEffect(() => {
    backend.listBackups().then(setBackups);
    backend.listConfiguredPlatformCredentials().then(setConfiguredCredentials);
  }, [backend]);

  async function handleSaveCredentials(platformId: string, e: React.FormEvent) {
    e.preventDefault();
    const input = credentialInputs[platformId];
    if (!input?.clientId?.trim() || !input?.clientSecret?.trim()) return;
    setCredentialSaving(platformId);
    setCredentialError(null);
    try {
      await backend.setPlatformCredentials(platformId, input.clientId.trim(), input.clientSecret.trim());
      setConfiguredCredentials(await backend.listConfiguredPlatformCredentials());
      setCredentialInputs((prev) => ({ ...prev, [platformId]: { clientId: "", clientSecret: "" } }));
    } catch (err) {
      setCredentialError(err instanceof Error ? err.message : "Couldn't save credentials.");
    } finally {
      setCredentialSaving(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    await backend.updateWorkspace({ workspaceId: workspace.id, name: name.trim(), description: description || undefined, accentColor, defaultWatchFolder: defaultWatchFolder || undefined });
    onUpdated({ ...workspace, name: name.trim(), description, accentColor, defaultWatchFolder });
    setSaving(false);
    setSaved(true);
  }

  async function handleBackup(e: React.FormEvent) {
    e.preventDefault();
    if (!backupPath.trim()) return;
    setBackupBusy(true);
    setBackupError(null);
    try {
      await backend.createBackup(backupPath.trim());
      setBackups(await backend.listBackups());
      setBackupPath("");
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : "Backup failed.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function performRestore() {
    setConfirmingRestore(false);
    setBackupBusy(true);
    setBackupError(null);
    setRestoreMessage(null);
    try {
      await backend.restoreBackup(restorePath.trim());
      setRestoreMessage("Restored. Restart the app for the restored database to take effect.");
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : "Restore failed.");
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
      <PageToolbar title="Workspace Settings" />

      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-base)" }}>
          Name
          <input className="nz-input" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} required />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-base)" }}>
          Description
          <textarea className="nz-input" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={inputStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-base)" }}>
          Accent color
          <input className="nz-input" type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} style={{ ...inputStyle, height: 36, padding: 2, cursor: "pointer" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-base)" }}>
          Default watch folder
          <input className="nz-input" value={defaultWatchFolder} onChange={(e) => setDefaultWatchFolder(e.target.value)} placeholder="C:\path\to\folder" style={inputStyle} />
        </label>
        <div>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </PrimaryButton>
        </div>
        {saved && <div style={{ color: "var(--success)", fontSize: "var(--text-sm)" }}>Saved.</div>}
      </form>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600, marginBottom: 10 }}>Platform Developer Apps</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginBottom: 12 }}>
          Real TikTok/Instagram/YouTube connections need your own developer app registered on each
          platform. Paste its Client ID/Secret here — stored in the OS credential store, never in the
          database. These adapters are written against each platform's public docs but{" "}
          <strong>have never been run against a live account</strong> — the first real test happens
          the moment you click Connect on the Connections page afterward.
        </p>
        {credentialError && <div style={{ color: "var(--error)", fontSize: "var(--text-sm)", marginBottom: 8 }}>{credentialError}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(["tiktok", "instagram", "youtube"] as const).map((platformId) => {
            // Meta's own developer console calls these "App ID"/"App
            // Secret", not "Client ID"/"Client Secret" -- same values,
            // same field, just matching the label to what's actually on
            // screen when the user copies them from Meta's dashboard.
            const idLabel = platformId === "instagram" ? "App ID" : platformId === "tiktok" ? "Client Key" : "Client ID";
            const secretLabel = platformId === "instagram" ? "App Secret" : "Client Secret";
            return (
            <div key={platformId} style={{ padding: 12, background: "var(--panel-strong)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <PlatformBadge platformId={platformId} label={platformId} size={22} />
                <span style={{ fontSize: "var(--text-base)", fontWeight: 600, textTransform: "capitalize" }}>{platformId}</span>
                {configuredCredentials.includes(platformId) && <Badge tone="success">Configured</Badge>}
              </div>
              <form onSubmit={(e) => handleSaveCredentials(platformId, e)} style={{ display: "flex", gap: 8 }}>
                <input
                  className="nz-input"
                  value={credentialInputs[platformId]?.clientId ?? ""}
                  onChange={(e) => setCredentialInputs((prev) => ({ ...prev, [platformId]: { clientId: e.target.value, clientSecret: prev[platformId]?.clientSecret ?? "" } }))}
                  placeholder={idLabel}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <div style={{ position: "relative", flex: 1 }}>
                  <input
                    className="nz-input"
                    value={credentialInputs[platformId]?.clientSecret ?? ""}
                    onChange={(e) => setCredentialInputs((prev) => ({ ...prev, [platformId]: { clientId: prev[platformId]?.clientId ?? "", clientSecret: e.target.value } }))}
                    placeholder={secretLabel}
                    type={secretVisible[platformId] ? "text" : "password"}
                    style={{ ...inputStyle, paddingRight: 34 }}
                  />
                  <button
                    type="button"
                    onClick={() => setSecretVisible((prev) => ({ ...prev, [platformId]: !prev[platformId] }))}
                    aria-label={secretVisible[platformId] ? `Hide ${platformId} ${secretLabel.toLowerCase()}` : `Show ${platformId} ${secretLabel.toLowerCase()}`}
                    style={{
                      position: "absolute",
                      right: 6,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-tertiary)",
                      cursor: "pointer",
                      display: "flex",
                      padding: 4,
                    }}
                  >
                    {secretVisible[platformId] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <SecondaryButton disabled={credentialSaving === platformId}>{credentialSaving === platformId ? "Saving…" : "Save"}</SecondaryButton>
              </form>
            </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600, marginBottom: 10 }}>Backup &amp; Restore</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginBottom: 12 }}>
          A backup is a raw copy of the local database file. It never includes OAuth credentials — those
          live in the OS credential store, not SQLite.
        </p>

        <form onSubmit={handleBackup} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input className="nz-input" value={backupPath} onChange={(e) => setBackupPath(e.target.value)} placeholder="Destination file path, e.g. C:\backups\nzyselle-2026-08-07.sqlite" style={inputStyle} />
          <SecondaryButton disabled={backupBusy || !backupPath.trim()}>Back up now</SecondaryButton>
        </form>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (restorePath.trim()) setConfirmingRestore(true);
          }}
          style={{ display: "flex", gap: 8, marginBottom: 10 }}
        >
          <input className="nz-input" value={restorePath} onChange={(e) => setRestorePath(e.target.value)} placeholder="Backup file path to restore from" style={inputStyle} />
          <SecondaryButton disabled={backupBusy || !restorePath.trim()}>Restore</SecondaryButton>
        </form>

        {backupError && <div style={{ color: "var(--error)", fontSize: "var(--text-sm)" }}>{backupError}</div>}
        {restoreMessage && <div style={{ color: "var(--success)", fontSize: "var(--text-sm)" }}>{restoreMessage}</div>}

        {backups.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            {backups.map((b) => (
              <li key={b.id} className="nz-row" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", padding: "6px 8px", borderRadius: "var(--radius-sm)" }}>
                {new Date(b.createdAt).toLocaleString()} — {b.filePath}
              </li>
            ))}
          </ul>
        )}

        <ConfirmDialog
          open={confirmingRestore}
          title="Restore this backup?"
          message={`This replaces the live database with "${restorePath}". Anything created since that backup was made will be lost. The app needs a restart afterward for it to take effect.`}
          confirmLabel="Restore"
          danger
          onConfirm={performRestore}
          onCancel={() => setConfirmingRestore(false)}
        />
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600, marginBottom: 4 }}>About</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginBottom: 16 }}>
          Nzyselle Database <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>v{APP_VERSION}</span>
        </p>

        <UpdateChecker />

        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "12px 14px",
            marginBottom: 20,
            background: "var(--panel-strong)",
            border: "1px solid var(--warning)",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          <span style={{ color: "var(--warning)", fontWeight: 700, flexShrink: 0 }}>Verification status</span>
          <span>
            Sandbox has been connected and posted to end-to-end. YouTube&rsquo;s and Instagram&rsquo;s real
            OAuth connections have also now been confirmed working against live accounts (as of
            2026-08-08) — but publishing a video through either hasn&rsquo;t been tested yet, so treat
            uploads as unverified until one actually succeeds. TikTok is implemented against its
            public API docs but has not been run against a live account at all — check the status shown
            on each platform&rsquo;s card on the Connections page before relying on any of this.
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {CHANGELOG.map((entry) => (
            <div key={entry.version}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>v{entry.version}</span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{entry.date}</span>
              </div>
              <div
                style={{
                  background: "var(--panel-strong)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                }}
              >
                {entry.changes.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 14px",
                      fontSize: "var(--text-sm)",
                      borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                    }}
                  >
                    <span style={{ flexShrink: 0, marginTop: 1 }}>
                      <Badge tone={CHANGE_KIND_TONE[c.kind]}>{CHANGE_KIND_LABEL[c.kind]}</Badge>
                    </span>
                    <span style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>{c.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
