// Domain types mirroring db/migrations/0001_init.sql and core/src/adapter.rs.
// Kept intentionally close to the Rust side so the eventual Tauri IPC layer
// is a thin serialization boundary, not a re-modeling exercise.

export type ConnectionStatus =
  | "not_connected"
  | "connected_enabled"
  | "connected_disabled"
  | "needs_reauth"
  | "missing_publish_permission"
  | "missing_analytics_permission"
  | "blocked_review"
  | "rate_limited"
  | "temporarily_unavailable"
  | "requires_paid_plan"
  | "assisted_only";

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  profileImagePath?: string;
  accentColor?: string;
  defaultWatchFolder?: string;
  createdAt: string;
  lastActivityAt?: string;
  archivedAt?: string;
  // Denormalized summary fields for the account-groups grid — computed by
  // the backend, never faked with zeros when data simply doesn't exist yet.
  connectedAccountCount: number;
  enabledDestinationCount: number;
  queuedPostCount: number;
  connectionWarningCount: number;
}

export interface PlatformDefinition {
  id: "tiktok" | "instagram" | "youtube" | "sandbox";
  displayName: string;
  iconAsset: string;
  docsUrl: string;
  registryVersion: number;
  instructionsReviewedAt: string;
  isSandbox: boolean;
}

export interface SocialConnection {
  id: string;
  workspaceId: string;
  platformId: PlatformDefinition["id"];
  displayName?: string;
  username?: string;
  platformAccountId?: string;
  profileImageUrl?: string;
  status: ConnectionStatus;
  enabled: boolean;
  grantedScopes: string[];
  missingScopes: string[];
  lastAuthorizedAt?: string;
  lastSyncedAt?: string;
}

export interface CapabilityInfo {
  key: string;
  supported: boolean;
  requiresReview: boolean;
  requiresPaidAccess: boolean;
  notes?: string;
}

/** Real per-platform posting limits, straight from the connection's own
 * adapter (core/src/adapter.rs's CreatorPostingOptions) -- never
 * fabricated frontend constants. Any field can be null/absent when the
 * platform doesn't document a limit. */
export interface CreatorPostingOptions {
  availablePrivacyLevels: string[];
  canDisableComments: boolean;
  canDisableDuet: boolean;
  canDisableStitch: boolean;
  maxDurationSeconds?: number;
  maxCaptionLength?: number;
  postingCapRemaining?: number;
}

/** The literal string the UI must render for any metric the platform
 * doesn't provide. Never substitute a zero. */
export const NOT_PROVIDED = "Not provided by this platform";

export interface VideoAsset {
  id: string;
  workspaceId: string;
  filePath: string;
  originalFilename: string;
  contentHash: string;
  durationSeconds: number;
  width: number;
  height: number;
  codec: string;
  fileSizeBytes: number;
  isVertical: boolean;
  outfitName?: string;
  cacCode?: string;
  tags: string[];
  hasBeenPosted: boolean;
  createdAt: string;
  validationIssues: string[];
  hasThumbnail: boolean;
}

export type DestinationPostStatus =
  | "local_draft"
  | "scheduled"
  | "uploading"
  | "posted"
  | "partially_posted"
  | "failed"
  | "cancelled";

export interface DestinationPost {
  id: string;
  campaignId: string;
  connectionId: string;
  platformId: PlatformDefinition["id"];
  status: DestinationPostStatus;
  platformPostId?: string;
  postUrl?: string;
  errorMessage?: string;
  isRetryable: boolean;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  workspaceId: string;
  videoAssetId: string;
  internalName?: string;
  sharedCaption?: string;
  sharedHashtags: string[];
  status: DestinationPostStatus;
  scheduledFor?: string;
  createdAt: string;
  destinations: DestinationPost[];
}

export interface SubmitCampaignInput {
  workspaceId: string;
  videoAssetId: string;
  internalName?: string;
  sharedCaption?: string;
  sharedHashtags?: string[];
  connectionIds: string[];
  captionOverrides?: Record<string, string>;
  /** ISO timestamp; omit to post now. */
  scheduledFor?: string;
  timezone?: string;
}

export interface MetricDefinitionOption {
  metricKey: string;
  label: string;
}

export interface DailyPoint {
  date: string;
  value: number | null;
}

export interface AnalyticsOverview {
  current: DailyPoint[];
  previous: DailyPoint[];
  currentTotal: number;
  previousTotal: number;
  deltaPercent: number | null;
}

export interface MetricRow {
  metricKey: string;
  label: string;
  value: number | null;
  notProvidedReason: string | null;
  measuredAt: string;
  platformPostId?: string;
}

export interface DiagnosticEvent {
  id: string;
  platformId?: string;
  connectionId?: string;
  severity: "info" | "warning" | "error";
  plainMessage: string;
  technicalErrorCode?: string;
  occurredAt: string;
}

export interface CaptionTemplate {
  id: string;
  workspaceId?: string;
  name: string;
  captionStructure?: string;
  createdAt: string;
}

export interface HashtagSet {
  id: string;
  workspaceId?: string;
  name: string;
  hashtags: string[];
  category?: string;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  kind: string;
  message: string;
  occurredAt: string;
}

export interface BackupRecord {
  id: string;
  filePath: string;
  schemaVersion: string;
  createdAt: string;
}
