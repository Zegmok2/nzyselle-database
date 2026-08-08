// The real, production backend. Every method is a thin `invoke()` call
// against a Rust command in src-tauri/src/commands.rs. This file has NOT
// been exercised against a compiled Tauri binary in the environment that
// wrote it (see README.md's toolchain limitations) — the command names
// and argument shapes are kept in exact sync with commands.rs and main.rs's
// invoke_handler! list, but treat this pairing as reviewed, not verified,
// until it's actually run with `npm run tauri dev`.

import { invoke } from "@tauri-apps/api/core";
import type { Backend } from "./backend";
import type {
  ActivityItem,
  AnalyticsOverview,
  BackupRecord,
  Campaign,
  CaptionTemplate,
  DiagnosticEvent,
  HashtagSet,
  MetricDefinitionOption,
  MetricRow,
  PlatformDefinition,
  SocialConnection,
  VideoAsset,
  Workspace,
} from "./types";

export const tauriBackend: Backend = {
  listPlatforms: () => invoke<PlatformDefinition[]>("list_platforms"),

  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),

  createWorkspace: (input) => invoke<Workspace>("create_workspace", { input }),

  updateWorkspace: (input) =>
    invoke<void>("update_workspace", {
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      accentColor: input.accentColor,
      defaultWatchFolder: input.defaultWatchFolder,
    }),

  deleteWorkspace: (id) => invoke<void>("delete_workspace", { workspaceId: id }),

  listConnections: (workspaceId) => invoke<SocialConnection[]>("list_connections", { workspaceId }),

  beginConnectSandbox: (workspaceId) => invoke<SocialConnection>("begin_connect_sandbox", { workspaceId }),

  beginConnectPlatform: (workspaceId, platformId) => invoke<SocialConnection>("begin_connect_platform", { workspaceId, platformId }),
  setPlatformCredentials: (platformId, clientId, clientSecret) => invoke<void>("set_platform_credentials", { platformId, clientId, clientSecret }),
  listConfiguredPlatformCredentials: () => invoke<string[]>("list_configured_platform_credentials"),

  setConnectionEnabled: (connectionId, enabled) =>
    invoke<void>("set_connection_enabled", { connectionId, enabled }),

  disconnect: (connectionId) => invoke<void>("disconnect_connection", { connectionId }),

  listVideos: (workspaceId) => invoke<VideoAsset[]>("list_videos", { workspaceId }),

  addVideoFromPath: (workspaceId, filePath) =>
    invoke<VideoAsset>("add_video_from_path", { workspaceId, filePath }),

  pickVideoFile: () => invoke<string | null>("pick_video_file"),
  getVideoThumbnail: (videoId) => invoke<string | null>("get_video_thumbnail", { videoId }),

  removeVideo: (videoId) => invoke<void>("remove_video", { videoId }),

  submitCampaign: (input) => invoke<Campaign>("submit_campaign", { input }),
  listCampaigns: (workspaceId) => invoke<Campaign[]>("list_campaigns", { workspaceId }),
  cancelScheduledPost: (destinationPostId) => invoke<void>("cancel_scheduled_post", { destinationPostId }),
  retryDestinationPost: (destinationPostId) => invoke<void>("retry_destination_post", { destinationPostId }),

  syncAnalytics: (connectionId) => invoke<void>("sync_analytics", { connectionId }),
  listMetrics: (connectionId) => invoke<MetricRow[]>("list_metrics", { connectionId }),
  listAvailableMetrics: (connectionId) => invoke<MetricDefinitionOption[]>("list_available_metrics", { connectionId }),
  getAnalyticsOverview: (input) =>
    invoke<AnalyticsOverview>("get_analytics_overview", {
      connectionId: input.connectionId,
      metricKey: input.metricKey,
      start: input.start,
      end: input.end,
      compareStart: input.compareStart,
      compareEnd: input.compareEnd,
    }),
  getRecentPostCount: (connectionId, minutes) => invoke<number>("get_recent_post_count", { connectionId, minutes }),

  listDiagnosticEvents: (workspaceId, limit) => invoke<DiagnosticEvent[]>("list_diagnostic_events", { workspaceId, limit }),

  listCaptionTemplates: (workspaceId) => invoke<CaptionTemplate[]>("list_caption_templates", { workspaceId }),
  createCaptionTemplate: (workspaceId, name, captionStructure) =>
    invoke<CaptionTemplate>("create_caption_template", { workspaceId, name, captionStructure }),
  deleteCaptionTemplate: (templateId) => invoke<void>("delete_caption_template", { templateId }),

  listHashtagSets: (workspaceId) => invoke<HashtagSet[]>("list_hashtag_sets", { workspaceId }),
  createHashtagSet: (workspaceId, name, hashtags, category) =>
    invoke<HashtagSet>("create_hashtag_set", { workspaceId, name, hashtags, category }),
  deleteHashtagSet: (hashtagSetId) => invoke<void>("delete_hashtag_set", { hashtagSetId }),

  listRecentActivity: (workspaceId, limit) => invoke<ActivityItem[]>("list_recent_activity", { workspaceId, limit }),

  createBackup: (destinationPath) => invoke<BackupRecord>("create_backup", { destinationPath }),
  listBackups: () => invoke<BackupRecord[]>("list_backups"),
  restoreBackup: (sourcePath) => invoke<void>("restore_backup", { sourcePath }),
};

/** True only when running inside the actual Tauri webview (injected by
 * Tauri itself at startup). Used to refuse falling back to fake data in a
 * production build that's somehow missing its native shell — per spec,
 * that must show a configuration error, not silently use mock data. */
export function isRunningInTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
