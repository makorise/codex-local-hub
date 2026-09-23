---
name: setup-codex-local-hub
description: Install, update, launch, and verify Codex Lookout on a Mac, including its phone dashboard and image-delivery skill. Use when a user wants Codex to complete the full Codex Lookout setup instead of following manual Terminal steps.
---

# Setup Codex Lookout

Set up the official project from `https://github.com/makorise/codex-local-hub` as a user-level macOS application. Treat invocation as authorization to download this repository, install or update **Codex Lookout**, install its bundled `deliver-to-codex-local-hub` skill, launch the app, and run local verification. It does not authorize disabling Gatekeeper, changing firewall or router settings, exposing port `8787` to the internet, deleting user data, or configuring an unrequested remote relay.

## Resume safely after an interruption

Make every stage idempotent. At the start of a run, inspect the managed checkout, built application, installed application, companion skill, and running service before repeating work. If an earlier run stopped because the selected model was unavailable, the task was cancelled, or a command timed out, resume from the first unverified stage instead of restarting or overwriting completed work.

Maintain a non-secret checkpoint at `~/Library/Application Support/Codex Local Hub/setup-state.json`. After each verified stage, atomically record its name, timestamp, source commit or release version, source path, and application path. Useful stages are `preflight`, `source-ready`, `tests-passed`, `app-built`, `app-installed`, `delivery-skill-installed`, `launched`, and `verified`. Never store conversation content or private IP addresses. Treat the checkpoint as a hint: confirm the corresponding files or service state before skipping a stage.

When the user asks to continue or invokes this skill again, reuse the checkpoint and existing clean artifacts. A model-capacity message is not an installation failure; if the task is no longer running, tell the user to select another available model and resume with the same skill.

## Choose the installation source

1. Confirm the host is macOS 15 or newer. Report a clear blocker on another operating system; do not attempt to install the Mac app there.
2. Prefer the latest stable GitHub Release when it contains a universal, notarized `Codex-Local-Hub-*-universal.dmg` asset. Download it to a temporary directory and keep macOS security checks enabled.
3. When no suitable stable release exists, build from source. Use the current checkout if it is this repository. Otherwise clone or fast-forward a clean checkout under `~/Library/Application Support/Codex Local Hub/source`. Never overwrite local changes; use a fresh temporary checkout if the managed source directory is dirty.

This skill is also the full-upgrade fallback for the app's built-in core hot updater. A routine `src` or `public` release should be applied by the running app's checksum-verified hot updater. Use this skill when the user requests a new installation, when the release requires a newer native host, when they explicitly ask Codex to perform the complete upgrade, or when the built-in updater reports that a compatible core asset is unavailable.

### Migrate legacy update clients

Before choosing a core-only update for an existing installation, inspect the installed host version and its updater endpoint. Read `CFBundleShortVersionString` from the installed app and inspect the executable with `strings`. If the executable contains `https://api.github.com/repos/brandonwang001/codex-local-hub/releases/latest`, it is a legacy host from before the project moved to Makorise. That endpoint is no longer available, and installing another core archive cannot repair it because the updater is part of the native host rather than the hot-updated core.

For this legacy case, skip the core-only path and perform one complete release or source-build upgrade from `https://github.com/makorise/codex-local-hub`. Preserve `~/Library/Application Support/Codex Local Hub`, quit the old app cleanly, move the old app to a timestamped sibling backup, install the verified replacement, and relaunch it. Confirm that the replacement executable contains `https://api.github.com/repos/makorise/codex-local-hub/releases/latest` and no longer contains the obsolete endpoint. Once this one-time migration succeeds, later compatible releases may use the normal checksum-verified core hot updater.

If GitHub's official `releases/latest` endpoint reports a newer version but the Mac app keeps showing an older cached release, do not delete Application Support or task data. Quit the app, remove only `CodexLocalHubUpdateCheckedAt` from the `app.codexlocalhub.desktop` defaults domain, and relaunch it so the legacy host performs a fresh network check. Prefer bypassing the UI entirely when this skill is active: download the latest trusted core asset and install it through `--install-core-update` as described below. Verify the effective version and health response before declaring recovery.

The user never needs to download the installer manually. For the release path, download the verified DMG into a temporary directory on their behalf. For the source path, reuse an existing clean checkout and fast-forward it with `git pull --ff-only`; if it contains any local or untracked changes, preserve it untouched and use a fresh checkout. Record which path was selected in the setup checkpoint.

For an existing host version `0.2.2` or newer, a stable release may contain `Codex-Local-Hub-core-<version>.zip`. Read the release asset's `digest` from the official GitHub Releases API and require a `sha256:` value. Download the core archive to a temporary directory, then invoke the installed executable with `--install-core-update <archive> <version> <sha256>`. The executable independently verifies the digest, safe archive paths, manifest version, and minimum host version before activating it. Only after that command succeeds, quit and relaunch the app so it loads the new core, then verify `/api/health` and `/api/tasks`. Use `--effective-version` to confirm the active version. If relaunch fails, run `--restore-bundled-core`, relaunch, verify recovery, and continue with the full DMG or source-build path. Never write directly into the active core directory or the signed app bundle.

## Install safely

For a release build, mount the DMG, copy `Codex Local Hub.app` into `/Applications` when writable or `~/Applications` otherwise, unmount the image, and verify it with `codesign --verify --deep --strict` and `spctl --assess --type execute`.

For a source build:

1. Require Git, Xcode Command Line Tools with `swiftc`, and the user's existing Node.js 22.22.2 or newer. Inspect the current `node` path and version without changing it. If Node is absent or incompatible, report that single blocker instead of installing, upgrading, relinking, uninstalling, or globally configuring Node.js, npm, Homebrew, nvm, Volta, asdf, or the user's shell profile.
2. Run `npm ci`, `npm run test:coverage`, and `BUNDLE_NODE=1 npm run build:mac` from the selected checkout. These commands may create only repository-local dependencies and build output; do not install global npm packages.
3. Verify the built application with `codesign --verify --deep --strict` and confirm the executable contains both `arm64` and `x86_64` slices using `lipo -info`.
4. Install the verified app into `/Applications` when writable or `~/Applications` otherwise. If an older app is present, quit it cleanly and move it to a timestamped sibling backup before replacing it. Do not remove the backup until the replacement launches successfully.

The installed application must contain its own official Node runtime for both Apple silicon and Intel. The app always selects its bundled architecture-specific runtime before looking at any system path, so launching Codex Lookout must not depend on or alter the user's development toolchain. Confirm that the user's original `node` path and version are unchanged afterward.

Do not bypass a failed security check with `xattr`, `spctl --master-disable`, ad-hoc trust changes, or similar workarounds. A locally built app may use the repository's ad-hoc signature; a downloaded release must pass normal Gatekeeper assessment.

## Install the companion delivery skill

Copy the checkout's `.agents/skills/deliver-to-codex-local-hub` directory into `${CODEX_HOME:-$HOME/.codex}/skills/deliver-to-codex-local-hub`. Preserve an existing modified copy; replace only an identical or older project-provided copy, making a timestamped backup when uncertain. When `quick_validate.py` and all of its existing dependencies are available, use it to validate the installed skill. Validation is best-effort: do not install Python packages just for this check, and never delay or block app installation because an optional validator dependency such as PyYAML is absent. Always verify that the installed `SKILL.md` and its referenced script exist.

## Launch and verify

1. Launch the installed application with `open` and leave it running.
2. Confirm the local dashboard, `/api/health`, and `/api/tasks` respond at `http://127.0.0.1:8787/` without a token or pairing cookie.
3. Confirm the app presents a phone address and that its QR code contains that same plain LAN URL. Explain that scanning it opens the browser directly, the Mac and phone must use the same trusted Wi-Fi, and macOS may request Local Network permission.
4. If verification fails, inspect the app's visible status and process output, attempt only safe in-scope fixes, and report the exact remaining blocker.

Finish with a concise summary containing the installed version or commit, application path, local dashboard URL, delivery-skill status, test and signature results, and the single next action: scan the QR code from the Mac app. Do not claim remote internet access is configured.
