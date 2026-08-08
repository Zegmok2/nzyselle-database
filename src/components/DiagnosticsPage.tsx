import { useEffect, useState } from "react";
import type { DiagnosticEvent } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { EmptyState } from "./dashboard/Toolbar";

const severityColor: Record<string, string> = {
  info: "var(--info)",
  warning: "var(--warning)",
  error: "var(--error)",
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
    return <div style={{ padding: 32, color: "var(--text-secondary)" }}>Loading…</div>;
  }

  const filtered = filter === "all" ? events : events.filter((e) => e.severity === filter);

  return (
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>Diagnostics</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
          Every adapter error the queue and analytics sync hit, in plain language. Never includes tokens
          or credentials.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {(["all", "info", "warning", "error"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: "5px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
              background: filter === s ? "var(--panel-soft)" : "transparent",
              color: "var(--text-primary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No diagnostic events." />
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
                fontSize: 12,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: severityColor[e.severity], fontWeight: 700, textTransform: "uppercase", fontSize: 10 }}>
                  {e.severity}
                </span>
                <span style={{ color: "var(--text-tertiary)" }}>{new Date(e.occurredAt).toLocaleString()}</span>
                {e.platformId && <span style={{ color: "var(--text-tertiary)" }}>· {e.platformId}</span>}
              </div>
              <div style={{ marginTop: 4 }}>{e.plainMessage}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
