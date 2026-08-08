//! Sandbox adapter — a fully working, self-contained implementation of
//! `ProviderAdapter` used for development, automated tests, and demos.
//!
//! This is what the spec calls the "developer-only sandbox mode": it is
//! visibly marked (platform_id == "sandbox", is_sandbox = 1 in the
//! platform registry) and cannot be selected as a real publishing
//! destination in the production UI. Its purpose is to let every other
//! layer of the app — queue, UI, diagnostics, analytics — be built and
//! tested against a real trait implementation before any live platform
//! credentials exist.
//!
//! It never talks to the network. It simulates realistic timing and a
//! configurable failure mode so retry/backoff logic can be exercised.

use async_trait::async_trait;
use chrono::{Duration, Utc};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use crate::ids::generate_id;

use crate::adapter::*;
use crate::capability::{Capability, PlatformCapabilities};

pub struct SandboxAdapter {
    /// When true, `upload_media` and `publish` return a retryable error the
    /// first time they're called for a given upload_id — lets tests exercise
    /// backoff/retry without any real network.
    pub simulate_transient_failure_once: bool,
    failed_once: Mutex<HashMap<String, bool>>,
    call_count: AtomicU32,
}

impl SandboxAdapter {
    pub fn new() -> Self {
        Self {
            simulate_transient_failure_once: false,
            failed_once: Mutex::new(HashMap::new()),
            call_count: AtomicU32::new(0),
        }
    }

    fn capabilities_map() -> HashMap<String, Capability> {
        let mut m = HashMap::new();
        for (key, supported) in [
            ("oauth_connection", true),
            ("direct_publish", true),
            ("video_metrics", true),
            ("watch_time_metric", true),
            ("scheduling_api", false),
        ] {
            m.insert(
                key.to_string(),
                Capability {
                    key: key.to_string(),
                    supported,
                    requires_review: false,
                    requires_paid_access: false,
                    notes: if supported {
                        None
                    } else {
                        Some("Not implemented in the sandbox adapter.".to_string())
                    },
                },
            );
        }
        m
    }
}

impl Default for SandboxAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ProviderAdapter for SandboxAdapter {
    fn platform_id(&self) -> &'static str {
        "sandbox"
    }

    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities {
            platform_id: "sandbox".to_string(),
            registry_version: 1,
            instructions_reviewed_at: "2026-08-01".to_string(),
            docs_url: "https://internal/none".to_string(),
            capabilities: Self::capabilities_map(),
        }
    }

    async fn begin_authorization(&self, requested_scopes: &[String], redirect_uri: &str) -> Result<OAuthBeginResult, AdapterError> {
        let state = generate_id();
        let pkce_verifier = generate_id();
        Ok(OAuthBeginResult {
            authorization_url: format!(
                "https://sandbox.local/oauth/authorize?state={state}&scopes={}&redirect_uri={redirect_uri}",
                requested_scopes.join(",")
            ),
            state,
            pkce_verifier,
            expires_at: Utc::now() + Duration::minutes(10),
        })
    }

    async fn complete_authorization(&self, _code: &str, _state: &str, _pkce_verifier: &str, _redirect_uri: &str) -> Result<AuthorizedIdentity, AdapterError> {
        Ok(AuthorizedIdentity {
            platform_account_id: format!("sb_acct_{}", &generate_id()[..8]),
            display_name: Some("Sandbox Creator".to_string()),
            username: Some("@sandbox_creator".to_string()),
            profile_image_url: None,
            granted_scopes: vec!["publish".to_string(), "analytics".to_string()],
            missing_scopes: vec![],
            credential_ref: format!("nzyselle:sandbox:{}", generate_id()),
            token_expires_at: Some(Utc::now() + Duration::days(60)),
        })
    }

    async fn refresh_authorization(&self, _credential_ref: &str) -> Result<(), AdapterError> {
        Ok(())
    }

    async fn revoke_authorization(&self, _credential_ref: &str) -> Result<(), AdapterError> {
        Ok(())
    }

    async fn get_connected_identity(&self, credential_ref: &str) -> Result<AuthorizedIdentity, AdapterError> {
        Ok(AuthorizedIdentity {
            platform_account_id: "sb_acct_stable".to_string(),
            display_name: Some("Sandbox Creator".to_string()),
            username: Some("@sandbox_creator".to_string()),
            profile_image_url: None,
            granted_scopes: vec!["publish".to_string(), "analytics".to_string()],
            missing_scopes: vec![],
            credential_ref: credential_ref.to_string(),
            token_expires_at: Some(Utc::now() + Duration::days(60)),
        })
    }

    async fn validate_connection(&self, _credential_ref: &str) -> Result<(), AdapterError> {
        Ok(())
    }

    async fn validate_media(&self, file_path: &str) -> Result<MediaValidationResult, AdapterError> {
        let mut issues = vec![];
        if !file_path.to_lowercase().ends_with(".mp4") {
            issues.push("Sandbox adapter only validates .mp4 files.".to_string());
        }
        Ok(MediaValidationResult {
            is_supported: issues.is_empty(),
            issues,
            max_duration_seconds: Some(180.0),
            max_file_size_bytes: Some(500 * 1024 * 1024),
            requires_conversion: false,
        })
    }

    async fn get_creator_posting_options(&self, _credential_ref: &str) -> Result<CreatorPostingOptions, AdapterError> {
        Ok(CreatorPostingOptions {
            available_privacy_levels: vec!["public".into(), "private".into()],
            can_disable_comments: true,
            can_disable_duet: false,
            can_disable_stitch: false,
            max_duration_seconds: Some(180.0),
            posting_cap_remaining: Some(50),
            extra: serde_json::json!({ "note": "sandbox — no real posting cap enforced" }),
        })
    }

    async fn estimate_request_cost(&self, _operation: &str) -> Result<CostEstimate, AdapterError> {
        Ok(CostEstimate {
            is_chargeable: false,
            estimated_cost_usd: Some(0.0),
            pricing_last_checked: Some(Utc::now()),
            pricing_source_url: None,
        })
    }

    async fn initialize_upload(&self, _credential_ref: &str, _file_path: &str, _metadata: &UploadMetadata) -> Result<UploadHandle, AdapterError> {
        Ok(UploadHandle {
            upload_id: generate_id(),
            resumable: true,
        })
    }

    async fn upload_media(&self, handle: &UploadHandle, _file_path: &str) -> Result<Option<String>, AdapterError> {
        self.call_count.fetch_add(1, Ordering::SeqCst);
        if self.simulate_transient_failure_once {
            let mut failed = self.failed_once.lock().unwrap();
            if !failed.contains_key(&handle.upload_id) {
                failed.insert(handle.upload_id.clone(), true);
                return Err(AdapterError::Retryable("simulated transient network blip".to_string()));
            }
        }
        Ok(None)
    }

    async fn get_upload_status(&self, _handle: &UploadHandle) -> Result<UploadStatus, AdapterError> {
        Ok(UploadStatus::Complete)
    }

    async fn publish(&self, _credential_ref: &str, _request: &PublishRequest) -> Result<PublishResult, AdapterError> {
        let post_id = format!("sb_post_{}", &generate_id()[..10]);
        Ok(PublishResult {
            platform_post_id: Some(post_id.clone()),
            post_url: Some(format!("https://sandbox.local/post/{post_id}")),
            awaiting_manual_finish: false,
            manual_finish_instructions: None,
        })
    }

    async fn cancel_publish(&self, _platform_post_id: &str) -> Result<(), AdapterError> {
        Ok(())
    }

    async fn list_owned_posts(&self, _credential_ref: &str) -> Result<Vec<RemotePost>, AdapterError> {
        Ok(vec![])
    }

    async fn get_post(&self, _credential_ref: &str, platform_post_id: &str) -> Result<RemotePost, AdapterError> {
        Ok(RemotePost {
            platform_post_id: platform_post_id.to_string(),
            post_url: Some(format!("https://sandbox.local/post/{platform_post_id}")),
            created_at: Some(Utc::now()),
        })
    }

    async fn get_post_metrics(&self, _credential_ref: &str, _platform_post_id: &str) -> Result<Vec<MetricValue>, AdapterError> {
        Ok(vec![
            MetricValue {
                metric_key: "views".to_string(),
                value: Some(128.0),
                not_provided_reason: None,
                measured_at: Utc::now(),
                is_estimated: false,
            },
            MetricValue {
                metric_key: "watch_time".to_string(),
                value: Some(342.0),
                not_provided_reason: None,
                measured_at: Utc::now(),
                is_estimated: false,
            },
            // Demonstrates the "not provided" contract even in the sandbox,
            // so downstream UI code has to handle it from day one.
            MetricValue {
                metric_key: "audience_retention".to_string(),
                value: None,
                not_provided_reason: Some("Not provided by this platform.".to_string()),
                measured_at: Utc::now(),
                is_estimated: false,
            },
        ])
    }

    fn get_metric_definitions(&self) -> Vec<(String, String)> {
        vec![
            ("views".to_string(), "Views".to_string()),
            ("watch_time".to_string(), "Watch time".to_string()),
        ]
    }

    async fn refresh_analytics(&self, _credential_ref: &str) -> Result<(), AdapterError> {
        Ok(())
    }

    async fn get_rate_limit_state(&self, _credential_ref: &str) -> Result<RateLimitState, AdapterError> {
        Ok(RateLimitState {
            remaining: Some(1000),
            limit: Some(1000),
            resets_at: Some(Utc::now() + Duration::hours(1)),
        })
    }

    fn translate_error(&self, error: &AdapterError) -> TranslatedError {
        match error {
            AdapterError::NotSupported(what) => TranslatedError {
                plain_message: format!("The sandbox platform doesn't support {what}."),
                is_retryable: false,
                technical_error_code: Some("SANDBOX_NOT_SUPPORTED".to_string()),
                http_status: None,
                documentation_url: None,
            },
            AdapterError::Retryable(msg) => TranslatedError {
                plain_message: "A temporary sandbox error occurred. This will retry automatically.".to_string(),
                is_retryable: true,
                technical_error_code: Some(msg.clone()),
                http_status: None,
                documentation_url: None,
            },
            other => TranslatedError {
                plain_message: other.to_string(),
                is_retryable: false,
                technical_error_code: None,
                http_status: None,
                documentation_url: None,
            },
        }
    }
}
