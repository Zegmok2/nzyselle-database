// The single interface every frontend page depends on. Production code
// (App.tsx, ConnectionsPage, LibraryPage, ...) imports ONLY this type and
// receives a concrete implementation via BackendProvider/useBackend below
// -- never `import { mockBackend } from "./mockBackend"` directly. That's
// what makes it structurally impossible for a production build to
// silently fall back to fake in-memory data: there is no import path from
// a production component to mockBackend.ts at all.

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
  SubmitCampaignInput,
  VideoAsset,
  Workspace,
} from "./types";

export interface Backend {
  listPlatforms(): Promise<PlatformDefinition[]>;

  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(input: {
    name: string;
    description?: string;
    accentColor?: string;
    defaultWatchFolder?: string;
  }): Promise<Workspace>;
  updateWorkspace(input: {
    workspaceId: string;
    name: string;
    description?: string;
    accentColor?: string;
    defaultWatchFolder?: string;
  }): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;

  listConnections(workspaceId: string): Promise<SocialConnection[]>;
  beginConnectSandbox(workspaceId: string): Promise<SocialConnection>;
  /** Real OAuth in the system browser for tiktok/instagram/youtube. Only
   * meaningful once setPlatformCredentials has been called for that
   * platform -- UNVERIFIED end-to-end, see core/src/*_adapter.rs. */
  beginConnectPlatform(workspaceId: string, platformId: string): Promise<SocialConnection>;
  setPlatformCredentials(platformId: string, clientId: string, clientSecret: string): Promise<void>;
  listConfiguredPlatformCredentials(): Promise<string[]>;
  setConnectionEnabled(connectionId: string, enabled: boolean): Promise<void>;
  disconnect(connectionId: string): Promise<void>;

  listVideos(workspaceId: string): Promise<VideoAsset[]>;
  addVideoFromPath(workspaceId: string, filePath: string): Promise<VideoAsset>;
  /** Opens a native file picker; resolves to null if the user cancels. */
  pickVideoFile(): Promise<string | null>;
  getVideoThumbnail(videoId: string): Promise<string | null>;
  removeVideo(videoId: string): Promise<void>;

  submitCampaign(input: SubmitCampaignInput): Promise<Campaign>;
  listCampaigns(workspaceId: string): Promise<Campaign[]>;
  cancelScheduledPost(destinationPostId: string): Promise<void>;
  retryDestinationPost(destinationPostId: string): Promise<void>;

  syncAnalytics(connectionId: string): Promise<void>;
  listMetrics(connectionId: string): Promise<MetricRow[]>;
  listAvailableMetrics(connectionId: string): Promise<MetricDefinitionOption[]>;
  getAnalyticsOverview(input: {
    connectionId: string;
    metricKey: string;
    start: string;
    end: string;
    compareStart: string;
    compareEnd: string;
  }): Promise<AnalyticsOverview>;
  getRecentPostCount(connectionId: string, minutes: number): Promise<number>;

  listDiagnosticEvents(workspaceId: string, limit: number): Promise<DiagnosticEvent[]>;

  listCaptionTemplates(workspaceId: string): Promise<CaptionTemplate[]>;
  createCaptionTemplate(workspaceId: string, name: string, captionStructure?: string): Promise<CaptionTemplate>;
  deleteCaptionTemplate(templateId: string): Promise<void>;

  listHashtagSets(workspaceId: string): Promise<HashtagSet[]>;
  createHashtagSet(workspaceId: string, name: string, hashtags: string[], category?: string): Promise<HashtagSet>;
  deleteHashtagSet(hashtagSetId: string): Promise<void>;

  listRecentActivity(workspaceId: string, limit: number): Promise<ActivityItem[]>;

  createBackup(destinationPath: string): Promise<BackupRecord>;
  listBackups(): Promise<BackupRecord[]>;
  restoreBackup(sourcePath: string): Promise<void>;
}
