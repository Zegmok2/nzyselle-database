//! The provider-adapter contract.
//!
//! Every platform (TikTok, Instagram, YouTube, X, ...) implements this same
//! trait. The rest of the application — upload queue, publish workflow,
//! diagnostics, analytics sync — talks only to `ProviderAdapter`, never to
//! a platform-specific type. That's what lets a new platform be added
//! without touching the UI or the queue: write one adapter, register it.
//!
//! Adapters MUST declare capabilities honestly. `PlatformCapabilities`
//! flows from the versioned registry (see `capability.rs`), and every
//! adapter method that a platform doesn't support returns
//! `AdapterError::NotSupported` rather than silently no-op'ing or faking
//! success — the caller is required to surface that to the user as
//! "Not provided by this platform," never as a zero or a fabricated result.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::capability::PlatformCapabilities;

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("this platform does not support this operation: {0}")]
    NotSupported(String),
    #[error("reauthorization required")]
    ReauthorizationRequired,
    #[error("rate limited, retry after {retry_after_seconds:?} seconds")]
    RateLimited { retry_after_seconds: Option<u64> },
    #[error("quota exhausted for this account")]
    QuotaExhausted,
    #[error("paid API access required: {0}")]
    PaidAccessRequired(String),
    #[error("developer app review required: {0}")]
    ReviewRequired(String),
    #[error("temporary provider error, safe to retry: {0}")]
    Retryable(String),
    #[error("permanent error, do not automatically retry: {0}")]
    Permanent(String),
    #[error("network or transport error: {0}")]
    Network(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthBeginResult {
    /// The official provider authorization URL to open in the system browser.
    /// Never rendered inside the app — the app never shows a login form.
    pub authorization_url: String,
    pub state: String,
    pub pkce_verifier: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizedIdentity {
    pub platform_account_id: String,
    pub display_name: Option<String>,
    pub username: Option<String>,
    pub profile_image_url: Option<String>,
    pub granted_scopes: Vec<String>,
    pub missing_scopes: Vec<String>,
    /// A reference key for Windows Credential Manager. The actual token
    /// value is written directly to Credential Manager by the caller and
    /// never appears in this struct or anywhere else in the domain layer.
    pub credential_ref: String,
    pub token_expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaValidationResult {
    pub is_supported: bool,
    pub issues: Vec<String>,
    pub max_duration_seconds: Option<f64>,
    pub max_file_size_bytes: Option<u64>,
    pub requires_conversion: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorPostingOptions {
    pub available_privacy_levels: Vec<String>,
    pub can_disable_comments: bool,
    pub can_disable_duet: bool,
    pub can_disable_stitch: bool,
    pub max_duration_seconds: Option<f64>,
    pub max_caption_length: Option<u32>,
    pub posting_cap_remaining: Option<u32>,
    /// Raw provider fields the UI may want to show verbatim, kept generic
    /// on purpose so this struct doesn't need to change per platform.
    pub extra: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostEstimate {
    pub is_chargeable: bool,
    pub estimated_cost_usd: Option<f64>,
    pub pricing_last_checked: Option<DateTime<Utc>>,
    pub pricing_source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadHandle {
    pub upload_id: String,
    pub resumable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UploadStatus {
    Preparing,
    Uploading { bytes_uploaded: u64, bytes_total: u64 },
    Processing,
    Complete,
    Failed { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishRequest {
    pub upload_id: String,
    pub caption: Option<String>,
    pub privacy_level: Option<String>,
    pub cover_timestamp_seconds: Option<f64>,
    pub disclosures: serde_json::Value,
    pub platform_specific: serde_json::Value,
}

/// Caption/privacy/etc metadata the caller already has in hand *before*
/// `initialize_upload` runs (it comes from the destination post row, set
/// when the user submitted the campaign). Some platforms (TikTok's Content
/// Posting API) require this in the same call that starts the upload, not
/// as a separate step afterward -- passing it here instead of only at
/// `publish()` time lets an adapter actually do that correctly. Mirrors
/// `PublishRequest` minus `upload_id`, which doesn't exist yet at this point.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UploadMetadata {
    pub caption: Option<String>,
    pub privacy_level: Option<String>,
    pub cover_timestamp_seconds: Option<f64>,
    pub disclosures: serde_json::Value,
    pub platform_specific: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishResult {
    pub platform_post_id: Option<String>,
    pub post_url: Option<String>,
    /// True when the platform requires a manual finishing step (e.g. a
    /// TikTok draft awaiting sound selection, or Instagram "Finish in
    /// Instagram" for native music) rather than being fully posted yet.
    pub awaiting_manual_finish: bool,
    pub manual_finish_instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePost {
    pub platform_post_id: String,
    pub post_url: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricValue {
    pub metric_key: String,
    pub value: Option<f64>,
    /// None means "not provided by this platform" — the UI renders this
    /// literally, never as a zero.
    pub not_provided_reason: Option<String>,
    pub measured_at: DateTime<Utc>,
    pub is_estimated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitState {
    pub remaining: Option<u32>,
    pub limit: Option<u32>,
    pub resets_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslatedError {
    pub plain_message: String,
    pub is_retryable: bool,
    pub technical_error_code: Option<String>,
    pub http_status: Option<u16>,
    pub documentation_url: Option<String>,
}

/// The contract every platform adapter implements. Nothing outside this
/// trait's return types should leak platform-specific shapes into the
/// rest of the application.
#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn platform_id(&self) -> &'static str;
    fn capabilities(&self) -> PlatformCapabilities;

    async fn begin_authorization(&self, requested_scopes: &[String], redirect_uri: &str) -> Result<OAuthBeginResult, AdapterError>;
    async fn complete_authorization(&self, code: &str, state: &str, pkce_verifier: &str, redirect_uri: &str) -> Result<AuthorizedIdentity, AdapterError>;
    async fn refresh_authorization(&self, credential_ref: &str) -> Result<(), AdapterError>;
    async fn revoke_authorization(&self, credential_ref: &str) -> Result<(), AdapterError>;
    async fn get_connected_identity(&self, credential_ref: &str) -> Result<AuthorizedIdentity, AdapterError>;
    async fn validate_connection(&self, credential_ref: &str) -> Result<(), AdapterError>;

    async fn validate_media(&self, file_path: &str) -> Result<MediaValidationResult, AdapterError>;
    async fn get_creator_posting_options(&self, credential_ref: &str) -> Result<CreatorPostingOptions, AdapterError>;
    async fn estimate_request_cost(&self, operation: &str) -> Result<CostEstimate, AdapterError>;

    async fn initialize_upload(&self, credential_ref: &str, file_path: &str, metadata: &UploadMetadata) -> Result<UploadHandle, AdapterError>;
    /// Returns `Some(id)` when the upload call itself revealed a permanent
    /// platform-native id (e.g. YouTube's resumable upload response
    /// includes the new video's id) -- the caller substitutes this for
    /// `PublishRequest.upload_id` on the subsequent `publish()` call when
    /// present, since some platforms have nothing left to do with the
    /// original upload handle once this comes back. `None` when the
    /// platform doesn't reveal an id this early (TikTok, Sandbox).
    async fn upload_media(&self, handle: &UploadHandle, file_path: &str) -> Result<Option<String>, AdapterError>;
    async fn get_upload_status(&self, handle: &UploadHandle) -> Result<UploadStatus, AdapterError>;

    async fn publish(&self, credential_ref: &str, request: &PublishRequest) -> Result<PublishResult, AdapterError>;
    async fn cancel_publish(&self, platform_post_id: &str) -> Result<(), AdapterError>;

    async fn list_owned_posts(&self, credential_ref: &str) -> Result<Vec<RemotePost>, AdapterError>;
    async fn get_post(&self, credential_ref: &str, platform_post_id: &str) -> Result<RemotePost, AdapterError>;
    async fn get_post_metrics(&self, credential_ref: &str, platform_post_id: &str) -> Result<Vec<MetricValue>, AdapterError>;
    fn get_metric_definitions(&self) -> Vec<(String, String)>; // (metric_key, human label)
    async fn refresh_analytics(&self, credential_ref: &str) -> Result<(), AdapterError>;

    async fn get_rate_limit_state(&self, credential_ref: &str) -> Result<RateLimitState, AdapterError>;
    fn translate_error(&self, error: &AdapterError) -> TranslatedError;
}
