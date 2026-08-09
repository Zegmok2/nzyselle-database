import { useEffect, useState } from "react";
import type { Campaign, DestinationPostStatus, VideoAsset } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { Badge, EmptyState, PageToolbar, PlatformBadge, SecondaryButton, Skeleton, type BadgeTone } from "./dashboard/Toolbar";
import { Send } from "lucide-react";

const STATUS_TONE: Record<DestinationPostStatus, BadgeTone> = {
  local_draft: "neutral",
  scheduled: "info",
  uploading: "info",
  posted: "success",
  partially_posted: "warning",
  failed: "error",
  cancelled: "neutral",
};

export function VideosPage({ workspaceId }: { workspaceId: string }) {
  const backend = useBackend();
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    const [v, c] = await Promise.all([backend.listVideos(workspaceId), backend.listCampaigns(workspaceId)]);
    setVideos(v);
    setCampaigns(c);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, workspaceId]);

  async function handleRetry(destinationPostId: string) {
    setBusyId(destinationPostId);
    await backend.retryDestinationPost(destinationPostId);
    await reload();
    setBusyId(null);
  }

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
        <Skeleton height={100} />
        <Skeleton height={100} />
      </div>
    );
  }

  const campaignsByVideo = new Map<string, Campaign[]>();
  for (const c of campaigns) {
    campaignsByVideo.set(c.videoAssetId, [...(campaignsByVideo.get(c.videoAssetId) ?? []), c]);
  }
  const videosWithCampaigns = videos.filter((v) => campaignsByVideo.has(v.id));

  return (
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <PageToolbar title="Videos" description="Per-destination status for every video you've submitted through Publish." />

      {videosWithCampaigns.length === 0 ? (
        <EmptyState icon={<Send size={24} />} message="Nothing published yet — use the Publish tab." />
      ) : (
        videosWithCampaigns.map((v) => (
          <div
            key={v.id}
            className="nz-card"
            style={{
              padding: 16,
              borderRadius: "var(--radius-md)",
              background: "var(--panel-strong)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: "var(--text-md)", marginBottom: 10 }}>{v.originalFilename}</div>
            {campaignsByVideo.get(v.id)!.map((campaign) => (
              <div key={campaign.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {campaign.destinations.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: "var(--text-sm)",
                      padding: "8px 0",
                      borderTop: "1px solid var(--border-subtle)",
                    }}
                  >
                    <PlatformBadge platformId={d.platformId} label={d.platformId} size={22} />
                    <Badge tone={STATUS_TONE[d.status]}>{d.status.replace(/_/g, " ")}</Badge>
                    {d.status === "posted" && (
                      <span style={{ color: "var(--text-tertiary)" }} title={new Date(d.updatedAt).toISOString()}>
                        {new Date(d.updatedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    )}
                    {d.postUrl && (
                      <a href={d.postUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                        view post
                      </a>
                    )}
                    {d.errorMessage && <span style={{ color: "var(--error)" }}>{d.errorMessage}</span>}
                    <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                      {d.status === "scheduled" && (
                        <SecondaryButton onClick={() => handleCancel(d.id)} disabled={busyId === d.id}>
                          Cancel
                        </SecondaryButton>
                      )}
                      {d.isRetryable && (
                        <SecondaryButton onClick={() => handleRetry(d.id)} disabled={busyId === d.id}>
                          Retry
                        </SecondaryButton>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
