// Upload queue / scheduler. Polls for destination_posts that are due and
// drives them through the exact same adapter contract already proven by
// core/tests/adapter_contract_tests.rs: validate_media -> initialize_upload
// -> upload_media -> get_upload_status -> publish. Nothing here is
// platform-specific -- it only ever talks to `ProviderAdapter`, looked up
// per-connection through `AdapterRegistry`, so a real adapter drops in
// without this file changing at all.
//
// "Post now" and "scheduled" are the same code path: submit_campaign sets
// publishing_campaign.scheduled_for to either "now" or a future timestamp,
// and a destination is "due" whenever that timestamp has passed.

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use rusqlite::Connection;

use crate::adapters::AdapterRegistry;
use crate::db::Database;
use nzyselle_core::adapter::{AdapterError, PublishRequest, UploadMetadata, UploadStatus};

const POLL_INTERVAL: Duration = Duration::from_secs(15);
const MAX_UPLOAD_ATTEMPTS: i64 = 5;

pub fn spawn(db: Arc<Database>, registry: Arc<AdapterRegistry>) {
    // tokio::spawn requires an active Tokio runtime context; Tauri's
    // .setup() closure runs before one exists on the calling thread.
    // tauri::async_runtime::spawn schedules onto Tauri's own managed
    // runtime (tokio under the hood) and works from here.
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(POLL_INTERVAL);
        loop {
            interval.tick().await;
            if let Err(e) = run_due_destinations(&db, &registry).await {
                eprintln!("scheduler tick failed: {e}");
            }
        }
    });
}

struct DueDestination {
    destination_post_id: String,
    campaign_id: String,
    connection_id: String,
    platform_id: String,
    credential_ref: String,
    video_file_path: String,
    caption: Option<String>,
    privacy_level: Option<String>,
}

async fn run_due_destinations(db: &Database, registry: &AdapterRegistry) -> Result<(), String> {
    let due = fetch_due_destinations(db).map_err(|e| e.to_string())?;
    for dest in due {
        process_destination(db, registry, dest).await;
    }
    Ok(())
}

fn fetch_due_destinations(db: &Database) -> rusqlite::Result<Vec<DueDestination>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT dp.id, dp.campaign_id, dp.connection_id, sc.platform_id, sc.credential_ref,
                    v.file_path, COALESCE(dc.caption_override, pc.shared_caption), dc.privacy_level
             FROM destination_post dp
             JOIN publishing_campaign pc ON pc.id = dp.campaign_id
             JOIN social_connection sc ON sc.id = dp.connection_id
             JOIN video_asset v ON v.id = pc.video_asset_id
             LEFT JOIN destination_configuration dc ON dc.destination_post_id = dp.id
             WHERE dp.status = 'scheduled' AND pc.scheduled_for <= ?1",
        )?;
        let rows = stmt.query_map([Utc::now().to_rfc3339()], |row| {
            Ok(DueDestination {
                destination_post_id: row.get(0)?,
                campaign_id: row.get(1)?,
                connection_id: row.get(2)?,
                platform_id: row.get(3)?,
                credential_ref: row.get(4)?,
                video_file_path: row.get(5)?,
                caption: row.get(6)?,
                privacy_level: row.get(7)?,
            })
        })?;
        rows.collect()
    })
}

async fn process_destination(db: &Database, registry: &AdapterRegistry, dest: DueDestination) {
    let Some(adapter) = registry.get(&dest.platform_id) else {
        fail_destination(
            db,
            &dest.destination_post_id,
            &dest.campaign_id,
            "NO_ADAPTER",
            &format!("No adapter is registered for platform \"{}\".", dest.platform_id),
            false,
        );
        return;
    };

    mark_status(db, &dest.destination_post_id, "uploading", None);

    let validation = match adapter.validate_media(&dest.video_file_path).await {
        Ok(v) => v,
        Err(e) => return handle_adapter_error(db, &dest, &adapter.translate_error(&e), false),
    };
    if !validation.is_supported {
        fail_destination(
            db,
            &dest.destination_post_id,
            &dest.campaign_id,
            "MEDIA_NOT_SUPPORTED",
            &validation.issues.join(" "),
            false,
        );
        return;
    }

    // Some platforms (TikTok) require caption/privacy in the same call that
    // starts the upload, not as a separate step afterward -- pass along
    // whatever the user already set on this destination.
    let upload_metadata = UploadMetadata {
        caption: dest.caption.clone(),
        privacy_level: dest.privacy_level.clone(),
        cover_timestamp_seconds: None,
        disclosures: serde_json::json!({}),
        platform_specific: serde_json::json!({}),
    };

    let handle = match adapter.initialize_upload(&dest.credential_ref, &dest.video_file_path, &upload_metadata).await {
        Ok(h) => h,
        Err(e) => return handle_adapter_error(db, &dest, &adapter.translate_error(&e), false),
    };

    let attempt_number = count_attempts(db, &dest.destination_post_id).unwrap_or(0) + 1;

    let discovered_id = match adapter.upload_media(&handle, &dest.video_file_path).await {
        Ok(id) => id,
        Err(e) => {
            let translated = adapter.translate_error(&e);
            record_upload_attempt(db, &dest.destination_post_id, attempt_number, "retryable_failure", &translated.plain_message);
            let retryable = matches!(e, AdapterError::Retryable(_)) && attempt_number < MAX_UPLOAD_ATTEMPTS;
            return handle_adapter_error(db, &dest, &translated, retryable);
        }
    };

    // Bounded poll -- the sandbox resolves immediately, a real adapter's
    // resumable/processing upload may take a few ticks.
    let mut status = UploadStatus::Preparing;
    for _ in 0..5 {
        match adapter.get_upload_status(&handle).await {
            Ok(UploadStatus::Complete) => {
                status = UploadStatus::Complete;
                break;
            }
            Ok(UploadStatus::Failed { message }) => {
                record_upload_attempt(db, &dest.destination_post_id, attempt_number, "permanent_failure", &message);
                fail_destination(db, &dest.destination_post_id, &dest.campaign_id, "UPLOAD_FAILED", &message, false);
                return;
            }
            Ok(other) => status = other,
            Err(e) => return handle_adapter_error(db, &dest, &adapter.translate_error(&e), false),
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    if !matches!(status, UploadStatus::Complete) {
        // Still not done after the bounded poll -- leave it queued, the
        // next tick will pick up from here rather than failing outright.
        mark_status(db, &dest.destination_post_id, "scheduled", Some("Upload still in progress; will resume next cycle."));
        return;
    }
    record_upload_attempt(db, &dest.destination_post_id, attempt_number, "success", "upload complete");

    // Prefer the id the upload call itself revealed (e.g. YouTube's new
    // video id) over the original upload handle, since some adapters have
    // nothing left to do with the handle once that comes back.
    let request = PublishRequest {
        upload_id: discovered_id.unwrap_or(handle.upload_id),
        caption: dest.caption.clone(),
        privacy_level: dest.privacy_level.clone(),
        cover_timestamp_seconds: None,
        disclosures: serde_json::json!({}),
        platform_specific: serde_json::json!({}),
    };

    match adapter.publish(&dest.credential_ref, &request).await {
        Ok(result) => {
            let db_result = db.with_conn(|conn| {
                conn.execute(
                    "UPDATE destination_post SET status = 'posted', platform_post_id = ?1, post_url = ?2,
                     error_code = NULL, error_message = NULL, is_retryable = 0, updated_at = datetime('now')
                     WHERE id = ?3",
                    rusqlite::params![result.platform_post_id, result.post_url, dest.destination_post_id],
                )?;
                insert_status_event(conn, &dest.destination_post_id, "posted", None)?;
                Ok::<_, rusqlite::Error>(())
            });
            if let Err(e) = db_result {
                eprintln!("failed to record successful publish: {e}");
            }
            recompute_campaign_status(db, &dest.campaign_id);
        }
        Err(e) => handle_adapter_error(db, &dest, &adapter.translate_error(&e), false),
    }
}

fn handle_adapter_error(
    db: &Database,
    dest: &DueDestination,
    translated: &nzyselle_core::adapter::TranslatedError,
    retryable: bool,
) {
    if retryable {
        // Leave status = 'scheduled' so the next tick retries it.
        mark_status(db, &dest.destination_post_id, "scheduled", Some(&translated.plain_message));
    } else {
        fail_destination(
            db,
            &dest.destination_post_id,
            &dest.campaign_id,
            translated.technical_error_code.as_deref().unwrap_or("ADAPTER_ERROR"),
            &translated.plain_message,
            false,
        );
    }
    log_diagnostic(db, &dest.connection_id, &translated.plain_message, translated.technical_error_code.as_deref());
}

fn fail_destination(db: &Database, destination_post_id: &str, campaign_id: &str, code: &str, message: &str, is_retryable: bool) {
    let result = db.with_conn(|conn| {
        conn.execute(
            "UPDATE destination_post SET status = 'failed', error_code = ?1, error_message = ?2,
             is_retryable = ?3, updated_at = datetime('now') WHERE id = ?4",
            rusqlite::params![code, message, is_retryable as i64, destination_post_id],
        )?;
        insert_status_event(conn, destination_post_id, "failed", Some(message))?;
        Ok::<_, rusqlite::Error>(())
    });
    if let Err(e) = result {
        eprintln!("failed to record destination failure: {e}");
    }
    recompute_campaign_status(db, campaign_id);
}

fn mark_status(db: &Database, destination_post_id: &str, status: &str, message: Option<&str>) {
    let result = db.with_conn(|conn| {
        conn.execute(
            "UPDATE destination_post SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![status, destination_post_id],
        )?;
        insert_status_event(conn, destination_post_id, status, message)?;
        Ok::<_, rusqlite::Error>(())
    });
    if let Err(e) = result {
        eprintln!("failed to update destination status: {e}");
    }
}

fn insert_status_event(conn: &Connection, destination_post_id: &str, status: &str, message: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO post_status_event (id, destination_post_id, status, message) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![nzyselle_core::ids::generate_prefixed_id("evt"), destination_post_id, status, message],
    )?;
    Ok(())
}

fn record_upload_attempt(db: &Database, destination_post_id: &str, attempt_number: i64, outcome: &str, message: &str) {
    let result = db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO upload_attempt (id, destination_post_id, attempt_number, finished_at, outcome, provider_error_code)
             VALUES (?1, ?2, ?3, datetime('now'), ?4, ?5)",
            rusqlite::params![
                nzyselle_core::ids::generate_prefixed_id("ua"),
                destination_post_id,
                attempt_number,
                outcome,
                message
            ],
        )
    });
    if let Err(e) = result {
        eprintln!("failed to record upload attempt: {e}");
    }
}

fn count_attempts(db: &Database, destination_post_id: &str) -> Option<i64> {
    db.with_conn(|conn| {
        conn.query_row(
            "SELECT COUNT(*) FROM upload_attempt WHERE destination_post_id = ?1",
            [destination_post_id],
            |row| row.get(0),
        )
    })
    .ok()
}

fn log_diagnostic(db: &Database, connection_id: &str, plain_message: &str, technical_error_code: Option<&str>) {
    let result = db.with_conn(|conn| {
        let platform_id: Option<String> = conn
            .query_row("SELECT platform_id FROM social_connection WHERE id = ?1", [connection_id], |row| row.get(0))
            .ok();
        conn.execute(
            "INSERT INTO diagnostic_event (id, platform_id, connection_id, severity, plain_message, technical_error_code)
             VALUES (?1, ?2, ?3, 'error', ?4, ?5)",
            rusqlite::params![
                nzyselle_core::ids::generate_prefixed_id("diag"),
                platform_id,
                connection_id,
                plain_message,
                technical_error_code
            ],
        )
    });
    if let Err(e) = result {
        eprintln!("failed to log diagnostic event: {e}");
    }
}

/// Recomputes and persists a campaign's aggregate status from its
/// destinations' individual statuses. Called after every destination
/// reaches a terminal state so the campaign row (what Videos/Calendar list)
/// always reflects reality rather than needing its own parallel tracking.
pub fn recompute_campaign_status(db: &Database, campaign_id: &str) {
    let result = db.with_conn(|conn| {
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM destination_post WHERE campaign_id = ?1",
            [campaign_id],
            |row| row.get(0),
        )?;
        let posted: i64 = conn.query_row(
            "SELECT COUNT(*) FROM destination_post WHERE campaign_id = ?1 AND status = 'posted'",
            [campaign_id],
            |row| row.get(0),
        )?;
        let pending: i64 = conn.query_row(
            "SELECT COUNT(*) FROM destination_post WHERE campaign_id = ?1 AND status IN ('scheduled','uploading')",
            [campaign_id],
            |row| row.get(0),
        )?;
        let cancelled: i64 = conn.query_row(
            "SELECT COUNT(*) FROM destination_post WHERE campaign_id = ?1 AND status = 'cancelled'",
            [campaign_id],
            |row| row.get(0),
        )?;

        let status = if pending > 0 {
            "scheduled"
        } else if posted == total {
            "posted"
        } else if posted > 0 {
            "partially_posted"
        } else if cancelled == total {
            "cancelled"
        } else {
            "failed"
        };

        conn.execute(
            "UPDATE publishing_campaign SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![status, campaign_id],
        )?;
        Ok::<_, rusqlite::Error>(())
    });
    if let Err(e) = result {
        eprintln!("failed to recompute campaign status: {e}");
    }
}
