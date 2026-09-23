import { spawn as nodeSpawn } from 'node:child_process';

const MAX_ACCOUNT_NAME_LENGTH = 48;
const UNSAFE_ACCOUNT_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

export function accountNameFromEmail(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  const separator = email.indexOf('@');
  if (separator <= 0) return '';
  const localPart = email.slice(0, separator).normalize('NFKC')
    .replace(UNSAFE_ACCOUNT_CHARACTERS, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return [...localPart].slice(0, MAX_ACCOUNT_NAME_LENGTH).join('');
}

export function normalizeAccount(result) {
  const name = accountNameFromEmail(result?.account?.email);
  if (!name) return { available: false, name: null, initial: null };
  const initial = [...name.toLocaleUpperCase('en-US')][0];
  return { available: true, name, initial };
}

export function createAccountReader({
  request = requestAccount,
  now = () => Date.now(),
  ttlMs = 5 * 60_000,
} = {}) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  return async () => {
    const timestamp = now();
    if (cached && timestamp < expiresAt) return cached;
    if (!pending) {
      pending = Promise.resolve(request()).then((result) => {
        cached = normalizeAccount(result);
        expiresAt = now() + ttlMs;
        return cached;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}

export function requestAccount({
  codexBin = 'codex',
  spawnProcess = nodeSpawn,
  timeoutMs = 8_000,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(codexBin, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    let buffer = '';
    let stderr = '';
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.kill) child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('读取 Codex 账号超时')), timeoutMs);
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      for (;;) {
        const boundary = buffer.indexOf('\n');
        if (boundary < 0) break;
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== 2) continue;
        if (message.error) finish(new Error(message.error.message || 'Codex 账号读取失败'));
        else finish(null, message.result || {});
      }
    });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => finish(error));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex App Server 已退出（${code}）`));
    });
    try {
      child.stdin.write(`${JSON.stringify({ method: 'initialize', id: 0, params: { clientInfo: { name: 'codex_local_hub', title: 'Codex Lookout', version: '1.0.0' } } })}\n`);
      child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
      child.stdin.write(`${JSON.stringify({ method: 'account/read', id: 2, params: {} })}\n`);
    } catch (error) {
      finish(error);
    }
  });
}
