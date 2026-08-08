/**
 * Placeholder EULA + Privacy Policy text, shown once on first launch (see
 * FirstRunAgreement.tsx) and re-shown if LEGAL_VERSION is bumped.
 *
 * This is a starting draft, not legal advice -- before selling this
 * software to the public, have an actual lawyer review and finalize both
 * documents, especially the data-handling/third-party-account sections,
 * since this app stores OAuth credentials and posts to users' social
 * accounts on their behalf.
 */
export const LEGAL_VERSION = "1";
export const ACCEPTANCE_STORAGE_KEY = `nzyselle:legalAccepted:v${LEGAL_VERSION}`;

export const EULA_TEXT = `
END-USER LICENSE AGREEMENT (DRAFT)

1. License. Subject to your compliance with this agreement, you are granted
a personal, non-exclusive, non-transferable license to install and use
Nzyselle Database on devices you own or control.

2. Third-party platforms. Nzyselle Database can connect to third-party
social media platforms (currently TikTok, Instagram, and YouTube, plus a
local Sandbox platform used for testing) using credentials you provide.
You are responsible for complying with each platform's own terms of
service. Some platform integrations are provided as-is and have not been
verified against a live account -- check the in-app status on the
Connections page before relying on any platform for real use.

3. No warranty. This software is provided "as is," without warranty of any
kind, express or implied, including but not limited to warranties of
merchantability, fitness for a particular purpose, and non-infringement.

4. Limitation of liability. To the maximum extent permitted by law, the
developer is not liable for any indirect, incidental, special,
consequential, or punitive damages, including lost profits or lost data,
arising from your use of this software.

5. Termination. This license terminates automatically if you fail to
comply with its terms.

This is a draft template and does not constitute legal advice.
`.trim();

export const PRIVACY_TEXT = `
PRIVACY POLICY (DRAFT)

Nzyselle Database is a local desktop application. It does not run its own
servers and does not transmit your data to the developer.

What's stored, and where:
- Workspace data, video library metadata, publishing history, and
  analytics you sync are stored in a local SQLite database on your own
  device.
- OAuth tokens and platform developer credentials (Client ID/Secret) are
  stored in the operating system's own credential store (Windows
  Credential Manager), never in the SQLite database, and never sent
  anywhere except directly to the platform they belong to.
- Backups you create are plain copies of that local database file, saved
  wherever you choose on your own device.

What's sent over the network:
- Only requests you initiate to the platforms you've connected (e.g.
  TikTok, Instagram, YouTube), using their own official APIs, to
  authenticate, publish, or sync analytics on your behalf.
- No telemetry, analytics, or crash reports are currently collected or
  transmitted by this application.

This is a draft template and does not constitute legal advice.
`.trim();
