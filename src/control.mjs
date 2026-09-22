import { execFileSync as nodeExecFileSync, spawn as nodeSpawn } from 'node:child_process';
import { existsSync as nodeExistsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const APP_TOOLS_SERVER = join('plugins', 'openai-bundled', 'plugins', 'codex-app-tools', 'server.mjs');

export class CodexAppToolsClient {
  constructor({
    codexBin = '/Applications/ChatGPT.app/Contents/Resources/codex',
    pipePath = '',
    nodeBin = '',
    serverPath = '',
    spawn = nodeSpawn,
    execFileSync = nodeExecFileSync,
    existsSync = nodeExistsSync,
    environment = process.env,
    timeoutMs = 15_000,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    const resources = dirname(codexBin);
    this.pipePath = pipePath;
    this.nodeBin = nodeBin || join(resources, 'cua_node', 'bin', 'node');
    this.serverPath = serverPath || join(resources, APP_TOOLS_SERVER);
    this.spawn = spawn;
    this.execFileSync = execFileSync;
    this.existsSync = existsSync;
    this.environment = environment;
    this.timeoutMs = timeoutMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  async sendMessage(threadId, text) {
    try {
      return await this.sendMessageOnce(threadId, text);
    } catch (error) {
      if (!/pipe closed|ENOENT|ECONNREFUSED|socket hang up/i.test(error.message)) throw error;
      this.pipePath = '';
      return this.sendMessageOnce(threadId, text);
    }
  }

  sendMessageOnce(threadId, text) {
    return new Promise((resolve, reject) => {
      const pipePath = this.pipePath || discoverAppToolsPipe({
        configured: this.environment.CODEX_APP_TOOLS_PIPE_PATH || '',
        execFileSync: this.execFileSync,
        existsSync: this.existsSync,
      });
      if (!pipePath) {
        reject(Object.assign(new Error('未找到 Codex 桌面端消息通道；请确认 Codex 正在运行，排队消息仍保留'), { statusCode: 503 }));
        return;
      }
      this.pipePath = pipePath;
      const interactionThreadId = this.environment.CODEX_THREAD_ID || this.environment.CODEX_SESSION_ID || threadId;
      const child = this.spawn(
        this.nodeBin,
        [this.serverPath, '--interaction-client-id', interactionThreadId],
        { stdio: ['pipe', 'pipe', 'pipe'], env: { ...this.environment, CODEX_APP_TOOLS_PIPE_PATH: pipePath } },
      );
      let buffer = '';
      let stderr = '';
      let settled = false;
      const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        this.clearTimer(timer);
        child.stdin.end();
        child.kill?.();
        if (error) reject(error);
        else resolve(result);
      };
      const timer = this.setTimer(() => finish(Object.assign(new Error('Codex 桌面端响应超时；排队消息仍保留'), { statusCode: 504 })), this.timeoutMs);

      child.stdin.on('error', (error) => finish(appToolsError(error.message)));
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.id === 1) {
            if (message.error) return finish(appToolsError(message.error.message, 'Codex 桌面端连接失败'));
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name: 'send_message_to_thread', arguments: { threadId, prompt: text } },
            });
          }
          if (message.id === 2) {
            if (message.error) return finish(appToolsError(message.error.message));
            if (message.result?.isError) {
              const detail = message.result.content?.map((item) => item.text).filter(Boolean).join('\n');
              return finish(appToolsError(detail, 'Codex 拒绝了这条消息'));
            }
            finish(null, { accepted: true, mode: 'steered', via: 'codex-app', result: message.result });
          }
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => finish(appToolsError(error.message)));
      child.on('exit', (code) => {
        if (!settled) finish(appToolsError(stderr, `Codex 桌面端消息通道退出（${code ?? '未知'}）`));
      });
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'codex-local-hub', version: '0.2.7' },
        },
      });
    });
  }
}

export function discoverAppToolsPipe({
  configured = process.env.CODEX_APP_TOOLS_PIPE_PATH || '',
  execFileSync = nodeExecFileSync,
  existsSync = nodeExistsSync,
} = {}) {
  const configuredPath = configured.trim();
  if (configuredPath && existsSync(configuredPath)) return configuredPath;
  try {
    const processes = String(execFileSync('/bin/ps', ['eww', '-ax'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
    return [...processes.matchAll(/CODEX_APP_TOOLS_PIPE_PATH=([^\s]+)/g)].at(-1)?.[1] || '';
  } catch {
    return '';
  }
}

export function appToolsError(detail, fallback = 'Codex 桌面端消息发送失败') {
  const message = String(detail || '').trim();
  return Object.assign(new Error(message || fallback), { statusCode: 502 });
}

export class CodexControlClient {
  constructor({ codexBin = 'codex', socketPath = '', appTools = null, spawn = nodeSpawn, timeoutMs = 15_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.codexBin = codexBin;
    this.socketPath = socketPath;
    this.appTools = appTools;
    this.spawn = spawn;
    this.timeoutMs = timeoutMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.runs = new Set();
  }

  steer(threadId, expectedTurnId, text) {
    if (this.appTools) return this.appTools.sendMessage(threadId, text);
    return this.call('turn/steer', {
      threadId,
      input: [{ type: 'text', text }],
      expectedTurnId,
    });
  }

  resume(threadId, text, cwd) {
    return new Promise((resolve, reject) => {
      const args = ['exec', 'resume', '--json', threadId, text];
      const options = { stdio: ['ignore', 'pipe', 'pipe'] };
      if (cwd) options.cwd = cwd;
      const child = this.spawn(this.codexBin, args, options);
      this.runs.add(child);
      let buffer = '';
      let stderr = '';
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        this.clearTimer(timer);
        if (error) {
          child.kill?.();
          reject(error);
        } else {
          resolve(result);
        }
      };
      const timer = this.setTimer(() => finish(Object.assign(new Error('Codex 任务启动超时；消息仍保留在队列中'), { statusCode: 504 })), this.timeoutMs);
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === 'turn.started') finish(null, { accepted: true, threadId });
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => finish(controlProcessError(error.message, null)));
      child.on('exit', (code) => {
        this.runs.delete(child);
        if (!settled) finish(controlProcessError(stderr, code));
      });
    });
  }

  async start(threadId, text) {
    const results = await this.callSequence([
      { method: 'thread/resume', params: { threadId } },
      { method: 'turn/start', params: { threadId, input: [{ type: 'text', text }] } },
    ], { keepAlive: true });
    return results.at(-1);
  }

  call(method, params) {
    return this.callSequence([{ method, params }]).then(([result]) => result);
  }

  callSequence(requests, { keepAlive = false } = {}) {
    if (!requests.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const args = this.socketPath
        ? ['app-server', 'proxy', '--sock', this.socketPath]
        : ['app-server', '--listen', 'stdio://'];
      const child = this.spawn(this.codexBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '';
      let stderr = '';
      let settled = false;
      const results = [];
      const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
      const shutdown = () => {
        child.stdin.end();
        child.kill?.();
      };
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        this.clearTimer(timer);
        if (error || !keepAlive) shutdown();
        if (error) reject(error);
        else resolve(result);
      };
      const timer = this.setTimer(() => finish(Object.assign(new Error('Codex 控制连接超时；消息仍保留在队列中'), { statusCode: 504 })), this.timeoutMs);

      child.stdin.on('error', (error) => finish(controlProcessError(error.message, null)));

      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (keepAlive && settled && message.method === 'turn/completed') {
            shutdown();
            continue;
          }
          if (message.id === 1) {
            if (message.error) return finish(controlProtocolError(message.error.message, 'Codex 初始化失败', 502));
            send({ method: 'initialized', params: {} });
            send({ id: 2, ...requests[0] });
          }
          const requestIndex = Number(message.id) - 2;
          if (requestIndex >= 0 && requestIndex < requests.length) {
            if (message.error) return finish(controlProtocolError(message.error.message, 'Codex 控制失败'));
            results[requestIndex] = message.result;
            if (requestIndex === requests.length - 1) {
              finish(null, results);
              continue;
            }
            send({ id: requestIndex + 3, ...requests[requestIndex + 1] });
          }
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => finish(controlProcessError(error.message, null)));
      child.on('exit', (code) => {
        if (!settled) finish(controlProcessError(stderr, code));
      });
      send({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'codex-pocket-dashboard', title: 'Codex 掌上任务台', version: '0.2.0' } },
      });
    });
  }
}

export function controlProtocolError(detail, fallback, statusCode = 409) {
  const message = String(detail || '').trim();
  if (/thread(?:\s+\S+)?\s+not found|thread not found/i.test(message)) {
    return Object.assign(new Error('找不到该任务，请刷新任务列表后重试；排队消息仍保留'), { statusCode: 409 });
  }
  if (/turn(?:\s+\S+)?\s+not found|expected.*turn|active turn/i.test(message)) {
    return Object.assign(new Error('当前执行回合已经变化，请刷新后重试；排队消息仍保留'), { statusCode: 409 });
  }
  return Object.assign(new Error(message || fallback), { statusCode });
}

export function controlProcessError(detail, code) {
  const message = String(detail || '').trim();
  if (/failed to connect to socket|no such file or directory/i.test(message)) {
    return Object.assign(new Error('当前任务由 ChatGPT 桌面端执行，尚未开放 steer 控制通道；消息仍保留在队列中'), { statusCode: 503 });
  }
  return Object.assign(new Error(message || `Codex 控制进程退出（${code ?? '未知'}）`), { statusCode: 502 });
}
