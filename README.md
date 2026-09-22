# Codex Local Hub

**A local-first mobile dashboard for monitoring and controlling Codex tasks from your phone.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb.svg)](LICENSE)
![macOS 15+](https://img.shields.io/badge/macOS-15%2B-111827.svg)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-16a34a.svg)
![Test coverage](https://img.shields.io/badge/coverage-100%25-16a34a.svg)

[简体中文](README.zh-CN.md) · English

Codex Local Hub is an open-source **Codex mobile dashboard, task monitor, and phone remote control for macOS**. It turns a Mac running Codex into a private, phone-friendly task console on your local network. Scan the QR code in the macOS app to monitor task progress, review recent messages and visual deliveries, manage queued prompts, and continue a task without exposing your conversations to a third-party service.

> Codex Local Hub is an independent open-source project and is not affiliated with or endorsed by OpenAI.

## Why Codex Local Hub?

- **Phone-first monitoring** — see running, queued, paused, failed, and completed tasks.
- **Two-way control** — send prompts, reorder or remove queued prompts, and steer an active task.
- **Interrupted-task recovery** — resume a paused task with one tap.
- **Visual delivery inbox** — review the latest screenshots and image results on your phone.
- **Usage visibility** — see current Codex usage and reset times.
- **Privacy by default** — task data stays on your Mac and local network.
- **Focused history** — only the latest 20 visible messages and images are presented; hidden reasoning is never mirrored.
- **English and Simplified Chinese** — follows the device language on first launch, with a remembered manual switch in the header.
- **Installable mobile shortcut** — add the dashboard to an iPhone, iPad, or Android home screen.

## Built for these workflows

- Monitor long-running Codex coding tasks from the couch, another room, or a mobile device.
- Send the next prompt without returning to the Mac.
- Reorder queued prompts and steer urgent work into the active turn.
- Review screenshots and visual results before accepting a UI implementation.
- Keep Codex task history local instead of copying full conversations into a hosted dashboard.

## How it works

```text
Codex local data + control channel
                 │
        Codex Local Hub on Mac
                 │  local Wi-Fi / HTTP
                 ▼
        Phone browser or home-screen shortcut
```

The macOS app starts a Node.js service, discovers the Mac's LAN address, and displays a pairing QR code. The phone receives a secure session cookie after scanning; the final browser URL stays clean and contains no visible token.

## Requirements

- macOS 13 or newer
- Node.js 22 or newer when building from source; release DMGs bundle Node.js 24 LTS
- Codex available through the ChatGPT desktop installation and local `~/.codex` state
- A phone and Mac connected to the same trusted Wi-Fi network

## Install

The first public notarized DMG is being prepared. Until it is available in GitHub Releases, build from source using the development steps below. Future release DMGs will include Node.js for Apple silicon and Intel Macs, so end users will not need Node.js or Terminal. See the [installation guide](docs/INSTALL.md) and [macOS compatibility matrix](docs/COMPATIBILITY.md).

For development:

```bash
npm install
npm run build:mac
open "dist/Codex Local Hub.app"
```

Then:

1. Keep the Mac and phone on the same Wi-Fi.
2. Open **Codex Local Hub** on the Mac.
3. Scan the QR code with the phone camera.
4. Optional: in Safari, choose **Share → Add to Home Screen**.

Use `npm start` for the browser-only development server. Use `npm run package:mac` to create a self-contained universal DMG.

The default port is `8787`. Environment overrides include `PORT`, `HOST`, `BRIDGE_TOKEN`, `CODEX_BIN`, `CODEX_TASK_DESK_INBOX`, and `CODEX_TASK_DESK_OUTBOX`.

## Security and privacy

- The dashboard is designed for a **trusted local network**.
- A random 256-bit secret is generated and stored with owner-only permissions.
- New phones pair through the QR code; visiting the bare LAN URL does not authorize a new device.
- API access uses an HttpOnly, SameSite cookie.
- The URL shown after pairing contains no token.
- Raw chain-of-thought, hidden reasoning, and complete conversation archives are not exposed.
- Do **not** forward port `8787` directly to the public internet.

See [SECURITY.md](SECURITY.md) before deploying or modifying the network boundary.

## Reliability

- Server-side state is read incrementally and cached only in memory.
- The macOS wrapper automatically restarts the local service after unexpected exits with bounded backoff.
- The UI keeps existing thumbnails during network jitter to prevent flashing.
- Idle and interrupted tasks are started through Codex resume rather than silently remaining queued.
- Queue mutations use revision checks to prevent conflicting edits.

## Tests

```bash
npm test
npm run test:coverage
```

The coverage command enforces 100% line, branch, and function coverage for the core synchronization, control, delivery, usage, HTTP, and frontend modules.

## Current scope

Codex Local Hub currently operates on the local network. Screen locking does not stop it, but sleep, shutdown, quitting the app, or leaving the LAN makes it unavailable. A TLS-secured public relay is planned; direct port exposure is intentionally unsupported.

## FAQ

### Is this an official OpenAI or Codex product?

No. Codex Local Hub is an independent open-source companion for local Codex workflows.

### Does it expose chain-of-thought or copy my full chat history?

No. It presents recent visible messages, task state, goals, queue information, usage, and visual deliveries. Hidden reasoning is not mirrored.

### Can I use it outside my home network?

Not yet. The current release is LAN-only. Do not expose port `8787` directly to the internet; the roadmap includes an authenticated TLS relay.

### Does locking the Mac stop synchronization?

No. Locking the screen is supported. Sleep, shutdown, or quitting Codex Local Hub will stop access until the Mac is available again.

## Roadmap

- Signed remote relay for away-from-home access
- Push notifications for completion, failure, and input requests
- Launch-at-login and richer health diagnostics
- Voice prompts and reusable prompt shortcuts
- Side-by-side image comparison and delivery annotations
- Linux host package for relay and headless installations

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Suggested GitHub topics

`codex` `openai` `mobile-dashboard` `local-first` `task-monitor` `macos` `nodejs` `pwa` `developer-tools` `remote-control`

## License

[MIT](LICENSE)
