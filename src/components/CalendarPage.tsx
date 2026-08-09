import { useEffect, useState } from "react";
import type { Campaign } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { EmptyState, PageToolbar, PlatformBadge, SecondaryButton, Skeleton } from "./dashboard/Toolbar";
import { CalendarClock } from "lucide-react";

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
    return (
      <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton height={32} width={160} />
        <Skeleton height={70} />
        <Skeleton height={70} />
      </div>
    );
  }

  const upcoming = campaigns
    .filter((c) => c.scheduledFor && c.destinations.some((d) => d.status === "scheduled"))
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());

  return (
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <PageToolbar
        title="Calendar"
        description="Upcoming scheduled posts, in order. A list rather than a grid — nothing here needs a calendar widget to be honest about what's queued."
      />

      {upcoming.length === 0 ? (
        <EmptyState icon={<CalendarClock size={24} />} message="Nothing scheduled." />
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
                <div style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>{new Date(c.scheduledFor!).toLocaleString()}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{c.internalName ?? c.sharedCaption ?? "(no caption)"}</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    {c.destinations.map((d) => (
                      <PlatformBadge key={d.id} platformId={d.platformId} label={d.platformId} size={18} />
                    ))}
                  </span>
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
