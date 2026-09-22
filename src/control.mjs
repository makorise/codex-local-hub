import { spawn as nodeSpawn } from 'node:child_process';

export class CodexControlClient {
  constructor({ codexBin = 'codex', socketPath = '', spawn = nodeSpawn, timeoutMs = 15_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.codexBin = codexBin;
    this.socketPath = socketPath;
    this.spawn = spawn;
    this.timeoutMs = timeoutMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.runs = new Set();
  }

  steer(threadId, expectedTurnId, text) {
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
            if (message.error) return finish(Object.assign(new Error(message.error.message || 'Codex 初始化失败'), { statusCode: 502 }));
            send({ method: 'initialized', params: {} });
            send({ id: 2, ...requests[0] });
          }
          const requestIndex = Number(message.id) - 2;
          if (requestIndex >= 0 && requestIndex < requests.length) {
            if (message.error) return finish(Object.assign(new Error(message.error.message || 'Codex 控制失败'), { statusCode: 409 }));
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

export function controlProcessError(detail, code) {
  const message = String(detail || '').trim();
  if (/failed to connect to socket|no such file or directory/i.test(message)) {
    return Object.assign(new Error('当前任务由 ChatGPT 桌面端执行，尚未开放 steer 控制通道；消息仍保留在队列中'), { statusCode: 503 });
  }
  return Object.assign(new Error(message || `Codex 控制进程退出（${code ?? '未知'}）`), { statusCode: 502 });
}
