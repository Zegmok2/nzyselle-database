-- Nzyselle Database — initial schema (migration 0001)
--
-- Design notes:
--   * No access/refresh tokens live in this schema. SocialConnection stores
--     only a `credential_ref` string, which is a lookup key into Windows
--     Credential Manager. The actual secret never touches SQLite.
--   * Every table that represents user-visible history is append-friendly
--     (status events, upload attempts, metric observations) rather than
--     mutate-in-place, so we always have an audit trail for support/debugging
--     and can safely reconcile ambiguous provider states after a crash.
--   * Foreign keys use ON DELETE CASCADE only where the spec's deletion
--     semantics call for it (e.g. deleting a workspace's local data should
--     clean up its templates), and ON DELETE RESTRICT/SET NULL elsewhere so
--     we never silently lose analytics or post history.

PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
    version         TEXT PRIMARY KEY,
    applied_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    description     TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- Workspaces (= "account groups" in the product UI)
-- ---------------------------------------------------------------------
CREATE TABLE workspace (
    id                  TEXT PRIMARY KEY,              -- uuid
    name                TEXT NOT NULL,
    description         TEXT,
    profile_image_path  TEXT,
    accent_color        TEXT,                           -- hex, e.g. #A98BFF
    default_watch_folder TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    archived_at         TEXT,                           -- NULL = active
    last_activity_at    TEXT
);

CREATE TABLE workspace_preference (
    workspace_id            TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
    default_destinations    TEXT,                       -- JSON array of connection ids
    default_template_id     TEXT,                       -- FK added after caption_template exists
    default_scheduling_json TEXT,                       -- JSON: {mode, defaultHour, timezone, ...}
    default_analytics_range TEXT NOT NULL DEFAULT '30d', -- '24h' | '7d' | '30d' | 'custom'
    updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------
-- Platform registry — versioned capability data, NOT hardcoded in the UI.
-- One row per platform per registry version, so capability changes over
-- time remain auditable instead of being silently overwritten.
-- ---------------------------------------------------------------------
CREATE TABLE platform_definition (
    id                  TEXT PRIMARY KEY,               -- 'tiktok' | 'instagram' | 'youtube' | 'sandbox'
    display_name        TEXT NOT NULL,                  -- e.g. 'TikTok'
    icon_asset          TEXT NOT NULL,
    docs_url             TEXT NOT NULL,
    registry_version     INTEGER NOT NULL,
    instructions_reviewed_at TEXT NOT NULL,              -- date bundled instructions were last checked
    is_sandbox           INTEGER NOT NULL DEFAULT 0,      -- 1 for the mock/dev-only adapter
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE connection_capability (
    id                  TEXT PRIMARY KEY,
    platform_id         TEXT NOT NULL REFERENCES platform_definition(id) ON DELETE CASCADE,
    registry_version     INTEGER NOT NULL,
    capability_key       TEXT NOT NULL,                 -- e.g. 'direct_publish', 'scheduling_api', 'watch_time_metric'
    supported            INTEGER NOT NULL,               -- 0/1
    requires_review      INTEGER NOT NULL DEFAULT 0,
    requires_paid_access  INTEGER NOT NULL DEFAULT 0,
    notes                TEXT,
    UNIQUE(platform_id, registry_version, capability_key)
);

-- ---------------------------------------------------------------------
-- Social connections. Sensitive tokens are NEVER stored here — only a
-- reference key used to look the secret up in Windows Credential Manager.
-- ---------------------------------------------------------------------
CREATE TABLE social_connection (
    id                  TEXT PRIMARY KEY,
    workspace_id         TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    platform_id          TEXT NOT NULL REFERENCES platform_definition(id),
    credential_ref        TEXT NOT NULL,                 -- Credential Manager target name, e.g. 'nzyselle:tiktok:<uuid>'
    display_name          TEXT,
    username               TEXT,
    platform_account_id    TEXT,
    profile_image_url       TEXT,
    status                  TEXT NOT NULL DEFAULT 'not_connected',
        -- not_connected | connected_enabled | connected_disabled | needs_reauth |
        -- missing_publish_permission | missing_analytics_permission | blocked_review |
        -- rate_limited | temporarily_unavailable | requires_paid_plan | assisted_only
    enabled                  INTEGER NOT NULL DEFAULT 1,
    granted_scopes           TEXT,                        -- JSON array
    missing_scopes            TEXT,                        -- JSON array
    last_authorized_at         TEXT,
    last_synced_at              TEXT,
    created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(workspace_id, platform_id, platform_account_id)
);

CREATE TABLE oauth_grant_metadata (
    id                     TEXT PRIMARY KEY,
    connection_id           TEXT NOT NULL REFERENCES social_connection(id) ON DELETE CASCADE,
    token_expires_at          TEXT,                       -- expiry timestamp only, never the token itself
    refresh_token_present      INTEGER NOT NULL DEFAULT 0, -- boolean marker; actual token lives in Credential Manager
    pkce_used                    INTEGER NOT NULL DEFAULT 1,
    authorization_server_meta_url TEXT,
    last_refresh_attempt_at       TEXT,
    last_refresh_result            TEXT,                  -- 'success' | 'failed' | NULL
    created_at                      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------
-- Local video library
-- ---------------------------------------------------------------------
CREATE TABLE video_asset (
    id                  TEXT PRIMARY KEY,
    workspace_id         TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    file_path             TEXT NOT NULL,
    original_filename       TEXT NOT NULL,
    content_hash             TEXT NOT NULL,               -- for duplicate detection
    duration_seconds           REAL,
    width                        INTEGER,
    height                        INTEGER,
    codec                          TEXT,
    audio_codec                     TEXT,
    frame_rate                       REAL,
    file_size_bytes                    INTEGER,
    is_vertical                          INTEGER,
    outfit_name                           TEXT,
    cac_code                                TEXT,
    notes                                     TEXT,
    source_watch_folder                        TEXT,
    created_at                                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    file_created_at                               TEXT,
    file_modified_at                               TEXT,
    archived_at                                     TEXT
);
CREATE INDEX idx_video_asset_workspace ON video_asset(workspace_id);
CREATE INDEX idx_video_asset_hash ON video_asset(content_hash);

CREATE TABLE video_thumbnail (
    id                  TEXT PRIMARY KEY,
    video_asset_id        TEXT NOT NULL REFERENCES video_asset(id) ON DELETE CASCADE,
    file_path               TEXT NOT NULL,
    timestamp_seconds         REAL NOT NULL,
    is_primary                  INTEGER NOT NULL DEFAULT 0,
    created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE video_tag (
    id             TEXT PRIMARY KEY,
    video_asset_id   TEXT NOT NULL REFERENCES video_asset(id) ON DELETE CASCADE,
    tag                TEXT NOT NULL,
    UNIQUE(video_asset_id, tag)
);

-- ---------------------------------------------------------------------
-- Publishing: one campaign (parent job) fans out into destination posts
-- (child jobs), one per selected social connection.
-- ---------------------------------------------------------------------
CREATE TABLE publishing_campaign (
    id                  TEXT PRIMARY KEY,
    workspace_id          TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    video_asset_id          TEXT NOT NULL REFERENCES video_asset(id),
    internal_name             TEXT,
    shared_caption              TEXT,
    shared_hashtags               TEXT,                  -- JSON array
    approved_config_json          TEXT NOT NULL,          -- immutable snapshot of what the user confirmed
    status                          TEXT NOT NULL DEFAULT 'local_draft',
        -- local_draft | scheduled | waiting_for_computer | preparing | validating |
        -- uploading | processing | posted | partially_posted | failed | cancelled
    scheduled_for                    TEXT,                 -- NULL = post now / draft
    timezone                          TEXT,
    created_at                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    confirmed_at                          TEXT,             -- when the user clicked the final confirm button
    updated_at                              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_campaign_workspace ON publishing_campaign(workspace_id);
CREATE INDEX idx_campaign_scheduled ON publishing_campaign(scheduled_for);

CREATE TABLE destination_post (
    id                  TEXT PRIMARY KEY,                 -- immutable job id
    campaign_id           TEXT NOT NULL REFERENCES publishing_campaign(id) ON DELETE CASCADE,
    connection_id           TEXT NOT NULL REFERENCES social_connection(id),
    status                    TEXT NOT NULL DEFAULT 'local_draft',
        -- mirrors campaign status enum, but tracked independently per destination
        -- so one platform's failure never blocks or repeats another's success
    platform_post_id           TEXT,
    post_url                     TEXT,
    error_code                     TEXT,
    error_message                   TEXT,
    is_retryable                      INTEGER NOT NULL DEFAULT 0,
    created_at                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at                            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_destination_post_campaign ON destination_post(campaign_id);
CREATE INDEX idx_destination_post_connection ON destination_post(connection_id);

CREATE TABLE sound_reference (
    id                  TEXT PRIMARY KEY,
    workspace_id          TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    platform_id             TEXT NOT NULL REFERENCES platform_definition(id),
    source_url                 TEXT,
    name                          TEXT NOT NULL,
    notes                           TEXT,
    preferred_start_seconds           REAL,
    recommended_original_volume         REAL,               -- 0.0 - 1.0
    recommended_added_volume              REAL,              -- 0.0 - 1.0
    is_favorite                             INTEGER NOT NULL DEFAULT 0,
    created_at                                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE destination_configuration (
    id                  TEXT PRIMARY KEY,
    destination_post_id   TEXT NOT NULL REFERENCES destination_post(id) ON DELETE CASCADE,
    caption_override         TEXT,
    cover_timestamp_seconds    REAL,
    privacy_level                TEXT,
    posting_mode                    TEXT,                  -- e.g. tiktok: direct|draft|assisted
    disclosures_json                   TEXT,                -- JSON: {brandedContent, aiGenerated, madeForKids, ...}
    platform_specific_json               TEXT,               -- JSON blob for fields unique to one adapter
    sound_reference_id                     TEXT REFERENCES sound_reference(id)
);

CREATE TABLE upload_attempt (
    id                  TEXT PRIMARY KEY,
    destination_post_id   TEXT NOT NULL REFERENCES destination_post(id) ON DELETE CASCADE,
    attempt_number           INTEGER NOT NULL,
    started_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at                  TEXT,
    outcome                        TEXT,                    -- 'success' | 'retryable_failure' | 'permanent_failure'
    http_status                      INTEGER,
    provider_error_code                 TEXT,
    correlation_id                        TEXT,
    bytes_uploaded                          INTEGER,
    bytes_total                               INTEGER
);

CREATE TABLE post_status_event (
    id                  TEXT PRIMARY KEY,
    destination_post_id   TEXT NOT NULL REFERENCES destination_post(id) ON DELETE CASCADE,
    status                   TEXT NOT NULL,
    message                     TEXT,
    occurred_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_post_status_event_dest ON post_status_event(destination_post_id);

CREATE TABLE schedule (
    id                  TEXT PRIMARY KEY,
    campaign_id           TEXT NOT NULL REFERENCES publishing_campaign(id) ON DELETE CASCADE,
    scheduled_for            TEXT NOT NULL,
    timezone                    TEXT NOT NULL,
    resume_policy                  TEXT NOT NULL DEFAULT 'ask',  -- 'auto' | 'ask' | 'skip'
    missed_reason                    TEXT,
    created_at                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------
CREATE TABLE caption_template (
    id                  TEXT PRIMARY KEY,
    workspace_id          TEXT REFERENCES workspace(id) ON DELETE CASCADE, -- NULL = global template
    name                     TEXT NOT NULL,
    caption_structure           TEXT,
    platform_overrides_json       TEXT,
    default_destinations_json       TEXT,
    privacy_defaults_json              TEXT,
    disclosure_defaults_json             TEXT,
    scheduling_defaults_json               TEXT,
    tiktok_mode                              TEXT,
    instagram_mode                             TEXT,
    created_at                                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at                                     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE hashtag_set (
    id                  TEXT PRIMARY KEY,
    workspace_id          TEXT REFERENCES workspace(id) ON DELETE CASCADE, -- NULL = global
    name                     TEXT NOT NULL,
    hashtags_json               TEXT NOT NULL,             -- JSON array
    category                       TEXT,                    -- roblox, r15, angel, cottagecore, ...
    created_at                        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------
-- Analytics
-- ---------------------------------------------------------------------
CREATE TABLE metric_definition (
    id                  TEXT PRIMARY KEY,                  -- e.g. 'tiktok.video_views'
    platform_id            TEXT NOT NULL REFERENCES platform_definition(id),
    metric_key                TEXT NOT NULL,
    label                        TEXT NOT NULL,
    definition                     TEXT NOT NULL,           -- human-readable explanation of what this counts
    is_lifetime                       INTEGER NOT NULL,      -- 0 = interval-based, 1 = lifetime
    is_estimated                        INTEGER NOT NULL DEFAULT 0,
    source_api_version                     TEXT,
    UNIQUE(platform_id, metric_key)
);

CREATE TABLE metric_observation (
    id                  TEXT PRIMARY KEY,
    destination_post_id   TEXT NOT NULL REFERENCES destination_post(id) ON DELETE CASCADE,
    metric_definition_id     TEXT NOT NULL REFERENCES metric_definition(id),
    value                       REAL,
    measured_at                    TEXT NOT NULL,
    reporting_period_start           TEXT,
    reporting_period_end               TEXT,
    synced_at                            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(destination_post_id, metric_definition_id, measured_at)
);
CREATE INDEX idx_metric_obs_dest ON metric_observation(destination_post_id);

CREATE TABLE analytics_sync (
    id                  TEXT PRIMARY KEY,
    connection_id          TEXT NOT NULL REFERENCES social_connection(id) ON DELETE CASCADE,
    started_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at                  TEXT,
    outcome                        TEXT,                    -- 'success' | 'partial' | 'failed'
    posts_synced                      INTEGER,
    error_message                        TEXT
);

-- ---------------------------------------------------------------------
-- Notifications, diagnostics, settings, backups, migrations
-- ---------------------------------------------------------------------
CREATE TABLE notification (
    id                  TEXT PRIMARY KEY,
    workspace_id           TEXT REFERENCES workspace(id) ON DELETE CASCADE, -- NULL = global
    category                  TEXT NOT NULL,
    title                        TEXT NOT NULL,
    body                            TEXT,
    is_read                           INTEGER NOT NULL DEFAULT 0,
    created_at                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE diagnostic_event (
    id                  TEXT PRIMARY KEY,
    platform_id            TEXT REFERENCES platform_definition(id),
    connection_id             TEXT REFERENCES social_connection(id),
    severity                     TEXT NOT NULL,             -- info | warning | error
    plain_message                   TEXT NOT NULL,
    technical_error_code               TEXT,
    http_status                           INTEGER,
    correlation_id                           TEXT,
    sanitized_response_json                    TEXT,        -- MUST NOT contain tokens/secrets
    occurred_at                                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE app_setting (
    key                 TEXT PRIMARY KEY,
    value                  TEXT NOT NULL,                   -- JSON-encoded
    updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE backup_record (
    id                  TEXT PRIMARY KEY,
    file_path              TEXT NOT NULL,
    schema_version            TEXT NOT NULL,
    included_credentials         INTEGER NOT NULL DEFAULT 0,
    encrypted                       INTEGER NOT NULL DEFAULT 0,
    created_at                        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE migration_record (
    id                  TEXT PRIMARY KEY,
    from_version           TEXT,
    to_version                TEXT NOT NULL,
    applied_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    outcome                        TEXT NOT NULL              -- 'success' | 'failed'
);

INSERT INTO schema_migrations(version, description)
VALUES ('0001', 'Initial schema: workspaces, platform registry, connections, video library, publishing pipeline, templates, analytics, diagnostics, settings, backups');
