//! Real Instagram adapter -- via the Meta/Facebook Graph API (Instagram
//! Graph API for professional accounts linked to a Facebook Page).
//!
//! **UNVERIFIED.** Written against https://developers.facebook.com/docs/instagram-platform/,
//! never run against a live Meta developer app -- same caveat as
//! `tiktok_adapter.rs`.
//!
//! **A real, load-bearing limitation, not a shortcut taken here:**
//! Instagram's public Graph API only accepts a *publicly reachable URL* for
//! the video when creating a media container -- it does not accept direct
//! byte upload of a local file the way TikTok/YouTube do. A fully local
//! desktop app has no such URL to offer by default. Rather than silently
//! failing or pretending to upload, `initialize_upload`/`upload_media`
//! return `AdapterError::NotSupported` with that explanation unless the
//! caller supplies an already-hosted URL via
//! `PublishRequest.platform_specific.mediaUrl` (for users who host their
//! own videos elsewhere) -- in which case `publish()` drives the real
//! container-creation + publish flow against that URL.

use async_trait::async_trait;
use chrono::{Duration, Utc};
use std::collections::HashMap;
use std::sync::Arc;

use crate::adapter::*;
use crate::capability::{Capability, PlatformCapabilities};
use crate::credentials::CredentialStore;
use crate::ids::generate_id;
use crate::oauth_http::{generate_pkce, load_client_config, load_tokens, map_http_status, map_transport_error, save_tokens, StoredTokens};

const GRAPH_VERSION: &str = "v19.0";
const AUTH_URL: &str = "https://www.facebook.com/v19.0/dialog/oauth";
const TOKEN_URL: &str = "https://graph.facebook.com/v19.0/oauth/access_token";

fn graph_url(path: &str) -> String {
    format!("https://graph.facebook.com/{GRAPH_VERSION}/{path}")
}

pub struct InstagramAdapter {
    credentials: Arc<dyn CredentialStore>,
    http: reqwest::Client,
}

impl InstagramAdapter {
    pub fn new(credentials: Arc<dyn CredentialStore>) -> Self {
        Self { credentials, http: reqwest::Client::new() }
    }

    fn capabilities_map() -> HashMap<String, Capability> {
        let mut m = HashMap::new();
        for (key, supported, note) in [
            ("oauth_connection", true, None),
            (
                "direct_publish",
                true,
                Some("Requires a professional account linked to a Facebook Page, AND a publicly-hosted video URL -- see module docs."),
            ),
            ("native_music_selection", false, Some("Not exposed via the Graph API.")),
            ("reach_metric", true, None),
            ("saves_metric", true, None),
        ] {
            m.insert(key.to_string(), Capability { key: key.to_string(), supported, requires_review: false, requires_paid_access: false, notes: note.map(str::to_string) });
        }
        m
    }

    async fn ig_user_id(&self, access_token: &str) -> Result<String, AdapterError> {
        let resp = self.http.get(graph_url("me/accounts")).query(&[("access_token", access_token)]).send().await.map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        #[derive(serde::Deserialize)]
        struct Accounts {
            data: Vec<Page>,
        }
        #[derive(serde::Deserialize)]
        struct Page {
            id: String,
        }
        let accounts: Accounts = serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(format!("Unexpected accounts response: {e}")))?;
        let Some(page) = accounts.data.first() else {
            return Err(AdapterError::Permanent("No Facebook Page found on this account. Instagram publishing requires a professional account linked to a Facebook Page.".to_string()));
        };

        let resp = self.http.get(graph_url(&page.id)).query(&[("fields", "instagram_business_account"), ("access_token", access_token)]).send().await.map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        #[derive(serde::Deserialize)]
        struct PageDetail {
            instagram_business_account: Option<IgAccount>,
        }
        #[derive(serde::Deserialize)]
        struct IgAccount {
            id: String,
        }
        let detail: PageDetail = serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(e.to_string()))?;
        detail
            .instagram_business_account
            .map(|a| a.id)
            .ok_or_else(|| AdapterError::Permanent("This Facebook Page has no linked Instagram professional account.".to_string()))
    }
}

#[async_trait]
impl ProviderAdapter for InstagramAdapter {
    fn platform_id(&self) -> &'static str {
        "instagram"
    }

    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities {
            platform_id: "instagram".to_string(),
            registry_version: 1,
            instructions_reviewed_at: "2026-08-01".to_string(),
            docs_url: "https://developers.facebook.com/docs/instagram-platform/".to_string(),
            capabilities: Self::capabilities_map(),
        }
    }

    async fn begin_authorization(&self, _requested_scopes: &[String], redirect_uri: &str) -> Result<OAuthBeginResult, AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "instagram")?;
        let pkce = generate_pkce(); // Meta's OAuth doesn't require PKCE, generated anyway for a uniform loopback-callback contract.
        let state = crate::oauth_http::generate_state();
        // The caller (commands.rs) only passes generic intent labels like
        // "publish"/"analytics", not real Facebook permission names -- those
        // aren't valid Graph API scopes, so this adapter always requests its
        // own real, documented permission set instead.
        let scope = "instagram_basic,instagram_content_publish,pages_show_list,business_management".to_string();
        let url = format!(
            "{AUTH_URL}?client_id={}&redirect_uri={}&state={}&scope={}&response_type=code",
            urlencoding::encode(&config.client_id),
            urlencoding::encode(redirect_uri),
            urlencoding::encode(&state),
            urlencoding::encode(&scope),
        );
        Ok(OAuthBeginResult { authorization_url: url, state, pkce_verifier: pkce.verifier, expires_at: Utc::now() + Duration::minutes(10) })
    }

    async fn complete_authorization(&self, code: &str, _state: &str, _pkce_verifier: &str, redirect_uri: &str) -> Result<AuthorizedIdentity, AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "instagram")?;
        let resp = self
            .http
            .get(TOKEN_URL)
            .query(&[
                ("client_id", config.client_id.as_str()),
                ("client_secret", config.client_secret.as_str()),
                ("redirect_uri", redirect_uri),
                ("code", code),
            ])
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        let body = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &body));
        }
        #[derive(serde::Deserialize)]
        struct TokenResponse {
            access_token: String,
            expires_in: Option<i64>,
        }
        let parsed: TokenResponse = serde_json::from_str(&body).map_err(|e| AdapterError::Permanent(format!("Unexpected token response: {e}")))?;

        let credential_ref = format!("nzyselle:instagram:{}", generate_id());
        save_tokens(
            self.credentials.as_ref(),
            &credential_ref,
            &StoredTokens { access_token: parsed.access_token.clone(), refresh_token: None, expires_at: parsed.expires_in.map(|s| Utc::now() + Duration::seconds(s)) },
        )?;

        let ig_user_id = self.ig_user_id(&parsed.access_token).await?;
        let resp = self.http.get(graph_url(&ig_user_id)).query(&[("fields", "username,profile_picture_url"), ("access_token", parsed.access_token.as_str())]).send().await.map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        #[derive(serde::Deserialize)]
        struct IgProfile {
            username: Option<String>,
            profile_picture_url: Option<String>,
        }
        let profile: IgProfile = serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(e.to_string()))?;

        Ok(AuthorizedIdentity {
            platform_account_id: ig_user_id,
            display_name: profile.username.clone(),
            username: profile.username,
            profile_image_url: profile.profile_picture_url,
            granted_scopes: vec![],
            missing_scopes: vec![],
            credential_ref,
            token_expires_at: None,
        })
    }

    async fn refresh_authorization(&self, credential_ref: &str) -> Result<(), AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "instagram")?;
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let resp = self
            .http
            .get(TOKEN_URL)
            .query(&[
                ("grant_type", "fb_exchange_token"),
                ("client_id", config.client_id.as_str()),
                ("client_secret", config.client_secret.as_str()),
                ("fb_exchange_token", tokens.access_token.as_str()),
            ])
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        let body = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &body));
        }
        #[derive(serde::Deserialize)]
        struct RefreshResponse {
            access_token: String,
            expires_in: Option<i64>,
        }
        let parsed: RefreshResponse = serde_json::from_str(&body).map_err(|e| AdapterError::Permanent(e.to_string()))?;
        save_tokens(self.credentials.as_ref(), credential_ref, &StoredTokens { access_token: parsed.access_token, refresh_token: None, expires_at: parsed.expires_in.map(|s| Utc::now() + Duration::seconds(s)) })
    }

    async fn revoke_authorization(&self, credential_ref: &str) -> Result<(), AdapterError> {
        let _ = self.credentials.delete(credential_ref);
        Ok(())
    }

    async fn get_connected_identity(&self, credential_ref: &str) -> Result<AuthorizedIdentity, AdapterError> {
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let ig_user_id = self.ig_user_id(&tokens.access_token).await?;
        Ok(AuthorizedIdentity { platform_account_id: ig_user_id, display_name: None, username: None, profile_image_url: None, granted_scopes: vec![], missing_scopes: vec![], credential_ref: credential_ref.to_string(), token_expires_at: None })
    }

    async fn validate_connection(&self, credential_ref: &str) -> Result<(), AdapterError> {
        self.get_connected_identity(credential_ref).await.map(|_| ())
    }

    async fn validate_media(&self, file_path: &str) -> Result<MediaValidationResult, AdapterError> {
        let mut issues = vec![];
        let lower = file_path.to_lowercase();
        if !(lower.ends_with(".mp4") || lower.ends_with(".mov")) {
            issues.push("Instagram accepts MP4 or MOV.".to_string());
        }
        Ok(MediaValidationResult { is_supported: issues.is_empty(), issues, max_duration_seconds: Some(900.0), max_file_size_bytes: Some(1024 * 1024 * 1024), requires_conversion: false })
    }

    async fn get_creator_posting_options(&self, _credential_ref: &str) -> Result<CreatorPostingOptions, AdapterError> {
        Ok(CreatorPostingOptions { available_privacy_levels: vec!["PUBLIC".into()], can_disable_comments: true, can_disable_duet: false, can_disable_stitch: false, max_duration_seconds: Some(900.0), posting_cap_remaining: Some(25), extra: serde_json::json!({}) })
    }

    async fn estimate_request_cost(&self, _operation: &str) -> Result<CostEstimate, AdapterError> {
        Ok(CostEstimate { is_chargeable: false, estimated_cost_usd: Some(0.0), pricing_last_checked: Some(Utc::now()), pricing_source_url: Some("https://developers.facebook.com/docs/instagram-platform/".to_string()) })
    }

    async fn initialize_upload(&self, _credential_ref: &str, _file_path: &str, _metadata: &UploadMetadata) -> Result<UploadHandle, AdapterError> {
        Err(AdapterError::NotSupported(
            "Instagram's Graph API only accepts a publicly-hosted video URL, not a direct local file upload. Host the file somewhere reachable and pass its URL, or use another platform.".to_string(),
        ))
    }

    async fn upload_media(&self, _handle: &UploadHandle, _file_path: &str) -> Result<Option<String>, AdapterError> {
        Err(AdapterError::NotSupported("Same limitation as initialize_upload -- Instagram needs a hosted URL.".to_string()))
    }

    async fn get_upload_status(&self, _handle: &UploadHandle) -> Result<UploadStatus, AdapterError> {
        Err(AdapterError::NotSupported("Not applicable -- Instagram publishing here goes through publish() directly with a hosted media URL.".to_string()))
    }

    async fn publish(&self, credential_ref: &str, request: &PublishRequest) -> Result<PublishResult, AdapterError> {
        let media_url = request
            .platform_specific
            .get("mediaUrl")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AdapterError::NotSupported("Instagram requires a publicly-hosted video URL in platform_specific.mediaUrl -- see module docs.".to_string()))?;

        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let ig_user_id = self.ig_user_id(&tokens.access_token).await?;

        let resp = self
            .http
            .post(graph_url(&format!("{ig_user_id}/media")))
            .query(&[("access_token", tokens.access_token.as_str())])
            .form(&[("video_url", media_url), ("caption", request.caption.as_deref().unwrap_or("")), ("media_type", "REELS")])
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        #[derive(serde::Deserialize)]
        struct ContainerResponse {
            id: String,
        }
        let container: ContainerResponse = serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(format!("Unexpected container response: {e}")))?;

        // Poll container status -- Instagram processes the hosted video
        // asynchronously before it can be published.
        for _ in 0..10 {
            let resp = self.http.get(graph_url(&container.id)).query(&[("fields", "status_code"), ("access_token", tokens.access_token.as_str())]).send().await.map_err(map_transport_error)?;
            let text = resp.text().await.map_err(map_transport_error)?;
            #[derive(serde::Deserialize)]
            struct StatusResponse {
                status_code: String,
            }
            if let Ok(parsed) = serde_json::from_str::<StatusResponse>(&text) {
                if parsed.status_code == "FINISHED" {
                    break;
                }
                if parsed.status_code == "ERROR" {
                    return Err(AdapterError::Permanent("Instagram failed to process the hosted video.".to_string()));
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }

        let resp = self
            .http
            .post(graph_url(&format!("{ig_user_id}/media_publish")))
            .query(&[("access_token", tokens.access_token.as_str())])
            .form(&[("creation_id", container.id.as_str())])
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        #[derive(serde::Deserialize)]
        struct PublishResponse {
            id: String,
        }
        let published: PublishResponse = serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(e.to_string()))?;
        Ok(PublishResult { platform_post_id: Some(published.id.clone()), post_url: Some(format!("https://www.instagram.com/reel/{}/", published.id)), awaiting_manual_finish: false, manual_finish_instructions: None })
    }

    async fn cancel_publish(&self, _platform_post_id: &str) -> Result<(), AdapterError> {
        Err(AdapterError::NotSupported("Instagram has no documented unpublish endpoint through this API.".to_string()))
    }

    async fn list_owned_posts(&self, _credential_ref: &str) -> Result<Vec<RemotePost>, AdapterError> {
        Err(AdapterError::NotSupported("Not implemented yet.".to_string()))
    }

    async fn get_post(&self, _credential_ref: &str, platform_post_id: &str) -> Result<RemotePost, AdapterError> {
        Ok(RemotePost { platform_post_id: platform_post_id.to_string(), post_url: Some(format!("https://www.instagram.com/reel/{platform_post_id}/")), created_at: None })
    }

    async fn get_post_metrics(&self, credential_ref: &str, platform_post_id: &str) -> Result<Vec<MetricValue>, AdapterError> {
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let resp = self
            .http
            .get(graph_url(&format!("{platform_post_id}/insights")))
            .query(&[("metric", "reach,saved"), ("access_token", tokens.access_token.as_str())])
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        #[derive(serde::Deserialize)]
        struct Insights {
            data: Vec<InsightMetric>,
        }
        #[derive(serde::Deserialize)]
        struct InsightMetric {
            name: String,
            values: Vec<InsightValue>,
        }
        #[derive(serde::Deserialize)]
        struct InsightValue {
            value: f64,
        }
        let parsed: Insights = serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(e.to_string()))?;
        Ok(parsed
            .data
            .into_iter()
            .map(|m| MetricValue { metric_key: m.name, value: m.values.first().map(|v| v.value), not_provided_reason: None, measured_at: Utc::now(), is_estimated: false })
            .collect())
    }

    fn get_metric_definitions(&self) -> Vec<(String, String)> {
        vec![("reach".to_string(), "Reach".to_string()), ("saved".to_string(), "Saves".to_string())]
    }

    async fn refresh_analytics(&self, _credential_ref: &str) -> Result<(), AdapterError> {
        Ok(())
    }

    async fn get_rate_limit_state(&self, _credential_ref: &str) -> Result<RateLimitState, AdapterError> {
        Ok(RateLimitState { remaining: None, limit: None, resets_at: None })
    }

    fn translate_error(&self, error: &AdapterError) -> TranslatedError {
        match error {
            AdapterError::NotSupported(what) => TranslatedError { plain_message: format!("Instagram doesn't support this here: {what}"), is_retryable: false, technical_error_code: Some("IG_NOT_SUPPORTED".to_string()), http_status: None, documentation_url: Some("https://developers.facebook.com/docs/instagram-platform/".to_string()) },
            AdapterError::ReauthorizationRequired => TranslatedError { plain_message: "Instagram requires reconnecting this account.".to_string(), is_retryable: false, technical_error_code: Some("IG_REAUTH".to_string()), http_status: Some(401), documentation_url: None },
            other => TranslatedError { plain_message: other.to_string(), is_retryable: false, technical_error_code: None, http_status: None, documentation_url: None },
        }
    }
}
