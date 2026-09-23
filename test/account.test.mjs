import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { accountNameFromEmail, createAccountReader, normalizeAccount, requestAccount } from '../src/account.mjs';

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

test('account normalization exposes only a bounded display name', () => {
  assert.equal(accountNameFromEmail(null), '');
  assert.equal(accountNameFromEmail('missing-at'), '');
  assert.equal(accountNameFromEmail('@example.com'), '');
  assert.equal(accountNameFromEmail('  Alice\u202e  Smith@example.com  '), 'Alice Smith');
  assert.equal(accountNameFromEmail(`${'你'.repeat(60)}@example.com`).length, 48);
  assert.deepEqual(normalizeAccount(null), { available: false, name: null, initial: null });
  assert.deepEqual(normalizeAccount({ account: { email: 'alice@example.com', type: 'chatgpt' } }), { available: true, name: 'alice', initial: 'A' });
  assert.equal(normalizeAccount({ account: { email: 'ß@example.com' } }).initial, 'S');
});

test('account reader caches results and shares an in-flight request', async () => {
  let clock = 10;
  let calls = 0;
  let resolveRequest;
  const request = () => {
    calls += 1;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const read = createAccountReader({ request, now: () => clock, ttlMs: 100 });
  const first = read();
  const concurrent = read();
  assert.equal(calls, 1);
  resolveRequest({ account: { email: 'first@example.com' } });
  assert.equal((await first).name, 'first');
  assert.equal(await concurrent, await first);
  assert.equal(await read(), await first);
  assert.equal(calls, 1);
  clock = 200;
  const refreshed = read();
  assert.equal(calls, 2);
  resolveRequest({ account: { email: 'second@example.com' } });
  assert.equal((await refreshed).name, 'second');
  assert.equal((await createAccountReader({ request: async () => ({}) })()).available, false);
});

test('account app-server transport completes the handshake', async () => {
  const child = fakeChild({ onWrite(value, process) {
    if (!value.includes('account/read')) return;
    queueMicrotask(() => process.stdout.emit('data', Buffer.from('not-json\n{"id":1,"result":{}}\n{"id":2,"result":{"account":{"email":"alice@example.com"}}}\n{"id":2,"result":{}}\n')));
  } });
  const result = await requestAccount({ codexBin: '/codex', spawnProcess: (bin, args, options) => {
    assert.equal(bin, '/codex');
    assert.deepEqual(args, ['app-server', '--stdio']);
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    return child;
  }, timeoutMs: 100 });
  assert.equal(result.account.email, 'alice@example.com');
  assert.equal(child.writes.length, 3);
  assert.equal(child.killed, 1);

  const defaultOptionsChild = fakeChild({ onWrite(value, process) {
    if (value.includes('account/read')) queueMicrotask(() => process.stdout.emit('data', '{"id":2,"result":{}}\n'));
  } });
  await requestAccount({ spawnProcess: (bin) => {
    assert.equal(bin, 'codex');
    return defaultOptionsChild;
  } });
});

test('account app-server transport reports protocol, process and timeout failures', async () => {
  const protocol = fakeChild({ onWrite(value, process) {
    if (value.includes('account/read')) queueMicrotask(() => process.stdout.emit('data', '{"id":2,"error":{"message":"denied"}}\n'));
  } });
  await assert.rejects(requestAccount({ spawnProcess: () => protocol, timeoutMs: 100 }), /denied/);

  const emptyProtocol = fakeChild({ onWrite(value, process) {
    if (value.includes('account/read')) queueMicrotask(() => process.stdout.emit('data', '{"id":2,"error":{}}\n'));
  } });
  await assert.rejects(requestAccount({ spawnProcess: () => emptyProtocol, timeoutMs: 100 }), /账号读取失败/);

  const noResult = fakeChild({ onWrite(value, process) {
    if (value.includes('account/read')) queueMicrotask(() => process.stdout.emit('data', '{"id":2}\n'));
  } });
  assert.deepEqual(await requestAccount({ spawnProcess: () => noResult, timeoutMs: 100 }), {});

  await assert.rejects(requestAccount({ spawnProcess: () => { throw new Error('spawn failed'); } }), /spawn failed/);

  const errored = fakeChild();
  queueMicrotask(() => errored.emit('error', new Error('child failed')));
  await assert.rejects(requestAccount({ spawnProcess: () => errored, timeoutMs: 100 }), /child failed/);

  const exited = fakeChild({ killEmitsExit: false });
  queueMicrotask(() => { exited.stderr.emit('data', 'server failed'); exited.emit('exit', 7); });
  await assert.rejects(requestAccount({ spawnProcess: () => exited, timeoutMs: 100 }), /server failed/);

  const codeOnly = fakeChild({ killEmitsExit: false });
  queueMicrotask(() => codeOnly.emit('exit', 8));
  await assert.rejects(requestAccount({ spawnProcess: () => codeOnly, timeoutMs: 100 }), /（8）/);

  const badInput = fakeChild({ withKill: false });
  badInput.stdin.write = () => { throw new Error('input failed'); };
  await assert.rejects(requestAccount({ spawnProcess: () => badInput, timeoutMs: 100 }), /input failed/);

  const hanging = fakeChild({ killEmitsExit: false });
  await assert.rejects(requestAccount({ spawnProcess: () => hanging, timeoutMs: 1 }), /超时/);
});
