# Changelog

All notable changes to Codex Local Hub will be documented in this file.

## 0.2.3 - 2026-09-22

- Published the first stable GitHub Release channel for checksum-verified core hot updates from `0.2.2`.
- Kept lists of five or fewer tasks flat and project-adjacent, while larger lists group by project with persistent, accessible collapse controls.
- Improved the bilingual project documentation, screenshots, architecture explanation, installation prompts, and GitHub discoverability.
- Added an explicitly named unsigned universal DMG preview while keeping it outside the trusted automatic host-update path.

## 0.2.2 - 2026-09-22

- Added a native macOS update checker that checks GitHub Releases at most once every 24 hours.
- Added semantic-version protection against reinstalling the same version or downgrading.
- Added checksum-verified core hot updates for the Node service and web UI, stored outside the signed app bundle and switched atomically.
- Added automatic rollback to the previous core when a newly activated service cannot start.
- Added a visible update button and one-time prompt; updates prefer the small core package and fall back to the full DMG only when the native host must change.
- Added an always-visible version line showing the current version, latest status, and `current → new` comparison before the user upgrades.
- Added cached update availability, manual checks, six-hour wake-up polling, and offline-safe failure handling.
- Added a tag-driven GitHub Release workflow that publishes both core and universal-DMG assets: unsigned builds become prereleases, while Developer ID credentials produce notarized stable releases.
- Added macOS update-checker and core activation tests alongside the existing 100% JavaScript coverage gate.

## 0.2.1 - 2026-09-22

- Changed the default QR code to the plain LAN URL so phones open the dashboard directly without pairing or token management.
- Fixed `401` responses for task synchronization and server-sent events when opening the displayed phone address.
- Added graceful task-list and recent-message fallbacks when optional Codex databases have not been initialized yet.
- Made optional delivery-skill validation dependencies non-blocking during one-message installation.
- Source setup now uses the developer's existing Node.js without installing, upgrading, relinking, or changing global packages; the built app still carries isolated runtimes for both Mac architectures.
- Removed the unused `ws` package and made CI verify that distributable app artifacts contain both bundled Node.js runtimes.
- Updated the image-delivery skill to use the app's bundled Node.js before falling back to a developer's existing runtime.
- Made the task pane independently scrollable on desktop and touch devices, with a 24-task responsive QA fixture.
- Increased the test suite to 37 tests while retaining 100% line, branch, and function coverage.

## 0.2.0 - 2026-09-22

- Added the universal macOS host app and QR pairing flow.
- Added phone-first task monitoring and recent visible conversation history.
- Added two-way prompts, queue reordering, deletion, and active-turn steering.
- Added paused-task resume, long-running goal status, elapsed time, and Codex usage.
- Added the recent-image delivery inbox.
- Added English and Simplified Chinese localization with device-language detection.
- Added PWA installation support and 100% tested core/frontend coverage gates.
