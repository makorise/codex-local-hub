import { spawn as nodeSpawn } from 'node:child_process';
import { createReadStream as nodeCreateReadStream } from 'node:fs';
import { mkdir as nodeMkdir, readFile as nodeReadFile, rename as nodeRename, unlink as nodeUnlink, writeFile as nodeWriteFile } from 'node:fs/promises';
import { readdir as nodeReaddir, stat as nodeStat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const WEEK_MINUTES = 10_080;
const HISTORY_DAYS = 7;
const RESET_TOLERANCE_MS = 60 * 60_000;
const TOKEN_LINE_LIMIT = 256 * 1024;
const TOKEN_FIELDS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'];
const TOKEN_SOURCE_FIELDS = {
  inputTokens: 'input_tokens',
  cachedInputTokens: 'cached_input_tokens',
  outputTokens: 'output_tokens',
  reasoningOutputTokens: 'reasoning_output_tokens',
  totalTokens: 'total_tokens',
};

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

export function localDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function emptyTodayTokenUsage(timestamp = Date.now()) {
  return {
    available: false,
    recorded: false,
    date: localDateKey(timestamp),
    eventCount: 0,
    fileCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

export function addTokenCountLine(summary, line, date = summary.date) {
  if (!line.includes('"token_count"')) return summary;
  let event;
  try { event = JSON.parse(line); } catch { return summary; }
  if (event?.type !== 'event_msg' || event.payload?.type !== 'token_count') return summary;
  const timestamp = Date.parse(event.timestamp);
  if (!Number.isFinite(timestamp) || localDateKey(timestamp) !== date) return summary;
  const usage = event.payload.info?.last_token_usage;
  if (!usage || typeof usage !== 'object') return summary;
  for (const field of TOKEN_FIELDS) {
    const value = Number(usage[TOKEN_SOURCE_FIELDS[field]]);
    if (Number.isFinite(value) && value > 0) summary[field] += value;
  }
  summary.eventCount += 1;
  summary.recorded = true;
  return summary;
}

export async function scanTokenRollout(path, summary, {
  createReadStream = nodeCreateReadStream,
  lineLimit = TOKEN_LINE_LIMIT,
} = {}) {
  const stream = createReadStream(path, { encoding: 'utf8' });
  let carry = '';
  let skipping = false;
  for await (const chunk of stream) {
    const parts = String(chunk).split('\n');
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (skipping) skipping = false;
      else addTokenCountLine(summary, carry + parts[index]);
      carry = '';
    }
    if (skipping) continue;
    carry += parts.at(-1);
    if (carry.length > lineLimit && !carry.includes('"token_count"')) {
      carry = '';
      skipping = true;
    }
  }
  if (!skipping && carry) addTokenCountLine(summary, carry);
  return summary;
}

export async function findModifiedRollouts(directory, since, {
  readdir = nodeReaddir,
  stat = nodeStat,
} = {}) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findModifiedRollouts(path, since, { readdir, stat }));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const details = await stat(path);
        if (details.mtimeMs >= since) files.push(path);
      } catch { /* A rollout can disappear while Codex rotates its files. */ }
    }
  }
  return files;
}

export function createTodayTokenReader({
  sessionsDir,
  now = () => Date.now(),
  findRollouts = findModifiedRollouts,
  scanRollout = scanTokenRollout,
} = {}) {
  return async () => {
    const timestamp = now();
    const start = new Date(timestamp);
    start.setHours(0, 0, 0, 0);
    const summary = emptyTodayTokenUsage(timestamp);
    const files = await findRollouts(sessionsDir, start.getTime());
    summary.available = true;
    summary.fileCount = files.length;
    for (const path of files) await scanRollout(path, summary);
    return summary;
  };
}

export function recentUsageDays(timestamp = Date.now(), count = HISTORY_DAYS) {
  const anchor = new Date(timestamp);
  anchor.setHours(12, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() - (count - index - 1));
    return { date: localDateKey(date.getTime()), usedPercent: 0, observed: false };
  });
}

export function normalizeUsageHistoryState(value) {
  const days = value?.days && typeof value.days === 'object' && !Array.isArray(value.days) ? value.days : {};
  const normalizedDays = {};
  for (const [date, entry] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) continue;
    const usedPercent = Number(entry?.usedPercent);
    if (!Number.isFinite(usedPercent) || usedPercent < 0) continue;
    normalizedDays[date] = { usedPercent, observed: entry?.observed === true };
  }
  const lastUsedPercent = value?.lastUsedPercent === null || value?.lastUsedPercent === undefined ? Number.NaN : Number(value.lastUsedPercent);
  const lastResetsAt = value?.lastResetsAt === null || value?.lastResetsAt === undefined ? Number.NaN : Number(value.lastResetsAt);
  return {
    schemaVersion: 1,
    lastUsedPercent: Number.isFinite(lastUsedPercent) && lastUsedPercent >= 0 ? lastUsedPercent : null,
    lastResetsAt: Number.isFinite(lastResetsAt) && lastResetsAt > 0 ? lastResetsAt : null,
    days: normalizedDays,
  };
}

export function updateUsageHistory(stateValue, usage, timestamp = Date.now()) {
  const state = normalizeUsageHistoryState(stateValue);
  const recent = recentUsageDays(timestamp);
  const allowed = new Set(recent.map((day) => day.date));
  state.days = Object.fromEntries(Object.entries(state.days).filter(([date]) => allowed.has(date)));
  const weekly = usage?.limits?.find((limit) => Number(limit.windowDurationMins) === WEEK_MINUTES);
  if (!weekly) return { state, days: recent.map((day) => ({ ...day, ...state.days[day.date] })) };

  const usedPercent = Math.max(0, Number(weekly.usedPercent) || 0);
  const resetsAt = Math.max(0, Number(weekly.resetsAt) || 0);
  let delta = 0;
  if (state.lastUsedPercent !== null) {
    const sameWindow = state.lastResetsAt === null || resetsAt === 0
      || Math.abs(resetsAt - state.lastResetsAt) <= RESET_TOLERANCE_MS;
    if (sameWindow && usedPercent >= state.lastUsedPercent) delta = usedPercent - state.lastUsedPercent;
    else if (!sameWindow) delta = usedPercent;
  }
  const today = localDateKey(timestamp);
  const existing = state.days[today] || { usedPercent: 0, observed: false };
  state.days[today] = { usedPercent: existing.usedPercent + delta, observed: true };
  const sameOrNewerWindow = state.lastUsedPercent === null || state.lastResetsAt === null || resetsAt === 0
    || Math.abs(resetsAt - state.lastResetsAt) > RESET_TOLERANCE_MS || usedPercent >= state.lastUsedPercent;
  if (sameOrNewerWindow) {
    state.lastUsedPercent = usedPercent;
    state.lastResetsAt = resetsAt || state.lastResetsAt;
  }
  return { state, days: recent.map((day) => ({ ...day, ...state.days[day.date] })) };
}

export function createUsageHistoryStore({
  path,
  now = () => Date.now(),
  readFile = nodeReadFile,
  writeFile = nodeWriteFile,
  mkdir = nodeMkdir,
  rename = nodeRename,
  unlink = nodeUnlink,
} = {}) {
  let state = null;
  let pending = Promise.resolve();
  async function load() {
    if (state) return state;
    try { state = normalizeUsageHistoryState(JSON.parse(await readFile(path, 'utf8'))); }
    catch { state = normalizeUsageHistoryState(null); }
    return state;
  }
  async function recordNow(usage) {
    const current = await load();
    const updated = updateUsageHistory(current, usage, now());
    state = updated.state;
    const temporary = `${path}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      await rename(temporary, path);
    } catch {
      try { await unlink(temporary); } catch { /* Temporary file may not exist. */ }
    }
    return updated.days;
  }
  return {
    record(usage) {
      const operation = pending.then(() => recordNow(usage), () => recordNow(usage));
      pending = operation;
      return operation;
    },
  };
}

export function createUsageReader({
  request = requestRateLimits,
  historyStore = { record: async () => [] },
  todayTokenReader = async () => emptyTodayTokenUsage(),
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
      pending = Promise.resolve(request()).then(async (result) => {
        cached = normalizeUsage(result, now());
        try { cached.dailyUsage = await historyStore.record(cached); }
        catch { cached.dailyUsage = []; }
        try { cached.todayTokens = await todayTokenReader(); }
        catch { cached.todayTokens = emptyTodayTokenUsage(now()); }
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
      child.stdin.write(`${JSON.stringify({ method: 'initialize', id: 0, params: { clientInfo: { name: 'codex_mobile_task_console', title: 'Codex Lookout', version: '1.0.0' } } })}\n`);
      child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
      child.stdin.write(`${JSON.stringify({ method: 'account/rateLimits/read', id: 2, params: {} })}\n`);
    } catch (error) {
      finish(error);
    }
  });
}
