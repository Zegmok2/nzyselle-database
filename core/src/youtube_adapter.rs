//! Real YouTube adapter -- Data API v3, resumable upload.
//!
//! **UNVERIFIED.** Written against
//! https://developers.google.com/youtube/v3/guides/uploading_a_video,
//! never run against a live Google Cloud project/YouTube channel -- same
//! caveat as `tiktok_adapter.rs` and `instagram_adapter.rs`.
//!
//! Upload here does a single PUT of the whole file to the resumable
//! session URL rather than YouTube's full chunked-with-resume-on-failure
//! protocol -- correct behavior for a healthy connection, but a dropped
//! connection mid-upload won't resume from an offset the way a complete
//! implementation would.
//!
//! Audience retention requires the separate YouTube Analytics API and its
//! own OAuth scope -- not requested here, so `get_post_metrics` reports it
//! as not provided rather than omitting it silently.

use async_trait::async_trait;
use chrono::{Duration, Utc};
use std::collections::HashMap;
use std::sync::Arc;

use crate::adapter::*;
use crate::capability::{Capability, PlatformCapabilities};
use crate::credentials::CredentialStore;
use crate::ids::generate_id;
use crate::oauth_http::{generate_pkce, load_client_config, load_tokens, map_http_status, map_transport_error, save_tokens, StoredTokens};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const UPLOAD_INIT_URL: &str = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const VIDEOS_URL: &str = "https://www.googleapis.com/youtube/v3/videos";
const CHANNELS_URL: &str = "https://www.googleapis.com/youtube/v3/channels";

pub struct YouTubeAdapter {
    credentials: Arc<dyn CredentialStore>,
    http: reqwest::Client,
}

impl YouTubeAdapter {
    pub fn new(credentials: Arc<dyn CredentialStore>) -> Self {
        Self { credentials, http: reqwest::Client::new() }
    }

    fn capabilities_map() -> HashMap<String, Capability> {
        let mut m = HashMap::new();
        for (key, supported, note) in [
            ("oauth_connection", true, None),
            ("resumable_upload", true, Some("Single-shot PUT, not full chunked resume -- see module docs.")),
            ("scheduling_api", true, Some("privacyStatus=private with publishAt.")),
            ("audience_retention_metric", false, Some("Requires the separate YouTube Analytics API and its own OAuth scope, not requested by this adapter.")),
            ("public_upload_without_review", false, Some("New API projects are typically quota-restricted until Google verifies the app.")),
        ] {
            m.insert(key.to_string(), Capability { key: key.to_string(), supported, requires_review: false, requires_paid_access: false, notes: note.map(str::to_string) });
        }
        m
    }
}

#[async_trait]
impl ProviderAdapter for YouTubeAdapter {
    fn platform_id(&self) -> &'static str {
        "youtube"
    }

    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities {
            platform_id: "youtube".to_string(),
            registry_version: 1,
            instructions_reviewed_at: "2026-08-01".to_string(),
            docs_url: "https://developers.google.com/youtube/v3/guides/uploading_a_video".to_string(),
            capabilities: Self::capabilities_map(),
        }
    }

    async fn begin_authorization(&self, _requested_scopes: &[String], redirect_uri: &str) -> Result<OAuthBeginResult, AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "youtube")?;
        let pkce = generate_pkce();
        let state = crate::oauth_http::generate_state();
        // The caller (commands.rs) only ever passes generic intent labels
        // like "publish"/"analytics", not real Google OAuth scope URIs --
        // those aren't valid scope strings for Google, so this adapter
        // always requests its own real, documented scope set rather than
        // trusting the caller to supply platform-correct syntax.
        let scope = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly".to_string();
        let url = format!(
            "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&state={}&code_challenge={}&code_challenge_method=S256",
            urlencoding::encode(&config.client_id),
            urlencoding::encode(redirect_uri),
            urlencoding::encode(&scope),
            urlencoding::encode(&state),
            urlencoding::encode(&pkce.challenge),
        );
        Ok(OAuthBeginResult { authorization_url: url, state, pkce_verifier: pkce.verifier, expires_at: Utc::now() + Duration::minutes(10) })
    }

    async fn complete_authorization(&self, code: &str, _state: &str, pkce_verifier: &str, redirect_uri: &str) -> Result<AuthorizedIdentity, AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "youtube")?;
        let resp = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", config.client_id.as_str()),
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
            scope: Option<String>,
        }
        let parsed: TokenResponse = serde_json::from_str(&body).map_err(|e| AdapterError::Permanent(format!("Unexpected token response: {e}")))?;

        let credential_ref = format!("nzyselle:youtube:{}", generate_id());
        save_tokens(
            self.credentials.as_ref(),
            &credential_ref,
            &StoredTokens { access_token: parsed.access_token.clone(), refresh_token: parsed.refresh_token, expires_at: parsed.expires_in.map(|s| Utc::now() + Duration::seconds(s)) },
        )?;

        let identity = self.fetch_channel_info(&parsed.access_token, &credential_ref).await?;
        let granted: Vec<String> = parsed.scope.unwrap_or_default().split(' ').filter(|s| !s.is_empty()).map(str::to_string).collect();
        Ok(AuthorizedIdentity { granted_scopes: granted, ..identity })
    }

    async fn refresh_authorization(&self, credential_ref: &str) -> Result<(), AdapterError> {
        let config = load_client_config(self.credentials.as_ref(), "youtube")?;
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let refresh_token = tokens.refresh_token.clone().ok_or(AdapterError::ReauthorizationRequired)?;
        let resp = self
            .http
            .post(TOKEN_URL)
            .form(&[("client_id", config.client_id.as_str()), ("client_secret", config.client_secret.as_str()), ("refresh_token", refresh_token.as_str()), ("grant_type", "refresh_token")])
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
        save_tokens(self.credentials.as_ref(), credential_ref, &StoredTokens { access_token: parsed.access_token, refresh_token: Some(refresh_token), expires_at: parsed.expires_in.map(|s| Utc::now() + Duration::seconds(s)) })
    }

    async fn revoke_authorization(&self, credential_ref: &str) -> Result<(), AdapterError> {
        if let Ok(tokens) = load_tokens(self.credentials.as_ref(), credential_ref) {
            let _ = self.http.post("https://oauth2.googleapis.com/revoke").form(&[("token", tokens.access_token.as_str())]).send().await;
        }
        let _ = self.credentials.delete(credential_ref);
        Ok(())
    }

    async fn get_connected_identity(&self, credential_ref: &str) -> Result<AuthorizedIdentity, AdapterError> {
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        self.fetch_channel_info(&tokens.access_token, credential_ref).await
    }

    async fn validate_connection(&self, credential_ref: &str) -> Result<(), AdapterError> {
        self.get_connected_identity(credential_ref).await.map(|_| ())
    }

    async fn validate_media(&self, file_path: &str) -> Result<MediaValidationResult, AdapterError> {
        let mut issues = vec![];
        let size = std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
        let max = 128u64 * 1024 * 1024 * 1024;
        if size == 0 {
            issues.push("File is empty or unreadable.".to_string());
        }
        if size > max {
            issues.push("File exceeds YouTube's documented 128GB upload limit.".to_string());
        }
        Ok(MediaValidationResult { is_supported: issues.is_empty(), issues, max_duration_seconds: None, max_file_size_bytes: Some(max), requires_conversion: false })
    }

    async fn get_creator_posting_options(&self, _credential_ref: &str) -> Result<CreatorPostingOptions, AdapterError> {
        // 100 chars is YouTube Data API's documented snippet.title limit:
        // https://developers.google.com/youtube/v3/docs/videos#snippet.title
        Ok(CreatorPostingOptions { available_privacy_levels: vec!["public".into(), "unlisted".into(), "private".into()], can_disable_comments: true, can_disable_duet: false, can_disable_stitch: false, max_duration_seconds: None, max_caption_length: Some(100), posting_cap_remaining: None, extra: serde_json::json!({}) })
    }

    async fn estimate_request_cost(&self, _operation: &str) -> Result<CostEstimate, AdapterError> {
        Ok(CostEstimate { is_chargeable: false, estimated_cost_usd: Some(0.0), pricing_last_checked: Some(Utc::now()), pricing_source_url: Some("https://developers.google.com/youtube/v3/getting-started#quota".to_string()) })
    }

    async fn initialize_upload(&self, credential_ref: &str, file_path: &str, metadata: &UploadMetadata) -> Result<UploadHandle, AdapterError> {
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let size = std::fs::metadata(file_path).map_err(|e| AdapterError::Permanent(e.to_string()))?.len();
        let filename = std::path::Path::new(file_path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled".to_string());
        // Use the real caption as the title when one was given, rather than
        // always falling back to the bare filename -- publish() still runs
        // videos.update afterward (needed for scheduling), but there's no
        // reason to ship an obviously-wrong placeholder title in between.
        let title = metadata.caption.clone().filter(|c| !c.trim().is_empty()).unwrap_or(filename);
        let privacy_status = metadata.privacy_level.clone().unwrap_or_else(|| "private".to_string());

        let body = serde_json::json!({
            "snippet": { "title": title, "categoryId": "22" },
            "status": { "privacyStatus": privacy_status, "selfDeclaredMadeForKids": false }
        });
        let resp = self
            .http
            .post(UPLOAD_INIT_URL)
            .bearer_auth(&tokens.access_token)
            .header("X-Upload-Content-Type", "video/*")
            .header("X-Upload-Content-Length", size.to_string())
            .json(&body)
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = resp.status();
        let upload_url = resp.headers().get("Location").and_then(|v| v.to_str().ok()).map(str::to_string);
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(map_http_status(status, &text));
        }
        let upload_url = upload_url.ok_or_else(|| AdapterError::Permanent("YouTube didn't return a resumable upload URL.".to_string()))?;
        Ok(UploadHandle { upload_id: upload_url, resumable: true })
    }

    async fn upload_media(&self, handle: &UploadHandle, file_path: &str) -> Result<Option<String>, AdapterError> {
        let bytes = tokio::fs::read(file_path).await.map_err(|e| AdapterError::Permanent(e.to_string()))?;
        let resp = self.http.put(&handle.upload_id).header("Content-Type", "video/*").body(bytes).send().await.map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        // The resumable upload's final response body IS the newly created
        // video resource -- its "id" is the only place this adapter ever
        // learns the real video id. Previously this was discarded entirely
        // and publish() unconditionally failed as a result (see
        // extract_video_id_from_upload_response, now removed).
        #[derive(serde::Deserialize)]
        struct UploadResponse {
            id: String,
        }
        let parsed: UploadResponse = serde_json::from_str(&text)
            .map_err(|e| AdapterError::Permanent(format!("YouTube's upload response didn't include a video id as expected: {e}")))?;
        Ok(Some(parsed.id))
    }

    async fn get_upload_status(&self, _handle: &UploadHandle) -> Result<UploadStatus, AdapterError> {
        // The single-shot PUT in upload_media() either fully succeeds or
        // returns an error -- there's no separate async processing step to
        // poll for a basic upload the way TikTok's init/PUT/status flow has.
        Ok(UploadStatus::Complete)
    }

    async fn publish(&self, credential_ref: &str, request: &PublishRequest) -> Result<PublishResult, AdapterError> {
        // YouTube's videos.insert already creates the video as part of the
        // resumable upload in initialize_upload/upload_media, already with
        // the real title/privacy from UploadMetadata -- "publish" here is a
        // videos.update pass to apply anything only known at publish time
        // (a confirmed schedule) and to hand back the definitive result.
        // The scheduler substitutes the real video id (captured in
        // upload_media's response) for upload_id before calling publish(),
        // so this is never the original upload-session URL.
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let video_id = request.upload_id.clone();

        let mut status_obj = serde_json::json!({ "privacyStatus": request.privacy_level.clone().unwrap_or_else(|| "private".to_string()) });
        if let Some(publish_at) = request.platform_specific.get("publishAt").and_then(|v| v.as_str()) {
            status_obj["privacyStatus"] = serde_json::Value::String("private".to_string());
            status_obj["publishAt"] = serde_json::Value::String(publish_at.to_string());
        }
        let body = serde_json::json!({
            "id": video_id,
            "snippet": { "title": request.caption.clone().unwrap_or_default(), "categoryId": "22" },
            "status": status_obj
        });
        let resp = self.http.put(format!("{VIDEOS_URL}?part=snippet,status")).bearer_auth(&tokens.access_token).json(&body).send().await.map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        Ok(PublishResult { platform_post_id: Some(video_id.clone()), post_url: Some(format!("https://www.youtube.com/watch?v={video_id}")), awaiting_manual_finish: false, manual_finish_instructions: None })
    }

    async fn cancel_publish(&self, platform_post_id: &str) -> Result<(), AdapterError> {
        Err(AdapterError::NotSupported(format!("Deleting/cancelling video {platform_post_id} isn't wired up in this adapter -- use YouTube Studio.")))
    }

    async fn list_owned_posts(&self, _credential_ref: &str) -> Result<Vec<RemotePost>, AdapterError> {
        Err(AdapterError::NotSupported("Not implemented yet.".to_string()))
    }

    async fn get_post(&self, credential_ref: &str, platform_post_id: &str) -> Result<RemotePost, AdapterError> {
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let resp = self.http.get(VIDEOS_URL).bearer_auth(&tokens.access_token).query(&[("part", "snippet"), ("id", platform_post_id)]).send().await.map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        Ok(RemotePost { platform_post_id: platform_post_id.to_string(), post_url: Some(format!("https://www.youtube.com/watch?v={platform_post_id}")), created_at: None })
    }

    async fn get_post_metrics(&self, credential_ref: &str, platform_post_id: &str) -> Result<Vec<MetricValue>, AdapterError> {
        let tokens = load_tokens(self.credentials.as_ref(), credential_ref)?;
        let resp = self.http.get(VIDEOS_URL).bearer_auth(&tokens.access_token).query(&[("part", "statistics"), ("id", platform_post_id)]).send().await.map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        #[derive(serde::Deserialize)]
        struct VideosResponse {
            // Same "items" omitted entirely on zero results" behavior as
            // ChannelsResponse in fetch_channel_info -- see that comment.
            #[serde(default)]
            items: Vec<VideoItem>,
        }
        #[derive(serde::Deserialize)]
        struct VideoItem {
            statistics: Statistics,
        }
        #[derive(serde::Deserialize)]
        struct Statistics {
            #[serde(rename = "viewCount")]
            view_count: Option<String>,
            #[serde(rename = "likeCount")]
            like_count: Option<String>,
        }
        let parsed: VideosResponse = serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(e.to_string()))?;
        let now = Utc::now();
        let Some(stats) = parsed.items.into_iter().next().map(|i| i.statistics) else {
            return Err(AdapterError::Permanent("Video not found.".to_string()));
        };
        Ok(vec![
            MetricValue { metric_key: "views".to_string(), value: stats.view_count.and_then(|v| v.parse().ok()), not_provided_reason: None, measured_at: now, is_estimated: false },
            MetricValue { metric_key: "likes".to_string(), value: stats.like_count.and_then(|v| v.parse().ok()), not_provided_reason: None, measured_at: now, is_estimated: false },
            MetricValue {
                metric_key: "audience_retention".to_string(),
                value: None,
                not_provided_reason: Some("Requires the separate YouTube Analytics API and its own OAuth scope, not requested by this connection.".to_string()),
                measured_at: now,
                is_estimated: false,
            },
        ])
    }

    fn get_metric_definitions(&self) -> Vec<(String, String)> {
        vec![("views".to_string(), "Views".to_string()), ("likes".to_string(), "Likes".to_string())]
    }

    async fn refresh_analytics(&self, _credential_ref: &str) -> Result<(), AdapterError> {
        Ok(())
    }

    async fn get_rate_limit_state(&self, _credential_ref: &str) -> Result<RateLimitState, AdapterError> {
        Ok(RateLimitState { remaining: None, limit: None, resets_at: None })
    }

    fn translate_error(&self, error: &AdapterError) -> TranslatedError {
        match error {
            AdapterError::ReauthorizationRequired => TranslatedError { plain_message: "YouTube requires reconnecting this account.".to_string(), is_retryable: false, technical_error_code: Some("YT_REAUTH".to_string()), http_status: Some(401), documentation_url: None },
            AdapterError::RateLimited { .. } => TranslatedError { plain_message: "YouTube's API quota was exceeded. Try again later or request a quota increase.".to_string(), is_retryable: true, technical_error_code: Some("YT_QUOTA".to_string()), http_status: Some(429), documentation_url: Some("https://developers.google.com/youtube/v3/getting-started#quota".to_string()) },
            other => TranslatedError { plain_message: other.to_string(), is_retryable: false, technical_error_code: None, http_status: None, documentation_url: None },
        }
    }
}

impl YouTubeAdapter {
    async fn fetch_channel_info(&self, access_token: &str, credential_ref: &str) -> Result<AuthorizedIdentity, AdapterError> {
        let resp = self.http.get(CHANNELS_URL).bearer_auth(access_token).query(&[("part", "snippet"), ("mine", "true")]).send().await.map_err(map_transport_error)?;
        let status = resp.status();
        let text = resp.text().await.map_err(map_transport_error)?;
        if !status.is_success() {
            return Err(map_http_status(status, &text));
        }
        #[derive(serde::Deserialize)]
        struct ChannelsResponse {
            // YouTube's API omits `items` entirely (rather than returning an
            // empty array) when a query matches zero channels -- confirmed
            // by a real "mine=true" call against a Google account with no
            // YouTube channel, which returned a 200 with no `items` key at
            // all and made plain deserialization fail before the "no
            // channel" check below ever got a chance to run.
            #[serde(default)]
            items: Vec<ChannelItem>,
        }
        #[derive(serde::Deserialize)]
        struct ChannelItem {
            id: String,
            snippet: ChannelSnippet,
        }
        #[derive(serde::Deserialize)]
        struct ChannelSnippet {
            title: String,
            thumbnails: Option<Thumbnails>,
        }
        #[derive(serde::Deserialize)]
        struct Thumbnails {
            default: Option<ThumbnailImage>,
        }
        #[derive(serde::Deserialize)]
        struct ThumbnailImage {
            url: String,
        }
        let parsed: ChannelsResponse = serde_json::from_str(&text).map_err(|e| AdapterError::Permanent(format!("Unexpected channels response: {e}")))?;
        let Some(channel) = parsed.items.into_iter().next() else {
            return Err(AdapterError::Permanent("No YouTube channel found on this Google account.".to_string()));
        };
        Ok(AuthorizedIdentity {
            platform_account_id: channel.id,
            display_name: Some(channel.snippet.title.clone()),
            username: Some(channel.snippet.title),
            profile_image_url: channel.snippet.thumbnails.and_then(|t| t.default).map(|d| d.url),
            granted_scopes: vec![],
            missing_scopes: vec![],
            credential_ref: credential_ref.to_string(),
            token_expires_at: None,
        })
    }
}
