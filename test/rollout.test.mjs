import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSnapshotReader, parseRolloutLines, readRolloutSnapshot, readTail } from '../src/rollout.mjs';

const line = (entry) => JSON.stringify(entry);
const message = (timestamp, role, type, text, id) => line({ timestamp, type: 'response_item', payload: { type: 'message', role, id, content: [{ type, text }] } });

test('rollout parser keeps only recent visible messages and lifecycle metadata', () => {
  const lines = [
    '{broken',
    line({ timestamp: 'bad', type: 'other', payload: null }),
    line({ timestamp: '2026-01-01T00:00:00Z', type: 'event_msg', payload: { type: 'task_started' } }),
    line({ type: 'event_msg', payload: { type: 'item_completed' } }),
    line({ timestamp: '2026-01-01T00:00:01Z', type: 'event_msg', payload: { type: 'item_started', item: { type: 'FileChange' } } }),
    message('2026-01-01T00:00:02Z', 'user', 'input_text', '<image_resize_notice>x', 'hidden'),
    message('2026-01-01T00:00:03Z', 'user', 'input_text', 'first', 'u1'),
    message('2026-01-01T00:00:04Z', 'assistant', 'output_text', 'answer', 'a1'),
    message('2026-01-01T00:00:04Z', 'assistant', 'output_text', '<environment_context>hidden', 'a-hidden'),
    message('2026-01-01T00:00:05Z', null, 'input_text', 'second', null),
    message('2026-01-01T00:00:06Z', null, 'output_text', 'final', null),
    line({ timestamp: '2026-01-01T00:00:07Z', type: 'event_msg', payload: { type: 'turn_aborted' } }),
  ];
  const parsed = parseRolloutLines(lines, 2);
  assert.equal(parsed.lifecycle, 'turn_aborted');
  assert.equal(parsed.lastActivityType, 'file_change');
  assert.equal(parsed.latestUser, 'second');
  assert.equal(parsed.latestAssistant, 'final');
  assert.equal(parsed.messages.length, 2);
  assert.deepEqual(parsed.messages.map((item) => item.role), ['user', 'assistant']);
});

test('tail reader handles complete and truncated files and closes them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-rollout-'));
  const path = join(dir, 'sample.jsonl');
  await writeFile(path, 'one\ntwo\nthree\n');
  assert.equal((await readTail(path)).text, 'one\ntwo\nthree\n');
  assert.equal((await readTail(path, 9)).text, 'three\n');
  await rm(dir, { recursive: true });
});

test('snapshot readers fall back safely and cache by file metadata', async () => {
  assert.deepEqual(await readRolloutSnapshot(''), {});
  assert.deepEqual(await readRolloutSnapshot('/x', async () => { throw new Error('no'); }), {});
  const fallback = await readRolloutSnapshot('/x', async () => ({ text: '{}\n', mtimeMs: 77 }));
  assert.equal(fallback.lastActivityAt, 77);
  let version = 1;
  let reads = 0;
  const reader = createSnapshotReader({
    statFile: async () => ({ mtimeMs: version, size: version }),
    read: async () => { reads += 1; return { text: message('2026-01-01T00:00:00Z', 'assistant', 'output_text', `v${version}`, 'a'), mtimeMs: 1 }; },
    maxMessages: 1,
  });
  assert.deepEqual(await reader(''), {});
  assert.equal((await reader('/x')).latestAssistant, 'v1');
  assert.equal((await reader('/x')).latestAssistant, 'v1');
  assert.equal(reads, 1);
  version = 2;
  assert.equal((await reader('/x')).latestAssistant, 'v2');
  assert.equal(reads, 2);
  const failing = createSnapshotReader({ statFile: async () => { throw new Error('no'); } });
  assert.deepEqual(await failing('/x'), {});
  const noTimestamp = createSnapshotReader({
    statFile: async () => ({ mtimeMs: 9, size: 2 }),
    read: async () => ({ text: '{}', mtimeMs: 8 }),
  });
  assert.equal((await noTimestamp('/empty')).lastActivityAt, 8);
});
