import { useEffect, useState } from "react";
import type { ActivityItem, Workspace } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { StatCard } from "./dashboard/StatCard";
import { EmptyState } from "./dashboard/Toolbar";

export function OverviewPage({ workspace }: { workspace: Workspace }) {
  const backend = useBackend();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    backend.listRecentActivity(workspace.id, 20).then((a) => {
      if (!cancelled) {
        setActivity(a);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [backend, workspace.id]);

  return (
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto" }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>Overview</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
        A quick read on {workspace.name}&rsquo;s current state.
      </p>

      <div style={{ display: "flex", gap: 24, marginTop: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Left column -- summary stats, ~1/3 width */}
        <div style={{ flex: "1 1 280px", maxWidth: 340, display: "flex", flexDirection: "column", gap: 12 }}>
          <StatCard label="Connected accounts" value={workspace.connectedAccountCount} />
          <StatCard label="Enabled destinations" value={workspace.enabledDestinationCount} />
          <StatCard label="Queued posts" value={workspace.queuedPostCount} />
          <StatCard
            label="Connection warnings"
            value={workspace.connectionWarningCount}
            hint={workspace.connectionWarningCount > 0 ? "Check Connections" : undefined}
          />
        </div>

        {/* Right column -- recent activity, ~2/3 width */}
        <div style={{ flex: "2 1 420px" }}>
          <div
            style={{
              background: "var(--panel-strong)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Recent activity</h2>
            </div>
            {loading ? (
              <div style={{ color: "var(--text-secondary)", fontSize: 13, padding: 16 }}>Loading…</div>
            ) : activity.length === 0 ? (
              <div style={{ padding: 16 }}>
                <EmptyState message="Nothing yet." />
              </div>
            ) : (
              <div>
                {activity.map((a, i) => (
                  <div
                    key={a.id}
                    className="nz-row"
                    style={{
                      fontSize: 13,
                      padding: "12px 16px",
                      borderBottom: i < activity.length - 1 ? "1px solid var(--border-subtle)" : "none",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span>{a.message}</span>
                    <span style={{ color: "var(--text-tertiary)", fontSize: 12, whiteSpace: "nowrap" }}>
                      {new Date(a.occurredAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
