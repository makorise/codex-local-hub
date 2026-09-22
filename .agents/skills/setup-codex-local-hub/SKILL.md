---
name: setup-codex-local-hub
description: Install, update, launch, and verify Codex Local Hub on a Mac, including its phone dashboard and image-delivery skill. Use when a user wants Codex to complete the full Codex Local Hub setup instead of following manual Terminal steps.
---

# Setup Codex Local Hub

Set up the official project from `https://github.com/brandonwang001/codex-local-hub` as a user-level macOS application. Treat invocation as authorization to download this repository, install or update **Codex Local Hub**, install its bundled `deliver-to-codex-local-hub` skill, launch the app, and run local verification. It does not authorize disabling Gatekeeper, changing firewall or router settings, exposing port `8787` to the internet, deleting user data, or configuring an unrequested remote relay.

## Resume safely after an interruption

Make every stage idempotent. At the start of a run, inspect the managed checkout, built application, installed application, companion skill, and running service before repeating work. If an earlier run stopped because the selected model was unavailable, the task was cancelled, or a command timed out, resume from the first unverified stage instead of restarting or overwriting completed work.

Maintain a non-secret checkpoint at `~/Library/Application Support/Codex Local Hub/setup-state.json`. After each verified stage, atomically record its name, timestamp, source commit or release version, source path, and application path. Useful stages are `preflight`, `source-ready`, `tests-passed`, `app-built`, `app-installed`, `delivery-skill-installed`, `launched`, and `verified`. Never store pairing tokens, cookies, conversation content, or private IP addresses. Treat the checkpoint as a hint: confirm the corresponding files or service state before skipping a stage.

When the user asks to continue or invokes this skill again, reuse the checkpoint and existing clean artifacts. A model-capacity message is not an installation failure; if the task is no longer running, tell the user to select another available model and resume with the same skill.

## Choose the installation source

1. Confirm the host is macOS 15 or newer. Report a clear blocker on another operating system; do not attempt to install the Mac app there.
2. Prefer the latest stable GitHub Release when it contains a universal, notarized `Codex-Local-Hub-*-universal.dmg` asset. Download it to a temporary directory and keep macOS security checks enabled.
3. When no suitable stable release exists, build from source. Use the current checkout if it is this repository. Otherwise clone or fast-forward a clean checkout under `~/Library/Application Support/Codex Local Hub/source`. Never overwrite local changes; use a fresh temporary checkout if the managed source directory is dirty.

## Install safely

For a release build, mount the DMG, copy `Codex Local Hub.app` into `/Applications` when writable or `~/Applications` otherwise, unmount the image, and verify it with `codesign --verify --deep --strict` and `spctl --assess --type execute`.

For a source build:

1. Require Git, Xcode Command Line Tools with `swiftc`, and Node.js 22 or newer. If one is absent, install it only through an already available trusted package manager or report the single concrete blocker that needs user action.
2. Run `npm ci`, `npm run test:coverage`, and `BUNDLE_NODE=1 npm run build:mac` from the selected checkout.
3. Verify the built application with `codesign --verify --deep --strict` and confirm the executable contains both `arm64` and `x86_64` slices using `lipo -info`.
4. Install the verified app into `/Applications` when writable or `~/Applications` otherwise. If an older app is present, quit it cleanly and move it to a timestamped sibling backup before replacing it. Do not remove the backup until the replacement launches successfully.

Do not bypass a failed security check with `xattr`, `spctl --master-disable`, ad-hoc trust changes, or similar workarounds. A locally built app may use the repository's ad-hoc signature; a downloaded release must pass normal Gatekeeper assessment.

## Install the companion delivery skill

Copy the checkout's `.agents/skills/deliver-to-codex-local-hub` directory into `${CODEX_HOME:-$HOME/.codex}/skills/deliver-to-codex-local-hub`. Preserve an existing modified copy; replace only an identical or older project-provided copy, making a timestamped backup when uncertain. Validate the installed skill with the available `quick_validate.py` from the Codex skill-creator package when present.

## Launch and verify

1. Launch the installed application with `open` and leave it running.
2. Confirm the local dashboard responds at `http://127.0.0.1:8787/`. Do not print or copy the private pairing token into logs or the final response.
3. Confirm the app presents a phone address or pairing QR code. Explain that the Mac and phone must use the same trusted Wi-Fi and that macOS may request Local Network permission.
4. If verification fails, inspect the app's visible status and process output, attempt only safe in-scope fixes, and report the exact remaining blocker.

Finish with a concise summary containing the installed version or commit, application path, local dashboard URL, delivery-skill status, test and signature results, and the single next action: scan the QR code from the Mac app. Do not claim remote internet access is configured.
