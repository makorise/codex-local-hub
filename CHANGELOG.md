# Changelog

All notable changes to Codex Local Hub will be documented in this file.

## 0.2.1 - 2026-09-22

- Changed the default QR code to the plain LAN URL so phones open the dashboard directly without pairing or token management.
- Fixed `401` responses for task synchronization and server-sent events when opening the displayed phone address.
- Added graceful task-list and recent-message fallbacks when optional Codex databases have not been initialized yet.
- Made optional delivery-skill validation dependencies non-blocking during one-message installation.
- Increased the test suite to 36 tests while retaining 100% line, branch, and function coverage.

## 0.2.0 - 2026-09-22

- Added the universal macOS host app and QR pairing flow.
- Added phone-first task monitoring and recent visible conversation history.
- Added two-way prompts, queue reordering, deletion, and active-turn steering.
- Added paused-task resume, long-running goal status, elapsed time, and Codex usage.
- Added the recent-image delivery inbox.
- Added English and Simplified Chinese localization with device-language detection.
- Added PWA installation support and 100% tested core/frontend coverage gates.
