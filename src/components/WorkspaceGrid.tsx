import { motion } from "framer-motion";
import type { Workspace } from "../lib/types";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function timeAgo(iso?: string) {
  if (!iso) return "No activity yet";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function WorkspaceCard({ ws, onOpen }: { ws: Workspace; onOpen: () => void }) {
  const accent = ws.accentColor ?? "#A98BFF";
  return (
    <motion.button
      onClick={onOpen}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        width: "100%",
        textAlign: "left",
        padding: 18,
        borderRadius: "var(--radius-lg)",
        background: "var(--panel-strong)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "var(--shadow-sm)",
        cursor: "pointer",
        color: "inherit",
        font: "inherit",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 48,
          height: 48,
          flexShrink: 0,
          borderRadius: "var(--radius-md)",
          background: accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          color: "#ffffff",
          fontSize: 16,
        }}
      >
        {initials(ws.name)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{ws.name}</h3>
          {ws.connectionWarningCount > 0 && (
            <span style={{ fontSize: 12, color: "var(--warning)" }}>
              {ws.connectionWarningCount} needs attention
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 13, color: "var(--text-secondary)" }}>
          <span>{ws.connectedAccountCount} accounts connected</span>
          <span>{ws.enabledDestinationCount} enabled</span>
          <span>{ws.queuedPostCount} queued</span>
          <span>{timeAgo(ws.lastActivityAt)}</span>
        </div>
      </div>

      <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Open →</span>
    </motion.button>
  );
}

export function WorkspaceGrid({
  workspaces,
  onOpen,
  onCreate,
}: {
  workspaces: Workspace[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: 32, maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Account groups</h1>
        <button
          onClick={onCreate}
          style={{
            padding: "10px 18px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--accent-gradient)",
            color: "#ffffff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Create account group
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {workspaces.map((ws) => (
          <WorkspaceCard key={ws.id} ws={ws} onOpen={() => onOpen(ws.id)} />
        ))}
      </div>
    </div>
  );
}
