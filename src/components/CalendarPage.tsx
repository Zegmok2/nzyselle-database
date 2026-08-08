import { useEffect, useState } from "react";
import type { Campaign } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { SecondaryButton, EmptyState } from "./dashboard/Toolbar";

export function CalendarPage({ workspaceId }: { workspaceId: string }) {
  const backend = useBackend();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    const c = await backend.listCampaigns(workspaceId);
    setCampaigns(c);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, workspaceId]);

  async function handleCancel(destinationPostId: string) {
    setBusyId(destinationPostId);
    await backend.cancelScheduledPost(destinationPostId);
    await reload();
    setBusyId(null);
  }

  if (loading) {
    return <div style={{ padding: 32, color: "var(--text-secondary)" }}>Loading…</div>;
  }

  const upcoming = campaigns
    .filter((c) => c.scheduledFor && c.destinations.some((d) => d.status === "scheduled"))
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());

  return (
    <div style={{ padding: 32, maxWidth: 700, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20 }}>Calendar</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
          Upcoming scheduled posts, in order. A list rather than a grid — nothing here needs a calendar
          widget to be honest about what's queued.
        </p>
      </div>

      {upcoming.length === 0 ? (
        <EmptyState message="Nothing scheduled." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {upcoming.map((c) => (
            <div
              key={c.id}
              className="nz-card"
              style={{
                padding: 14,
                borderRadius: "var(--radius-md)",
                background: "var(--panel-strong)",
                border: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{new Date(c.scheduledFor!).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  {c.internalName ?? c.sharedCaption ?? "(no caption)"} —{" "}
                  {c.destinations.map((d) => d.platformId).join(", ")}
                </div>
              </div>
              {c.destinations
                .filter((d) => d.status === "scheduled")
                .map((d) => (
                  <SecondaryButton key={d.id} onClick={() => handleCancel(d.id)} disabled={busyId === d.id}>
                    Cancel {d.platformId}
                  </SecondaryButton>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
