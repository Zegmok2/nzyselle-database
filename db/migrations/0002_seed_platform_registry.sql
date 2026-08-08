-- Seeds platform_definition + connection_capability with the initial
-- registry (version 1). This is data, not code — updating a platform's
-- capabilities means adding rows here (or a future migration), never
-- editing UI components.

INSERT OR IGNORE INTO platform_definition (id, display_name, icon_asset, docs_url, registry_version, instructions_reviewed_at, is_sandbox) VALUES
('tiktok',    'TikTok',          'icons/tiktok.svg',    'https://developers.tiktok.com/doc/content-posting-api-get-started/', 1, '2026-08-01', 0),
('instagram', 'Instagram',       'icons/instagram.svg', 'https://developers.facebook.com/docs/instagram-platform/',            1, '2026-08-01', 0),
('youtube',   'YouTube',         'icons/youtube.svg',   'https://developers.google.com/youtube/v3/guides/uploading_a_video',   1, '2026-08-01', 0),
('sandbox',   'Sandbox (Dev Only)', 'icons/sandbox.svg', 'https://internal/none', 1, '2026-08-01', 1);

-- A representative slice of capability rows per platform. Not exhaustive —
-- this is the seed pattern; real deployments extend this table as the
-- registry is verified against current API docs, dated per capability set
-- via platform_definition.instructions_reviewed_at.
INSERT OR IGNORE INTO connection_capability (id, platform_id, registry_version, capability_key, supported, requires_review, requires_paid_access, notes) VALUES
-- TikTok
('cap_tt_1',  'tiktok', 1, 'oauth_connection',        1, 0, 0, NULL),
('cap_tt_2',  'tiktok', 1, 'direct_publish',           1, 1, 0, 'Requires TikTok app audit for unaudited apps to post beyond the developer''s own account'),
('cap_tt_3',  'tiktok', 1, 'draft_upload',              1, 1, 0, 'Also gated by audit status'),
('cap_tt_4',  'tiktok', 1, 'scheduling_api',             0, 0, 0, 'Not currently offered by the Content Posting API'),
('cap_tt_5',  'tiktok', 1, 'cover_selection',              1, 0, 0, NULL),
('cap_tt_6',  'tiktok', 1, 'sound_library_search',           0, 0, 0, 'No official endpoint for searching/attaching licensed sounds'),
('cap_tt_7',  'tiktok', 1, 'video_metrics',                    1, 0, 0, 'Available for videos posted via the API to an authorized account'),
('cap_tt_8',  'tiktok', 1, 'watch_time_metric',                  0, 0, 0, 'Not provided by this platform'),
-- Instagram
('cap_ig_1',  'instagram', 1, 'oauth_connection',    1, 0, 0, NULL),
('cap_ig_2',  'instagram', 1, 'direct_publish',        1, 0, 0, 'Requires a professional (business/creator) account linked to a Facebook Page'),
('cap_ig_3',  'instagram', 1, 'native_music_selection',  0, 0, 0, 'Native licensed-music selection is not exposed via the Graph API; use Finish in Instagram mode'),
('cap_ig_4',  'instagram', 1, 'reach_metric',               1, 0, 0, NULL),
('cap_ig_5',  'instagram', 1, 'saves_metric',                  1, 0, 0, NULL),
-- YouTube
('cap_yt_1',  'youtube', 1, 'oauth_connection',      1, 0, 0, NULL),
('cap_yt_2',  'youtube', 1, 'resumable_upload',        1, 0, 0, NULL),
('cap_yt_3',  'youtube', 1, 'scheduling_api',            1, 0, 0, 'Set status.privacyStatus=private with publishAt'),
('cap_yt_4',  'youtube', 1, 'audience_retention_metric',  1, 0, 0, 'Requires YouTube Analytics API, separate scope from Data API'),
('cap_yt_5',  'youtube', 1, 'public_upload_without_review', 0, 1, 0, 'New API projects are audit/quota-restricted for public uploads until verified'),
-- Sandbox (mock, dev-only — mirrors a generic platform so the whole
-- pipeline is end-to-end testable without live credentials)
('cap_sb_1',  'sandbox', 1, 'oauth_connection',   1, 0, 0, NULL),
('cap_sb_2',  'sandbox', 1, 'direct_publish',       1, 0, 0, NULL),
('cap_sb_3',  'sandbox', 1, 'video_metrics',          1, 0, 0, NULL),
('cap_sb_4',  'sandbox', 1, 'watch_time_metric',        1, 0, 0, NULL);

INSERT OR IGNORE INTO metric_definition (id, platform_id, metric_key, label, definition, is_lifetime, is_estimated, source_api_version) VALUES
('md_tt_views',   'tiktok',    'views',      'Views',    'Number of times the video started playing, per TikTok''s Display API definition.', 0, 0, 'v2'),
('md_ig_reach',   'instagram', 'reach',      'Reach',    'Number of unique accounts that saw the media, per Meta Graph API.',                 0, 0, 'v19.0'),
('md_yt_views',   'youtube',   'views',      'Views',    'Number of qualified views counted by YouTube, per YouTube Analytics API.',           0, 0, 'v2'),
('md_sb_views',   'sandbox',   'views',      'Views',    'Simulated view count for development/testing only.',                                0, 0, 'mock'),
('md_sb_watch',   'sandbox',   'watch_time', 'Watch time', 'Simulated cumulative watch time for development/testing only.',                    0, 0, 'mock');
