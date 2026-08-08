import { useEffect, useState } from "react";
import type { PlatformDefinition, SocialConnection } from "../lib/types";
import { useBackend } from "../lib/backendContext";

const STATUS_LABEL: Record<SocialConnection["status"], string> = {
  not_connected: "Not connected",
  connected_enabled: "Connected",
  connected_disabled: "Connected (disabled)",
  needs_reauth: "Reauthorization required",
  missing_publish_permission: "Missing publishing permission",
  missing_analytics_permission: "Missing analytics permission",
  blocked_review: "Blocked by developer-app review",
  rate_limited: "Rate limited",
  temporarily_unavailable: "Temporarily unavailable",
  requires_paid_plan: "Requires a paid API plan",
  assisted_only: "Supported only through assisted posting",
};

/** `status` reflects platform-reported connection health; `enabled` is a
 * separate, purely local preference (per spec: "connection and enablement
 * are different states"). This derives the *displayed* status by
 * combining both, so toggling enabled can never leave the label showing
 * stale/contradictory state — without conflating the two as one field. */
function displayStatus(connection: SocialConnection): SocialConnection["status"] {
  if (connection.status === "connected_enabled" || connection.status === "connected_disabled") {
    return connection.enabled ? "connected_enabled" : "connected_disabled";
  }
  return connection.status;
}

function StatusDot({ status }: { status: SocialConnection["status"] }) {
  const color =
    status === "connected_enabled"
      ? "var(--success)"
      : status === "connected_disabled"
        ? "var(--text-tertiary)"
        : status === "not_connected"
          ? "var(--text-tertiary)"
          : "var(--warning)";
  return (
    <span
      aria-hidden
      style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }}
    />
  );
}

function PlatformCard({
  platform,
  connection,
  hasCredentials,
  onConnect,
  onToggleEnabled,
  onDisconnect,
}: {
  platform: PlatformDefinition;
  connection?: SocialConnection;
  hasCredentials: boolean;
  onConnect: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  // The sandbox adapter always has a real, working connect flow. Real
  // platform adapters (see core/src/{tiktok,instagram,youtube}_adapter.rs)
  // are real too, but UNVERIFIED against a live account, and only usable
  // once the user has entered a real developer app Client ID/Secret in
  // Workspace Settings -- offering a connect button before that exists
  // would be exactly the "fake successful connection" the product spec
  // forbids, so those cards say so plainly instead until configured.
  const hasRealAdapter = platform.isSandbox || hasCredentials;

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      await onConnect();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Couldn't connect.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div
      className="nz-card"
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        background: "var(--panel-strong)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        opacity: connection && !connection.enabled ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--panel-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {platform.displayName[0]}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{platform.displayName}</span>
            {platform.isSandbox && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: "var(--warning)",
                  border: "1px solid var(--warning)",
                  borderRadius: 4,
                  padding: "1px 5px",
                }}
              >
                DEV ONLY
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
            <StatusDot status={connection ? displayStatus(connection) : "not_connected"} />
            {STATUS_LABEL[connection ? displayStatus(connection) : "not_connected"]}
          </div>
        </div>
        {connection && (
          <label
            title={connection.enabled ? "Excludes this account from new posts without disconnecting it" : "Re-enable this account for new posts"}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}
          >
            {connection.enabled ? "Enabled" : "Disabled"}
            <input
              type="checkbox"
              checked={connection.enabled}
              onChange={(e) => onToggleEnabled(e.target.checked)}
              aria-label={`${connection.enabled ? "Disable" : "Enable"} ${platform.displayName} for new posts`}
            />
          </label>
        )}
      </div>

      {connection ? (
        <>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 2 }}>
            <span>{connection.displayName} · {connection.username}</span>
            <span>Granted: {connection.grantedScopes.join(", ") || "none"}</span>
            {connection.missingScopes.length > 0 && (
              <span style={{ color: "var(--warning)" }}>Missing: {connection.missingScopes.join(", ")}</span>
            )}
            <span>
              Last synced: {connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString() : "Never"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="nz-btn-secondary" style={secondaryBtn} onClick={onDisconnect}>
              Disconnect
            </button>
          </div>
        </>
      ) : hasRealAdapter ? (
        <>
          <button className="nz-btn-primary" style={primaryBtn} onClick={handleConnect} disabled={connecting}>
            {connecting ? "Waiting for browser..." : `Attach ${platform.displayName} here`}
          </button>
          {connectError && <div style={{ color: "var(--error)", fontSize: 12 }}>{connectError}</div>}
        </>
      ) : (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-tertiary)",
            padding: "8px 10px",
            background: "var(--panel-soft)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {platform.isSandbox
            ? "Real connections aren't implemented yet — see docs/LIMITATIONS.md."
            : `Add a ${platform.displayName} developer app Client ID/Secret in Workspace Settings first. The real adapter exists but has never been run against a live account — see core/src/${platform.id}_adapter.rs.`}
          {" "}Connecting here does nothing rather than faking a successful connection.
        </div>
      )}

      {hasRealAdapter && !connection && (
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-tertiary)" }}>
          Uses official OAuth in your default browser. Nzyselle Database never asks for your{" "}
          {platform.displayName} password.
        </p>
      )}
    </div>
  );
}

export function ConnectionsPage({ workspaceId }: { workspaceId: string }) {
  const backend = useBackend();
  const [platforms, setPlatforms] = useState<PlatformDefinition[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [configuredCredentials, setConfiguredCredentials] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([backend.listPlatforms(), backend.listConnections(workspaceId), backend.listConfiguredPlatformCredentials()]).then(([p, c, creds]) => {
      if (cancelled) return;
      setPlatforms(p);
      setConnections(c);
      setConfiguredCredentials(creds);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [backend, workspaceId]);

  async function handleConnect(platform: PlatformDefinition) {
    const conn = platform.isSandbox ? await backend.beginConnectSandbox(workspaceId) : await backend.beginConnectPlatform(workspaceId, platform.id);
    setConnections((prev) => [...prev, conn]);
  }

  async function handleToggle(connectionId: string, enabled: boolean) {
    setConnections((prev) => prev.map((c) => (c.id === connectionId ? { ...c, enabled } : c)));
    await backend.setConnectionEnabled(connectionId, enabled);
  }

  async function handleDisconnect(connectionId: string) {
    setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    await backend.disconnect(connectionId);
  }

  if (loading) {
    return <div style={{ padding: 32, color: "var(--text-secondary)" }}>Loading connections…</div>;
  }

  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 20, maxWidth: "var(--content-max-width)", margin: "0 auto" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>Connections</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
          Connecting is not the same as enabling. A disabled account keeps its authorization and
          history but is excluded from new posts until you turn it back on.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {platforms.map((platform) => (
          <PlatformCard
            key={platform.id}
            platform={platform}
            connection={connections.find((c) => c.platformId === platform.id)}
            hasCredentials={configuredCredentials.includes(platform.id)}
            onConnect={() => handleConnect(platform)}
            onToggleEnabled={(enabled) => {
              const conn = connections.find((c) => c.platformId === platform.id);
              if (conn) handleToggle(conn.id, enabled);
            }}
            onDisconnect={() => {
              const conn = connections.find((c) => c.platformId === platform.id);
              if (conn) handleDisconnect(conn.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: "var(--radius-sm)",
  border: "none",
  background: "var(--accent-gradient)",
  color: "#ffffff",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-subtle)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: 13,
  cursor: "pointer",
};
