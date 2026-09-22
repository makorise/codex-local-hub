import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUsageReader, normalizeUsage, requestRateLimits, usageWindowLabel } from '../src/usage.mjs';

function fakeChild({ onWrite, killEmitsExit = true, withKill = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.writes = [];
  child.stdin = {
    write(value) {
      child.writes.push(value);
      if (onWrite) onWrite(value, child);
    },
  };
  child.killed = 0;
  if (withKill) child.kill = () => {
    child.killed += 1;
    if (killEmitsExit) child.emit('exit', 0);
  };
  return child;
}

test('usage normalization selects buckets, formats windows and clamps remaining percent', () => {
  assert.equal(usageWindowLabel(15), '15 分钟');
  assert.equal(usageWindowLabel(300), '5 小时');
  assert.equal(usageWindowLabel(1_440), '1 天');
  assert.equal(usageWindowLabel(10_080), '周');
  assert.equal(usageWindowLabel(0), '0 分钟');
  assert.equal(usageWindowLabel(), '0 分钟');
  assert.deepEqual(normalizeUsage(null, 1), { available: false, planType: null, limits: [], updatedAt: 1 });
  assert.equal(typeof normalizeUsage(null).updatedAt, 'number');

  const result = normalizeUsage({ rateLimitsByLimitId: { codex: {
    planType: 'pro',
    primary: { usedPercent: 9, windowDurationMins: 10_080, resetsAt: 100 },
    secondary: { usedPercent: 120, windowDurationMins: 300, resetsAt: 0 },
  } } }, 2);
  assert.equal(result.available, true);
  assert.equal(result.planType, 'pro');
  assert.deepEqual(result.limits.map((item) => [item.id, item.label, item.remainingPercent]), [['primary', '周', 91], ['secondary', '5 小时', 0]]);
  assert.equal(result.limits[0].resetsAt, 100_000);

  const fallback = normalizeUsage({ rateLimits: { primary: { usedPercent: -5, windowDurationMins: 30 } } }, 3);
  assert.equal(fallback.limits[0].remainingPercent, 100);
  assert.equal(fallback.planType, null);
  assert.equal(fallback.limits[0].resetsAt, 0);
  assert.equal(fallback.limits[0].usedPercent, -5);

  const firstBucket = normalizeUsage({ rateLimitsByLimitId: { other: { primary: null } } }, 4);
  assert.equal(firstBucket.available, false);

  const emptyWindow = normalizeUsage({ rateLimits: { primary: {} } }, 5);
  assert.deepEqual(emptyWindow.limits[0], {
    id: 'primary', label: '0 分钟', usedPercent: 0, remainingPercent: 100,
    resetsAt: 0, windowDurationMins: 0,
  });
});

test('usage reader caches results and shares an in-flight request', async () => {
  let clock = 10;
  let calls = 0;
  let resolveRequest;
  const request = () => {
    calls += 1;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const read = createUsageReader({ request, now: () => clock, ttlMs: 100 });
  const first = read();
  const concurrent = read();
  assert.equal(calls, 1);
  resolveRequest({ rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1 } } });
  assert.equal((await first).limits[0].remainingPercent, 75);
  assert.equal(await concurrent, await first);
  assert.equal(await read(), await first);
  assert.equal(calls, 1);
  clock = 200;
  const refreshed = read();
  assert.equal(calls, 2);
  resolveRequest({ rateLimits: { primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 2 } } });
  assert.equal((await refreshed).limits[0].remainingPercent, 70);

  const readWithDefaults = createUsageReader({ request: async () => ({}) });
  assert.equal((await readWithDefaults()).available, false);
});

test('app-server transport completes the handshake and parses a rate-limit response', async () => {
  const child = fakeChild({ onWrite(value, process) {
    if (!value.includes('account/rateLimits/read')) return;
    queueMicrotask(() => process.stdout.emit('data', Buffer.from('not-json\n{"id":1,"result":{}}\n{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":9}}}}\n{"id":2,"result":{}}\n')));
  } });
  const result = await requestRateLimits({ codexBin: '/codex', spawnProcess: (bin, args, options) => {
    assert.equal(bin, '/codex');
    assert.deepEqual(args, ['app-server', '--stdio']);
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    return child;
  }, timeoutMs: 100 });
  assert.equal(result.rateLimits.primary.usedPercent, 9);
  assert.equal(child.writes.length, 3);
  assert.equal(child.killed, 1);

  const defaultOptionsChild = fakeChild({ onWrite(value, process) {
    if (value.includes('account/rateLimits/read')) queueMicrotask(() => process.stdout.emit('data', '{"id":2,"result":{}}\n'));
  } });
  await requestRateLimits({ spawnProcess: (bin) => {
    assert.equal(bin, 'codex');
    return defaultOptionsChild;
  } });
});

test('app-server transport reports protocol, process, startup, input and timeout failures', async () => {
  const protocol = fakeChild({ onWrite(value, process) {
    if (value.includes('account/rateLimits/read')) queueMicrotask(() => process.stdout.emit('data', '{"id":2,"error":{"message":"denied"}}\n'));
  } });
  await assert.rejects(requestRateLimits({ spawnProcess: () => protocol, timeoutMs: 100 }), /denied/);

  const emptyProtocol = fakeChild({ onWrite(value, process) {
    if (value.includes('account/rateLimits/read')) queueMicrotask(() => process.stdout.emit('data', '{"id":2,"error":{}}\n'));
  } });
  await assert.rejects(requestRateLimits({ spawnProcess: () => emptyProtocol, timeoutMs: 100 }), /Codex 用量读取失败/);

  const noResult = fakeChild({ onWrite(value, process) {
    if (value.includes('account/rateLimits/read')) queueMicrotask(() => process.stdout.emit('data', '{"id":2}\n'));
  } });
  assert.deepEqual(await requestRateLimits({ spawnProcess: () => noResult, timeoutMs: 100 }), {});

  await assert.rejects(requestRateLimits({ spawnProcess: () => { throw new Error('spawn failed'); } }), /spawn failed/);

  const errored = fakeChild();
  queueMicrotask(() => errored.emit('error', new Error('child failed')));
  await assert.rejects(requestRateLimits({ spawnProcess: () => errored, timeoutMs: 100 }), /child failed/);

  const exited = fakeChild({ killEmitsExit: false });
  queueMicrotask(() => { exited.stderr.emit('data', 'server failed'); exited.emit('exit', 7); });
  await assert.rejects(requestRateLimits({ spawnProcess: () => exited, timeoutMs: 100 }), /server failed/);

  const codeOnly = fakeChild({ killEmitsExit: false });
  queueMicrotask(() => codeOnly.emit('exit', 8));
  await assert.rejects(requestRateLimits({ spawnProcess: () => codeOnly, timeoutMs: 100 }), /（8）/);

  const badInput = fakeChild({ withKill: false });
  badInput.stdin.write = () => { throw new Error('input failed'); };
  await assert.rejects(requestRateLimits({ spawnProcess: () => badInput, timeoutMs: 100 }), /input failed/);

  const hanging = fakeChild({ killEmitsExit: false });
  await assert.rejects(requestRateLimits({ spawnProcess: () => hanging, timeoutMs: 1 }), /超时/);
});
