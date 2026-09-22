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

## Install with one message to Codex

You do not need to begin with Terminal commands. Copy the message below into a Codex task on the Mac you want to use as the host:

```text
Use $skill-installer to install the setup skill from https://github.com/brandonwang001/codex-local-hub/tree/main/.agents/skills/setup-codex-local-hub. After installation, read the installed SKILL.md and carry it out in this task: install or update Codex Local Hub on this Mac, install its image-delivery skill, launch the app, and verify local phone access. Prefer the latest stable release; if no suitable release exists, build it from source. Continue autonomously unless an action genuinely requires me, then finish with the app location, access method, and verification results.
```

This one message asks Codex to install the reusable [`setup-codex-local-hub`](.agents/skills/setup-codex-local-hub) skill and immediately complete the setup. The skill keeps Gatekeeper enabled, preserves existing files, runs the test suite, verifies the application, installs the companion image-delivery skill, and stops instead of exposing the service to the public internet.

If Codex reports that the selected model is at capacity, wait while the task is still working. If it stops, choose another available model and send this in the same task:

```text
Continue with $setup-codex-local-hub from the last verified setup stage. Reuse the existing checkpoint and files; do not restart completed work. Finish installation, launch, and phone-access verification.
```

## See it in action

### 1. Start the host on your Mac

<p align="center">
  <img src="docs/assets/screenshots/mac-host.en.png" width="720" alt="Codex Local Hub macOS host app showing service status, a demo QR code, LAN address, and launch controls">
</p>
<p align="center"><strong>Mac host app</strong> — start the local service, scan the LAN URL, and open the dashboard</p>

### 2. See every task at a glance

<p align="center">
  <img src="docs/assets/screenshots/desktop-home.en.png" width="920" alt="Codex Local Hub home screen showing usage, task counts, filters, task status, and an empty conversation panel before a task is selected">
</p>
<p align="center"><strong>Workspace home</strong> — usage, running work, queued tasks, and completed work stay visible together</p>

### 3. Open a task and continue the conversation

<p align="center">
  <img src="docs/assets/screenshots/desktop-dashboard.en.png" width="920" alt="Codex Local Hub task view showing a selected task, recent conversation, goal status, queue count, last prompt, and message composer">
</p>
<p align="center"><strong>Task conversation</strong> — review the latest visible messages, inspect the goal and queue, then send the next prompt</p>

### 4. Use the same flow on your phone

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/mobile-dashboard.en.png" width="100%" alt="Codex Local Hub phone home screen showing current usage and task states"></td>
    <td width="50%"><img src="docs/assets/screenshots/mobile-conversation.en.png" width="100%" alt="Codex Local Hub phone task view showing recent messages, goal status, queue count, last prompt, and message composer"></td>
  </tr>
  <tr>
    <td align="center"><strong>Phone home</strong> — choose a task from the compact dashboard</td>
    <td align="center"><strong>Phone conversation</strong> — monitor progress and send the next prompt with one hand</td>
  </tr>
</table>

These are real product-interface screenshots with sanitized demo data. The working QR code and private LAN address in the host screenshot were replaced with a non-scannable placeholder and example address; no private task content is included.

## How it works

![Architecture diagram showing how Codex Local Hub is installed on a Mac, reads local Codex state, synchronizes over local Wi-Fi, and supports two-way control from a phone](docs/assets/how-it-works.svg)

1. **Install the host app.** The native macOS wrapper starts its bundled Node.js service on the Mac and shows a QR code containing the plain phone address.
2. **Read local Codex data.** The service reads task, project, queue, goal, usage, and recent visible-message state from the local `~/.codex` databases. It uses the Codex CLI and app-server control channel for resume, queue, and steer actions; it does not scrape the ChatGPT web interface.
3. **Synchronize on the LAN.** Scanning the QR code opens the dashboard directly. JSON endpoints provide current state, while server-sent events refresh it when work changes.
4. **Control work from the phone.** Prompts and queue actions travel back to the Mac, where they are delivered to the selected Codex task. The service keeps only a small recent view for monitoring instead of building a second full chat archive.

The current release is local-network only. The data path stays between the Mac and devices on the same trusted Wi-Fi; no hosted Codex Local Hub relay is involved.

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

## Enable the visual delivery skill

The **Delivery inbox** is built into Codex Local Hub. The one-message setup above installs the companion [`deliver-to-codex-local-hub`](.agents/skills/deliver-to-codex-local-hub) skill automatically. It teaches Codex how to validate an existing screenshot or image and stage it for the inbox. The source file is never moved or modified, and the inbox keeps only the latest 20 supported images.

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

For most users, the **Install with one message to Codex** flow near the top of this README is the recommended path.

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

The default port is `8787`. Environment overrides include `PORT`, `HOST`, `BRIDGE_REQUIRE_PAIRING`, `BRIDGE_TOKEN`, `CODEX_BIN`, `CODEX_TASK_DESK_INBOX`, and `CODEX_TASK_DESK_OUTBOX`.

## Security and privacy

- The dashboard is designed for a **trusted local network**.
- The default QR code contains the plain LAN URL and opens the dashboard directly—there is no token for users to copy or manage.
- Anyone who can reach the Mac on that trusted LAN can use the dashboard, including its control actions. Use it only on a network you trust.
- Advanced browser-only deployments can opt into the legacy cookie gate with `BRIDGE_REQUIRE_PAIRING=1`; a random 256-bit secret is then stored with owner-only permissions.
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
