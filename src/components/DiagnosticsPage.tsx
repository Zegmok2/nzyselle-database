import { useEffect, useState } from "react";
import type { DiagnosticEvent } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { Badge, EmptyState, PageToolbar, Skeleton, type BadgeTone } from "./dashboard/Toolbar";
import { ShieldCheck } from "lucide-react";

const SEVERITY_TONE: Record<DiagnosticEvent["severity"], BadgeTone> = {
  info: "info",
  warning: "warning",
  error: "error",
};

export function DiagnosticsPage({ workspaceId }: { workspaceId: string }) {
  const backend = useBackend();
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "info" | "warning" | "error">("all");

  useEffect(() => {
    let cancelled = false;
    backend.listDiagnosticEvents(workspaceId, 100).then((e) => {
      if (!cancelled) {
        setEvents(e);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [backend, workspaceId]);

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton height={32} width={160} />
        <Skeleton height={60} />
        <Skeleton height={60} />
      </div>
    );
  }

  const filtered = filter === "all" ? events : events.filter((e) => e.severity === filter);

  return (
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <PageToolbar title="Diagnostics" description="Every adapter error the queue and analytics sync hit, in plain language. Never includes tokens or credentials." />

      <div style={{ display: "flex", gap: 8 }}>
        {(["all", "info", "warning", "error"] as const).map((s) => {
          const count = s === "all" ? events.length : events.filter((e) => e.severity === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              aria-pressed={filter === s}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: "var(--radius-sm)",
                border: filter === s ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                background: filter === s ? "var(--panel-hover)" : "transparent",
                color: filter === s ? "var(--text-primary)" : "var(--text-secondary)",
                fontSize: "var(--text-sm)",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {s}
              <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<ShieldCheck size={24} />} message="No diagnostic events." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((e) => (
            <div
              key={e.id}
              style={{
                padding: 12,
                borderRadius: "var(--radius-sm)",
                background: "var(--panel-strong)",
                border: "1px solid var(--border-subtle)",
                fontSize: "var(--text-sm)",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity}</Badge>
                <span style={{ color: "var(--text-tertiary)" }}>{new Date(e.occurredAt).toLocaleString()}</span>
                {e.platformId && <span style={{ color: "var(--text-tertiary)" }}>· {e.platformId}</span>}
              </div>
              <div style={{ marginTop: 6 }}>{e.plainMessage}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
