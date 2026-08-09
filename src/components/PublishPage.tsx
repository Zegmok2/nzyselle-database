import { useEffect, useMemo, useState } from "react";
import type { CreatorPostingOptions, HashtagSet, SocialConnection, VideoAsset } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { Badge, EmptyState, PageToolbar, PlatformBadge, PrimaryButton, Select, Skeleton, Switch } from "./dashboard/Toolbar";
import { AlertTriangle, Video as VideoIcon } from "lucide-react";

const inputStyle: React.CSSProperties = {
  background: "var(--panel-soft)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "10px 12px",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
  fontFamily: "inherit",
  width: "100%",
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function VideoThumb({ video }: { video: VideoAsset }) {
  const backend = useBackend();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (video.hasThumbnail) {
      backend.getVideoThumbnail(video.id).then((data) => {
        if (!cancelled) setUrl(data);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [backend, video.id, video.hasThumbnail]);

  return (
    <div
      aria-hidden
      style={{
        width: 36,
        height: 64,
        borderRadius: "var(--radius-sm)",
        background: url ? `center / cover no-repeat url(${url})` : "var(--panel-soft)",
        flexShrink: 0,
        border: "1px solid var(--border-subtle)",
      }}
    />
  );
}

interface ValidationIssue {
  tone: "error" | "warning";
  text: string;
}

/** Real validation only -- every check here is backed by a real, documented
 * platform limit (core/src/adapter.rs's CreatorPostingOptions, fetched via
 * getPostingOptions) or a real, measured video property. Nothing here is a
 * fabricated rule. The vertical-video check is deliberately a "warning"
 * (advisory), never "error" -- no adapter actually enforces aspect ratio. */
function validateForDestination(caption: string, video: VideoAsset, opts: CreatorPostingOptions, platformLabel: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (opts.maxCaptionLength && caption.length > opts.maxCaptionLength) {
    issues.push({ tone: "error", text: `Caption is ${caption.length} characters, over ${platformLabel}'s ${opts.maxCaptionLength}-character limit.` });
  }
  if (opts.maxDurationSeconds && video.durationSeconds > opts.maxDurationSeconds) {
    issues.push({ tone: "error", text: `Video is ${formatDuration(video.durationSeconds)}, over ${platformLabel}'s ${formatDuration(opts.maxDurationSeconds)} limit.` });
  }
  if (!video.isVertical) {
    issues.push({ tone: "warning", text: `This video is landscape -- ${platformLabel} is built for vertical short-form video.` });
  }
  return issues;
}

export function PublishPage({ workspaceId }: { workspaceId: string }) {
  const backend = useBackend();
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [hashtagSets, setHashtagSets] = useState<HashtagSet[]>([]);
  const [loading, setLoading] = useState(true);

  const [videoId, setVideoId] = useState("");
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [sharedCaption, setSharedCaption] = useState("");
  const [sharedHashtags, setSharedHashtags] = useState("");
  const [customized, setCustomized] = useState<Record<string, boolean>>({});
  const [captionOverrides, setCaptionOverrides] = useState<Record<string, string>>({});
  const [postingOptions, setPostingOptions] = useState<Record<string, CreatorPostingOptions>>({});
  const [optionsLoading, setOptionsLoading] = useState<Record<string, boolean>>({});

  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([backend.listVideos(workspaceId), backend.listConnections(workspaceId), backend.listHashtagSets(workspaceId)]).then(([v, c, h]) => {
      if (cancelled) return;
      setVideos(v);
      setConnections(c.filter((conn) => conn.enabled && conn.status === "connected_enabled"));
      setHashtagSets(h);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [backend, workspaceId]);

  const selectedVideo = videos.find((v) => v.id === videoId);

  function toggleConnection(id: string) {
    const willSelect = !selectedConnections.includes(id);
    setSelectedConnections((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
    if (willSelect && !postingOptions[id] && !optionsLoading[id]) {
      setOptionsLoading((prev) => ({ ...prev, [id]: true }));
      backend
        .getPostingOptions(id)
        .then((opts) => setPostingOptions((prev) => ({ ...prev, [id]: opts })))
        .finally(() => setOptionsLoading((prev) => ({ ...prev, [id]: false })));
    }
  }

  function insertHashtagSet(setId: string) {
    const set = hashtagSets.find((h) => h.id === setId);
    if (!set) return;
    const existing = sharedHashtags.split(/\s+/).filter(Boolean);
    const merged = Array.from(new Set([...existing, ...set.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`))]));
    setSharedHashtags(merged.join(" "));
  }

  const hashtagList = useMemo(() => sharedHashtags.split(/\s+/).map((h) => h.trim()).filter(Boolean), [sharedHashtags]);

  const blockingErrors = useMemo(() => {
    if (!selectedVideo) return [];
    return selectedConnections.flatMap((connId) => {
      const conn = connections.find((c) => c.id === connId);
      const opts = postingOptions[connId];
      if (!conn || !opts) return [];
      const caption = customized[connId] ? (captionOverrides[connId] ?? "") : sharedCaption;
      return validateForDestination(caption, selectedVideo, opts, conn.displayName ?? conn.platformId).filter((i) => i.tone === "error");
    });
  }, [selectedVideo, selectedConnections, connections, postingOptions, customized, captionOverrides, sharedCaption]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!videoId || selectedConnections.length === 0 || blockingErrors.length > 0) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const overridesToSend: Record<string, string> = {};
      for (const connId of selectedConnections) {
        if (customized[connId] && captionOverrides[connId] !== undefined) overridesToSend[connId] = captionOverrides[connId];
      }
      const campaign = await backend.submitCampaign({
        workspaceId,
        videoAssetId: videoId,
        sharedCaption: sharedCaption || undefined,
        sharedHashtags: hashtagList.length > 0 ? hashtagList : undefined,
        connectionIds: selectedConnections,
        captionOverrides: overridesToSend,
        scheduledFor: scheduleMode === "later" && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      });
      setSuccess(
        scheduleMode === "now"
          ? `Queued for ${campaign.destinations.length} destination(s) — check the Videos tab for status.`
          : `Scheduled for ${new Date(campaign.scheduledFor!).toLocaleString()}.`,
      );
      setVideoId("");
      setSelectedConnections([]);
      setSharedCaption("");
      setSharedHashtags("");
      setCustomized({});
      setCaptionOverrides({});
      setScheduledFor("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit this post.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton height={32} width={200} />
        <Skeleton height={110} />
        <Skeleton height={110} />
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        <PageToolbar title="Publish" />
        <EmptyState
          icon={<VideoIcon size={28} />}
          message="No enabled connections yet. Connect and enable at least one platform on the Connections page before publishing."
        />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <PageToolbar title="Publish" description="Submitting queues the post for the upload/publish pipeline — nothing here fakes a successful post." />

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>Video</div>
        {videos.length === 0 ? (
          <EmptyState icon={<VideoIcon size={24} />} message="No videos in the Library yet." />
        ) : (
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
            {videos.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVideoId(v.id)}
                className="nz-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 10,
                  minWidth: 220,
                  borderRadius: "var(--radius-md)",
                  border: videoId === v.id ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                  background: videoId === v.id ? "var(--panel-hover)" : "var(--panel-strong)",
                  cursor: "pointer",
                  textAlign: "left",
                  flexShrink: 0,
                }}
              >
                <VideoThumb video={v} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.originalFilename}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                    {formatDuration(v.durationSeconds)}
                    {v.isVertical ? " · vertical" : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>Destinations</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {connections.map((c) => (
            <div
              key={c.id}
              className="nz-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
                background: "var(--panel-strong)",
              }}
            >
              <PlatformBadge platformId={c.platformId} label={c.displayName ?? c.platformId} size={28} />
              <div style={{ flex: 1, fontSize: "var(--text-base)" }}>
                {c.displayName ?? c.platformId} <span style={{ color: "var(--text-tertiary)" }}>({c.platformId})</span>
              </div>
              <Switch checked={selectedConnections.includes(c.id)} onChange={() => toggleConnection(c.id)} ariaLabel={`Publish to ${c.displayName ?? c.platformId}`} />
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-base)" }}>
          Caption
          <textarea value={sharedCaption} onChange={(e) => setSharedCaption(e.target.value)} rows={3} style={inputStyle} placeholder="Shared caption — customize per platform below if needed" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-base)" }}>
          Hashtags
          <div style={{ display: "flex", gap: 8 }}>
            <input value={sharedHashtags} onChange={(e) => setSharedHashtags(e.target.value)} style={inputStyle} placeholder="#example #tags" />
            {hashtagSets.length > 0 && (
              <div style={{ width: 200, flexShrink: 0 }}>
                <Select value="" onChange={insertHashtagSet} ariaLabel="Insert a saved hashtag set">
                  <option value="">Insert set…</option>
                  {hashtagSets.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </label>
      </section>

      {selectedConnections.length > 0 && selectedVideo && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>Customize per platform</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {selectedConnections.map((connId) => {
              const conn = connections.find((c) => c.id === connId);
              if (!conn) return null;
              const opts = postingOptions[connId];
              const isCustomized = customized[connId] ?? false;
              const effectiveCaption = isCustomized ? captionOverrides[connId] ?? "" : sharedCaption;
              const issues = opts ? validateForDestination(effectiveCaption, selectedVideo, opts, conn.displayName ?? conn.platformId) : [];

              return (
                <div
                  key={connId}
                  style={{
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-md)",
                    padding: 14,
                    background: "var(--panel-strong)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <PlatformBadge platformId={conn.platformId} label={conn.displayName ?? conn.platformId} size={24} />
                    <span style={{ fontSize: "var(--text-base)", fontWeight: 500, flex: 1 }}>{conn.displayName ?? conn.platformId}</span>
                    {optionsLoading[connId] ? (
                      <Skeleton width={110} height={22} />
                    ) : (
                      <button
                        type="button"
                        className="nz-btn-secondary"
                        onClick={() => setCustomized((prev) => ({ ...prev, [connId]: !prev[connId] }))}
                        style={{
                          padding: "4px 10px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-subtle)",
                          background: "transparent",
                          color: "var(--text-secondary)",
                          fontSize: "var(--text-xs)",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isCustomized ? "Use shared caption" : "Customize caption"}
                      </button>
                    )}
                  </div>

                  {isCustomized ? (
                    <textarea
                      value={captionOverrides[connId] ?? sharedCaption}
                      onChange={(e) => setCaptionOverrides((prev) => ({ ...prev, [connId]: e.target.value }))}
                      rows={2}
                      style={inputStyle}
                    />
                  ) : (
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                      {sharedCaption || <span style={{ color: "var(--text-tertiary)" }}>No caption yet.</span>}
                    </div>
                  )}

                  {opts && (
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", display: "flex", gap: 12 }}>
                      {opts.maxCaptionLength !== undefined && (
                        <span>
                          {effectiveCaption.length}/{opts.maxCaptionLength} chars
                        </span>
                      )}
                      {opts.maxDurationSeconds !== undefined && <span>Limit {formatDuration(opts.maxDurationSeconds)}</span>}
                    </div>
                  )}

                  {issues.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {issues.map((issue, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Badge tone={issue.tone}>{issue.tone === "error" ? "Blocking" : "Advisory"}</Badge>
                          <span style={{ fontSize: "var(--text-xs)", color: issue.tone === "error" ? "var(--error)" : "var(--text-secondary)" }}>{issue.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section style={{ display: "flex", gap: 16, fontSize: "var(--text-base)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input className="nz-radio" type="radio" name="scheduleMode" checked={scheduleMode === "now"} onChange={() => setScheduleMode("now")} />
          Post now
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input className="nz-radio" type="radio" name="scheduleMode" checked={scheduleMode === "later"} onChange={() => setScheduleMode("later")} />
          Schedule for later
        </label>
      </section>
      {scheduleMode === "later" && (
        <input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} style={inputStyle} aria-label="Scheduled time" required />
      )}

      {error && <div style={{ color: "var(--error)", fontSize: "var(--text-base)" }}>{error}</div>}
      {success && <div style={{ color: "var(--success)", fontSize: "var(--text-base)" }}>{success}</div>}
      {blockingErrors.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--error)", fontSize: "var(--text-base)" }}>
          <AlertTriangle size={14} /> Fix the blocking issue(s) above before submitting.
        </div>
      )}

      <div>
        <PrimaryButton type="submit" disabled={submitting || !videoId || selectedConnections.length === 0 || blockingErrors.length > 0}>
          {submitting ? "Submitting…" : scheduleMode === "now" ? "Post now" : "Schedule"}
        </PrimaryButton>
      </div>
    </form>
  );
}
