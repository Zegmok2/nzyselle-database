import { useEffect, useState } from "react";
import type { PlatformDefinition, SocialConnection } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { Badge, PageToolbar, PlatformBadge, PrimaryButton, SecondaryButton, Skeleton, Switch } from "./dashboard/Toolbar";

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

const STATUS_TONE: Record<SocialConnection["status"], "success" | "error" | "warning" | "neutral"> = {
  not_connected: "neutral",
  connected_enabled: "success",
  connected_disabled: "neutral",
  needs_reauth: "warning",
  missing_publish_permission: "warning",
  missing_analytics_permission: "warning",
  blocked_review: "error",
  rate_limited: "warning",
  temporarily_unavailable: "warning",
  requires_paid_plan: "warning",
  assisted_only: "warning",
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
  const status = connection ? displayStatus(connection) : "not_connected";

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
        <PlatformBadge platformId={platform.id} label={platform.displayName} size={36} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>{platform.displayName}</span>
            {platform.isSandbox && <Badge tone="warning">DEV ONLY</Badge>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-base)", color: "var(--text-secondary)", marginTop: 2 }}>
            <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
          </div>
        </div>
        {connection && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{connection.enabled ? "Enabled" : "Disabled"}</span>
            <Switch
              checked={connection.enabled}
              onChange={onToggleEnabled}
              ariaLabel={`${connection.enabled ? "Disable" : "Enable"} ${platform.displayName} for new posts`}
            />
          </div>
        )}
      </div>

      {connection ? (
        <>
          <div style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 2 }}>
            <span>
              {connection.displayName} · {connection.username}
            </span>
            <span>Granted: {connection.grantedScopes.join(", ") || "none"}</span>
            {connection.missingScopes.length > 0 && <span style={{ color: "var(--warning)" }}>Missing: {connection.missingScopes.join(", ")}</span>}
            <span>Last synced: {connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString() : "Never"}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <SecondaryButton onClick={onDisconnect}>Disconnect</SecondaryButton>
          </div>
        </>
      ) : hasRealAdapter ? (
        <>
          <PrimaryButton onClick={handleConnect} disabled={connecting}>
            {connecting ? "Waiting for browser..." : `Attach ${platform.displayName} here`}
          </PrimaryButton>
          {connectError && <div style={{ color: "var(--error)", fontSize: "var(--text-sm)" }}>{connectError}</div>}
        </>
      ) : (
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-tertiary)",
            padding: "8px 10px",
            background: "var(--panel-soft)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {platform.isSandbox
            ? "Real connections aren't implemented yet — see docs/LIMITATIONS.md."
            : `Add a ${platform.displayName} developer app Client ID/Secret in Workspace Settings first. The real adapter exists but has never been run against a live account — see core/src/${platform.id}_adapter.rs.`}{" "}
          Connecting here does nothing rather than faking a successful connection.
        </div>
      )}

      {hasRealAdapter && !connection && (
        <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          Uses official OAuth in your default browser. Nzyselle Database never asks for your {platform.displayName} password.
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
    return (
      <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 20, maxWidth: "var(--content-max-width)", margin: "0 auto" }}>
        <Skeleton height={32} width={200} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          <Skeleton height={160} />
          <Skeleton height={160} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 20, maxWidth: "var(--content-max-width)", margin: "0 auto" }}>
      <PageToolbar
        title="Connections"
        description="Connecting is not the same as enabling. A disabled account keeps its authorization and history but is excluded from new posts until you turn it back on."
      />

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
