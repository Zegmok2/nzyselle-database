// Suppresses the console window in release builds -- without this, a
// GUI app built with the default Windows console subsystem shows a real
// (empty) console window alongside the actual Tauri window on every
// launch. Debug builds keep the console since `debug_assertions` is on,
// which is useful for eprintln!() output from e.g. scheduler.rs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Nzyselle Database — Tauri application entry point.
//
// IMPORTANT: this file has NOT been compiled in the development sandbox
// that produced it. Building a Tauri v2 app requires system webview
// libraries (WebView2 on Windows, webkit2gtk on Linux) that aren't
// available in that sandbox, so — consistent with everything else in this
// project — it is written carefully against the documented Tauri 2 API
// but must be treated as unverified until `cargo tauri dev` actually runs
// it on Windows. Every module it calls into (nzyselle_core::*) IS
// independently compiled and tested; this file is the thin glue layer.

mod adapters;
mod db;
mod commands;
mod scheduler;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub db: Arc<db::Database>,
    pub db_path: PathBuf,
    pub adapters: Arc<adapters::AdapterRegistry>,
    #[cfg(target_os = "windows")]
    pub credentials: Arc<dyn nzyselle_core::credentials::CredentialStore>,
    #[cfg(not(target_os = "windows"))]
    pub credentials: Arc<dyn nzyselle_core::credentials::CredentialStore>,
    /// Tracks the in-flight OAuth callback listener for each platform (keyed
    /// by platform_id) so a fresh `begin_connect_platform` attempt can abort
    /// a still-pending one first. Only matters for fixed-port platforms
    /// (TikTok/Instagram) -- without this, retrying (e.g. after opening the
    /// authorization URL in the wrong browser by accident) collides with the
    /// old listener still holding the port and fails with "address already
    /// in use". See `begin_connect_platform` in commands.rs.
    pub pending_oauth: Mutex<HashMap<String, tokio::task::AbortHandle>>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("resolvable app data directory");
            std::fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("nzyselle.sqlite");

            let db = Arc::new(db::Database::open_and_migrate(&db_path)?);

            #[cfg(target_os = "windows")]
            let credentials: Arc<dyn nzyselle_core::credentials::CredentialStore> =
                Arc::new(nzyselle_core::credentials::WindowsCredentialStore::new());
            // Non-Windows builds are dev-only in this project (the product
            // targets Windows 10/11 per spec); an in-memory store here
            // makes `cargo check`/local dev possible without ever
            // shipping this fallback in a Windows release build.
            #[cfg(not(target_os = "windows"))]
            let credentials: Arc<dyn nzyselle_core::credentials::CredentialStore> =
                Arc::new(nzyselle_core::credentials::InMemoryCredentialStore::new());

            let adapter_registry = Arc::new(adapters::AdapterRegistry::new(credentials.clone()));
            scheduler::spawn(db.clone(), adapter_registry.clone());

            app.manage(AppState { db, db_path, adapters: adapter_registry, credentials, pending_oauth: Mutex::new(HashMap::new()) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_platforms,
            commands::list_workspaces,
            commands::create_workspace,
            commands::delete_workspace,
            commands::list_connections,
            commands::begin_connect_sandbox,
            commands::begin_connect_platform,
            commands::set_platform_credentials,
            commands::list_configured_platform_credentials,
            commands::set_connection_enabled,
            commands::disconnect_connection,
            commands::list_videos,
            commands::add_video_from_path,
            commands::pick_video_file,
            commands::get_video_thumbnail,
            commands::remove_video,
            commands::submit_campaign,
            commands::list_campaigns,
            commands::cancel_scheduled_post,
            commands::retry_destination_post,
            commands::sync_analytics,
            commands::get_posting_options,
            commands::list_metrics,
            commands::list_available_metrics,
            commands::get_analytics_overview,
            commands::get_recent_post_count,
            commands::list_diagnostic_events,
            commands::list_caption_templates,
            commands::create_caption_template,
            commands::delete_caption_template,
            commands::list_hashtag_sets,
            commands::create_hashtag_set,
            commands::delete_hashtag_set,
            commands::update_workspace,
            commands::list_recent_activity,
            commands::create_backup,
            commands::list_backups,
            commands::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nzyselle Database");
}
