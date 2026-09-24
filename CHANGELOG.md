# Changelog

All notable changes to Codex Lookout will be documented in this file.

## 0.2.23 - 2026-09-24

- Stopped live task-status refreshes from rebuilding the conversation while someone is scrolling through older messages.
- New messages now preserve the currently visible message as a stable visual anchor instead of restoring a stale numeric scroll position after the finger has moved.
- Added a compact “New messages” control so readers can stay in history until they choose to return to the latest message, with complete mobile-scroll regression coverage.

## 0.2.22 - 2026-09-24

- Removed the conflicting background wake-up loop that repeatedly showed “Startup is taking longer” even while Codex Desktop was already taking over the queued prompt.
- Phone prompts now have a single owner: the official Codex Desktop queue. Real-device integration verification confirmed queue consumption in 6 seconds, message delivery in 7 seconds, and exactly one resulting turn.
- Replaced the unreliable private-channel Steer action with a safe “Move to front” priority action, removed repeated queue-error popups, and retained 100% line, branch, and function coverage.

## 0.2.21 - 2026-09-24

- Fixed live task refreshes pulling the conversation back to the newest message while the user was scrolling through older history.
- The conversation now follows the latest message only on first open or while already at the bottom; otherwise it preserves the reader's exact scroll position across message and status updates.
- Isolated mobile conversation overscroll from the fixed composer dock and added complete regression coverage for manual-history and follow-latest behavior.

## 0.2.20 - 2026-09-24

- Removed the unsafe idle-task fallback that launched `codex exec resume` as a second writer and could make Codex Desktop report “This is open in another app.”
- Idle queued prompts now start only through the native Codex Desktop control channel; if that channel is unavailable, the prompt remains durable in the queue with an explicit waiting state and no competing executor is launched.
- Rejects stale desktop pipe paths, refreshes the phone shell cache, and adds regression coverage proving that background dispatch never spawns the competing CLI path.

## 0.2.19 - 2026-09-23

- Replaced the misleading seven-day locally observed percentage chart with an exact “Tokens today” summary read from Codex session logs on this Mac.
- Added compact mobile presentation plus detailed input, output, and cached-input totals, with clear local-only scope in Chinese and English.
- Streams and filters rollout logs without loading message content into memory, and retains 100% line, branch, and function test coverage.

## 0.2.18 - 2026-09-23

- Fixed Steer surfacing a raw “closed” error when Codex closed or interrupted the target turn between status sync and the phone tap.
- Steer now checks only the latest recorded turn and safely starts the queued prompt as a new turn when the previous interaction has just closed.
- Preserves queued prompts on every failed control path and adds full regression coverage for closed-turn recovery.

## 0.2.17 - 2026-09-23

- Added instant optimistic queue feedback on phones so sending a prompt never makes the interface appear frozen.
- Changed completed-task delivery to persist the prompt in Codex's queue first, return immediately, and start the next turn safely in the background.
- Added automatic retry with queue preservation and bilingual delayed-start feedback, backed by complete regression coverage.

## 0.2.16 - 2026-09-23

- Added phone controls to stop a running task and archive a task without returning to the Mac.
- Added two-step project removal from Codex while explicitly preserving the project directory and every local file.
- Connected the dashboard to Codex's native task and project management protocol, with bilingual mobile UI and complete regression coverage.

## 0.2.15 - 2026-09-23

- Fixed legacy hosts repeatedly offering a cached older release instead of querying GitHub again when the update button was pressed.
- Manual update checks now invalidate stale release metadata and always force a fresh request; failed core activation clears its cached release before offering retry.
- Added a data-preserving stale-cache recovery path to the setup Skill and regression coverage for bypassing the daily update throttle.

## 0.2.14 - 2026-09-23

- Fixed intermittent hot-update rollback when a host read process output across a split UTF-8 character boundary and discarded the readiness marker.
- Sends the stable ASCII readiness marker as an isolated first write, delays human-readable output, and retries the internal 0.2.8 compatibility marker during startup.
- Made newer native hosts preserve valid output across arbitrary pipe chunk boundaries and added deterministic scheduling coverage.

## 0.2.13 - 2026-09-23

- Fixed 0.2.8 hosts falsely rolling back a healthy core update after the product rename changed the human-readable startup text.
- Added a stable, brand-independent core readiness marker while retaining the previous host marker internally for backward compatibility.
- Added regression coverage for both the 0.2.8 host handshake and future brand-independent startup detection.

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
