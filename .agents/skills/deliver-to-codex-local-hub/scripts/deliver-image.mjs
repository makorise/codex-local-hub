#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { platform } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

const source = process.argv[2];
const suppliedTitle = process.argv[3];
if (!source) fail('Usage: deliver-image.mjs <absolute-image-path> [short-title]');

const sourcePath = resolve(source);
const extension = extname(sourcePath).toLowerCase();
const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
if (!allowed.has(extension)) fail('Only PNG, JPEG, WebP, and GIF images are supported');

let info;
try {
  info = await stat(sourcePath);
} catch {
  fail('The image file does not exist');
}
if (!info.isFile()) fail('The delivery path is not a file');
if (info.size > 20 * 1024 * 1024) fail('The image must not exceed 20 MB');

const defaultOutbox = platform() === 'darwin'
  ? '/private/tmp/codex-task-desk-outbox'
  : '/tmp/codex-task-desk-outbox';
const outbox = resolve(process.env.CODEX_TASK_DESK_OUTBOX || defaultOutbox);
const rawTitle = suppliedTitle || basename(sourcePath, extension);
const title = rawTitle.normalize('NFC')
  .replace(/[\\/:?*"<>|\u0000-\u001f]/g, '_')
  .replace(/\s+/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 80) || 'image';
const filename = `${Date.now()}-${randomUUID().slice(0, 8)}-${title}${extension}`;
const destination = join(outbox, filename);

await mkdir(outbox, { recursive: true });
await copyFile(sourcePath, destination);
process.stdout.write(`${JSON.stringify({ staged: true, path: destination, filename, size: info.size })}\n`);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
