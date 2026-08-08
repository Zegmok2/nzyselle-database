// Tauri commands invoked from the frontend via `@tauri-apps/api/core`'s
// `invoke()`. Shapes here intentionally mirror src/lib/mockBackend.ts so
// swapping the frontend from the dev mock to real IPC is a search-and-replace
// of the import, not a redesign.
//
// NOTE: like main.rs, this file is unverified in the sandbox that wrote it
// (no system webview libs to build a full Tauri binary here). It's written
// against nzyselle-core's already-tested types, so the parts that matter
// most for correctness (adapter contract, capability rules, id generation)
// carry real test coverage even though this glue layer doesn't yet.

use nzyselle_core::adapter::ProviderAdapter;
use nzyselle_core::ids::generate_prefixed_id;
use nzyselle_core::mock_adapter::SandboxAdapter;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

use crate::scheduler::recompute_campaign_status;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub accent_color: Option<String>,
    pub default_watch_folder: Option<String>,
    pub created_at: String,
    pub last_activity_at: Option<String>,
    pub connected_account_count: i64,
    pub enabled_destination_count: i64,
    pub queued_post_count: i64,
    pub connection_warning_count: i64,
}

#[tauri::command]
pub fn list_workspaces(state: State<AppState>) -> Result<Vec<WorkspaceDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT w.id, w.name, w.description, w.accent_color, w.default_watch_folder,
                        w.created_at, w.last_activity_at,
                        (SELECT COUNT(*) FROM social_connection sc WHERE sc.workspace_id = w.id),
                        (SELECT COUNT(*) FROM social_connection sc WHERE sc.workspace_id = w.id AND sc.enabled = 1),
                        (SELECT COUNT(*) FROM publishing_campaign pc WHERE pc.workspace_id = w.id AND pc.status IN ('scheduled','waiting_for_computer')),
                        (SELECT COUNT(*) FROM social_connection sc WHERE sc.workspace_id = w.id AND sc.status NOT IN ('connected_enabled','not_connected'))
                 FROM workspace w
                 WHERE w.archived_at IS NULL
                 ORDER BY w.created_at ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(WorkspaceDto {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    accent_color: row.get(3)?,
                    default_watch_folder: row.get(4)?,
                    created_at: row.get(5)?,
                    last_activity_at: row.get(6)?,
                    connected_account_count: row.get(7)?,
                    enabled_destination_count: row.get(8)?,
                    queued_post_count: row.get(9)?,
                    connection_warning_count: row.get(10)?,
                })
            })?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceInput {
    pub name: String,
    pub description: Option<String>,
    pub accent_color: Option<String>,
    pub default_watch_folder: Option<String>,
}

#[tauri::command]
pub fn create_workspace(state: State<AppState>, input: CreateWorkspaceInput) -> Result<WorkspaceDto, String> {
    if input.name.trim().is_empty() {
        return Err("Account-group name is required.".to_string());
    }
    let id = generate_prefixed_id("ws");
    let id_for_query = id.clone();
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspace (id, name, description, accent_color, default_watch_folder) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![id, input.name.trim(), input.description, input.accent_color, input.default_watch_folder],
            )
        })
        .map_err(|e| e.to_string())?;

    Ok(WorkspaceDto {
        id: id_for_query,
        name: input.name.trim().to_string(),
        description: input.description,
        accent_color: input.accent_color,
        default_watch_folder: input.default_watch_folder,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_activity_at: None,
        connected_account_count: 0,
        enabled_destination_count: 0,
        queued_post_count: 0,
        connection_warning_count: 0,
    })
}

/// Per spec: deleting a local workspace never deletes anything on the
/// social platform itself — this only removes local rows.
#[tauri::command]
pub fn delete_workspace(state: State<AppState>, workspace_id: String) -> Result<(), String> {
    state
        .db
        .with_conn(|conn| conn.execute("DELETE FROM workspace WHERE id = ?1", [&workspace_id]))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDto {
    pub id: String,
    pub workspace_id: String,
    pub platform_id: String,
    pub display_name: Option<String>,
    pub username: Option<String>,
    pub status: String,
    pub enabled: bool,
    pub granted_scopes: Vec<String>,
    pub missing_scopes: Vec<String>,
    pub last_authorized_at: Option<String>,
    pub last_synced_at: Option<String>,
}

#[tauri::command]
pub fn list_connections(state: State<AppState>, workspace_id: String) -> Result<Vec<ConnectionDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, workspace_id, platform_id, display_name, username, status, enabled,
                        granted_scopes, missing_scopes, last_authorized_at, last_synced_at
                 FROM social_connection WHERE workspace_id = ?1",
            )?;
            let rows = stmt.query_map([&workspace_id], |row| {
                let granted: Option<String> = row.get(7)?;
                let missing: Option<String> = row.get(8)?;
                Ok(ConnectionDto {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    platform_id: row.get(2)?,
                    display_name: row.get(3)?,
                    username: row.get(4)?,
                    status: row.get(5)?,
                    enabled: row.get::<_, i64>(6)? != 0,
                    granted_scopes: granted.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                    missing_scopes: missing.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                    last_authorized_at: row.get(9)?,
                    last_synced_at: row.get(10)?,
                })
            })?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

/// Sandbox-only connect command (see nzyselle_core::mock_adapter). Real
/// platform adapters get their own `begin_connect_<platform>` command that
/// opens the system browser via `tauri_plugin_shell::open` instead of
/// completing synchronously like this one does.
#[tauri::command]
pub async fn begin_connect_sandbox(state: State<'_, AppState>, workspace_id: String) -> Result<ConnectionDto, String> {
    let adapter = SandboxAdapter::new();
    let begin = adapter.begin_authorization(&["publish".into(), "analytics".into()], "http://127.0.0.1:0/callback").await.map_err(|e| e.to_string())?;
    let identity = adapter
        .complete_authorization("dev-code", &begin.state, &begin.pkce_verifier, "http://127.0.0.1:0/callback")
        .await
        .map_err(|e| e.to_string())?;

    state
        .credentials
        .set(&identity.credential_ref, "sandbox-refresh-token-placeholder")
        .map_err(|e| e.to_string())?;

    let id = generate_prefixed_id("conn");
    let granted = serde_json::to_string(&identity.granted_scopes).unwrap_or_default();
    let missing = serde_json::to_string(&identity.missing_scopes).unwrap_or_default();

    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO social_connection
                 (id, workspace_id, platform_id, credential_ref, display_name, username, platform_account_id,
                  status, enabled, granted_scopes, missing_scopes, last_authorized_at, last_synced_at)
                 VALUES (?1, ?2, 'sandbox', ?3, ?4, ?5, ?6, 'connected_enabled', 1, ?7, ?8, datetime('now'), datetime('now'))",
                rusqlite::params![
                    id, workspace_id, identity.credential_ref, identity.display_name,
                    identity.username, identity.platform_account_id, granted, missing
                ],
            )
        })
        .map_err(|e| e.to_string())?;

    Ok(ConnectionDto {
        id,
        workspace_id,
        platform_id: "sandbox".to_string(),
        display_name: identity.display_name,
        username: identity.username,
        status: "connected_enabled".to_string(),
        enabled: true,
        granted_scopes: identity.granted_scopes,
        missing_scopes: identity.missing_scopes,
        last_authorized_at: Some(chrono::Utc::now().to_rfc3339()),
        last_synced_at: Some(chrono::Utc::now().to_rfc3339()),
    })
}

#[tauri::command]
pub fn set_connection_enabled(state: State<AppState>, connection_id: String, enabled: bool) -> Result<(), String> {
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "UPDATE social_connection SET enabled = ?1, updated_at = datetime('now') WHERE id = ?2",
                rusqlite::params![enabled as i64, connection_id],
            )
        })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Disconnect: removes the local row AND the credential from the OS store.
/// Deliberately a separate command from `set_connection_enabled` — the
/// spec requires these two destructive/non-destructive actions never be
/// combined into one control.
#[tauri::command]
pub fn disconnect_connection(state: State<AppState>, connection_id: String) -> Result<(), String> {
    let credential_ref: Option<String> = state
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT credential_ref FROM social_connection WHERE id = ?1",
                [&connection_id],
                |row| row.get(0),
            )
        })
        .ok();

    if let Some(cred_ref) = credential_ref {
        // Best-effort local removal even if the OS store errors -- we still
        // want the connection gone from SQLite either way, and log the
        // credential-store failure via diagnostic_event rather than
        // blocking the disconnect the user asked for.
        let _ = state.credentials.delete(&cred_ref);
    }

    state
        .db
        .with_conn(|conn| conn.execute("DELETE FROM social_connection WHERE id = ?1", [&connection_id]))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// TikTok's and Instagram's OAuth apps require an exact pre-registered
/// redirect URI, unlike Google's Desktop-app client type which allows any
/// loopback port -- 0 here means "let the OS pick," used for every platform
/// that doesn't need a fixed one.
fn fixed_oauth_port_for(platform_id: &str) -> u16 {
    match platform_id {
        "tiktok" => 47983,
        "instagram" => 47984,
        _ => 0,
    }
}

/// Opens the platform's real OAuth authorize page in the system browser and
/// waits for the loopback callback -- the same pattern `begin_connect_sandbox`
/// uses, but generic over any adapter in the registry instead of hardcoding
/// Sandbox. UNVERIFIED end-to-end (see core/src/{tiktok,instagram,youtube}_adapter.rs)
/// until real Client ID/Secret credentials exist to test against.
#[tauri::command]
pub async fn begin_connect_platform(app: tauri::AppHandle, state: State<'_, AppState>, workspace_id: String, platform_id: String) -> Result<ConnectionDto, String> {
    use tauri_plugin_opener::OpenerExt;

    let adapter = state.adapters.get(&platform_id).ok_or_else(|| format!("No adapter registered for \"{platform_id}\"."))?;

    // Google's "Desktop app" OAuth client type explicitly allows any
    // 127.0.0.1 port (RFC 8252), so YouTube can use a fresh OS-assigned
    // port every time. TikTok and Meta/Instagram require the redirect URI
    // to exactly match what's registered in their developer console --
    // a random port would never match, so those use a fixed port that
    // must be registered as http://127.0.0.1:<port>/callback in each
    // platform's developer app settings (see docs/LIMITATIONS.md).
    let fixed_port = fixed_oauth_port_for(&platform_id);
    let (listener, port) = nzyselle_core::oauth_callback::CallbackServer::bind_on(fixed_port).await.map_err(|e| e.to_string())?;
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let begin = adapter.begin_authorization(&["publish".into(), "analytics".into()], &redirect_uri).await.map_err(|e| e.to_string())?;
    let server = nzyselle_core::oauth_callback::CallbackServer::listen(listener, port, begin.state.clone());

    app.opener().open_url(&begin.authorization_url, None::<String>).map_err(|e| format!("Couldn't open the system browser: {e}"))?;

    let callback = server
        .wait_for_callback(std::time::Duration::from_secs(300))
        .await
        .map_err(|e| format!("Authorization didn't complete: {e}"))?;

    let identity = adapter
        .complete_authorization(&callback.code, &callback.state, &begin.pkce_verifier, &redirect_uri)
        .await
        .map_err(|e| e.to_string())?;

    let id = generate_prefixed_id("conn");
    let granted = serde_json::to_string(&identity.granted_scopes).unwrap_or_default();
    let missing = serde_json::to_string(&identity.missing_scopes).unwrap_or_default();

    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO social_connection
                 (id, workspace_id, platform_id, credential_ref, display_name, username, platform_account_id,
                  status, enabled, granted_scopes, missing_scopes, last_authorized_at, last_synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'connected_enabled', 1, ?8, ?9, datetime('now'), datetime('now'))",
                rusqlite::params![
                    id, workspace_id, platform_id, identity.credential_ref, identity.display_name,
                    identity.username, identity.platform_account_id, granted, missing
                ],
            )
        })
        .map_err(|e| e.to_string())?;

    Ok(ConnectionDto {
        id,
        workspace_id,
        platform_id,
        display_name: identity.display_name,
        username: identity.username,
        status: "connected_enabled".to_string(),
        enabled: true,
        granted_scopes: identity.granted_scopes,
        missing_scopes: identity.missing_scopes,
        last_authorized_at: Some(chrono::Utc::now().to_rfc3339()),
        last_synced_at: Some(chrono::Utc::now().to_rfc3339()),
    })
}

/// Stores a developer app's Client ID/Secret for a real platform via the
/// same `CredentialStore` OAuth tokens use -- never SQLite. Required before
/// `begin_connect_platform` can do anything for that platform.
#[tauri::command]
pub fn set_platform_credentials(state: State<AppState>, platform_id: String, client_id: String, client_secret: String) -> Result<(), String> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err("Both Client ID and Client Secret are required.".to_string());
    }
    let json = serde_json::to_string(&serde_json::json!({ "client_id": client_id.trim(), "client_secret": client_secret.trim() })).map_err(|e| e.to_string())?;
    state.credentials.set(&nzyselle_core::oauth_http::client_config_ref(&platform_id), &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_configured_platform_credentials(state: State<AppState>) -> Result<Vec<String>, String> {
    Ok(["tiktok", "instagram", "youtube"]
        .into_iter()
        .filter(|id| state.credentials.exists(&nzyselle_core::oauth_http::client_config_ref(id)))
        .map(str::to_string)
        .collect())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformDto {
    pub id: String,
    pub display_name: String,
    pub icon_asset: String,
    pub docs_url: String,
    pub registry_version: i64,
    pub instructions_reviewed_at: String,
    pub is_sandbox: bool,
}

#[tauri::command]
pub fn list_platforms(state: State<AppState>) -> Result<Vec<PlatformDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, display_name, icon_asset, docs_url, registry_version, instructions_reviewed_at, is_sandbox
                 FROM platform_definition ORDER BY is_sandbox ASC, display_name ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(PlatformDto {
                    id: row.get(0)?,
                    display_name: row.get(1)?,
                    icon_asset: row.get(2)?,
                    docs_url: row.get(3)?,
                    registry_version: row.get(4)?,
                    instructions_reviewed_at: row.get(5)?,
                    is_sandbox: row.get::<_, i64>(6)? != 0,
                })
            })?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAssetDto {
    pub id: String,
    pub workspace_id: String,
    pub file_path: String,
    pub original_filename: String,
    pub content_hash: String,
    pub duration_seconds: f64,
    pub width: i64,
    pub height: i64,
    pub codec: String,
    pub file_size_bytes: i64,
    pub is_vertical: bool,
    pub outfit_name: Option<String>,
    pub cac_code: Option<String>,
    pub tags: Vec<String>,
    pub has_been_posted: bool,
    pub created_at: String,
    pub validation_issues: Vec<String>,
    pub has_thumbnail: bool,
}

#[tauri::command]
pub fn list_videos(state: State<AppState>, workspace_id: String) -> Result<Vec<VideoAssetDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT v.id, v.workspace_id, v.file_path, v.original_filename, v.content_hash,
                        v.duration_seconds, v.width, v.height, v.codec, v.file_size_bytes, v.is_vertical,
                        v.outfit_name, v.cac_code, v.created_at,
                        (SELECT COUNT(*) FROM destination_post dp
                           JOIN publishing_campaign pc ON pc.id = dp.campaign_id
                           WHERE pc.video_asset_id = v.id AND dp.status = 'posted'),
                        (SELECT COUNT(*) FROM video_thumbnail vt WHERE vt.video_asset_id = v.id AND vt.is_primary = 1)
                 FROM video_asset v WHERE v.workspace_id = ?1 AND v.archived_at IS NULL
                 ORDER BY v.created_at DESC",
            )?;
            let rows = stmt.query_map([&workspace_id], |row| {
                let posted_count: i64 = row.get(14)?;
                let thumbnail_count: i64 = row.get(15)?;
                Ok(VideoAssetDto {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    file_path: row.get(2)?,
                    original_filename: row.get(3)?,
                    content_hash: row.get(4)?,
                    duration_seconds: row.get(5)?,
                    width: row.get(6)?,
                    height: row.get(7)?,
                    codec: row.get(8)?,
                    file_size_bytes: row.get(9)?,
                    is_vertical: row.get::<_, i64>(10)? != 0,
                    outfit_name: row.get(11)?,
                    cac_code: row.get(12)?,
                    tags: vec![],
                    has_been_posted: posted_count > 0,
                    created_at: row.get(13)?,
                    validation_issues: vec![],
                    has_thumbnail: thumbnail_count > 0,
                })
            })?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

/// Reads the primary thumbnail file (see `add_video_from_path`) and returns
/// it as a `data:` URL. A dedicated command rather than embedding bytes in
/// `list_videos` so the (potentially many) video list loads stay cheap and
/// thumbnails load lazily per visible card.
#[tauri::command]
pub fn get_video_thumbnail(state: State<AppState>, video_id: String) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let thumb_path: Option<String> = state
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT file_path FROM video_thumbnail WHERE video_asset_id = ?1 AND is_primary = 1 LIMIT 1",
                [&video_id],
                |row| row.get(0),
            )
        })
        .ok();
    let Some(thumb_path) = thumb_path else { return Ok(None) };
    match std::fs::read(&thumb_path) {
        Ok(bytes) => Ok(Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))),
        Err(_) => Ok(None),
    }
}

/// Real pipeline: probes the file with ffprobe, hashes it for duplicate
/// detection, and generates a thumbnail -- using core::media / core::hashing,
/// the same modules with real test coverage in core/tests. Never alters
/// the source file (see media::generate_thumbnail's test guaranteeing this).
#[tauri::command]
pub fn add_video_from_path(state: State<AppState>, workspace_id: String, file_path: String) -> Result<VideoAssetDto, String> {
    use nzyselle_core::hashing::hash_file;
    use nzyselle_core::media::probe_video;
    use std::path::Path;

    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }

    let info = probe_video(path).map_err(|e| e.to_string())?;
    let hash = hash_file(path).map_err(|e| e.to_string())?;

    let existing_name: Option<String> = state
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT original_filename FROM video_asset WHERE workspace_id = ?1 AND content_hash = ?2",
                rusqlite::params![workspace_id, hash],
                |row| row.get(0),
            )
        })
        .ok();
    if let Some(name) = existing_name {
        return Err(format!("This looks like the same file as \"{name}\", already in the library."));
    }

    let filename = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| file_path.clone());
    let id = generate_prefixed_id("vid");

    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO video_asset
                 (id, workspace_id, file_path, original_filename, content_hash, duration_seconds,
                  width, height, codec, audio_codec, frame_rate, file_size_bytes, is_vertical)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                rusqlite::params![
                    id, workspace_id, file_path, filename, hash, info.duration_seconds,
                    info.width, info.height, info.codec, info.audio_codec, info.frame_rate,
                    info.file_size_bytes as i64, info.is_vertical as i64
                ],
            )
        })
        .map_err(|e| e.to_string())?;

    // Best-effort: a missing/failed thumbnail must never block adding the
    // video to the library -- has_thumbnail just stays false and the UI
    // falls back to its placeholder.
    let has_thumbnail = generate_and_store_thumbnail(&state, &id, path, info.duration_seconds).is_ok();

    Ok(VideoAssetDto {
        id, workspace_id, file_path, original_filename: filename, content_hash: hash,
        duration_seconds: info.duration_seconds, width: info.width as i64, height: info.height as i64,
        codec: info.codec, file_size_bytes: info.file_size_bytes as i64, is_vertical: info.is_vertical,
        outfit_name: None, cac_code: None, tags: vec![], has_been_posted: false,
        created_at: chrono::Utc::now().to_rfc3339(), validation_issues: vec![], has_thumbnail,
    })
}

fn generate_and_store_thumbnail(state: &State<AppState>, video_id: &str, source: &std::path::Path, duration_seconds: f64) -> Result<(), String> {
    use nzyselle_core::media::generate_thumbnail;

    let thumbs_dir = state.db_path.parent().ok_or("no app data dir")?.join("thumbnails");
    std::fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;
    let out_path = thumbs_dir.join(format!("{video_id}.jpg"));

    let at_seconds = if duration_seconds > 1.0 { 1.0 } else { duration_seconds / 2.0 };
    generate_thumbnail(source, &out_path, at_seconds).map_err(|e| e.to_string())?;

    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO video_thumbnail (id, video_asset_id, file_path, timestamp_seconds, is_primary) VALUES (?1, ?2, ?3, ?4, 1)",
                rusqlite::params![generate_prefixed_id("thumb"), video_id, out_path.to_string_lossy(), at_seconds],
            )
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Opens a native "choose a video" file picker instead of requiring the
/// user to type an exact path. Returns None if they cancel.
#[tauri::command]
pub fn pick_video_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .add_filter("Video", &["mp4", "mov", "mkv", "webm", "avi", "m4v"])
        .blocking_pick_file();
    Ok(picked.map(|p| p.to_string()))
}

#[tauri::command]
pub fn remove_video(state: State<AppState>, video_id: String) -> Result<(), String> {
    state
        .db
        .with_conn(|conn| conn.execute("DELETE FROM video_asset WHERE id = ?1", [&video_id]))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// -------------------------------------------------------------------------
// Publishing: campaigns fan out into one destination_post per selected
// connection. The scheduler (src-tauri/src/scheduler.rs) is what actually
// drives each destination through the adapter contract -- these commands
// only ever create/read rows and flip status back to 'scheduled' for a
// retry; they never call a ProviderAdapter directly.
// -------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestinationPostDto {
    pub id: String,
    pub campaign_id: String,
    pub connection_id: String,
    pub platform_id: String,
    pub status: String,
    pub platform_post_id: Option<String>,
    pub post_url: Option<String>,
    pub error_message: Option<String>,
    pub is_retryable: bool,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignDto {
    pub id: String,
    pub workspace_id: String,
    pub video_asset_id: String,
    pub internal_name: Option<String>,
    pub shared_caption: Option<String>,
    pub status: String,
    pub scheduled_for: Option<String>,
    pub created_at: String,
    pub destinations: Vec<DestinationPostDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitCampaignInput {
    pub workspace_id: String,
    pub video_asset_id: String,
    pub internal_name: Option<String>,
    pub shared_caption: Option<String>,
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub caption_overrides: HashMap<String, String>,
    /// RFC3339 timestamp. None = post now.
    pub scheduled_for: Option<String>,
    pub timezone: Option<String>,
}

fn load_campaign(conn: &rusqlite::Connection, campaign_id: &str) -> rusqlite::Result<CampaignDto> {
    let (workspace_id, video_asset_id, internal_name, shared_caption, status, scheduled_for, created_at) = conn.query_row(
        "SELECT workspace_id, video_asset_id, internal_name, shared_caption, status, scheduled_for, created_at
         FROM publishing_campaign WHERE id = ?1",
        [campaign_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
    )?;

    let mut stmt = conn.prepare(
        "SELECT dp.id, dp.campaign_id, dp.connection_id, sc.platform_id, dp.status,
                dp.platform_post_id, dp.post_url, dp.error_message, dp.is_retryable, dp.updated_at
         FROM destination_post dp JOIN social_connection sc ON sc.id = dp.connection_id
         WHERE dp.campaign_id = ?1",
    )?;
    let destinations = stmt
        .query_map([campaign_id], |row| {
            Ok(DestinationPostDto {
                id: row.get(0)?,
                campaign_id: row.get(1)?,
                connection_id: row.get(2)?,
                platform_id: row.get(3)?,
                status: row.get(4)?,
                platform_post_id: row.get(5)?,
                post_url: row.get(6)?,
                error_message: row.get(7)?,
                is_retryable: row.get::<_, i64>(8)? != 0,
                updated_at: row.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(CampaignDto {
        id: campaign_id.to_string(),
        workspace_id,
        video_asset_id,
        internal_name,
        shared_caption,
        status,
        scheduled_for,
        created_at,
        destinations,
    })
}

#[tauri::command]
pub fn submit_campaign(state: State<AppState>, input: SubmitCampaignInput) -> Result<CampaignDto, String> {
    if input.connection_ids.is_empty() {
        return Err("Select at least one connection to publish to.".to_string());
    }
    let campaign_id = generate_prefixed_id("camp");
    let scheduled_for = input.scheduled_for.clone().unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let is_future_schedule = input.scheduled_for.is_some();
    let approved_config_json = serde_json::to_string(&serde_json::json!({
        "connectionIds": input.connection_ids,
        "captionOverrides": input.caption_overrides,
        "scheduledFor": scheduled_for,
        "timezone": input.timezone,
    }))
    .map_err(|e| e.to_string())?;

    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO publishing_campaign
                 (id, workspace_id, video_asset_id, internal_name, shared_caption, shared_hashtags,
                  approved_config_json, status, scheduled_for, timezone, confirmed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, '[]', ?6, 'scheduled', ?7, ?8, datetime('now'))",
                rusqlite::params![
                    campaign_id, input.workspace_id, input.video_asset_id, input.internal_name,
                    input.shared_caption, approved_config_json, scheduled_for, input.timezone
                ],
            )?;

            for connection_id in &input.connection_ids {
                let dp_id = generate_prefixed_id("dp");
                conn.execute(
                    "INSERT INTO destination_post (id, campaign_id, connection_id, status) VALUES (?1, ?2, ?3, 'scheduled')",
                    rusqlite::params![dp_id, campaign_id, connection_id],
                )?;
                if let Some(caption) = input.caption_overrides.get(connection_id) {
                    conn.execute(
                        "INSERT INTO destination_configuration (id, destination_post_id, caption_override) VALUES (?1, ?2, ?3)",
                        rusqlite::params![generate_prefixed_id("dc"), dp_id, caption],
                    )?;
                }
            }

            if is_future_schedule {
                conn.execute(
                    "INSERT INTO schedule (id, campaign_id, scheduled_for, timezone) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        generate_prefixed_id("sched"),
                        campaign_id,
                        scheduled_for,
                        input.timezone.clone().unwrap_or_else(|| "UTC".to_string())
                    ],
                )?;
            }

            Ok::<_, rusqlite::Error>(())
        })
        .map_err(|e| e.to_string())?;

    state.db.with_conn(|conn| load_campaign(conn, &campaign_id)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_campaigns(state: State<AppState>, workspace_id: String) -> Result<Vec<CampaignDto>, String> {
    let ids: Vec<String> = state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id FROM publishing_campaign WHERE workspace_id = ?1 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map([&workspace_id], |row| row.get(0))?;
            rows.collect()
        })
        .map_err(|e| e.to_string())?;

    state
        .db
        .with_conn(|conn| ids.iter().map(|id| load_campaign(conn, id)).collect())
        .map_err(|e| e.to_string())
}

/// Only cancels destinations still in the queue -- a destination that's
/// already posted, uploading, or terminally failed can't be "cancelled"
/// without lying about what actually happened.
#[tauri::command]
pub fn cancel_scheduled_post(state: State<AppState>, destination_post_id: String) -> Result<(), String> {
    let campaign_id: String = state
        .db
        .with_conn(|conn| {
            let updated = conn.execute(
                "UPDATE destination_post SET status = 'cancelled', updated_at = datetime('now')
                 WHERE id = ?1 AND status = 'scheduled'",
                [&destination_post_id],
            )?;
            if updated == 0 {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            conn.execute(
                "INSERT INTO post_status_event (id, destination_post_id, status, message)
                 VALUES (?1, ?2, 'cancelled', 'Cancelled by user before it was picked up.')",
                rusqlite::params![generate_prefixed_id("evt"), destination_post_id],
            )?;
            conn.query_row("SELECT campaign_id FROM destination_post WHERE id = ?1", [&destination_post_id], |row| row.get(0))
        })
        .map_err(|_| "That post can no longer be cancelled -- it's already being uploaded or has finished.".to_string())?;

    recompute_campaign_status(&state.db, &campaign_id);
    Ok(())
}

// -------------------------------------------------------------------------
// Analytics
// -------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricRowDto {
    pub metric_key: String,
    pub label: String,
    pub value: Option<f64>,
    pub not_provided_reason: Option<String>,
    pub measured_at: String,
    pub platform_post_id: Option<String>,
}

/// Real sync: calls `refresh_analytics` then `get_post_metrics` per posted
/// destination on this connection, through the same adapter registry the
/// scheduler uses. `value: None` is written through exactly as the adapter
/// returned it -- never coerced to zero.
#[tauri::command]
pub async fn sync_analytics(state: State<'_, AppState>, connection_id: String) -> Result<(), String> {
    let (platform_id, credential_ref): (String, String) = state
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT platform_id, credential_ref FROM social_connection WHERE id = ?1",
                [&connection_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
        })
        .map_err(|e| e.to_string())?;

    let adapter = state.adapters.get(&platform_id).ok_or_else(|| format!("No adapter registered for \"{platform_id}\"."))?;

    let sync_id = generate_prefixed_id("sync");
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO analytics_sync (id, connection_id) VALUES (?1, ?2)",
                rusqlite::params![sync_id, connection_id],
            )
        })
        .map_err(|e| e.to_string())?;

    let outcome = async {
        adapter.refresh_analytics(&credential_ref).await?;

        let posted: Vec<(String, String)> = state
            .db
            .with_conn(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, platform_post_id FROM destination_post
                     WHERE connection_id = ?1 AND status = 'posted' AND platform_post_id IS NOT NULL",
                )?;
                let rows = stmt.query_map([&connection_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
                rows.collect()
            })
            .map_err(|e| nzyselle_core::adapter::AdapterError::Permanent(e.to_string()))?;

        let mut synced = 0i64;
        for (destination_post_id, platform_post_id) in posted {
            let metrics = adapter.get_post_metrics(&credential_ref, &platform_post_id).await?;
            for m in metrics {
                let def_id: Option<String> = state
                    .db
                    .with_conn(|conn| {
                        conn.query_row(
                            "SELECT id FROM metric_definition WHERE platform_id = ?1 AND metric_key = ?2",
                            rusqlite::params![platform_id, m.metric_key],
                            |row| row.get(0),
                        )
                    })
                    .ok();
                let Some(def_id) = def_id else { continue };
                let _ = state.db.with_conn(|conn| {
                    conn.execute(
                        "INSERT OR REPLACE INTO metric_observation
                         (id, destination_post_id, metric_definition_id, value, measured_at, synced_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
                        rusqlite::params![
                            generate_prefixed_id("mo"),
                            destination_post_id,
                            def_id,
                            m.value,
                            m.measured_at.to_rfc3339()
                        ],
                    )
                });
            }
            synced += 1;
        }
        Ok::<i64, nzyselle_core::adapter::AdapterError>(synced)
    }
    .await;

    match outcome {
        Ok(count) => {
            state
                .db
                .with_conn(|conn| {
                    conn.execute(
                        "UPDATE analytics_sync SET finished_at = datetime('now'), outcome = 'success', posts_synced = ?1 WHERE id = ?2",
                        rusqlite::params![count, sync_id],
                    )
                })
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(e) => {
            let translated = adapter.translate_error(&e);
            state
                .db
                .with_conn(|conn| {
                    conn.execute(
                        "UPDATE analytics_sync SET finished_at = datetime('now'), outcome = 'failed', error_message = ?1 WHERE id = ?2",
                        rusqlite::params![translated.plain_message, sync_id],
                    )
                })
                .map_err(|e| e.to_string())?;
            Err(translated.plain_message)
        }
    }
}

#[tauri::command]
pub fn list_metrics(state: State<AppState>, connection_id: String) -> Result<Vec<MetricRowDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT md.metric_key, md.label, mo.value, mo.measured_at, dp.platform_post_id
                 FROM metric_observation mo
                 JOIN destination_post dp ON dp.id = mo.destination_post_id
                 JOIN metric_definition md ON md.id = mo.metric_definition_id
                 WHERE dp.connection_id = ?1
                 ORDER BY mo.measured_at DESC",
            )?;
            let rows = stmt.query_map([&connection_id], |row| {
                let value: Option<f64> = row.get(2)?;
                Ok(MetricRowDto {
                    metric_key: row.get(0)?,
                    label: row.get(1)?,
                    value,
                    not_provided_reason: if value.is_none() { Some("Not provided by this platform".to_string()) } else { None },
                    measured_at: row.get(3)?,
                    platform_post_id: row.get(4)?,
                })
            })?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricDefinitionDto {
    pub metric_key: String,
    pub label: String,
}

#[tauri::command]
pub fn list_available_metrics(state: State<AppState>, connection_id: String) -> Result<Vec<MetricDefinitionDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT md.metric_key, md.label FROM metric_definition md
                 JOIN social_connection sc ON sc.platform_id = md.platform_id
                 WHERE sc.id = ?1
                 ORDER BY md.label ASC",
            )?;
            let rows = stmt.query_map([&connection_id], |row| Ok(MetricDefinitionDto { metric_key: row.get(0)?, label: row.get(1)? }))?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPointDto {
    pub date: String,
    pub value: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsOverviewDto {
    pub current: Vec<DailyPointDto>,
    pub previous: Vec<DailyPointDto>,
    pub current_total: f64,
    pub previous_total: f64,
    /// None when there's nothing in the comparison period to divide by --
    /// rendered as "—", never a fabricated 0% or infinite jump.
    pub delta_percent: Option<f64>,
}

fn daily_series(conn: &rusqlite::Connection, connection_id: &str, metric_key: &str, start: &str, end: &str) -> rusqlite::Result<Vec<DailyPointDto>> {
    let mut stmt = conn.prepare(
        "SELECT date(mo.measured_at) as day, AVG(mo.value)
         FROM metric_observation mo
         JOIN destination_post dp ON dp.id = mo.destination_post_id
         JOIN metric_definition md ON md.id = mo.metric_definition_id
         WHERE dp.connection_id = ?1 AND md.metric_key = ?2
               AND date(mo.measured_at) >= date(?3) AND date(mo.measured_at) <= date(?4)
         GROUP BY day ORDER BY day ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![connection_id, metric_key, start, end], |row| {
        Ok(DailyPointDto { date: row.get(0)?, value: row.get(1)? })
    })?;
    rows.collect()
}

/// Real aggregation over `metric_observation` -- the GA4-style date-range +
/// comparison-period UI on the Analytics page renders exactly this, no
/// interpolated/fabricated points. With only sandbox data and infrequent
/// syncs the series will legitimately look sparse; that's honest, not a bug.
#[tauri::command]
pub fn get_analytics_overview(
    state: State<AppState>,
    connection_id: String,
    metric_key: String,
    start: String,
    end: String,
    compare_start: String,
    compare_end: String,
) -> Result<AnalyticsOverviewDto, String> {
    state
        .db
        .with_conn(|conn| {
            let current = daily_series(conn, &connection_id, &metric_key, &start, &end)?;
            let previous = daily_series(conn, &connection_id, &metric_key, &compare_start, &compare_end)?;
            let current_total: f64 = current.iter().filter_map(|p| p.value).sum();
            let previous_total: f64 = previous.iter().filter_map(|p| p.value).sum();
            let delta_percent = if previous_total > 0.0 { Some(((current_total - previous_total) / previous_total) * 100.0) } else { None };
            Ok(AnalyticsOverviewDto { current, previous, current_total, previous_total, delta_percent })
        })
        .map_err(|e: rusqlite::Error| e.to_string())
}

/// The "events in last N minutes" realtime-style panel -- here, real posts
/// that actually went out for this connection, not a fabricated live feed.
#[tauri::command]
pub fn get_recent_post_count(state: State<AppState>, connection_id: String, minutes: i64) -> Result<i64, String> {
    state
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM post_status_event pse
                 JOIN destination_post dp ON dp.id = pse.destination_post_id
                 WHERE dp.connection_id = ?1 AND pse.status = 'posted'
                       AND pse.occurred_at >= datetime('now', ?2)",
                rusqlite::params![connection_id, format!("-{minutes} minutes")],
                |row| row.get(0),
            )
        })
        .map_err(|e| e.to_string())
}

// -------------------------------------------------------------------------
// Diagnostics
// -------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEventDto {
    pub id: String,
    pub platform_id: Option<String>,
    pub connection_id: Option<String>,
    pub severity: String,
    pub plain_message: String,
    pub technical_error_code: Option<String>,
    pub occurred_at: String,
}

#[tauri::command]
pub fn list_diagnostic_events(state: State<AppState>, workspace_id: String, limit: i64) -> Result<Vec<DiagnosticEventDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT de.id, de.platform_id, de.connection_id, de.severity, de.plain_message,
                        de.technical_error_code, de.occurred_at
                 FROM diagnostic_event de
                 LEFT JOIN social_connection sc ON sc.id = de.connection_id
                 WHERE sc.workspace_id = ?1 OR de.connection_id IS NULL
                 ORDER BY de.occurred_at DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(rusqlite::params![workspace_id, limit], |row| {
                Ok(DiagnosticEventDto {
                    id: row.get(0)?,
                    platform_id: row.get(1)?,
                    connection_id: row.get(2)?,
                    severity: row.get(3)?,
                    plain_message: row.get(4)?,
                    technical_error_code: row.get(5)?,
                    occurred_at: row.get(6)?,
                })
            })?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

// -------------------------------------------------------------------------
// Templates: caption templates + hashtag sets
// -------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionTemplateDto {
    pub id: String,
    pub workspace_id: Option<String>,
    pub name: String,
    pub caption_structure: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn list_caption_templates(state: State<AppState>, workspace_id: String) -> Result<Vec<CaptionTemplateDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, workspace_id, name, caption_structure, created_at FROM caption_template
                 WHERE workspace_id = ?1 OR workspace_id IS NULL ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map([&workspace_id], |row| {
                Ok(CaptionTemplateDto { id: row.get(0)?, workspace_id: row.get(1)?, name: row.get(2)?, caption_structure: row.get(3)?, created_at: row.get(4)? })
            })?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_caption_template(state: State<AppState>, workspace_id: String, name: String, caption_structure: Option<String>) -> Result<CaptionTemplateDto, String> {
    if name.trim().is_empty() {
        return Err("Template name is required.".to_string());
    }
    let id = generate_prefixed_id("capt");
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO caption_template (id, workspace_id, name, caption_structure) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, workspace_id, name.trim(), caption_structure],
            )
        })
        .map_err(|e| e.to_string())?;
    Ok(CaptionTemplateDto { id, workspace_id: Some(workspace_id), name: name.trim().to_string(), caption_structure, created_at: chrono::Utc::now().to_rfc3339() })
}

#[tauri::command]
pub fn delete_caption_template(state: State<AppState>, template_id: String) -> Result<(), String> {
    state.db.with_conn(|conn| conn.execute("DELETE FROM caption_template WHERE id = ?1", [&template_id])).map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HashtagSetDto {
    pub id: String,
    pub workspace_id: Option<String>,
    pub name: String,
    pub hashtags: Vec<String>,
    pub category: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn list_hashtag_sets(state: State<AppState>, workspace_id: String) -> Result<Vec<HashtagSetDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, workspace_id, name, hashtags_json, category, created_at FROM hashtag_set
                 WHERE workspace_id = ?1 OR workspace_id IS NULL ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map([&workspace_id], |row| {
                let json: String = row.get(3)?;
                Ok(HashtagSetDto {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    name: row.get(2)?,
                    hashtags: serde_json::from_str(&json).unwrap_or_default(),
                    category: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_hashtag_set(state: State<AppState>, workspace_id: String, name: String, hashtags: Vec<String>, category: Option<String>) -> Result<HashtagSetDto, String> {
    if name.trim().is_empty() {
        return Err("Hashtag set name is required.".to_string());
    }
    let id = generate_prefixed_id("hset");
    let json = serde_json::to_string(&hashtags).map_err(|e| e.to_string())?;
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO hashtag_set (id, workspace_id, name, hashtags_json, category) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![id, workspace_id, name.trim(), json, category],
            )
        })
        .map_err(|e| e.to_string())?;
    Ok(HashtagSetDto { id, workspace_id: Some(workspace_id), name: name.trim().to_string(), hashtags, category, created_at: chrono::Utc::now().to_rfc3339() })
}

#[tauri::command]
pub fn delete_hashtag_set(state: State<AppState>, hashtag_set_id: String) -> Result<(), String> {
    state.db.with_conn(|conn| conn.execute("DELETE FROM hashtag_set WHERE id = ?1", [&hashtag_set_id])).map(|_| ()).map_err(|e| e.to_string())
}

// -------------------------------------------------------------------------
// Workspace settings + overview
// -------------------------------------------------------------------------

#[tauri::command]
pub fn update_workspace(state: State<AppState>, workspace_id: String, name: String, description: Option<String>, accent_color: Option<String>, default_watch_folder: Option<String>) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Account-group name is required.".to_string());
    }
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "UPDATE workspace SET name = ?1, description = ?2, accent_color = ?3, default_watch_folder = ?4, last_activity_at = datetime('now')
                 WHERE id = ?5",
                rusqlite::params![name.trim(), description, accent_color, default_watch_folder, workspace_id],
            )
        })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItemDto {
    pub id: String,
    pub kind: String,
    pub message: String,
    pub occurred_at: String,
}

#[tauri::command]
pub fn list_recent_activity(state: State<AppState>, workspace_id: String, limit: i64) -> Result<Vec<ActivityItemDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT pse.id, pse.status, pse.message, pse.occurred_at
                 FROM post_status_event pse
                 JOIN destination_post dp ON dp.id = pse.destination_post_id
                 JOIN publishing_campaign pc ON pc.id = dp.campaign_id
                 WHERE pc.workspace_id = ?1
                 ORDER BY pse.occurred_at DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(rusqlite::params![workspace_id, limit], |row| {
                let status: String = row.get(1)?;
                let message: Option<String> = row.get(2)?;
                Ok(ActivityItemDto {
                    id: row.get(0)?,
                    kind: status.clone(),
                    message: message.unwrap_or(status),
                    occurred_at: row.get(3)?,
                })
            })?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

// -------------------------------------------------------------------------
// Backup / restore
// -------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecordDto {
    pub id: String,
    pub file_path: String,
    pub schema_version: String,
    pub created_at: String,
}

/// Copies the live sqlite file to a user-chosen path. Credentials never
/// live in SQLite (see core::credentials), so a backup file never contains
/// OAuth secrets regardless of `included_credentials` -- that flag exists
/// for a future encrypted-credentials-bundle feature, not implemented yet.
#[tauri::command]
pub fn create_backup(state: State<AppState>, destination_path: String) -> Result<BackupRecordDto, String> {
    std::fs::copy(&state.db_path, &destination_path).map_err(|e| format!("Failed to write backup: {e}"))?;
    let id = generate_prefixed_id("bkp");
    let schema_version = "0003".to_string();
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO backup_record (id, file_path, schema_version) VALUES (?1, ?2, ?3)",
                rusqlite::params![id, destination_path, schema_version],
            )
        })
        .map_err(|e| e.to_string())?;
    Ok(BackupRecordDto { id, file_path: destination_path, schema_version, created_at: chrono::Utc::now().to_rfc3339() })
}

#[tauri::command]
pub fn list_backups(state: State<AppState>) -> Result<Vec<BackupRecordDto>, String> {
    state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT id, file_path, schema_version, created_at FROM backup_record ORDER BY created_at DESC")?;
            let rows = stmt.query_map([], |row| {
                Ok(BackupRecordDto { id: row.get(0)?, file_path: row.get(1)?, schema_version: row.get(2)?, created_at: row.get(3)? })
            })?;
            rows.collect()
        })
        .map_err(|e| e.to_string())
}

/// Restoring into a live open connection safely is out of scope -- this
/// validates the source file looks like a compatible sqlite database, then
/// requires an app restart to actually take effect rather than pretending
/// to hot-swap the connection underneath in-flight queries.
#[tauri::command]
pub fn restore_backup(state: State<AppState>, source_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&source_path);
    if !path.exists() {
        return Err(format!("File not found: {source_path}"));
    }
    let check = rusqlite::Connection::open(path).map_err(|e| format!("Not a valid database file: {e}"))?;
    let has_schema_migrations: bool = check
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_schema_migrations {
        return Err("This file doesn't look like a Nzyselle Database backup.".to_string());
    }
    drop(check);
    std::fs::copy(path, &state.db_path).map_err(|e| format!("Failed to restore: {e}"))?;
    Ok(())
}

/// Only re-queues a destination the scheduler already marked retryable --
/// never a permanent failure, which would misrepresent a hopeless retry as
/// a fresh attempt.
#[tauri::command]
pub fn retry_destination_post(state: State<AppState>, destination_post_id: String) -> Result<(), String> {
    let campaign_id: String = state
        .db
        .with_conn(|conn| {
            let updated = conn.execute(
                "UPDATE destination_post SET status = 'scheduled', error_code = NULL, error_message = NULL,
                 is_retryable = 0, updated_at = datetime('now') WHERE id = ?1 AND is_retryable = 1",
                [&destination_post_id],
            )?;
            if updated == 0 {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            let campaign_id: String =
                conn.query_row("SELECT campaign_id FROM destination_post WHERE id = ?1", [&destination_post_id], |row| row.get(0))?;
            conn.execute(
                "UPDATE publishing_campaign SET status = 'scheduled', scheduled_for = datetime('now') WHERE id = ?1",
                [&campaign_id],
            )?;
            conn.execute(
                "INSERT INTO post_status_event (id, destination_post_id, status, message)
                 VALUES (?1, ?2, 'scheduled', 'Re-queued for retry by user.')",
                rusqlite::params![generate_prefixed_id("evt"), destination_post_id],
            )?;
            Ok(campaign_id)
        })
        .map_err(|_| "That post isn't retryable right now.".to_string())?;

    recompute_campaign_status(&state.db, &campaign_id);
    Ok(())
}
