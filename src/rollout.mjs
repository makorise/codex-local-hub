import { open, stat as nodeStat } from 'node:fs/promises';
import { cleanUserMessage, extractMessageText, isInternalMessage } from './core.mjs';

const DEFAULT_LIMIT = 8 * 1024 * 1024;

export function parseRolloutLines(lines, maxMessages = 20) {
  const snapshot = {
    lifecycle: null,
    latestUser: '',
    latestAssistant: '',
    lastActivityType: null,
    lastActivityAt: 0,
    messages: [],
  };

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const timestamp = Date.parse(entry.timestamp ?? '') || 0;
    snapshot.lastActivityAt = Math.max(snapshot.lastActivityAt, timestamp);
    const payload = entry.payload ?? {};
    if (entry.type === 'event_msg') {
      if (['task_started', 'task_complete', 'turn_aborted'].includes(payload.type)) snapshot.lifecycle = payload.type;
      if (payload.type === 'item_started' || payload.type === 'item_completed') {
        snapshot.lastActivityType = String(payload.item?.type ?? '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
      }
    }
    if (entry.type !== 'response_item' || payload.type !== 'message') continue;
    let text = extractMessageText(payload.content);
    const role = payload.role || payload.content?.[0]?.type;
    if (role === 'user' || role === 'input_text') {
      text = cleanUserMessage(text);
      if (isInternalMessage(text)) continue;
      snapshot.latestUser = text;
      snapshot.messages.push({ id: payload.id || `${timestamp}-user`, role: 'user', text, timestamp });
    }
    if (role === 'assistant' || role === 'output_text') {
      if (isInternalMessage(text)) continue;
      snapshot.latestAssistant = text;
      snapshot.messages.push({ id: payload.id || `${timestamp}-assistant`, role: 'assistant', text, timestamp });
    }
  }
  snapshot.messages = snapshot.messages.slice(-maxMessages);
  return snapshot;
}

export async function readTail(path, maxBytes = DEFAULT_LIMIT) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, stat.size - length);
    let text = buffer.toString('utf8');
    if (stat.size > length) text = text.slice(text.indexOf('\n') + 1);
    return { text, mtimeMs: stat.mtimeMs };
  } finally {
    await file.close();
  }
}

export async function readRolloutSnapshot(path, read = readTail) {
  if (!path) return {};
  try {
    const { text, mtimeMs } = await read(path);
    const snapshot = parseRolloutLines(text.split('\n').filter(Boolean));
    if (!snapshot.lastActivityAt) snapshot.lastActivityAt = mtimeMs;
    return snapshot;
  } catch {
    return {};
  }
}

export function createSnapshotReader({ read = readTail, statFile = nodeStat, maxMessages = 20 } = {}) {
  const cache = new Map();
  return async (path) => {
    if (!path) return {};
    try {
      const info = await statFile(path);
      const cached = cache.get(path);
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.snapshot;
      const { text, mtimeMs } = await read(path);
      const snapshot = parseRolloutLines(text.split('\n').filter(Boolean), maxMessages);
      if (!snapshot.lastActivityAt) snapshot.lastActivityAt = mtimeMs;
      cache.set(path, { mtimeMs: info.mtimeMs, size: info.size, snapshot });
      return snapshot;
    } catch {
      return {};
    }
  };
}
