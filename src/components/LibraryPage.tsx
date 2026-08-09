import { useEffect, useState } from "react";
import type { VideoAsset } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { Badge, ConfirmDialog, EmptyState, PageToolbar, PrimaryButton, SecondaryButton, Skeleton } from "./dashboard/Toolbar";
import { Video as VideoIcon } from "lucide-react";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function Thumbnail({ video }: { video: VideoAsset }) {
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
        width: 44,
        height: 78,
        borderRadius: "var(--radius-sm)",
        background: url ? `center / cover no-repeat url(${url})` : "var(--panel-soft)",
        flexShrink: 0,
        border: "1px solid var(--border-subtle)",
      }}
    />
  );
}

export function LibraryPage({ workspaceId }: { workspaceId: string }) {
  const backend = useBackend();
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<VideoAsset | null>(null);

  useEffect(() => {
    let cancelled = false;
    backend.listVideos(workspaceId).then((v) => {
      if (!cancelled) {
        setVideos(v);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [backend, workspaceId]);

  async function handlePickAndAdd() {
    setAddError(null);
    const path = await backend.pickVideoFile();
    if (!path) return; // user cancelled
    setAdding(true);
    try {
      const video = await backend.addVideoFromPath(workspaceId, path);
      setVideos((prev) => [...prev, video]);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Couldn't add this video.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: string) {
    setVideos((prev) => prev.filter((v) => v.id !== id));
    await backend.removeVideo(id);
  }

  const filtered = videos.filter((v) =>
    v.originalFilename.toLowerCase().includes(query.toLowerCase()) ||
    (v.outfitName ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={32} width={160} />
        <Skeleton height={78} />
        <Skeleton height={78} />
        <Skeleton height={78} />
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <PageToolbar
        title="Library"
        description="Adding a video here never posts it anywhere — it just makes it available to pick from on the Publish page."
        search={{ value: query, onChange: setQuery, placeholder: "Search by filename or outfit name", ariaLabel: "Search library" }}
        actions={
          <PrimaryButton onClick={handlePickAndAdd} disabled={adding}>
            {adding ? "Adding…" : "+ Add video"}
          </PrimaryButton>
        }
      />
      {addError && <div style={{ color: "var(--error)", fontSize: "var(--text-base)" }}>{addError}</div>}

      {filtered.length === 0 ? (
        <EmptyState icon={<VideoIcon size={28} />} message={videos.length === 0 ? "No videos yet." : "No videos match your search."} />
      ) : (
        <div
          style={{
            background: "var(--panel-strong)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
          }}
        >
          {filtered.map((v, i) => (
            <div
              key={v.id}
              className="nz-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: 14,
                borderBottom: i < filtered.length - 1 ? "1px solid var(--border-subtle)" : "none",
              }}
            >
              <Thumbnail video={v} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: "var(--text-md)" }}>{v.originalFilename}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>
                  {formatDuration(v.durationSeconds)} · {v.width}×{v.height}
                  {v.isVertical ? " (vertical)" : ""} · {formatSize(v.fileSizeBytes)} · {v.codec}
                </div>
                {v.hasBeenPosted && (
                  <div style={{ marginTop: 6 }}>
                    <Badge tone="info">Already posted</Badge>
                  </div>
                )}
              </div>
              <SecondaryButton onClick={() => setPendingRemove(v)}>Remove</SecondaryButton>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove this video?"
        message={pendingRemove ? `"${pendingRemove.originalFilename}" will be removed from the Library. This doesn't delete the file from disk, and doesn't affect posts already made from it.` : ""}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          if (pendingRemove) handleRemove(pendingRemove.id);
          setPendingRemove(null);
        }}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
