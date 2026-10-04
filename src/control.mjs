import { execFileSync as nodeExecFileSync, spawn as nodeSpawn } from 'node:child_process';
import { existsSync as nodeExistsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const APP_TOOLS_SERVER = join('plugins', 'openai-bundled', 'plugins', 'codex-app-tools', 'server.mjs');

export function codexResourcesDirectory(codexBin) {
  const normalized = String(codexBin || '');
  const marker = '/Contents/Resources/';
  const boundary = normalized.indexOf(marker);
  return boundary >= 0 ? normalized.slice(0, boundary + marker.length - 1) : dirname(normalized);
}

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
    timeoutMs = 60_000,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    const resources = codexResourcesDirectory(codexBin);
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
    this.failedPipes = new Set();
  }

  async sendMessage(threadId, text) {
    const result = await this.callToolWithRetry(
      'send_message_to_thread',
      { threadId, prompt: text },
      threadId,
      'delivery',
    );
    return { accepted: true, mode: 'continued', via: 'codex-app', result };
  }

  async archiveThread(threadId) {
    const result = await this.callToolWithRetry(
      'set_thread_archived',
      { threadId, archived: true },
      threadId,
      'archive',
    );
    return { archived: true, threadId, via: 'codex-app', result };
  }

  async callToolWithRetry(toolName, toolArguments, interactionThreadId, operation = 'delivery') {
    try {
      return await this.callToolOnce(toolName, toolArguments, interactionThreadId, operation);
    } catch (error) {
      if (error.code === 'DELIVERY_STATUS_UNKNOWN') throw error;
      if (error.transportCode !== 'PIPE_CLOSED' && !/pipe closed|ENOENT|ECONNREFUSED|socket hang up/i.test(error.message)) throw error;
      if (this.pipePath) this.failedPipes.add(this.pipePath);
      this.pipePath = '';
      return this.callToolOnce(toolName, toolArguments, interactionThreadId, operation);
    }
  }

  callToolOnce(toolName, toolArguments, interactionThreadId, operation = 'delivery') {
    return new Promise((resolve, reject) => {
      const policy = appToolPolicy(operation);
      const pipePath = discoverAppToolsPipe({
        configured: this.pipePath || this.environment.CODEX_APP_TOOLS_PIPE_PATH || '',
        execFileSync: this.execFileSync,
        existsSync: this.existsSync,
        excludedPaths: this.failedPipes,
      });
      if (!pipePath) {
        reject(policy.unavailable());
        return;
      }
      this.pipePath = pipePath;
      const interactionId = this.environment.CODEX_THREAD_ID || this.environment.CODEX_SESSION_ID || interactionThreadId;
      const child = this.spawn(
        this.nodeBin,
        [this.serverPath, '--interaction-client-id', interactionId],
        { stdio: ['pipe', 'pipe', 'pipe'], env: { ...this.environment, CODEX_APP_TOOLS_PIPE_PATH: pipePath } },
      );
      let buffer = '';
      let stderr = '';
      let settled = false;
      let toolRequested = false;
      const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
      const transportError = (detail, fallback) => policy.uncertainAfterRequest && toolRequested
        ? policy.statusUnknown(detail)
        : appToolsError(detail, fallback, policy.unavailable);
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        this.clearTimer(timer);
        child.stdin.end();
        child.kill?.();
        if (error) reject(error);
        else resolve(result);
      };
      const timer = this.setTimer(() => finish(policy.uncertainAfterRequest && toolRequested
        ? policy.statusUnknown(policy.pendingTimeout)
        : Object.assign(new Error(policy.timeout), { statusCode: 504 })), this.timeoutMs);

      child.stdin.on('error', (error) => finish(transportError(error.message)));
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.id === 1) {
            if (message.error) return finish(appToolsError(message.error.message, 'Codex 桌面端连接失败', policy.unavailable));
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            toolRequested = true;
            send({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name: toolName, arguments: toolArguments },
            });
          }
          if (message.id === 2) {
            if (message.error) return finish(appToolsError(message.error.message, policy.failed, policy.unavailable));
            if (message.result?.isError) {
              const detail = message.result.content?.map((item) => item.text).filter(Boolean).join('\n');
              return finish(appToolsError(detail, policy.rejected, policy.unavailable));
            }
            finish(null, message.result);
          }
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => finish(transportError(error.message)));
      child.on('exit', (code) => {
        if (!settled) finish(transportError(stderr, `${policy.exit}（${code ?? '未知'}）`));
      });
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'codex-local-hub', version: '0.2.47' },
        },
      });
    });
  }
}

export function discoverAppToolsPipe({
  configured = process.env.CODEX_APP_TOOLS_PIPE_PATH || '',
  execFileSync = nodeExecFileSync,
  existsSync = nodeExistsSync,
  excludedPaths = new Set(),
} = {}) {
  const configuredPath = configured.trim();
  const usable = (path) => path
    && !path.includes('/codex-browser-use/')
    && !excludedPaths.has(path)
    && existsSync(path);
  if (usable(configuredPath)) return configuredPath;
  try {
    const processes = String(execFileSync('/bin/ps', ['eww', '-ax'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
    const candidates = [...processes.matchAll(/CODEX_APP_TOOLS_PIPE_PATH=([^\s]+)/g)].map((match) => match[1]);
    return candidates.reverse().find(usable) || '';
  } catch {
    return '';
  }
}

export function desktopControlUnavailable() {
  return Object.assign(new Error('Codex Desktop 当前不接受外部后续消息；消息仍保留在队列中'), {
    statusCode: 503,
    code: 'DESKTOP_CONTROL_UNAVAILABLE',
  });
}

export function desktopArchiveUnavailable() {
  return Object.assign(new Error('Codex Desktop 当前不接受外部归档，请刷新后重试'), {
    statusCode: 503,
    code: 'DESKTOP_ARCHIVE_UNAVAILABLE',
  });
}

export function appToolsError(detail, fallback = 'Codex 桌面端消息发送失败', unavailable = desktopControlUnavailable) {
  const message = String(detail || '').trim();
  if (/Codex app tools pipe closed/i.test(message)) {
    return Object.assign(unavailable(), { transportCode: 'PIPE_CLOSED' });
  }
  return Object.assign(new Error(message || fallback), { statusCode: 502 });
}

export function deliveryStatusUnknown(detail = '') {
  const reason = String(detail || '').trim();
  return Object.assign(new Error(`${reason ? `${reason}；` : ''}正在核对是否已送达，消息暂时保留在队列中`), {
    statusCode: 504,
    code: 'DELIVERY_STATUS_UNKNOWN',
  });
}

function appToolPolicy(operation) {
  if (operation === 'archive') return {
    unavailable: desktopArchiveUnavailable,
    uncertainAfterRequest: false,
    statusUnknown: deliveryStatusUnknown,
    pendingTimeout: '',
    timeout: 'Codex 桌面端归档超时，请刷新后确认任务状态',
    failed: 'Codex 桌面端归档失败',
    rejected: 'Codex 拒绝归档该任务',
    exit: 'Codex 桌面端归档通道退出',
  };
  return {
    unavailable: desktopControlUnavailable,
    uncertainAfterRequest: true,
    statusUnknown: deliveryStatusUnknown,
    pendingTimeout: 'Codex 桌面端仍在确认接收',
    timeout: 'Codex 桌面端连接超时；排队消息仍保留',
    failed: 'Codex 桌面端消息发送失败',
    rejected: 'Codex 拒绝了这条消息',
    exit: 'Codex 桌面端消息通道退出',
  };
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
  }

  resume(threadId, text) {
    if (!this.appTools) return Promise.reject(desktopControlUnavailable());
    return this.appTools.sendMessage(threadId, text);
  }

  async start(threadId, text) {
    const results = await this.callSequence([
      { method: 'thread/resume', params: { threadId } },
      { method: 'turn/start', params: { threadId, input: [{ type: 'text', text }] } },
    ], { keepAlive: true });
    return results.at(-1);
  }

  async archiveThread(threadId) {
    if (this.appTools) {
      try {
        return await this.appTools.archiveThread(threadId);
      } catch (error) {
        if (error.code !== 'DESKTOP_ARCHIVE_UNAVAILABLE'
          && error.code !== 'DESKTOP_CONTROL_UNAVAILABLE'
          && error.transportCode !== 'PIPE_CLOSED') throw error;
      }
    }
    return this.call('thread/archive', { threadId });
  }

  interruptTurn(threadId, turnId) {
    return this.call('turn/interrupt', { threadId, turnId });
  }

  deleteProject(projectId) {
    return this.call('project/delete', { projectId });
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
      const requestAt = (index) => {
        const request = requests[index];
        return typeof request === 'function' ? request(results) : request;
      };
      const sendRequest = (index) => {
        try {
          send({ id: index + 2, ...requestAt(index) });
        } catch (error) {
          finish(error);
        }
      };
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
            sendRequest(0);
          }
          const requestIndex = Number(message.id) - 2;
          if (requestIndex >= 0 && requestIndex < requests.length) {
            if (message.error) return finish(controlProtocolError(message.error.message, 'Codex 控制失败'));
            results[requestIndex] = message.result;
            if (requestIndex === requests.length - 1) {
              finish(null, results);
              continue;
            }
            sendRequest(requestIndex + 1);
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
        params: {
          clientInfo: { name: 'codex-pocket-dashboard', title: 'Codex Lookout', version: '0.2.47' },
          capabilities: { experimentalApi: true },
        },
      });
    });
  }
}

export function controlProtocolError(detail, fallback, statusCode = 409) {
  const message = String(detail || '').trim();
  if (/already has an active writer/i.test(message)) {
    return Object.assign(new Error('Codex Desktop 正在写入该任务，操作通道暂时冲突；请稍后重试'), {
      statusCode: 409,
      code: 'ACTIVE_WRITER',
    });
  }
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
    return Object.assign(new Error('当前任务由 ChatGPT 桌面端执行，尚未开放外部控制通道；消息仍保留在队列中'), { statusCode: 503 });
  }
  return Object.assign(new Error(message || `Codex 控制进程退出（${code ?? '未知'}）`), { statusCode: 502 });
}
