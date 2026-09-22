# Codex Local Hub

**A local-first mobile dashboard for monitoring and controlling Codex tasks from your phone.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb.svg)](LICENSE)
[![CI](https://github.com/brandonwang001/codex-local-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/brandonwang001/codex-local-hub/actions/workflows/ci.yml)
![macOS 15+](https://img.shields.io/badge/macOS-15%2B-111827.svg)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-16a34a.svg)
![Test coverage](https://img.shields.io/badge/coverage-100%25-16a34a.svg)

[简体中文](README.zh-CN.md) · English

Codex Local Hub is an open-source **Codex mobile dashboard, task monitor, and phone remote control for macOS**. It turns a Mac running Codex into a private, phone-friendly task console on your local network. Scan the QR code in the macOS app to monitor task progress, review recent messages and visual deliveries, manage queued prompts, and continue a task without exposing your conversations to a third-party service.

> Codex Local Hub is an independent open-source project and is not affiliated with or endorsed by OpenAI.

## See it in action

<table>
  <tr>
    <td width="78%"><img src="docs/assets/screenshots/desktop-dashboard.en.png" width="100%" alt="Codex Local Hub desktop dashboard showing tasks, progress, usage, recent messages, goal status, and the prompt composer"></td>
    <td width="22%"><img src="docs/assets/screenshots/mobile-dashboard.en.png" width="100%" alt="Codex Local Hub phone dashboard showing current usage and task states"></td>
  </tr>
  <tr>
    <td align="center"><strong>Desktop workspace</strong> — task list and conversation stay visible together</td>
    <td align="center"><strong>Phone dashboard</strong> — a compact view built for one-handed use</td>
  </tr>
</table>

These are real screenshots of the production interface rendered with sanitized demo data. No private task content, pairing token, or active QR code is included.

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

![Architecture diagram showing how Codex Local Hub is installed on a Mac, reads local Codex state, synchronizes over local Wi-Fi, and supports two-way control from a phone](docs/assets/how-it-works.svg)

1. **Install the host app.** The native macOS wrapper starts its bundled Node.js service on the Mac and shows the phone address and a one-time pairing QR code.
2. **Read local Codex data.** The service reads task, project, queue, goal, usage, and recent visible-message state from the local `~/.codex` databases. It uses the Codex CLI and app-server control channel for resume, queue, and steer actions; it does not scrape the ChatGPT web interface.
3. **Synchronize on the LAN.** After QR pairing, the phone receives an HttpOnly session cookie. Authenticated JSON endpoints provide current state, while server-sent events refresh the dashboard when work changes.
4. **Control work from the phone.** Prompts and queue actions travel back to the Mac, where they are delivered to the selected Codex task. The service keeps only a small recent view for monitoring instead of building a second full chat archive.

The current release is local-network only. The data path stays between the Mac and paired devices on the same trusted Wi-Fi; no hosted Codex Local Hub relay is involved.

## Enable the visual delivery skill

The **Delivery inbox** is built into Codex Local Hub. The optional [`deliver-to-codex-local-hub`](.agents/skills/deliver-to-codex-local-hub) skill teaches Codex how to validate an existing screenshot or image and stage it for the inbox. The source file is never moved or modified, and the inbox keeps only the latest 20 supported images.

Recommended installation: send this message in Codex (it is not a Terminal command):

```text
$skill-installer Install the skill from https://github.com/brandonwang001/codex-local-hub/tree/main/.agents/skills/deliver-to-codex-local-hub
```

If you cloned this repository, Codex can discover the repo-scoped skill automatically while working inside the repository. To install it manually for every project:

```bash
mkdir -p "$HOME/.agents/skills"
cp -R ".agents/skills/deliver-to-codex-local-hub" "$HOME/.agents/skills/"
```

Codex normally detects the new skill automatically; restart Codex if it does not appear. Then ask naturally, or invoke it explicitly:

```text
Use $deliver-to-codex-local-hub to send /absolute/path/to/screenshot.png to my phone as "Checkout result".
```

Keep Codex Local Hub running. The image appears in **Delivery inbox** on the next refresh. Supported formats are PNG, JPEG, WebP, and GIF, up to 20 MB. See the [official OpenAI skill documentation](https://learn.chatgpt.com/docs/build-skills) for how Codex discovers and invokes skills.

## Requirements

- macOS 15 or newer
- Node.js 22 or newer when building from source; release DMGs bundle Node.js 24 LTS
- Codex available through the ChatGPT desktop installation and local `~/.codex` state
- A phone and Mac connected to the same trusted Wi-Fi network

## Install

The first public notarized DMG is being prepared. Until it is available in GitHub Releases, build from source using the development steps below. Future release DMGs will include Node.js for Apple silicon and Intel Macs, so end users will not need Node.js or Terminal. See the [installation guide](docs/INSTALL.md) and [macOS compatibility matrix](docs/COMPATIBILITY.md).

For development:

```bash
git clone https://github.com/brandonwang001/codex-local-hub.git
cd codex-local-hub
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
