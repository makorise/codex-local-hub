---
name: deliver-to-codex-local-hub
description: Deliver an existing screenshot or raster image to the Codex Local Hub delivery inbox for phone review. Use when the user asks to send, publish, or show an image, screenshot, mockup, or visual result in Codex Local Hub or its mobile dashboard.
---

# Deliver to Codex Local Hub

Deliver only an image already within the current task's scope. If it does not exist yet, first create or capture it with the appropriate tool.

Resolve this skill's directory from the loaded `SKILL.md` path, then run:

```bash
<skill-directory>/scripts/deliver-image.sh <absolute-image-path> [short-title]
```

The helper uses Codex Local Hub's bundled architecture-specific Node.js runtime when the app is installed, falling back to an existing `node` command only for source-development environments. It never installs or changes Node.js. It accepts PNG, JPEG, WebP, and GIF files up to 20 MB, copies the image into Codex Local Hub's sandbox-safe staging outbox, and prints a JSON result; it never removes or changes the source image. `CODEX_TASK_DESK_OUTBOX` can override the staging directory when the host uses a custom location.

After staging:

1. Verify that the JSON result reports `staged: true` and that its `path` exists.
2. Tell the user the image is ready in Codex Local Hub's **Delivery inbox**. The running host imports it during the next refresh.
3. Do not claim it is available away from the local network unless a remote relay is actually configured.

If the helper fails, report its concrete validation error. Do not copy unsupported files directly into the inbox or weaken the file-type and size checks.
