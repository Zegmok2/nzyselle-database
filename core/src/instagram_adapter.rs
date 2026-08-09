//! Real Instagram adapter -- via "Instagram API with Instagram Login" /
//! Business Login for Instagram (developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login).
//!
//! This adapter was originally written against the OLDER "Instagram Graph
//! API via Facebook Login for Business" flow (a linked Facebook Page,
//! `graph.facebook.com`, scopes like `instagram_basic`). That flow turned
//! out not to match reality: a real Meta app created for Instagram posting
//! defaults to the newer **Instagram Login** flow, confirmed live via a
//! real "Invalid Scopes" rejection followed by checking the actual App
//! Dashboard configuration. Rewritten 2026-08-08 against Meta's current
//! docs for that flow -- endpoints, scope names (`instagram_business_*`,
//! not the old `instagram_basic`/`instagram_content_publish`), and the
//! short-lived -> long-lived token exchange are all different from the
//! Facebook Login flow and from every other adapter in this codebase.
//!
//! **A real, load-bearing limitation, not a shortcut taken here:**
//! Instagram's public API only accepts a *publicly reachable URL* for the
//! video when creating a media container -- it does not accept direct byte
//! upload of a local file the way TikTok/YouTube do. A fully local desktop
//! app has no such URL to offer by default. Rather than silently failing
//! or pretending to upload, `initialize_upload`/`upload_media` return
//! `AdapterError::NotSupported` with that explanation unless the caller
//! supplies an already-hosted URL via `PublishRequest.platform_specific.mediaUrl`
//! (for users who host their own videos elsewhere) -- in which case
//! `publish()` drives the real container-creation + publish flow against
//! that URL. This limitation is unchanged by the OAuth-flow rewrite above.

use async_trait::async_trait;
use chrono::{Duration, Utc};
use std::collections::HashMap;
use std::sync::Arc;

use crate::adapter::*;
use crate::capability::{Capability, PlatformCapabilities};
use crate::credentials::CredentialStore;
use crate::ids::generate_id;
use crate::oauth_http::{load_client_config, load_tokens, map_http_status, map_transport_error, save_tokens, StoredTokens};

const GRAPH_VERSION: &str = "v26.0";
const AUTH_URL: &str = "https://www.instagram.com/oauth/authorize";
const SHORT_LIVED_TOKEN_URL: &str = "https://api.instagram.com/oauth/access_token";
const LONG_LIVED_TOKEN_URL: &str = "https://graph.instagram.com/access_token";
const REFRESH_TOKEN_URL: &str = "https://graph.instagram.com/refresh_access_token";
// Confirmed live against Meta's current Business Login for Instagram docs
// (developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)
// after a real "Invalid Scopes" rejection using the old instagram_basic/
// instagram_content_publish names -- those are deprecated in favor of
// these instagram_business_* names for this specific login flow.
const SCOPES: &str = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages";

fn graph_url(path: &str) -> String {
    format!("https://graph.instagram.com/{GRAPH_VERSION}/{path}")
}

#[derive(serde::Deserialize)]
struct MeProfile {
    user_id: String,
    username: Option<String>,
    profile_picture_url: Option<String>,
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
                Some("Requires a professional (Business/Creator) Instagram account, AND a publicly-hosted video URL -- see module docs."),
            ),
            ("native_music_selection", false, Some("Not exposed via the API.")),
            ("reach_metric", true, None),
            ("saves_metric", true, None),
        ] {
            m.insert(key.to_string(), Capability { key: key.to_string(), supported, requires_review: false, requires_paid_access: false, notes: note.map(str::to_string) });
        }
        m
    }

    /// The `/me` endpoint under this login flow -- unlike the old Facebook
    /// Login flow, there's no Facebook Page indirection: the access token
    /// is already scoped directly to the Instagram professional account.
    /// Confirmed live against Meta's current Get Started docs
    /// (developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started),
    /// which show the response wrapped in a "data" array -- unusual for a
    /// singular /me resource, and possibly just a docs inconsistency, so
    /// this tries that shape first and falls back to a flat object rather
    /// than hard-failing on whichever guess turns out wrong.
    async fn fetch_me(&self, access_token: &str) -> Result<MeProfile, AdapterError> {
        let resp = self
            .http
            .get(graph_url("me"))
            .query(&[("fields", "user_id,username,profile_picture_url"), ("access_token", access_token)])
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }

        #[derive(serde::Deserialize)]
        struct Wrapped {
            data: Vec<MeProfile>,
        }
        if let Ok(wrapped) = serde_json::from_str::<Wrapped>(&text) {
            if let Some(profile) = wrapped.data.into_iter().next() {
                return Ok(profile);
            }
        }
        serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(format!("Unexpected /me response: {e}")))
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
            instructions_reviewed_at: "2026-08-08".to_string(),
            docs_url: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/".to_string(),
            capabilities: Self::capabilities_map(),
        }
    }

    async fn begin_authorization(&self, _requested_scopes: &[String], redirect_uri: &str) -> Result<OAuthBeginResult, AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "instagram")?;
        let state = crate::oauth_http::generate_state();
        // This flow's docs don't mention PKCE at all (client_secret-based
        // exchange only) -- pkce_verifier is left empty rather than
        // generated-but-unused, so nothing implies it's actually checked.
        let url = format!(
            "{AUTH_URL}?client_id={}&redirect_uri={}&state={}&scope={}&response_type=code",
            urlencoding::encode(&config.client_id),
            urlencoding::encode(redirect_uri),
            urlencoding::encode(&state),
            urlencoding::encode(SCOPES),
        );
        Ok(OAuthBeginResult { authorization_url: url, state, pkce_verifier: String::new(), expires_at: Utc::now() + Duration::minutes(10) })
    }

    async fn complete_authorization(&self, code: &str, _state: &str, _pkce_verifier: &str, redirect_uri: &str) -> Result<AuthorizedIdentity, AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "instagram")?;

        // Step 1: exchange the code for a short-lived (1 hour) token.
        let resp = self
            .http
            .post(SHORT_LIVED_TOKEN_URL)
            .form(&[
                ("client_id", config.client_id.as_str()),
                ("client_secret", config.client_secret.as_str()),
                ("grant_type", "authorization_code"),
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
        // Wrapped in a "data" array per Meta's documented response shape
        // for this specific endpoint -- confirmed from their live docs.
        #[derive(serde::Deserialize)]
        struct ShortLivedTokenResponse {
            data: Vec<ShortLivedTokenItem>,
        }
        #[derive(serde::Deserialize)]
        struct ShortLivedTokenItem {
            access_token: String,
        }
        let parsed: ShortLivedTokenResponse = serde_json::from_str(&body).map_err(|e| AdapterError::Permanent(format!("Unexpected token response: {e}")))?;
        let short_lived = parsed
            .data
            .into_iter()
            .next()
            .ok_or_else(|| AdapterError::Permanent("Token exchange succeeded but returned no token.".to_string()))?
            .access_token;

        // Step 2: exchange the short-lived token for a 60-day long-lived one.
        let resp = self
            .http
            .get(LONG_LIVED_TOKEN_URL)
            .query(&[("grant_type", "ig_exchange_token"), ("client_secret", config.client_secret.as_str()), ("access_token", short_lived.as_str())])
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        let body = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &body));
        }
        #[derive(serde::Deserialize)]
        struct LongLivedTokenResponse {
            access_token: String,
            expires_in: Option<i64>,
        }
        let long_lived: LongLivedTokenResponse = serde_json::from_str(&body).map_err(|e| AdapterError::Permanent(format!("Unexpected long-lived token response: {e}")))?;

        let credential_ref = format!("nzyselle:instagram:{}", generate_id());
        save_tokens(
            self.credentials.as_ref(),
            &credential_ref,
            &StoredTokens { access_token: long_lived.access_token.clone(), refresh_token: None, expires_at: long_lived.expires_in.map(|s| Utc::now() + Duration::seconds(s)) },
        )?;

        let me = self.fetch_me(&long_lived.access_token).await?;
        Ok(AuthorizedIdentity {
            platform_account_id: me.user_id,
            display_name: me.username.clone(),
            username: me.username,
            profile_image_url: me.profile_picture_url,
            granted_scopes: vec![],
            missing_scopes: vec![],
            credential_ref,
            token_expires_at: long_lived.expires_in.map(|s| Utc::now() + Duration::seconds(s)),
        })
    }

    async fn refresh_authorization(&self, credential_ref: &str) -> Result<(), AdapterError> {
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        // Instagram's long-lived tokens refresh themselves -- no separate
        // refresh_token concept, just the current access_token plus the
        // app's ability to call this endpoint (requires the token to be
        // >=24h old and still valid, and instagram_business_basic to have
        // been granted -- both real documented constraints, not enforced
        // client-side here; a failure surfaces as a normal API error).
        let resp = self
            .http
            .get(REFRESH_TOKEN_URL)
            .query(&[("grant_type", "ig_refresh_token"), ("access_token", tokens.access_token.as_str())])
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
        let me = self.fetch_me(&tokens.access_token).await?;
        Ok(AuthorizedIdentity {
            platform_account_id: me.user_id,
            display_name: me.username.clone(),
            username: me.username,
            profile_image_url: me.profile_picture_url,
            granted_scopes: vec![],
            missing_scopes: vec![],
            credential_ref: credential_ref.to_string(),
            token_expires_at: None,
        })
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
        // 2200 chars is the Instagram API's documented media caption limit:
        // https://developers.facebook.com/docs/instagram-platform/reference/instagram-media
        Ok(CreatorPostingOptions { available_privacy_levels: vec!["PUBLIC".into()], can_disable_comments: true, can_disable_duet: false, can_disable_stitch: false, max_duration_seconds: Some(900.0), max_caption_length: Some(2200), posting_cap_remaining: Some(25), extra: serde_json::json!({}) })
    }

    async fn estimate_request_cost(&self, _operation: &str) -> Result<CostEstimate, AdapterError> {
        Ok(CostEstimate { is_chargeable: false, estimated_cost_usd: Some(0.0), pricing_last_checked: Some(Utc::now()), pricing_source_url: Some("https://developers.facebook.com/docs/instagram-platform/".to_string()) })
    }

    async fn initialize_upload(&self, _credential_ref: &str, _file_path: &str, _metadata: &UploadMetadata) -> Result<UploadHandle, AdapterError> {
        Err(AdapterError::NotSupported(
            "Instagram's API only accepts a publicly-hosted video URL, not a direct local file upload. Host the file somewhere reachable and pass its URL, or use another platform.".to_string(),
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
        let me = self.fetch_me(&tokens.access_token).await?;
        let ig_user_id = me.user_id;

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
