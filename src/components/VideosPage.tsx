import { useEffect, useState } from "react";
import type { Campaign, VideoAsset } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { SecondaryButton, EmptyState } from "./dashboard/Toolbar";

const statusColor: Record<string, string> = {
  scheduled: "var(--info)",
  uploading: "var(--info)",
  posted: "var(--success)",
  partially_posted: "var(--warning)",
  failed: "var(--error)",
  cancelled: "var(--text-tertiary)",
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
    return <div style={{ padding: 32, color: "var(--text-secondary)" }}>Loading…</div>;
  }

  const campaignsByVideo = new Map<string, Campaign[]>();
  for (const c of campaigns) {
    campaignsByVideo.set(c.videoAssetId, [...(campaignsByVideo.get(c.videoAssetId) ?? []), c]);
  }

  return (
    <div style={{ padding: 32, maxWidth: 900, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20 }}>Videos</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
          Per-destination status for every video you've submitted through Publish.
        </p>
      </div>

      {videos.filter((v) => campaignsByVideo.has(v.id)).length === 0 ? (
        <EmptyState message="Nothing published yet — use the Publish tab." />
      ) : (
        videos
          .filter((v) => campaignsByVideo.has(v.id))
          .map((v) => (
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
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{v.originalFilename}</div>
              {campaignsByVideo.get(v.id)!.map((campaign) => (
                <div key={campaign.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {campaign.destinations.map((d) => (
                    <div
                      key={d.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontSize: 12,
                        padding: "6px 0",
                        borderTop: "1px solid var(--border-subtle)",
                      }}
                    >
                      <span style={{ minWidth: 90 }}>{d.platformId}</span>
                      <span style={{ color: statusColor[d.status] ?? "var(--text-secondary)", fontWeight: 600 }}>
                        {d.status.replace(/_/g, " ")}
                      </span>
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
