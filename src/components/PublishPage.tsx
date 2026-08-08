import { useEffect, useState } from "react";
import type { SocialConnection, VideoAsset } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { PrimaryButton } from "./dashboard/Toolbar";

const inputStyle: React.CSSProperties = {
  background: "var(--panel-soft)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "10px 12px",
  color: "var(--text-primary)",
  fontSize: 13,
  width: "100%",
};

export function PublishPage({ workspaceId }: { workspaceId: string }) {
  const backend = useBackend();
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [videoId, setVideoId] = useState("");
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([backend.listVideos(workspaceId), backend.listConnections(workspaceId)]).then(([v, c]) => {
      if (cancelled) return;
      setVideos(v);
      setConnections(c.filter((conn) => conn.enabled && conn.status === "connected_enabled"));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [backend, workspaceId]);

  function toggleConnection(id: string) {
    setSelectedConnections((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!videoId || selectedConnections.length === 0) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const campaign = await backend.submitCampaign({
        workspaceId,
        videoAssetId: videoId,
        sharedCaption: caption || undefined,
        connectionIds: selectedConnections,
        scheduledFor: scheduleMode === "later" && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      });
      setSuccess(
        scheduleMode === "now"
          ? `Queued for ${campaign.destinations.length} destination(s) — check the Videos tab for status.`
          : `Scheduled for ${new Date(campaign.scheduledFor!).toLocaleString()}.`,
      );
      setVideoId("");
      setSelectedConnections([]);
      setCaption("");
      setScheduledFor("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit this post.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 32, color: "var(--text-secondary)" }}>Loading…</div>;
  }

  if (connections.length === 0) {
    return (
      <div style={{ padding: 32, maxWidth: 640 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Publish</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 12 }}>
          No enabled connections yet. Connect and enable at least one platform on the Connections page
          before publishing.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: 32, maxWidth: 640, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20 }}>Publish</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
          Submitting queues the post for the upload/publish pipeline — nothing here fakes a successful post.
        </p>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        Video
        <select value={videoId} onChange={(e) => setVideoId(e.target.value)} style={inputStyle} required>
          <option value="">Choose a video from Library…</option>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.originalFilename}
            </option>
          ))}
        </select>
      </label>

      <div>
        <div style={{ fontSize: 13, marginBottom: 8 }}>Destinations</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {connections.map((c) => (
            <label
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
                background: "var(--panel-strong)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={selectedConnections.includes(c.id)}
                onChange={() => toggleConnection(c.id)}
              />
              {c.displayName ?? c.platformId} ({c.platformId})
            </label>
          ))}
        </div>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        Caption
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} style={inputStyle} />
      </label>

      <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="radio" checked={scheduleMode === "now"} onChange={() => setScheduleMode("now")} />
          Post now
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="radio" checked={scheduleMode === "later"} onChange={() => setScheduleMode("later")} />
          Schedule for later
        </label>
      </div>
      {scheduleMode === "later" && (
        <input
          type="datetime-local"
          value={scheduledFor}
          onChange={(e) => setScheduledFor(e.target.value)}
          style={inputStyle}
          aria-label="Scheduled time"
          required
        />
      )}

      {error && <div style={{ color: "var(--error)", fontSize: 13 }}>{error}</div>}
      {success && <div style={{ color: "var(--success)", fontSize: 13 }}>{success}</div>}

      <div>
        <PrimaryButton type="submit" disabled={submitting || !videoId || selectedConnections.length === 0}>
          {submitting ? "Submitting…" : scheduleMode === "now" ? "Post now" : "Schedule"}
        </PrimaryButton>
      </div>
    </form>
  );
}
