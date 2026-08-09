// In-memory mock backend — used ONLY by tests and by the explicitly-labeled
// Sandbox mode, never by default in a production build.
//
// IMPORTANT: an earlier version of this file's header comment claimed
// "App.tsx gates it behind an explicit dev-mode flag" — that was
// inaccurate; App.tsx actually imported this directly in every build,
// including production. The real gate is structural now: production
// components (App.tsx, ConnectionsPage, LibraryPage) import only the
// `Backend` interface (./backend.ts) and receive an implementation via
// BackendProvider (./backendContext.tsx). There is no import path from a
// production component to this file at all — only test files and an
// explicit "Use Sandbox Mode" entry point may import `mockBackend`
// directly. `implements Backend` below means this can't silently drift
// out of sync with what the real Tauri backend must provide.

import type { Backend } from "./backend";
import type {
  ActivityItem,
  AnalyticsOverview,
  BackupRecord,
  Campaign,
  CaptionTemplate,
  CreatorPostingOptions,
  DailyPoint,
  DestinationPost,
  DiagnosticEvent,
  HashtagSet,
  MetricDefinitionOption,
  MetricRow,
  PlatformDefinition,
  SocialConnection,
  SubmitCampaignInput,
  VideoAsset,
  Workspace,
} from "./types";

const PLATFORMS: PlatformDefinition[] = [
  {
    id: "tiktok",
    displayName: "TikTok",
    iconAsset: "tiktok",
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started/",
    registryVersion: 1,
    instructionsReviewedAt: "2026-08-01",
    isSandbox: false,
  },
  {
    id: "instagram",
    displayName: "Instagram",
    iconAsset: "instagram",
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/",
    registryVersion: 1,
    instructionsReviewedAt: "2026-08-01",
    isSandbox: false,
  },
  {
    id: "youtube",
    displayName: "YouTube",
    iconAsset: "youtube",
    docsUrl: "https://developers.google.com/youtube/v3/guides/uploading_a_video",
    registryVersion: 1,
    instructionsReviewedAt: "2026-08-01",
    isSandbox: false,
  },
  {
    id: "sandbox",
    displayName: "Sandbox (Dev Only)",
    iconAsset: "sandbox",
    docsUrl: "https://internal/none",
    registryVersion: 1,
    instructionsReviewedAt: "2026-08-01",
    isSandbox: true,
  },
];

let workspaces: Workspace[] = [];
let connections: SocialConnection[] = [];
let videos: VideoAsset[] = [];
let campaigns: Campaign[] = [];
let metrics: MetricRow[] = [];
let diagnosticEvents: DiagnosticEvent[] = [];
let captionTemplates: CaptionTemplate[] = [];
let hashtagSets: HashtagSet[] = [];
let activity: ActivityItem[] = [];
let backups: BackupRecord[] = [];
let configuredPlatformCredentials: string[] = [];
let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Test-only: resets the in-memory mock state. A separate export (rather
 * than a method on `mockBackend`) so `mockBackend` itself is structurally
 * exactly a `Backend` — no test-only surface leaking into what a real
 * backend implementation is required to look like. */
export function resetMockBackendForTests(): void {
  workspaces = [];
  connections = [];
  videos = [];
  campaigns = [];
  metrics = [];
  diagnosticEvents = [];
  captionTemplates = [];
  hashtagSets = [];
  activity = [];
  backups = [];
  configuredPlatformCredentials = [];
  idCounter = 0;
}

export const mockBackend = {
  async listPlatforms(): Promise<PlatformDefinition[]> {
    await delay(80);
    return PLATFORMS;
  },

  async listWorkspaces(): Promise<Workspace[]> {
    await delay(120);
    return workspaces;
  },

  async createWorkspace(input: {
    name: string;
    description?: string;
    accentColor?: string;
    defaultWatchFolder?: string;
  }): Promise<Workspace> {
    await delay(150);
    const ws: Workspace = {
      id: nextId("ws"),
      name: input.name,
      description: input.description,
      accentColor: input.accentColor,
      defaultWatchFolder: input.defaultWatchFolder,
      createdAt: new Date().toISOString(),
      connectedAccountCount: 0,
      enabledDestinationCount: 0,
      queuedPostCount: 0,
      connectionWarningCount: 0,
    };
    workspaces = [...workspaces, ws];
    return ws;
  },

  async updateWorkspace(input: {
    workspaceId: string;
    name: string;
    description?: string;
    accentColor?: string;
    defaultWatchFolder?: string;
  }): Promise<void> {
    await delay(120);
    workspaces = workspaces.map((w) =>
      w.id === input.workspaceId
        ? { ...w, name: input.name, description: input.description, accentColor: input.accentColor, defaultWatchFolder: input.defaultWatchFolder }
        : w,
    );
  },

  async deleteWorkspace(id: string): Promise<void> {
    await delay(150);
    workspaces = workspaces.filter((w) => w.id !== id);
    connections = connections.filter((c) => c.workspaceId !== id);
  },

  async listConnections(workspaceId: string): Promise<SocialConnection[]> {
    await delay(100);
    return connections.filter((c) => c.workspaceId === workspaceId);
  },

  /** Simulates the OAuth begin step. A real implementation calls the Rust
   * adapter's begin_authorization() and opens the URL in the system
   * browser via the Tauri shell API — this mock just fabricates a URL so
   * the UI flow (button -> "waiting for browser" state -> connected) is
   * fully exercisable without any live provider. */
  async beginConnectSandbox(workspaceId: string): Promise<SocialConnection> {
    await delay(400);
    const conn: SocialConnection = {
      id: nextId("conn"),
      workspaceId,
      platformId: "sandbox",
      displayName: "Sandbox Creator",
      username: "@sandbox_creator",
      status: "connected_enabled",
      enabled: true,
      grantedScopes: ["publish", "analytics"],
      missingScopes: [],
      lastAuthorizedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
    };
    connections = [...connections, conn];
    return conn;
  },

  /** Simulates a real OAuth connect for dev/testing -- in production this
   * is real TikTok/Instagram/YouTube OAuth (see tauriBackend.ts), UNVERIFIED
   * until real developer credentials exist. */
  async beginConnectPlatform(workspaceId: string, platformId: string): Promise<SocialConnection> {
    await delay(400);
    if (!configuredPlatformCredentials.includes(platformId)) {
      throw new Error(`No ${platformId} developer app credentials configured yet. Add a Client ID/Secret in Workspace Settings first.`);
    }
    const conn: SocialConnection = {
      id: nextId("conn"),
      workspaceId,
      platformId: platformId as SocialConnection["platformId"],
      displayName: `${platformId} creator`,
      username: `@${platformId}_creator`,
      status: "connected_enabled",
      enabled: true,
      grantedScopes: ["publish", "analytics"],
      missingScopes: [],
      lastAuthorizedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
    };
    connections = [...connections, conn];
    return conn;
  },

  async setPlatformCredentials(platformId: string, clientId: string, clientSecret: string): Promise<void> {
    await delay(100);
    if (!clientId.trim() || !clientSecret.trim()) throw new Error("Both Client ID and Client Secret are required.");
    if (!configuredPlatformCredentials.includes(platformId)) configuredPlatformCredentials = [...configuredPlatformCredentials, platformId];
  },

  async listConfiguredPlatformCredentials(): Promise<string[]> {
    await delay(60);
    return configuredPlatformCredentials;
  },

  async setConnectionEnabled(connectionId: string, enabled: boolean): Promise<void> {
    await delay(80);
    connections = connections.map((c) => (c.id === connectionId ? { ...c, enabled } : c));
  },

  async disconnect(connectionId: string): Promise<void> {
    await delay(150);
    connections = connections.filter((c) => c.id !== connectionId);
  },

  async listVideos(workspaceId: string): Promise<VideoAsset[]> {
    await delay(100);
    return videos.filter((v) => v.workspaceId === workspaceId);
  },

  /** Simulates picking a file: in the real app this calls the Rust
   * `probe_video` + `hash_file` + `generate_thumbnail` pipeline
   * (core/src/media.rs, core/src/hashing.rs) via Tauri IPC. Here it
   * fabricates a plausible result so the Library UI — validation
   * warnings, duplicate detection — is fully exercisable without ffmpeg
   * in the browser dev environment. */
  async addVideoFromPath(workspaceId: string, filePath: string): Promise<VideoAsset> {
    await delay(300);
    const filename = filePath.split(/[\\/]/).pop() ?? filePath;
    const fakeHash = `sha256:${filename}-${filePath.length}`;

    const duplicate = videos.find((v) => v.workspaceId === workspaceId && v.contentHash === fakeHash);
    if (duplicate) {
      throw new Error(`This looks like the same file as "${duplicate.originalFilename}", already in the library.`);
    }

    const video: VideoAsset = {
      id: nextId("vid"),
      workspaceId,
      filePath,
      originalFilename: filename,
      contentHash: fakeHash,
      durationSeconds: 14.5,
      width: 1080,
      height: 1920,
      codec: "h264",
      fileSizeBytes: 8_400_000,
      isVertical: true,
      tags: [],
      hasBeenPosted: false,
      createdAt: new Date().toISOString(),
      validationIssues: [],
      hasThumbnail: false,
    };
    videos = [...videos, video];
    return video;
  },

  /** No native dialog in the mock -- dev/test callers should stub this per
   * test rather than expect a real picker to appear. */
  async pickVideoFile(): Promise<string | null> {
    await delay(50);
    return null;
  },

  async getVideoThumbnail(_videoId: string): Promise<string | null> {
    await delay(50);
    return null;
  },

  async removeVideo(videoId: string): Promise<void> {
    await delay(100);
    videos = videos.filter((v) => v.id !== videoId);
  },

  /** Simulates the whole queue/scheduler pipeline synchronously: a "post
   * now" (no scheduledFor, or one already in the past) fast-forwards
   * straight to posted, exactly like the real scheduler would after its
   * next tick — so component tests never need real timers. A future
   * scheduledFor stays "scheduled" until a test explicitly advances it. */
  async submitCampaign(input: SubmitCampaignInput): Promise<Campaign> {
    await delay(150);
    const campaignId = nextId("camp");
    const scheduledFor = input.scheduledFor ?? new Date().toISOString();
    const isDue = new Date(scheduledFor).getTime() <= Date.now();

    const destinations: DestinationPost[] = input.connectionIds.map((connectionId) => {
      const conn = connections.find((c) => c.id === connectionId);
      const base: DestinationPost = {
        id: nextId("dp"),
        campaignId,
        connectionId,
        platformId: conn?.platformId ?? "sandbox",
        status: "scheduled",
        isRetryable: false,
        updatedAt: new Date().toISOString(),
      };
      if (isDue) {
        const postId = nextId("post");
        return { ...base, status: "posted", platformPostId: postId, postUrl: `https://sandbox.local/post/${postId}` };
      }
      return base;
    });

    const campaign: Campaign = {
      id: campaignId,
      workspaceId: input.workspaceId,
      videoAssetId: input.videoAssetId,
      internalName: input.internalName,
      sharedCaption: input.sharedCaption,
      sharedHashtags: input.sharedHashtags ?? [],
      status: isDue ? "posted" : "scheduled",
      scheduledFor,
      createdAt: new Date().toISOString(),
      destinations,
    };
    campaigns = [...campaigns, campaign];
    videos = videos.map((v) => (v.id === input.videoAssetId ? { ...v, hasBeenPosted: v.hasBeenPosted || isDue } : v));

    if (isDue) {
      activity = [
        { id: nextId("act"), kind: "posted", message: `Posted to ${destinations.length} destination(s).`, occurredAt: new Date().toISOString() },
        ...activity,
      ];
    }

    return campaign;
  },

  async listCampaigns(workspaceId: string): Promise<Campaign[]> {
    await delay(100);
    return campaigns.filter((c) => c.workspaceId === workspaceId);
  },

  /** Mirrors each real adapter's actual get_creator_posting_options()
   * return values (core/src/{tiktok,instagram,youtube}_adapter.rs) so a
   * mock-backed test exercises the same limits the real app would. */
  async getPostingOptions(connectionId: string): Promise<CreatorPostingOptions> {
    await delay(80);
    const conn = connections.find((c) => c.id === connectionId);
    switch (conn?.platformId) {
      case "tiktok":
        return { availablePrivacyLevels: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"], canDisableComments: true, canDisableDuet: true, canDisableStitch: true, maxDurationSeconds: 600, maxCaptionLength: 2200, postingCapRemaining: undefined };
      case "instagram":
        return { availablePrivacyLevels: ["PUBLIC"], canDisableComments: true, canDisableDuet: false, canDisableStitch: false, maxDurationSeconds: 900, maxCaptionLength: 2200, postingCapRemaining: 25 };
      case "youtube":
        return { availablePrivacyLevels: ["public", "unlisted", "private"], canDisableComments: true, canDisableDuet: false, canDisableStitch: false, maxDurationSeconds: undefined, maxCaptionLength: 100, postingCapRemaining: undefined };
      default:
        return { availablePrivacyLevels: ["public", "private"], canDisableComments: true, canDisableDuet: false, canDisableStitch: false, maxDurationSeconds: 180, maxCaptionLength: 500, postingCapRemaining: 50 };
    }
  },

  async cancelScheduledPost(destinationPostId: string): Promise<void> {
    await delay(100);
    campaigns = campaigns.map((c) => ({
      ...c,
      destinations: c.destinations.map((d) => (d.id === destinationPostId && d.status === "scheduled" ? { ...d, status: "cancelled" } : d)),
    }));
  },

  async retryDestinationPost(destinationPostId: string): Promise<void> {
    await delay(150);
    campaigns = campaigns.map((c) => ({
      ...c,
      destinations: c.destinations.map((d) => {
        if (d.id !== destinationPostId || !d.isRetryable) return d;
        const postId = nextId("post");
        return { ...d, status: "posted", isRetryable: false, errorMessage: undefined, platformPostId: postId, postUrl: `https://sandbox.local/post/${postId}` };
      }),
    }));
  },

  async syncAnalytics(connectionId: string): Promise<void> {
    await delay(200);
    const postedDestinations = campaigns.flatMap((c) => c.destinations).filter((d) => d.connectionId === connectionId && d.status === "posted");
    const now = new Date().toISOString();
    const newRows: MetricRow[] = postedDestinations.flatMap((d) => [
      { metricKey: "views", label: "Views", value: 128, notProvidedReason: null, measuredAt: now, platformPostId: d.platformPostId },
      { metricKey: "watch_time", label: "Watch time", value: 342, notProvidedReason: null, measuredAt: now, platformPostId: d.platformPostId },
      { metricKey: "audience_retention", label: "Audience retention", value: null, notProvidedReason: "Not provided by this platform", measuredAt: now, platformPostId: d.platformPostId },
    ]);
    metrics = [...metrics.filter((m) => !postedDestinations.some((d) => d.platformPostId === m.platformPostId)), ...newRows];
  },

  async listMetrics(connectionId: string): Promise<MetricRow[]> {
    await delay(100);
    const postIds = new Set(campaigns.flatMap((c) => c.destinations).filter((d) => d.connectionId === connectionId).map((d) => d.platformPostId));
    return metrics.filter((m) => postIds.has(m.platformPostId));
  },

  async listAvailableMetrics(_connectionId: string): Promise<MetricDefinitionOption[]> {
    await delay(60);
    return [
      { metricKey: "views", label: "Views" },
      { metricKey: "watch_time", label: "Watch time" },
      { metricKey: "audience_retention", label: "Audience retention" },
    ];
  },

  async getAnalyticsOverview(input: {
    connectionId: string;
    metricKey: string;
    start: string;
    end: string;
    compareStart: string;
    compareEnd: string;
  }): Promise<AnalyticsOverview> {
    await delay(150);
    const postIds = new Set(campaigns.flatMap((c) => c.destinations).filter((d) => d.connectionId === input.connectionId).map((d) => d.platformPostId));
    const rows = metrics.filter((m) => m.metricKey === input.metricKey && postIds.has(m.platformPostId));

    function bucket(startIso: string, endIso: string): DailyPoint[] {
      const byDay = new Map<string, number[]>();
      for (const r of rows) {
        const day = r.measuredAt.slice(0, 10);
        if (day < startIso.slice(0, 10) || day > endIso.slice(0, 10)) continue;
        if (r.value === null) continue;
        byDay.set(day, [...(byDay.get(day) ?? []), r.value]);
      }
      // UTC-based stepping throughout -- mixing this with local-time
      // setDate()/getDate() would drift the bucket keys by a day in any
      // timezone behind UTC, silently losing same-day data.
      const points: DailyPoint[] = [];
      const cursor = new Date(`${startIso.slice(0, 10)}T00:00:00.000Z`);
      const end = new Date(`${endIso.slice(0, 10)}T00:00:00.000Z`);
      while (cursor <= end) {
        const key = cursor.toISOString().slice(0, 10);
        const values = byDay.get(key);
        points.push({ date: key, value: values ? values.reduce((a, b) => a + b, 0) / values.length : null });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return points;
    }

    const current = bucket(input.start, input.end);
    const previous = bucket(input.compareStart, input.compareEnd);
    const currentTotal = current.reduce((sum, p) => sum + (p.value ?? 0), 0);
    const previousTotal = previous.reduce((sum, p) => sum + (p.value ?? 0), 0);
    const deltaPercent = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : null;

    return { current, previous, currentTotal, previousTotal, deltaPercent };
  },

  async getRecentPostCount(connectionId: string, minutes: number): Promise<number> {
    await delay(60);
    const cutoff = Date.now() - minutes * 60_000;
    return campaigns
      .flatMap((c) => c.destinations)
      .filter((d) => d.connectionId === connectionId && d.status === "posted" && new Date(d.updatedAt).getTime() >= cutoff).length;
  },

  async listDiagnosticEvents(_workspaceId: string, limit: number): Promise<DiagnosticEvent[]> {
    await delay(100);
    return diagnosticEvents.slice(0, limit);
  },

  async listCaptionTemplates(workspaceId: string): Promise<CaptionTemplate[]> {
    await delay(80);
    return captionTemplates.filter((t) => t.workspaceId === workspaceId);
  },

  async createCaptionTemplate(workspaceId: string, name: string, captionStructure?: string): Promise<CaptionTemplate> {
    await delay(100);
    const t: CaptionTemplate = { id: nextId("capt"), workspaceId, name, captionStructure, createdAt: new Date().toISOString() };
    captionTemplates = [...captionTemplates, t];
    return t;
  },

  async deleteCaptionTemplate(templateId: string): Promise<void> {
    await delay(80);
    captionTemplates = captionTemplates.filter((t) => t.id !== templateId);
  },

  async listHashtagSets(workspaceId: string): Promise<HashtagSet[]> {
    await delay(80);
    return hashtagSets.filter((h) => h.workspaceId === workspaceId);
  },

  async createHashtagSet(workspaceId: string, name: string, hashtags: string[], category?: string): Promise<HashtagSet> {
    await delay(100);
    const h: HashtagSet = { id: nextId("hset"), workspaceId, name, hashtags, category, createdAt: new Date().toISOString() };
    hashtagSets = [...hashtagSets, h];
    return h;
  },

  async deleteHashtagSet(hashtagSetId: string): Promise<void> {
    await delay(80);
    hashtagSets = hashtagSets.filter((h) => h.id !== hashtagSetId);
  },

  async listRecentActivity(_workspaceId: string, limit: number): Promise<ActivityItem[]> {
    await delay(80);
    return activity.slice(0, limit);
  },

  async createBackup(destinationPath: string): Promise<BackupRecord> {
    await delay(150);
    const b: BackupRecord = { id: nextId("bkp"), filePath: destinationPath, schemaVersion: "0003", createdAt: new Date().toISOString() };
    backups = [...backups, b];
    return b;
  },

  async listBackups(): Promise<BackupRecord[]> {
    await delay(80);
    return backups;
  },

  async restoreBackup(_sourcePath: string): Promise<void> {
    await delay(150);
  },
} satisfies Backend;
