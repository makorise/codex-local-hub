import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../.agents/skills/deliver-to-codex-local-hub/scripts/deliver-image.sh', import.meta.url));
const runSkill = (args, options) => execute('/bin/sh', [script, ...args], options);

test('delivery skill stages a supported image without changing its source', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'local-hub-skill-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source image.png');
  const outbox = join(root, 'outbox');
  await writeFile(source, Buffer.from('safe-demo-image'));

  const { stdout, stderr } = await runSkill([source, 'Final / mobile: view'], {
    env: { ...process.env, CODEX_TASK_DESK_OUTBOX: outbox },
  });
  const result = JSON.parse(stdout);

  assert.equal(stderr, '');
  assert.equal(result.staged, true);
  assert.match(result.filename, /^\d+-[0-9a-f]{8}-Final_mobile_view\.png$/);
  assert.equal(result.path, join(outbox, result.filename));
  assert.deepEqual(await readFile(result.path), Buffer.from('safe-demo-image'));
  assert.deepEqual(await readFile(source), Buffer.from('safe-demo-image'));
  assert.equal((await stat(result.path)).isFile(), true);
});

test('delivery skill rejects missing, unsupported, absent, and non-file inputs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'local-hub-skill-errors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'folder.png');
  const oversized = join(root, 'oversized.webp');
  await mkdir(directory);
  const oversizedHandle = await open(oversized, 'w');
  await oversizedHandle.truncate(20 * 1024 * 1024 + 1);
  await oversizedHandle.close();

  await assert.rejects(runSkill([]), /Usage:/);
  await assert.rejects(runSkill([join(root, 'notes.txt')]), /Only PNG/);
  await assert.rejects(runSkill([join(root, 'missing.png')]), /does not exist/);
  await assert.rejects(runSkill([directory]), /not a file/);
  await assert.rejects(runSkill([oversized]), /must not exceed 20 MB/);
});

test('delivery skill derives a safe fallback title from the source name', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'local-hub-skill-title-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'review result.gif');
  const outbox = join(root, 'outbox');
  await writeFile(source, Buffer.from('gif'));

  const derived = JSON.parse((await runSkill([source], {
    env: { ...process.env, CODEX_TASK_DESK_OUTBOX: outbox },
  })).stdout);
  const fallback = JSON.parse((await runSkill([source, '///'], {
    env: { ...process.env, CODEX_TASK_DESK_OUTBOX: outbox },
  })).stdout);

  assert.match(derived.filename, /-review_result\.gif$/);
  assert.match(fallback.filename, /-image\.gif$/);
});
