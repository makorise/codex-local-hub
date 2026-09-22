import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  CodexAppToolsClient,
  CodexControlClient,
  appToolsError,
  controlProcessError,
  controlProtocolError,
  discoverAppToolsPipe,
} from '../src/control.mjs';

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
  assert.deepEqual(writes.slice(2), [{
    id: 2,
    method: 'turn/steer',
    params: { threadId: 'thread-1', input: [{ type: 'text', text: '现在处理这个' }], expectedTurnId: 'turn-1' },
  }]);
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

  const callChild = childProcess((line, process) => {
    const message = JSON.parse(line);
    if (message.id === 1) process.stdout.write('{"id":1,"result":{}}\n');
    if (message.id === 2) process.stdout.write('{"id":2,"result":{"ok":true}}\n');
  });
  assert.deepEqual(await new CodexControlClient({ spawn: () => callChild }).call('status/read', {}), { ok: true });

  const appTools = { sendMessage: async (...args) => ({ args }) };
  assert.deepEqual(
    await new CodexControlClient({ appTools }).steer('thread-2', 'ignored-turn', '桌面通道'),
    { args: ['thread-2', '桌面通道'] },
  );
});

test('Codex app tools channel discovers the desktop pipe and sends the prompt', async () => {
  const writes = [];
  let spawned;
  const child = childProcess((line, process) => {
    const message = JSON.parse(line);
    writes.push(message);
    if (message.id === 1) process.stdout.write('\nnot-json\n{"jsonrpc":"2.0","id":1,"result":{}}\n');
    if (message.id === 2) process.stdout.write('{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"ok"}],"isError":false}}\n');
  });
  const client = new CodexAppToolsClient({
    codexBin: '/Applications/ChatGPT.app/Contents/Resources/codex',
    execFileSync: () => 'one CODEX_APP_TOOLS_PIPE_PATH=/tmp/old.sock two\nCODEX_APP_TOOLS_PIPE_PATH=/tmp/current.sock',
    environment: { CODEX_SESSION_ID: 'session-caller' },
    spawn: (...args) => { spawned = args; return child; },
  });
  assert.deepEqual(await client.sendMessage('thread-1', '立即处理'), {
    accepted: true,
    mode: 'steered',
    via: 'codex-app',
    result: { content: [{ type: 'text', text: 'ok' }], isError: false },
  });
  assert.equal(client.pipePath, '/tmp/current.sock');
  assert.deepEqual(spawned.slice(0, 2), [
    '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node',
    [
      '/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/codex-app-tools/server.mjs',
      '--interaction-client-id',
      'session-caller',
    ],
  ]);
  assert.equal(spawned[2].env.CODEX_APP_TOOLS_PIPE_PATH, '/tmp/current.sock');
  assert.equal(writes[1].method, 'notifications/initialized');
  assert.deepEqual(writes[2], {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'send_message_to_thread', arguments: { threadId: 'thread-1', prompt: '立即处理' } },
  });
  assert.equal(child.killed, true);
  child.emit('error', new Error('late desktop error'));

  assert.equal(discoverAppToolsPipe({ configured: ' /tmp/configured.sock ', existsSync: () => true }), '/tmp/configured.sock');
  assert.equal(discoverAppToolsPipe({ configured: '/tmp/stale.sock', existsSync: () => false, execFileSync: () => 'CODEX_APP_TOOLS_PIPE_PATH=/tmp/live.sock' }), '/tmp/live.sock');
  assert.equal(discoverAppToolsPipe({ configured: '', execFileSync: () => 'no pipe here' }), '');
  assert.equal(discoverAppToolsPipe({ configured: '', execFileSync: () => { throw new Error('ps failed'); } }), '');
  const savedPipe = process.env.CODEX_APP_TOOLS_PIPE_PATH;
  process.env.CODEX_APP_TOOLS_PIPE_PATH = '';
  assert.equal(discoverAppToolsPipe({ execFileSync: () => '' }), '');
  if (savedPipe === undefined) delete process.env.CODEX_APP_TOOLS_PIPE_PATH;
  else process.env.CODEX_APP_TOOLS_PIPE_PATH = savedPipe;
  assert.equal(appToolsError('', 'fallback').message, 'fallback');

  const environmentChild = childProcess((line, process) => {
    const message = JSON.parse(line);
    if (message.id === 1) process.stdout.write('{"id":1,"result":{}}\n');
    if (message.id === 2) process.stdout.write('{"id":2}\n');
  });
  const environmentClient = new CodexAppToolsClient({
    environment: { CODEX_APP_TOOLS_PIPE_PATH: '/tmp/from-env.sock', CODEX_THREAD_ID: 'caller-thread' },
    existsSync: () => true,
    nodeBin: '/custom/node',
    serverPath: '/custom/server.mjs',
    spawn: (command, args) => {
      assert.equal(command, '/custom/node');
      assert.equal(args[0], '/custom/server.mjs');
      assert.equal(args[2], 'caller-thread');
      return environmentChild;
    },
  });
  assert.deepEqual(await environmentClient.sendMessage('thread-2', 'message'), {
    accepted: true,
    mode: 'steered',
    via: 'codex-app',
    result: undefined,
  });

  const fallbackChild = childProcess((line, process) => {
    const message = JSON.parse(line);
    if (message.id === 1) process.stdout.write('{"id":1,"result":{}}\n');
    if (message.id === 2) process.stdout.write('{"id":2,"result":{}}\n');
  });
  const fallbackClient = new CodexAppToolsClient({
    pipePath: '/tmp/direct.sock',
    environment: {},
    spawn: (_command, args) => {
      assert.equal(args[2], 'target-thread');
      return fallbackChild;
    },
  });
  await fallbackClient.sendMessage('target-thread', 'message');

  let retryCount = 0;
  const retryClient = new CodexAppToolsClient({
    pipePath: '/tmp/stale.sock',
    environment: {},
    execFileSync: () => 'CODEX_APP_TOOLS_PIPE_PATH=/tmp/live.sock',
    spawn: () => {
      retryCount += 1;
      if (retryCount === 1) {
        const staleChild = childProcess();
        queueMicrotask(() => staleChild.emit('error', new Error('Codex app tools pipe closed')));
        return staleChild;
      }
      return childProcess((line, process) => {
        const message = JSON.parse(line);
        if (message.id === 1) process.stdout.write('{"id":1,"result":{}}\n');
        if (message.id === 2) process.stdout.write('{"id":2,"result":{}}\n');
      });
    },
  });
  await retryClient.sendMessage('thread-retry', 'message');
  assert.equal(retryCount, 2);
  assert.equal(retryClient.pipePath, '/tmp/live.sock');
});

test('Codex app tools channel preserves the queue on desktop failures', async () => {
  const missing = new CodexAppToolsClient({ pipePath: '', execFileSync: () => '', environment: {} });
  await assert.rejects(missing.sendMessage('thread', 'text'), (error) => error.statusCode === 503);

  const scenarios = [
    {
      expected: /init denied/,
      make: () => childProcess((line, child) => { if (JSON.parse(line).id === 1) child.stdout.write('{"id":1,"error":{"message":"init denied"}}\n'); }),
    },
    {
      expected: /连接失败/,
      make: () => childProcess((line, child) => { if (JSON.parse(line).id === 1) child.stdout.write('{"id":1,"error":{}}\n'); }),
    },
    {
      expected: /tool denied/,
      make: () => childProcess((line, child) => {
        const message = JSON.parse(line);
        if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
        if (message.id === 2) child.stdout.write('{"id":2,"error":{"message":"tool denied"}}\n');
      }),
    },
    {
      expected: /Codex 桌面端消息发送失败/,
      make: () => childProcess((line, child) => {
        const message = JSON.parse(line);
        if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
        if (message.id === 2) child.stdout.write('{"id":2,"error":{}}\n');
      }),
    },
    {
      expected: /send rejected/,
      make: () => childProcess((line, child) => {
        const message = JSON.parse(line);
        if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
        if (message.id === 2) child.stdout.write('{"id":2,"result":{"isError":true,"content":[{"text":"send rejected"},{"type":"text"}]}}\n');
      }),
    },
    {
      expected: /Codex 拒绝了这条消息/,
      make: () => childProcess((line, child) => {
        const message = JSON.parse(line);
        if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
        if (message.id === 2) child.stdout.write('{"id":2,"result":{"isError":true}}\n');
      }),
    },
    {
      expected: /spawn failed/,
      make: () => { const child = childProcess(); delete child.kill; queueMicrotask(() => child.emit('error', new Error('spawn failed'))); return child; },
    },
    {
      expected: /stdin failed/,
      make: () => { const child = childProcess(); queueMicrotask(() => child.stdin.emit('error', new Error('stdin failed'))); return child; },
    },
    {
      expected: /desktop exited/,
      make: () => { const child = childProcess(); queueMicrotask(() => { child.stderr.write('desktop exited'); child.emit('exit', 2); }); return child; },
    },
    {
      expected: /未知/,
      make: () => { const child = childProcess(); queueMicrotask(() => child.emit('exit', null)); return child; },
    },
  ];
  for (const scenario of scenarios) {
    const client = new CodexAppToolsClient({ pipePath: '/tmp/codex.sock', spawn: scenario.make, timeoutMs: 100 });
    await assert.rejects(client.sendMessage('thread', 'text'), scenario.expected);
  }

  let timeoutCallback;
  let cleared = false;
  const timeoutChild = childProcess();
  const timeout = new CodexAppToolsClient({
    pipePath: '/tmp/codex.sock',
    spawn: () => timeoutChild,
    setTimer: (callback) => { timeoutCallback = callback; return 11; },
    clearTimer: (id) => { assert.equal(id, 11); cleared = true; },
  });
  const pending = timeout.sendMessage('thread', 'text');
  timeoutCallback();
  await assert.rejects(pending, (error) => error.statusCode === 504);
  assert.equal(cleared, true);
  assert.equal(timeoutChild.killed, true);
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

  const deniedSteer = new CodexControlClient({ spawn: () => childProcess((line, child) => {
    const message = JSON.parse(line);
    if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
    if (message.id === 2) child.stdout.write('{"id":2,"error":{"message":"turn active-1 not found"}}\n');
  }) });
  await assert.rejects(deniedSteer.steer('thread-1', 'active-1', 'message'), /执行回合已经变化/);

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
  assert.match(controlProtocolError('thread 123 not found', 'fallback').message, /找不到该任务/);
  assert.match(controlProtocolError('turn 456 not found', 'fallback').message, /执行回合已经变化/);
  assert.match(controlProtocolError('expected active turn abc', 'fallback').message, /执行回合已经变化/);
  assert.equal(controlProtocolError('', 'fallback', 502).statusCode, 502);
  assert.equal(controlProtocolError('', 'fallback', 502).message, 'fallback');
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
