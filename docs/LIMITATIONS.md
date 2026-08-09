# Platform Limitations

This mirrors `db/migrations/0002_seed_platform_registry.sql` — the actual
seeded capability registry — in plain language. If this document and the
registry ever disagree, the registry (loaded at runtime) is the source of
truth; update both together.

**Last reviewed: 2026-08-01.** APIs change. Before relying on any line
below, check the linked official docs — this file records what was true
when last checked, not a permanent guarantee.

## OAuth redirect URI setup (read this before connecting TikTok or Instagram)

This app's OAuth flow opens your system browser and briefly listens on
`127.0.0.1` for the platform to redirect back with an authorization code
(RFC 8252's "loopback interface redirection" pattern).

- **YouTube (Google)**: uses a fresh, randomly-assigned port every time you
  connect. This is fine as long as your Google Cloud OAuth client is
  registered as a **Desktop app** (not "Web application") — Google's
  Desktop app type explicitly allows any `http://127.0.0.1:*` redirect URI.
- **TikTok**: TikTok's Developer Portal requires an *exact* registered
  redirect URI — it does not accept a wildcard port. This app therefore
  uses a **fixed port, 47983**, for TikTok specifically. **Confirmed live:
  TikTok's Login Kit "Web" redirect URI type rejects any loopback address
  outright** ("Enter a valid redirect uri (localhost is not supported)"),
  same restriction Instagram has below. This app therefore sends TikTok
  through a small static bridge page hosted on GitHub Pages,
  `https://zegmok2.github.io/nzyselle-database/tiktok-redirect.html`
  (source: `docs/tiktok-redirect.html`), which immediately forwards the
  browser to this app's real local callback listener with the same query
  string — register that bridge URL, not a localhost one, as your TikTok
  app's redirect URI (see `TIKTOK_REDIRECT_BRIDGE_URL` in
  `src-tauri/src/commands.rs`). If port 47983 happens to be in use by
  something else on your machine when you try to connect, the connection
  attempt will fail with a bind error — close whatever's using it and
  retry.
- **Instagram (Meta)**: same fixed-port constraint as TikTok, **plus the
  same no-loopback-exception quirk confirmed live**: Meta's "Business
  Login for Instagram" flow has no loopback/localhost exception at all —
  it rejects both a bare-IP redirect and a plain `http://localhost` one
  outright ("Error saving redirect URIs"). This app therefore sends
  Instagram through a small static bridge page hosted on GitHub Pages,
  `https://zegmok2.github.io/nzyselle-database/instagram-redirect.html`
  (source: `docs/instagram-redirect.html`), which immediately forwards
  the browser to this app's real local callback listener with the same
  query string — register that bridge URL, not a localhost one, in your
  Meta app's Instagram **OAuth redirect URIs** (see
  `INSTAGRAM_REDIRECT_BRIDGE_URL` in `src-tauri/src/commands.rs`).

(See `fixed_oauth_port_for` in `src-tauri/src/commands.rs` if you ever need
to change these port numbers — just keep the registered redirect URI in
each developer portal in sync with whatever you pick.)

## TikTok
- Docs: https://developers.tiktok.com/doc/content-posting-api-get-started/
- OAuth connection: supported.
- Direct publish / draft upload: supported by the API, **but gated by
  TikTok's app audit**. An unaudited ("unaudited" / test-mode) developer
  app is typically restricted to posting only to the developer's own
  connected account, not arbitrary users. A personal/internal utility like
  this one may not qualify for production audit approval — the app must
  detect and explain this honestly rather than claim posting works for
  every user.
- Scheduling via the API: **not currently offered.** Any "schedule" for
  TikTok in this product is a local reminder, not a server-side guarantee.
- Sound library search/attach: **no official endpoint exists** for
  searching or programmatically attaching TikTok's licensed/trending
  sounds. This is why the product has a "Sound Assistant" (saved
  references + manual finishing step) instead of a fake "auto-attach
  sound" button.
- Video metrics: available for videos posted through the API to an
  authorized account.
- Watch-time metric: not provided by this platform's Content Posting/
  Display API.

## Instagram
- Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
- **Uses "Instagram API with Instagram Login" (Business Login for
  Instagram), not the older Facebook Login flow** — confirmed live after a
  real "Invalid Scopes" rejection with the old flow's permission names,
  followed by checking the actual App Dashboard configuration. This means:
  - **Credentials are the "Instagram App ID"/"Instagram app secret"**
    shown under App Dashboard > Instagram > **API setup with Instagram
    login** > Business login settings — **not** the Facebook "App ID"/
    "App Secret" from App Settings > Basic. Paste the Instagram-specific
    ones into Nzyselle's Settings > Platform Developer Apps > Instagram.
  - Scopes are the newer `instagram_business_basic`,
    `instagram_business_content_publish`,
    `instagram_business_manage_comments`,
    `instagram_business_manage_messages` — the older `instagram_basic`/
    `instagram_content_publish` names are deprecated for this flow.
  - The redirect URI must be registered under App Dashboard > Instagram >
    API setup with Instagram login > Business login settings > **OAuth
    redirect URIs** (a different settings page from "Facebook Login for
    Business" > Client OAuth Settings). **This flow has no loopback/
    localhost exception at all** -- confirmed live after Meta rejected
    both `http://localhost:47984/callback` and a trailing-slash variant
    with "Error saving redirect URIs", and confirmed against Meta's own
    docs (every example redirect_uri shown is a real HTTPS domain, none
    is localhost). Register
    `https://zegmok2.github.io/nzyselle-database/instagram-redirect.html`
    instead -- a small static page (`docs/instagram-redirect.html`) that
    immediately forwards the browser to this app's real local callback
    listener with the same query string, so the OAuth code/state still
    only ever reaches your machine (see `INSTAGRAM_REDIRECT_BRIDGE_URL`
    in `src-tauri/src/commands.rs`).
- OAuth connection: supported (via the flow above).
- Direct publish: supported, requires a professional (Business or
  Creator) Instagram account — a personal account cannot be used for API
  publishing at all. This flow does **not** require a linked Facebook
  Page (that was specifically a Facebook-Login-flow requirement).
- Native licensed-music selection: **not exposed via the API.** There is
  no official way to programmatically pick Instagram's in-app music
  catalog for a Reel. Content with embedded/original audio can be
  published directly; native music requires the user to finish the post
  inside Instagram itself ("Finish in Instagram" mode).
- Reach, saves: available metrics for professional accounts.

## YouTube
- Docs: https://developers.google.com/youtube/v3/guides/uploading_a_video
- OAuth connection: supported.
- Resumable upload: supported (and used) via the Data API v3.
- Scheduling via the API: supported — set `privacyStatus=private` with a
  `publishAt` timestamp.
- Public uploads without review: **new API projects are typically
  quota-restricted and may require Google's audit/verification process
  before public (non-testing) uploads work reliably.** Don't assume a
  freshly-created API project can publish publicly on day one.
- Audience retention: requires the separate YouTube Analytics API and its
  own OAuth scope — not included automatically with Data API access.
- There is no distinct "upload as a Short" endpoint; YouTube classifies
  eligible videos as Shorts using its own rules based on the video itself
  (duration, aspect ratio, etc.), not an upload-time flag this app sets.

## What "Not provided by this platform" means everywhere in this product

If a metric or control isn't in the capability registry as `supported`,
the UI shows the literal text **"Not provided by this platform"** — never
a zero, an empty chart treated as zero, or a dash that could be misread as
"no engagement." This is enforced at the adapter-contract level: see
`core/src/adapter.rs`'s `MetricValue.not_provided_reason` and the
sandbox-adapter test `full_publish_flow_end_to_end` in
`core/tests/adapter_contract_tests.rs`, which asserts exactly this for a
metric the sandbox deliberately doesn't support.
