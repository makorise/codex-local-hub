# Changelog

All notable changes to Codex Lookout will be documented in this file.

## 0.2.12 - 2026-09-23

- Added a one-time, data-preserving full-host migration for installations whose native updater still points to the retired personal repository.
- Fixed full upgrades continuing to launch an older hot-updated core from Application Support instead of the newer core bundled with the Mac host.
- Added regression coverage for legacy updater detection and stale-core cleanup after a host upgrade.

## 0.2.11 - 2026-09-23

- Unified every user-facing surface under the **Codex Lookout / Codex 瞭望台** brand while retaining repository paths, bundle identifiers, update storage, release asset names, and skill identifiers for compatibility.
- Updated the phone dashboard, PWA metadata, native Mac host, permissions and update prompts, website, READMEs, bundled skills, issue templates, documentation, release titles, and bilingual screenshots.
- Added regression tests that reject legacy display names on product surfaces and require a single explicit compatibility note in each language.

## 0.2.10 - 2026-09-23

- Added a compact seven-day chart below the weekly Codex allowance, based on daily changes observed locally by the Mac.
- Kept only seven small daily aggregates in the private application-support directory; no prompts, tokens, account IDs, or full usage archive are stored.
- Compressed the running, queued, and all-task counters into a single 44-pixel status strip and tightened filter spacing, so tasks appear sooner even with the new chart.
- Added bilingual chart labels, missing-data states, reset-window handling, atomic local persistence, mobile overflow QA, and complete regression coverage.

## 0.2.9 - 2026-09-23

- Added a compact current-account badge beside the live connection state on desktop and phone.
- Derived only a sanitized display name and initial on the Mac; full email addresses, account IDs, access tokens, and credentials are never returned to the dashboard.
- Added failure-safe hiding, responsive truncation, bilingual accessibility labels, and complete backend/frontend/privacy regression coverage.

## 0.2.8 - 2026-09-22

- Moved the official source, installation skills, release channel, and product website to the Makorise GitHub organization.
- Updated the native updater, documentation, package metadata, website links, SEO metadata, and social preview to use the organization-owned URLs.
- Moved new installations and future hot updates to `makorise/codex-local-hub`; installations whose native updater predates the move require one complete host migration.

## 0.2.7 - 2026-09-22

- Fixed `steer` failing with `thread not found` by sending the prompt through the running Codex desktop app that owns the task, instead of starting a competing app-server process.
- Automatically discovers the Codex desktop message channel after the Hub or Codex app restarts; failed sends keep the queued message intact.
- Added desktop-channel, protocol, timeout, and stale-task regression coverage.

## 0.2.6 - 2026-09-22

- Disabled both double-tap and two-finger page zoom across the phone dashboard while preserving normal vertical scrolling and horizontal image swiping.
- Added a mobile touch-policy regression test and refreshed the offline shell cache.

## 0.2.5 - 2026-09-22

- Added a compact, two-step confirmation control for clearing the visual delivery inbox from desktop or phone.
- Clearing removes only managed inbox and pending-delivery image copies; original screenshots and unrelated files remain untouched.
- Added complete backend, API, bilingual frontend, failure-state, and filesystem-safety test coverage for inbox clearing.

## 0.2.4 - 2026-09-22

- Added active core version and runtime source to `/api/health`, so a manual hot update can be verified independently from the desktop prompt.
- Made both bundled and hot-updated cores identify themselves consistently, including when a new core is installed by an older compatible host.
- Added full branch coverage for version detection, missing manifests, and bundled fallbacks.

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
