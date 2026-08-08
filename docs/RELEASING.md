# Releasing a new version (with auto-update)

This app checks GitHub Releases for updates (see "Check for updates" in
Settings > About, and `plugins.updater` in `src-tauri/tauri.conf.json`).
Customers never redownload manually — once you publish a release the way
this doc describes, everyone's app can find and install it in-app.

**One-time setup:**

1. Create the GitHub repository `Zegmok2/nzyselle-database`, **public**.
   It must be public — the updater does a plain, unauthenticated download
   of release files, and GitHub blocks that for private repos (it redirects
   to a login page instead of serving the file). This project is already a
   local git repo (`git init` has been run) but has no remote yet.
2. `git remote add origin https://github.com/Zegmok2/nzyselle-database.git`
   then push (`git add`, `git commit`, `git push -u origin main`).
   `src-tauri/tauri.conf.json`'s `plugins.updater.endpoints` already points
   at this repo.
3. Keep `updater-keys/nzyselle-updater.key` and
   `updater-keys/.keypassword.txt` somewhere safe outside this repo (a
   password manager, ideally) — `.gitignore` already excludes
   `updater-keys/` so it will never be committed. **If you lose this key,
   you can never publish a trusted update again and every install would
   need the signing setup redone from scratch with a new key** (and old
   installs won't trust updates signed by a new key, so they'd need a
   manual one-time reinstall).

## Cutting a release

1. Bump the version number in all four places (keep them identical):
   `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
   `core/Cargo.toml`.
2. Add a new entry to `src/lib/changelog.ts` describing what changed.
3. Build, with the signing key supplied via environment variables so the
   build signs the update artifacts automatically:

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "updater-keys\nzyselle-updater.key" -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content "updater-keys\.keypassword.txt" -Raw
   npm run tauri build
   ```

   This produces, under `src-tauri/target/release/bundle/nsis/` (verified
   against a real build on 2026-08-08):
   - `Nzyselle Database_<version>_x64-setup.exe` — both the regular
     installer new users download AND the update artifact the auto-updater
     downloads for existing installs (Tauri's NSIS updater target is the
     installer .exe itself, not a separate .nsis.zip).
   - `Nzyselle Database_<version>_x64-setup.exe.sig` — its signature.

4. Write `latest.json` (the manifest `plugins.updater.endpoints` points
   at) — this file is NOT produced automatically by a plain CLI build, you
   assemble it once per release:

   ```json
   {
     "version": "<version>",
     "notes": "<short summary of what changed>",
     "pub_date": "<current UTC time, e.g. 2026-08-08T00:00:00Z>",
     "platforms": {
       "windows-x86_64": {
         "signature": "<paste the full contents of the .sig file here>",
         "url": "https://github.com/Zegmok2/nzyselle-database/releases/download/v<version>/Nzyselle.Database_<version>_x64-setup.exe"
       }
     }
   }
   ```

5. Create a GitHub release tagged `v<version>` and attach these files to
   it: the `.exe` installer (serves double duty as the update artifact),
   its `.sig`, and `latest.json` (the manifest itself — must be attached as
   a release asset named exactly `latest.json`, since the endpoint URL is
   `.../releases/latest/download/latest.json`).

   ```powershell
   git tag v<version>
   git push origin v<version>
   gh release create v<version> `
     "src-tauri/target/release/bundle/nsis/Nzyselle Database_<version>_x64-setup.exe" `
     "src-tauri/target/release/bundle/nsis/Nzyselle Database_<version>_x64-setup.exe.sig" `
     "latest.json" `
     --title "v<version>" --notes "<short summary>"
   ```

Existing installs will see the update the next time someone clicks "Check
for updates" (or you later wire up an automatic background check).

**Unverified**: this whole flow is written against Tauri's documented
updater format and has not been run against a real GitHub release yet —
same caveat as the TikTok/Instagram/YouTube adapters. The first real test
happens the first time you actually cut a release and click "Check for
updates" from an older build.
