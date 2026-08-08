# Nzyselle Database

A locally-installed social-media publishing, scheduling, video-library, and
analytics dashboard for short-form video creators. Original Nzyselle
interface — not a copy of any third-party product's layout or trade dress.

**Honestly-scoped, and now a real, buildable app.** This started as a
partial implementation in a sandbox with no Windows/webview toolchain; it
has since been built out to the full spec and compiled/tested for real on
Windows. The one honest gap that remains is the one no amount of local dev
work can close: TikTok/Instagram/YouTube require *your own* developer app
credentials, so those three adapters are written against each platform's
public docs but have not been exercised against a live account.

## What's real and verified in this codebase

| Piece | Status |
|---|---|
| Database schema (26 entities) | ✅ Applied to a real SQLite file, passed a full relational-integrity test through the entire publish pipeline (workspace → connection → video → campaign → destination post → status events → metrics), zero FK violations |
| Platform capability registry | ✅ Seeded with dated, researched notes on real TikTok/Instagram/YouTube restrictions (audit gating, paid tiers, missing endpoints) |
| Provider adapter trait (`core/src/adapter.rs`) | ✅ Compiles; the contract every real platform adapter implements |
| Sandbox/mock adapter | ✅ Fully implements the trait; contract tests pass, including one that specifically checks unsupported metrics return `None` with a reason, never a fabricated `0` |
| OAuth loopback callback server (`core/src/oauth_callback.rs`) | ✅ Real TCP server, tests pass including state-mismatch rejection over an actual socket. Supports both an OS-assigned port (Google/YouTube, which allows any loopback port) and a fixed port per platform (TikTok 47983, Instagram 47984 — both require an exact pre-registered redirect URI; see `docs/LIMITATIONS.md`) |
| Credential storage abstraction (`core/src/credentials.rs`) | ✅ Trait + in-memory test double fully tested. The real `WindowsCredentialStore` backend compiles and is written against the `keyring` crate's documented API, but has not been exercised against the real Windows Credential Manager by an actual user session — treat as reviewed, not end-to-end verified |
| Media inspection & validation (`core/src/media.rs`) | ✅ Real `ffprobe`/`ffmpeg` calls, tested against actual generated video files, including black-bar/letterboxing detection via `cropdetect` and confirming thumbnail generation never touches the source file's bytes |
| Content hashing, watch-folder scanning, id generation | ✅ Fully tested |
| Upload scheduler + adapter registry (`src-tauri/src/scheduler.rs`, `adapters.rs`) | ✅ Drives the full validate → upload → publish pipeline against any registered adapter; compiles and is exercised end-to-end against the Sandbox adapter by the frontend test suite |
| Real TikTok/Instagram/YouTube adapters (`core/src/{tiktok,instagram,youtube}_adapter.rs`) | ⚠️ Written against each platform's current public API docs, compiles clean, and has been through two rounds of code-review bug fixes (see `src/lib/changelog.ts` v0.2.0–0.3.0) — but **still unverified against a live account**. You'll need your own developer app credentials (Settings > Platform Developer Apps) for the first real test |
| React/TypeScript frontend — every tab (Overview, Library, Connections, Publish, Videos, Calendar, Analytics, Diagnostics, Templates, Settings) | ✅ Builds clean (`npm run build`), 27 component tests pass against the spec's own acceptance language ("opens with zero workspaces," "never traps the user," "warns instead of silently double-adding," "renders an unsupported metric as the literal not-provided text, never a fabricated zero") |
| Tauri shell (`src-tauri/`) | ✅ Compiles clean (`cargo check` + `cargo clippy`, zero warnings) and produces a real signed Windows installer via `npm run tauri build` — confirmed on a real Windows machine, not just written against the API |
| Auto-update (`tauri-plugin-updater`) | ✅ Wired up and confirmed to produce a correctly signed update artifact on a real build. Publishing a release still requires one-time GitHub repo setup — see `docs/RELEASING.md` |
| EULA / Privacy Policy first-run gate, error boundary, versioned changelog | ✅ Built and covered by the manual verification pass; legal text is a draft, not reviewed by a lawyer |

Total automated tests passing right now: **34 Rust tests + 27 frontend tests = 61**, all of which were actually executed, not just written.

## The one honest gap that remains

- **No live OAuth with any real platform yet.** TikTok, Meta, and Google
  all require *your* verified developer/business identity to register an
  app — that step can't be done on your behalf. Paste your Client
  ID/Secret for each platform in Settings, then Connect on the Connections
  page — that's the first real test each adapter gets. See
  `docs/LIMITATIONS.md` for platform-specific setup requirements
  (TikTok/Instagram need a fixed OAuth redirect port registered exactly).

## Project layout

```
core/            Platform-agnostic Rust domain logic. No Tauri/GUI
                 dependency on purpose — compiles and tests anywhere.
  src/adapter.rs             The ProviderAdapter trait every platform implements.
  src/capability.rs          Versioned capability registry types.
  src/mock_adapter.rs        Sandbox adapter (dev/test only, clearly marked).
  src/tiktok_adapter.rs      Real TikTok Content Posting API v2 adapter (unverified live).
  src/instagram_adapter.rs   Real Instagram/Meta Graph API adapter (unverified live).
  src/youtube_adapter.rs     Real YouTube Data API v3 adapter (unverified live).
  src/oauth_callback.rs      Localhost-only OAuth loopback server.
  src/oauth_http.rs          Shared OAuth/HTTP helpers (PKCE, token storage, error mapping).
  src/credentials.rs         Credential storage trait + Windows/in-memory backends.
  src/media.rs                ffprobe/ffmpeg-backed video inspection & validation.
  src/hashing.rs               Streaming content hash for duplicate detection.
  src/watch_folder.rs           Watch-folder scanning + "finished writing" detection.
  src/ids.rs                     Dependency-free id generation.
  tests/                          Contract tests exercising the full publish flow.

db/migrations/   Raw SQL migrations, embedded into the Tauri binary at
                 compile time (see src-tauri/src/db.rs).

src/             React + TypeScript frontend.
  components/    Splash intro, every workspace tab (Overview, Library,
                 Connections, Publish, Videos, Calendar, Analytics,
                 Diagnostics, Templates, Settings), first-run legal
                 agreement, error boundary.
  lib/           Domain types, mockBackend.ts (dev-mode stand-in for real
                 Tauri IPC) and tauriBackend.ts (the real IPC calls),
                 changelog.ts, legal.ts.
  test/          Vitest + Testing Library tests against the spec's own
                 acceptance criteria.

src-tauri/       The native Windows shell. Compiles and builds a real
                 signed installer (see table above).
  capabilities/  Tauri v2 permission grants for the plugins in use.

updater-keys/    Auto-update signing keypair (gitignored — never commit).

docs/
  LIMITATIONS.md What each platform's API genuinely can't do, plus OAuth
                 redirect-port setup requirements.
  RELEASING.md   Step-by-step runbook for cutting a signed, auto-updating
                 release via GitHub Releases.
```

## Running what's actually built, right now

```bash
# Frontend (against the in-memory dev mock, no Rust/Tauri required):
npm install
npm run dev          # opens in your browser at http://localhost:1420
npm test             # 27 passing tests
npm run build         # production build

# Rust core (adapter contracts, capability registry, OAuth callback server,
# credential storage, media inspection, hashing, watch-folder scanning —
# all fully testable without Windows or Tauri; media.rs tests spawn real
# ffmpeg/ffprobe processes, so ffmpeg needs to be on PATH):
cd core
cargo test          # 34 passing tests

# The native Windows shell:
cd src-tauri
cargo check         # confirmed clean
cargo clippy         # confirmed clean, zero warnings
```

## Building for real (confirmed on a real Windows machine)

```powershell
# 1. Install Rust (rustup.rs) and Node.js if you don't have them.
# 2. From the project root:
npm install
npm run tauri dev      # runs the real desktop app with hot reload
npm run tauri build    # produces the real Windows installer in
                        # src-tauri/target/release/bundle/nsis/
```

To also produce the signed update artifact the auto-updater downloads,
set `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` before
building — see `docs/RELEASING.md` for the full release runbook (GitHub
repo setup, tagging, and what to attach to each release).

## Continuing the build

The full spec is built. What's left is entirely things only you can do:

- **Connect a real platform.** Register a developer app with TikTok,
  Meta, and/or Google, paste the Client ID/Secret into Settings, and click
  Connect — that's the first live test each real adapter gets.
- **Set up GitHub Releases** for auto-updates (`docs/RELEASING.md`).
- **Get the EULA/Privacy Policy drafts reviewed** by an actual lawyer
  before selling this to the public.
