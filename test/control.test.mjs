import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CodexControlClient, controlProcessError } from '../src/control.mjs';

function childProcess(onWrite = () => undefined) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  child.stdin.on('data', (chunk) => onWrite(chunk.toString(), child));
  return child;
}

test('Codex control initializes the desktop proxy and steers the active turn', async () => {
  const writes = [];
  let spawned;
  const child = childProcess((line, process) => {
    const message = JSON.parse(line);
    writes.push(message);
    if (message.id === 1) process.stdout.write('\nnot-json\n{"id":1,"result":{}}\n');
    if (message.id === 2) process.stdout.write('{"id":2,"result":{"turnId":"turn-2"}}\n');
  });
  const client = new CodexControlClient({
    codexBin: '/codex',
    socketPath: '/tmp/codex.sock',
    spawn: (...args) => { spawned = args; return child; },
  });
  assert.deepEqual(await client.steer('thread-1', 'turn-1', '现在处理这个'), { turnId: 'turn-2' });
  assert.deepEqual(spawned, ['/codex', ['app-server', 'proxy', '--sock', '/tmp/codex.sock'], { stdio: ['pipe', 'pipe', 'pipe'] }]);
  assert.equal(writes[1].method, 'initialized');
  assert.deepEqual(writes[2], {
    id: 2,
    method: 'turn/steer',
    params: { threadId: 'thread-1', input: [{ type: 'text', text: '现在处理这个' }], expectedTurnId: 'turn-1' },
  });
  assert.equal(child.killed, true);

  const startWrites = [];
  const startChild = childProcess((line, process) => {
    const message = JSON.parse(line);
    startWrites.push(message);
    if (message.id === 1) process.stdout.write('{"method":"notice"}\n{"id":1,"result":{}}\n');
    if (message.id === 2) process.stdout.write('{"id":2,"result":{"thread":{"id":"thread-1"}}}\n');
    if (message.id === 3) process.stdout.write('{"id":3,"result":{"turn":{"id":"turn-new"}}}\n');
  });
  const starter = new CodexControlClient({ spawn: () => startChild });
  assert.deepEqual(await starter.start('thread-1', '启动任务'), { turn: { id: 'turn-new' } });
  assert.deepEqual(startWrites.slice(2), [
    { id: 2, method: 'thread/resume', params: { threadId: 'thread-1' } },
    { id: 3, method: 'turn/start', params: { threadId: 'thread-1', input: [{ type: 'text', text: '启动任务' }] } },
  ]);
  assert.equal(startChild.killed, false);
  startChild.stdout.write('{"method":"turn/completed","params":{"threadId":"thread-1"}}\n');
  assert.equal(startChild.killed, true);
  assert.deepEqual(await starter.callSequence([]), []);
});

test('Codex control reports protocol, process and timeout failures', async () => {
  const scenarios = [
    {
      expected: /init denied/,
      make: () => childProcess((line, child) => { if (JSON.parse(line).id === 1) child.stdout.write('{"id":1,"error":{"message":"init denied"}}\n'); }),
    },
    {
      expected: /Codex 初始化失败/,
      make: () => childProcess((line, child) => { if (JSON.parse(line).id === 1) child.stdout.write('{"id":1,"error":{}}\n'); }),
    },
    {
      expected: /steer denied/,
      make: () => childProcess((line, child) => {
        const message = JSON.parse(line);
        if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
        if (message.id === 2) child.stdout.write('{"id":2,"error":{"message":"steer denied"}}\n');
      }),
    },
    {
      expected: /Codex 控制失败/,
      make: () => childProcess((line, child) => {
        const message = JSON.parse(line);
        if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
        if (message.id === 2) child.stdout.write('{"id":2,"error":{}}\n');
      }),
    },
    {
      expected: /spawn failed/,
      make: () => { const child = childProcess(); delete child.kill; queueMicrotask(() => { child.emit('error', new Error('spawn failed')); child.emit('error', new Error('already settled')); child.emit('exit', 1); }); return child; },
    },
    {
      expected: /pipe failed/,
      make: () => { const child = childProcess(); queueMicrotask(() => child.stdin.emit('error', new Error('pipe failed'))); return child; },
    },
    {
      expected: /proxy failed/,
      make: () => { const child = childProcess(); queueMicrotask(() => { child.stderr.write('proxy failed'); child.emit('exit', 3); }); return child; },
    },
    {
      expected: /未知/,
      make: () => { const child = childProcess(); queueMicrotask(() => child.emit('exit', null)); return child; },
    },
  ];
  for (const scenario of scenarios) {
    const client = new CodexControlClient({ spawn: scenario.make, timeoutMs: 100 });
    await assert.rejects(client.call('test', {}), scenario.expected);
  }

  let timeoutCallback;
  let cleared = false;
  const timeoutClient = new CodexControlClient({
    spawn: () => childProcess(),
    setTimer: (callback) => { timeoutCallback = callback; return 7; },
    clearTimer: (id) => { assert.equal(id, 7); cleared = true; },
  });
  const pending = timeoutClient.call('test', {});
  timeoutCallback();
  await assert.rejects(pending, (error) => error.statusCode === 504);
  assert.equal(cleared, true);

  const defaults = new CodexControlClient();
  assert.equal(defaults.codexBin, 'codex');
  assert.equal(defaults.timeoutMs, 15_000);
  const unavailable = controlProcessError('failed to connect to socket: No such file or directory', 1);
  assert.equal(unavailable.statusCode, 503);
  assert.match(unavailable.message, /消息仍保留/);
});

test('Codex control resumes an idle task and keeps it running in the project directory', async () => {
  let spawned;
  const child = childProcess();
  const client = new CodexControlClient({
    codexBin: '/codex',
    spawn: (...args) => { spawned = args; return child; },
  });
  const pending = client.resume('thread-1', '继续执行', '/work');
  child.stdout.write('not-json\n{"type":"thread.started"}\n{"type":"turn.started"}\n');
  assert.deepEqual(await pending, { accepted: true, threadId: 'thread-1' });
  assert.deepEqual(spawned, ['/codex', ['exec', 'resume', '--json', 'thread-1', '继续执行'], { stdio: ['ignore', 'pipe', 'pipe'], cwd: '/work' }]);
  assert.equal(client.runs.has(child), true);
  child.emit('error', new Error('late error'));
  child.emit('exit', 0);
  assert.equal(client.runs.size, 0);

  const failedChild = childProcess();
  const failed = new CodexControlClient({ spawn: () => failedChild });
  const rejected = failed.resume('thread-2', '失败', '');
  failedChild.stderr.write('resume failed');
  failedChild.emit('exit', 2);
  await assert.rejects(rejected, /resume failed/);

  let timeoutCallback;
  const timeoutChild = childProcess();
  const timeout = new CodexControlClient({
    spawn: () => timeoutChild,
    setTimer: (callback) => { timeoutCallback = callback; return 9; },
    clearTimer: (id) => assert.equal(id, 9),
  });
  const timedOut = timeout.resume('thread-3', '超时');
  timeoutCallback();
  await assert.rejects(timedOut, (error) => error.statusCode === 504);
  assert.equal(timeoutChild.killed, true);
});
