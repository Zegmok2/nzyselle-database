import { useEffect, useState } from "react";
import type { ActivityItem, Workspace } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { StatCard } from "./dashboard/StatCard";
import { EmptyState, PageToolbar, Skeleton } from "./dashboard/Toolbar";
import { Activity, CheckCircle2, Link2, Send } from "lucide-react";

function activityIcon(kind: string) {
  const size = 14;
  if (kind.includes("post")) return <Send size={size} />;
  if (kind.includes("connect")) return <Link2 size={size} />;
  if (kind.includes("complete") || kind.includes("success")) return <CheckCircle2 size={size} />;
  return <Activity size={size} />;
}

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
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <PageToolbar title="Overview" description={`A quick read on ${workspace.name}'s current state.`} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <StatCard label="Connected accounts" value={workspace.connectedAccountCount} />
        <StatCard label="Enabled destinations" value={workspace.enabledDestinationCount} />
        <StatCard label="Queued posts" value={workspace.queuedPostCount} />
        <StatCard
          label="Connection warnings"
          value={workspace.connectionWarningCount}
          hint={workspace.connectionWarningCount > 0 ? "Check Connections" : undefined}
        />
      </div>

      <div
        style={{
          background: "var(--panel-strong)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <h2 style={{ fontSize: "var(--text-md)", fontWeight: 600, margin: 0 }}>Recent activity</h2>
        </div>
        {loading ? (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={18} />
            <Skeleton height={18} />
            <Skeleton height={18} width="70%" />
          </div>
        ) : activity.length === 0 ? (
          <div style={{ padding: 16 }}>
            <EmptyState icon={<Activity size={24} />} message="Nothing yet." />
          </div>
        ) : (
          <div>
            {activity.map((a, i) => (
              <div
                key={a.id}
                className="nz-row"
                style={{
                  fontSize: "var(--text-base)",
                  padding: "12px 16px",
                  borderBottom: i < activity.length - 1 ? "1px solid var(--border-subtle)" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "var(--text-tertiary)", display: "flex" }} aria-hidden>
                    {activityIcon(a.kind)}
                  </span>
                  {a.message}
                </span>
                <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}>
                  {new Date(a.occurredAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
