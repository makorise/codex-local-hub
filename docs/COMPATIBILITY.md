# macOS compatibility

## Supported systems

| System | CPU | Status |
|---|---|---|
| macOS 15 and newer | Apple silicon | Primary supported configuration |
| macOS 15 and newer | Intel x86_64 | Supported by the universal build |
| macOS 13–14 | Apple silicon or Intel | Best-effort compatibility |

## Compatibility safeguards

- The app executable is a universal Mach-O containing `arm64` and `x86_64` slices.
- The DMG bundles separate official Node.js 24 LTS runtimes for Apple silicon and Intel.
- Bundled runtimes are private to the application; existing Homebrew, nvm, Volta, asdf, system Node.js, and global npm packages are neither modified nor used at runtime.
- `NSLocalNetworkUsageDescription` is localized for macOS local-network privacy prompts.
- Release builds use hardened runtime, Developer ID signing, Apple notarization, and stapling.
- CI builds and validates the app on the GitHub `macos-15` runner.
- The app does not require Rosetta on Apple silicon.

## Release checks

Every public release should be tested on a clean macOS 15 or newer account with no separately installed Node.js:

1. Gatekeeper accepts the downloaded DMG.
2. Drag-to-Applications installation succeeds without administrator access.
3. The Local Network prompt contains the expected explanation.
4. The QR code opens the plain LAN URL and the task and event APIs respond without a pairing step.
5. Locking the screen does not stop synchronization.
6. Denying and later re-enabling Local Network access produces a recoverable state.
