# Installing Codex Local Hub on macOS

## Recommended installation

Existing installations should use the app's checksum-verified core updater. Until a Developer ID-signed and Apple-notarized DMG is published, new users should use the one-message Codex setup in the README; it builds and verifies the app locally without changing the user's Node.js installation.

The GitHub Release also includes an explicitly named `unsigned-preview.dmg` for developer testing. It is not accepted as an automatic host update and should not be presented as a notarized installer.

Once a notarized DMG is available:

1. Download `Codex-Local-Hub-<version>-universal.dmg` from GitHub Releases.
2. Open the DMG.
3. Drag **Codex Local Hub** to **Applications**.
4. Open the app and allow Local Network access when macOS asks.
5. Scan the QR code with your phone while both devices use the same Wi-Fi.

The release DMG bundles isolated Node.js runtimes for both Apple silicon and Intel Macs. End users do not install Node.js and do not use Terminal. The app chooses its bundled runtime first and never replaces, relinks, or configures a developer's existing Node installation.

## Updates

The Mac app checks the repository's latest stable GitHub Release at most once every 24 hours. It also checks when the app becomes active and every six hours while running, but the 24-hour throttle prevents unnecessary GitHub requests. When a strictly newer semantic version is available, the app shows an update button and a one-time prompt.

The host window always shows the active version. After a check it displays either `Current vX · latest stable`, `Current vX → New vY`, or a retryable availability error. The update button explicitly says whether the offered action is a core hot update or a full host update.

The preferred asset is `Codex-Local-Hub-core-<version>.zip`, which contains only `src`, `public`, and a compatibility manifest. The app requires GitHub's SHA-256 asset digest, rejects unsafe archive paths, extracts into `~/Library/Application Support/Codex Local Hub/CoreUpdates`, atomically selects the new core, and restarts the local service. If startup fails before the normal ready signal, it restores the previous core and starts it again. The signed `.app` bundle is never modified.

When the core manifest requires a newer native host—or a release has no compatible core asset—the app falls back to downloading and opening the universal DMG. Equal or older versions are ignored, network failures do not interrupt the local service, and no separate update server is required.

Use **Check for updates** in the host window to bypass the daily throttle. Prereleases and draft releases are intentionally ignored by automatic updates.

## Why DMG instead of PKG?

Codex Local Hub is a user-level app. It does not install system extensions, privileged helpers, or files outside its own app bundle and user data directory. A PKG would introduce administrator prompts without providing a user benefit.

## Developer installation

```bash
npm install
BUNDLE_NODE=1 npm run build:mac
open "dist/Codex Local Hub.app"
```

Source builds use the developer's existing Node.js 22.22.2+ only for repository-local dependency installation, tests, and compilation. The setup does not install or upgrade Node, change shell startup files or the persistent `PATH`, or touch global npm packages. The resulting app contains its own runtimes and does not depend on that build toolchain.

To produce the self-contained installer:

```bash
npm run package:mac
```

## Optional: install the image-delivery skill

The host app already includes the phone **Delivery inbox**. Install the bundled skill when you want Codex to send screenshots and image results into it.

In a Codex conversation, run:

```text
$skill-installer Install the skill from https://github.com/makorise/codex-local-hub/tree/main/.agents/skills/deliver-to-codex-local-hub
```

For a source checkout, Codex discovers `.agents/skills/deliver-to-codex-local-hub` while working in this repository. For user-wide manual installation:

```bash
mkdir -p "$HOME/.agents/skills"
cp -R ".agents/skills/deliver-to-codex-local-hub" "$HOME/.agents/skills/"
```

Restart Codex only if the skill does not appear automatically. Keep Codex Local Hub running, then ask Codex to send an existing PNG, JPEG, WebP, or GIF file to the delivery inbox. Images must not exceed 20 MB.

## Signing and notarization

Before public distribution, configure a Developer ID Application certificate and a `notarytool` keychain profile:

```bash
export DEVELOPER_ID_APPLICATION='Developer ID Application: Example Company (TEAMID)'
export APPLE_NOTARY_PROFILE='codex-local-hub-notary'
npm run package:mac
```

The release script enables hardened runtime, signs the embedded Node runtimes with JIT entitlements, signs the app and DMG, submits the DMG to Apple, staples the ticket, and verifies the result.

GitHub Releases themselves do not require an Apple account. A tag matching `package.json` triggers the release workflow. Without Developer ID secrets the workflow publishes a stable, checksum-verified core update plus an explicitly named unsigned DMG preview; with signing and notarization secrets it publishes a stable notarized DMG alongside the core update.

For a notarized automated release, configure these GitHub Actions secrets: `MACOS_CERTIFICATE_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD`. The first value is a base64-encoded Developer ID Application `.p12`; the password is an app-specific Apple password, not the normal Apple Account password. Publishing the core update and unsigned preview requires none of these Apple credentials.

## Homebrew

A Homebrew Cask is appropriate after the first notarized GitHub Release exists. It should point to the immutable release DMG and its SHA-256 checksum. DMG remains the primary installation path for nontechnical users.
