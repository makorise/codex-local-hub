# Installing Codex Local Hub on macOS

## Recommended: notarized DMG

The public release should be a universal, Developer ID-signed, Apple-notarized DMG.

1. Download `Codex-Local-Hub-<version>-universal.dmg` from GitHub Releases.
2. Open the DMG.
3. Drag **Codex Local Hub** to **Applications**.
4. Open the app and allow Local Network access when macOS asks.
5. Scan the QR code with your phone while both devices use the same Wi-Fi.

The release DMG bundles Node.js for both Apple silicon and Intel Macs. End users do not install Node.js and do not use Terminal.

## Why DMG instead of PKG?

Codex Local Hub is a user-level app. It does not install system extensions, privileged helpers, or files outside its own app bundle and user data directory. A PKG would introduce administrator prompts without providing a user benefit.

## Developer installation

```bash
npm install
npm run build:mac
open "dist/Codex Local Hub.app"
```

This development build may use the locally installed Node.js runtime. To produce the self-contained installer:

```bash
npm run package:mac
```

## Signing and notarization

Before public distribution, configure a Developer ID Application certificate and a `notarytool` keychain profile:

```bash
export DEVELOPER_ID_APPLICATION='Developer ID Application: Example Company (TEAMID)'
export APPLE_NOTARY_PROFILE='codex-local-hub-notary'
npm run package:mac
```

The release script enables hardened runtime, signs the embedded Node runtimes with JIT entitlements, signs the app and DMG, submits the DMG to Apple, staples the ticket, and verifies the result.

## Homebrew

A Homebrew Cask is appropriate after the first notarized GitHub Release exists. It should point to the immutable release DMG and its SHA-256 checksum. DMG remains the primary installation path for nontechnical users.
