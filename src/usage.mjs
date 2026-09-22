import { spawn as nodeSpawn } from 'node:child_process';

export function usageWindowLabel(minutes) {
  const value = Number(minutes || 0);
  if (value === 10_080) return '周';
  if (value < 60) return `${value} 分钟`;
  if (value < 1_440) return `${Math.round(value / 60)} 小时`;
  return `${Math.round(value / 1_440)} 天`;
}

export function normalizeUsage(result, updatedAt = Date.now()) {
  const buckets = result?.rateLimitsByLimitId || {};
  const bucket = buckets.codex || result?.rateLimits || Object.values(buckets)[0] || null;
  if (!bucket) return { available: false, planType: null, limits: [], updatedAt };
  const limits = [bucket.primary, bucket.secondary].filter(Boolean).map((window, index) => ({
    id: index === 0 ? 'primary' : 'secondary',
    label: usageWindowLabel(window.windowDurationMins),
    usedPercent: Number(window.usedPercent || 0),
    remainingPercent: Math.max(0, Math.min(100, 100 - Number(window.usedPercent || 0))),
    resetsAt: Number(window.resetsAt || 0) * 1000,
    windowDurationMins: Number(window.windowDurationMins || 0),
  }));
  return { available: limits.length > 0, planType: bucket.planType || null, limits, updatedAt };
}

export function createUsageReader({
  request = requestRateLimits,
  now = () => Date.now(),
  ttlMs = 60_000,
} = {}) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  return async () => {
    const timestamp = now();
    if (cached && timestamp < expiresAt) return cached;
    if (!pending) {
      pending = Promise.resolve(request()).then((result) => {
        cached = normalizeUsage(result, now());
        expiresAt = now() + ttlMs;
        return cached;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}

export function requestRateLimits({
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
    const timer = setTimeout(() => finish(new Error('读取 Codex 用量超时')), timeoutMs);
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
        if (message.error) finish(new Error(message.error.message || 'Codex 用量读取失败'));
        else finish(null, message.result || {});
      }
    });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => finish(error));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex App Server 已退出（${code}）`));
    });
    try {
      child.stdin.write(`${JSON.stringify({ method: 'initialize', id: 0, params: { clientInfo: { name: 'codex_mobile_task_console', title: 'Codex 掌上任务台', version: '1.0.0' } } })}\n`);
      child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
      child.stdin.write(`${JSON.stringify({ method: 'account/rateLimits/read', id: 2, params: {} })}\n`);
    } catch (error) {
      finish(error);
    }
  });
}
