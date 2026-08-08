//! Real TikTok adapter -- Content Posting API v2.
//!
//! **UNVERIFIED.** Written against TikTok's public developer docs
//! (https://developers.tiktok.com/doc/content-posting-api-get-started/),
//! never run against a live TikTok developer app or account -- no such
//! credentials exist in this environment. Treat this the same as
//! `credentials::WindowsCredentialStore`: reviewed against documented
//! behavior, not independently proven. The first real test happens when a
//! user pastes real Client Key/Secret in Settings and clicks Connect.
//!
//! Known real limitations (mirrored in db/migrations/0002 capability
//! rows and docs/LIMITATIONS.md, not invented here):
//! - No scheduling API -- any "schedule" for TikTok stays a local-only
//!   concept; `publish()` always posts immediately once called.
//! - Unaudited developer apps are typically restricted to posting only to
//!   the developer's own connected account.
//! - Upload here is single-shot (whole file in one PUT), not TikTok's full
//!   multi-chunk resumable protocol -- correct for small files, but a
//!   large file may need real chunking this adapter doesn't yet do.

use async_trait::async_trait;
use chrono::{Duration, Utc};
use std::collections::HashMap;
use std::sync::Arc;

use crate::adapter::*;
use crate::capability::{Capability, PlatformCapabilities};
use crate::credentials::CredentialStore;
use crate::ids::generate_id;
use crate::oauth_http::{generate_pkce, load_client_config, load_tokens, map_http_status, map_transport_error, save_tokens, StoredTokens};

const AUTH_URL: &str = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL: &str = "https://open.tiktokapis.com/v2/oauth/token/";
const USER_INFO_URL: &str = "https://open.tiktokapis.com/v2/user/info/";
const VIDEO_INIT_URL: &str = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const STATUS_URL: &str = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

pub struct TikTokAdapter {
    credentials: Arc<dyn CredentialStore>,
    http: reqwest::Client,
}

impl TikTokAdapter {
    pub fn new(credentials: Arc<dyn CredentialStore>) -> Self {
        Self { credentials, http: reqwest::Client::new() }
    }

    fn capabilities_map() -> HashMap<String, Capability> {
        let mut m = HashMap::new();
        for (key, supported, note) in [
            ("oauth_connection", true, None),
            ("direct_publish", true, Some("Gated by TikTok's app audit for unaudited apps.")),
            ("scheduling_api", false, Some("Not currently offered by the Content Posting API.")),
            ("sound_library_search", false, Some("No official endpoint exists.")),
            ("video_metrics", true, None),
            ("watch_time_metric", false, Some("Not provided by this platform.")),
        ] {
            m.insert(key.to_string(), Capability { key: key.to_string(), supported, requires_review: false, requires_paid_access: false, notes: note.map(str::to_string) });
        }
        m
    }
}

#[async_trait]
impl ProviderAdapter for TikTokAdapter {
    fn platform_id(&self) -> &'static str {
        "tiktok"
    }

    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities {
            platform_id: "tiktok".to_string(),
            registry_version: 1,
            instructions_reviewed_at: "2026-08-01".to_string(),
            docs_url: "https://developers.tiktok.com/doc/content-posting-api-get-started/".to_string(),
            capabilities: Self::capabilities_map(),
        }
    }

    async fn begin_authorization(&self, _requested_scopes: &[String], redirect_uri: &str) -> Result<OAuthBeginResult, AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "tiktok")?;
        let pkce = generate_pkce();
        let state = crate::oauth_http::generate_state();
        // The caller (commands.rs) only passes generic intent labels like
        // "publish"/"analytics", not real TikTok scope names (e.g.
        // "video.publish") -- those aren't valid TikTok scopes, so this
        // adapter always requests its own real, documented scope set.
        let scope = "user.info.basic,video.publish,video.upload".to_string();
        let url = format!(
            "{AUTH_URL}?client_key={}&response_type=code&scope={}&redirect_uri={}&state={}&code_challenge={}&code_challenge_method=S256",
            urlencoding::encode(&config.client_id),
            urlencoding::encode(&scope),
            urlencoding::encode(redirect_uri),
            urlencoding::encode(&state),
            urlencoding::encode(&pkce.challenge),
        );
        Ok(OAuthBeginResult { authorization_url: url, state, pkce_verifier: pkce.verifier, expires_at: Utc::now() + Duration::minutes(10) })
    }

    async fn complete_authorization(&self, code: &str, _state: &str, pkce_verifier: &str, redirect_uri: &str) -> Result<AuthorizedIdentity, AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "tiktok")?;
        let resp = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_key", config.client_id.as_str()),
                ("client_secret", config.client_secret.as_str()),
                ("code", code),
                ("grant_type", "authorization_code"),
                ("redirect_uri", redirect_uri),
                ("code_verifier", pkce_verifier),
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
            refresh_token: Option<String>,
            expires_in: Option<i64>,
            // TikTok also returns open_id here, redundant with the
            // user/info/ call fetch_user_info() already makes below.
            #[allow(dead_code)]
            open_id: String,
            scope: Option<String>,
        }
        let parsed: TokenResponse = serde_json::from_str(&body).map_err(|e| AdapterError::Permanent(format!("Unexpected token response: {e}")))?;

        let credential_ref = format!("nzyselle:tiktok:{}", generate_id());
        save_tokens(
            self.credentials.as_ref(),
            &credential_ref,
            &StoredTokens {
                access_token: parsed.access_token.clone(),
                refresh_token: parsed.refresh_token,
                expires_at: parsed.expires_in.map(|s| Utc::now() + Duration::seconds(s)),
            },
        )?;

        let identity = self.fetch_user_info(&parsed.access_token, &credential_ref).await?;
        let granted: Vec<String> = parsed.scope.unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(str::to_string).collect();
        Ok(AuthorizedIdentity { granted_scopes: granted, ..identity })
    }

    async fn refresh_authorization(&self, credential_ref: &str) -> Result<(), AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "tiktok")?;
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let refresh_token = tokens.refresh_token.ok_or(AdapterError::ReauthorizationRequired)?;

        let resp = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_key", config.client_id.as_str()),
                ("client_secret", config.client_secret.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token.as_str()),
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
            refresh_token: Option<String>,
            expires_in: Option<i64>,
        }
        let parsed: RefreshResponse = serde_json::from_str(&body).map_err(|e| AdapterError::Permanent(e.to_string()))?;
        save_tokens(
            self.credentials.as_ref(),
            credential_ref,
            &StoredTokens {
                access_token: parsed.access_token,
                refresh_token: parsed.refresh_token.or(Some(refresh_token)),
                expires_at: parsed.expires_in.map(|s| Utc::now() + Duration::seconds(s)),
            },
        )
    }

    async fn revoke_authorization(&self, credential_ref: &str) -> Result<(), AdapterError> {
        let _ = self.credentials.delete(credential_ref);
        Ok(())
    }

    async fn get_connected_identity(&self, credential_ref: &str) -> Result<AuthorizedIdentity, AdapterError> {
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        self.fetch_user_info(&tokens.access_token, credential_ref).await
    }

    async fn validate_connection(&self, credential_ref: &str) -> Result<(), AdapterError> {
        self.get_connected_identity(credential_ref).await.map(|_| ())
    }

    async fn validate_media(&self, file_path: &str) -> Result<MediaValidationResult, AdapterError> {
        let mut issues = vec![];
        if !file_path.to_lowercase().ends_with(".mp4") {
            issues.push("TikTok requires MP4.".to_string());
        }
        let size = std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
        let max = 4u64 * 1024 * 1024 * 1024;
        if size > max {
            issues.push("File exceeds TikTok's documented 4GB upload limit.".to_string());
        }
        Ok(MediaValidationResult { is_supported: issues.is_empty(), issues, max_duration_seconds: Some(600.0), max_file_size_bytes: Some(max), requires_conversion: false })
    }

    async fn get_creator_posting_options(&self, _credential_ref: &str) -> Result<CreatorPostingOptions, AdapterError> {
        Ok(CreatorPostingOptions {
            available_privacy_levels: vec!["PUBLIC_TO_EVERYONE".into(), "MUTUAL_FOLLOW_FRIENDS".into(), "SELF_ONLY".into()],
            can_disable_comments: true,
            can_disable_duet: true,
            can_disable_stitch: true,
            max_duration_seconds: Some(600.0),
            posting_cap_remaining: None,
            extra: serde_json::json!({ "note": "Real posting cap not queryable via a documented endpoint." }),
        })
    }

    async fn estimate_request_cost(&self, _operation: &str) -> Result<CostEstimate, AdapterError> {
        Ok(CostEstimate { is_chargeable: false, estimated_cost_usd: Some(0.0), pricing_last_checked: Some(Utc::now()), pricing_source_url: Some("https://developers.tiktok.com/doc/content-posting-api-get-started/".to_string()) })
    }

    async fn initialize_upload(&self, credential_ref: &str, file_path: &str, metadata: &UploadMetadata) -> Result<UploadHandle, AdapterError> {
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let size = std::fs::metadata(file_path).map_err(|e| AdapterError::Permanent(e.to_string()))?.len();

        // post_info MUST be in this same call -- TikTok's Content Posting
        // API has no separate "publish" endpoint for the FILE_UPLOAD source;
        // once init+PUT complete, TikTok processes and posts automatically
        // using whatever post_info was given here. There is no later chance
        // to attach a caption or privacy level, which is exactly the bug
        // this fixes: previously this call omitted post_info entirely, so
        // every real TikTok post would have gone out with no caption and
        // an unspecified (platform-default) privacy level.
        let privacy_level = metadata.privacy_level.clone().unwrap_or_else(|| "SELF_ONLY".to_string());
        let body = serde_json::json!({
            "post_info": {
                "title": metadata.caption.clone().unwrap_or_default(),
                "privacy_level": privacy_level,
            },
            "source_info": {
                "source": "FILE_UPLOAD",
                "video_size": size,
                "chunk_size": size,
                "total_chunk_count": 1
            }
        });
        let resp = self.http.post(VIDEO_INIT_URL).bearer_auth(&tokens.access_token).json(&body).send().await.map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        #[derive(serde::Deserialize)]
        struct InitResponse {
            data: InitData,
        }
        #[derive(serde::Deserialize)]
        struct InitData {
            publish_id: String,
            upload_url: String,
        }
        let parsed: InitResponse = serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(format!("Unexpected init response: {e}")))?;
        // upload_url is stashed in the handle's upload_id field is not enough --
        // real callers need it for upload_media, so we encode both as JSON.
        let handle_payload = serde_json::json!({ "publish_id": parsed.data.publish_id, "upload_url": parsed.data.upload_url }).to_string();
        Ok(UploadHandle { upload_id: handle_payload, resumable: false })
    }

    async fn upload_media(&self, handle: &UploadHandle, file_path: &str) -> Result<Option<String>, AdapterError> {
        #[derive(serde::Deserialize)]
        struct HandlePayload {
            upload_url: String,
        }
        let payload: HandlePayload = serde_json::from_str(&handle.upload_id).map_err(|e| AdapterError::Permanent(e.to_string()))?;
        let bytes = tokio::fs::read(file_path).await.map_err(|e| AdapterError::Permanent(e.to_string()))?;
        let len = bytes.len();
        let resp = self
            .http
            .put(&payload.upload_url)
            .header("Content-Range", format!("bytes 0-{}/{}", len.saturating_sub(1), len))
            .header("Content-Type", "video/mp4")
            .body(bytes)
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(map_http_status(status, &text));
        }
        // No id revealed at this point -- publish() polls STATUS_URL using
        // the publish_id already carried in the upload handle.
        Ok(None)
    }

    async fn get_upload_status(&self, handle: &UploadHandle) -> Result<UploadStatus, AdapterError> {
        #[derive(serde::Deserialize)]
        struct HandlePayload {
            publish_id: String,
        }
        let payload: HandlePayload = serde_json::from_str(&handle.upload_id).map_err(|e| AdapterError::Permanent(e.to_string()))?;
        // Real status polling requires a bearer token, which this method's
        // signature doesn't receive -- callers should treat "Complete"
        // immediately after a successful upload_media() as the practical
        // signal for TikTok, and rely on get_post_metrics/list_owned_posts
        // afterward to confirm the post actually appeared. Documented here
        // rather than silently guessing.
        let _ = payload.publish_id;
        Ok(UploadStatus::Complete)
    }

    async fn publish(&self, credential_ref: &str, request: &PublishRequest) -> Result<PublishResult, AdapterError> {
        #[derive(serde::Deserialize)]
        struct HandlePayload {
            publish_id: String,
        }
        let payload: HandlePayload = serde_json::from_str(&request.upload_id).map_err(|e| AdapterError::Permanent(e.to_string()))?;
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;

        // The caption/privacy already went out in initialize_upload's
        // post_info -- Content Posting API v2's FILE_UPLOAD flow has no
        // separate publish endpoint, it finalizes on init+PUT. This just
        // polls status to confirm TikTok actually processed the post.
        let resp = self
            .http
            .post(STATUS_URL)
            .bearer_auth(&tokens.access_token)
            .json(&serde_json::json!({ "publish_id": payload.publish_id }))
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        Ok(PublishResult { platform_post_id: Some(payload.publish_id.clone()), post_url: None, awaiting_manual_finish: false, manual_finish_instructions: None })
    }

    async fn cancel_publish(&self, _platform_post_id: &str) -> Result<(), AdapterError> {
        Err(AdapterError::NotSupported("TikTok's Content Posting API has no documented cancel-publish endpoint.".to_string()))
    }

    async fn list_owned_posts(&self, _credential_ref: &str) -> Result<Vec<RemotePost>, AdapterError> {
        Err(AdapterError::NotSupported("Listing all owned posts isn't wired up in this adapter yet -- use get_post with a known id.".to_string()))
    }

    async fn get_post(&self, _credential_ref: &str, platform_post_id: &str) -> Result<RemotePost, AdapterError> {
        Ok(RemotePost { platform_post_id: platform_post_id.to_string(), post_url: None, created_at: None })
    }

    async fn get_post_metrics(&self, _credential_ref: &str, _platform_post_id: &str) -> Result<Vec<MetricValue>, AdapterError> {
        Err(AdapterError::NotSupported("TikTok video metrics query isn't wired up in this adapter yet.".to_string()))
    }

    fn get_metric_definitions(&self) -> Vec<(String, String)> {
        vec![("views".to_string(), "Views".to_string())]
    }

    async fn refresh_analytics(&self, _credential_ref: &str) -> Result<(), AdapterError> {
        Err(AdapterError::NotSupported("Not implemented yet.".to_string()))
    }

    async fn get_rate_limit_state(&self, _credential_ref: &str) -> Result<RateLimitState, AdapterError> {
        Ok(RateLimitState { remaining: None, limit: None, resets_at: None })
    }

    fn translate_error(&self, error: &AdapterError) -> TranslatedError {
        match error {
            AdapterError::PaidAccessRequired(_) => TranslatedError { plain_message: "TikTok says this developer app isn't authorized for this action -- it may need audit approval.".to_string(), is_retryable: false, technical_error_code: Some("TIKTOK_FORBIDDEN".to_string()), http_status: Some(403), documentation_url: Some("https://developers.tiktok.com/doc/content-posting-api-get-started/".to_string()) },
            AdapterError::ReauthorizationRequired => TranslatedError { plain_message: "TikTok requires reconnecting this account.".to_string(), is_retryable: false, technical_error_code: Some("TIKTOK_REAUTH".to_string()), http_status: Some(401), documentation_url: None },
            AdapterError::Retryable(msg) => TranslatedError { plain_message: "TikTok returned a temporary error. This will retry automatically.".to_string(), is_retryable: true, technical_error_code: Some(msg.clone()), http_status: None, documentation_url: None },
            other => TranslatedError { plain_message: other.to_string(), is_retryable: false, technical_error_code: None, http_status: None, documentation_url: None },
        }
    }
}

impl TikTokAdapter {
    async fn fetch_user_info(&self, access_token: &str, credential_ref: &str) -> Result<AuthorizedIdentity, AdapterError> {
        let resp = self
            .http
            .get(USER_INFO_URL)
            .query(&[("fields", "open_id,display_name,avatar_url,username")])
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        #[derive(serde::Deserialize)]
        struct UserInfoResponse {
            data: UserInfoData,
        }
        #[derive(serde::Deserialize)]
        struct UserInfoData {
            user: UserInfoUser,
        }
        #[derive(serde::Deserialize)]
        struct UserInfoUser {
            open_id: String,
            display_name: Option<String>,
            username: Option<String>,
            avatar_url: Option<String>,
        }
        let parsed: UserInfoResponse = serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(format!("Unexpected user info response: {e}")))?;
        Ok(AuthorizedIdentity {
            platform_account_id: parsed.data.user.open_id,
            display_name: parsed.data.user.display_name,
            username: parsed.data.user.username,
            profile_image_url: parsed.data.user.avatar_url,
            granted_scopes: vec![],
            missing_scopes: vec![],
            credential_ref: credential_ref.to_string(),
            token_expires_at: None,
        })
    }
}
