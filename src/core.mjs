export const MAX_MESSAGE_LENGTH = 12_000;
export const CORE_READY_MARKER = 'CODEX_LOOKOUT_READY';
export const LEGACY_HOST_READY_MARKER = 'Codex 掌上任务台已启动';
export const LEGACY_READY_DELAYS_MS = [100, 350, 750];

export function scheduleCoreReadySignals({ write, schedule }) {
  write(CORE_READY_MARKER);
  for (const delay of LEGACY_READY_DELAYS_MS) {
    schedule(() => write(LEGACY_HOST_READY_MARKER), delay);
  }
}

export function truncate(value, length = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

export function extractMessageText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item && (item.type === 'text' || item.type === 'input_text' || item.type === 'output_text'))
    .map((item) => item.text ?? '')
    .join('\n')
    .trim();
}

export function isInternalMessage(text) {
  const value = String(text ?? '').trim();
  return !value || /^<(image_resize_notice|environment_context|recommended_plugins|app-context|skills_instructions|permissions\b)/.test(value);
}

export function cleanUserMessage(text) {
  const value = String(text ?? '').trim();
  const marker = '## My request:';
  if (value.includes(marker)) return value.slice(value.lastIndexOf(marker) + marker.length).trim();
  if (value.startsWith('<in-app-browser-context')) return '';
  return value;
}

export function inferProgress({ lifecycle, lastActivityAt, now = Date.now(), queued = 0 }) {
  if (lifecycle === 'task_started' || lifecycle === 'inProgress') return { state: 'running', label: '进行中', tone: 'blue' };
  if (lifecycle === 'turn_aborted' || lifecycle === 'interrupted') return { state: 'paused', label: '已暂停', tone: 'amber' };
  if (lifecycle === 'failed') return { state: 'failed', label: '需处理', tone: 'red' };
  if (queued > 0) return { state: 'queued', label: '已排队', tone: 'violet' };
  if (lifecycle === 'task_complete' || lifecycle === 'completed') return { state: 'done', label: '已完成', tone: 'green' };
  if (lastActivityAt && now - lastActivityAt < 120_000) {
    return { state: 'running', label: '同步中', tone: 'blue' };
  }
  return { state: 'idle', label: '待命', tone: 'slate' };
}

export function activityLabel(type) {
  const labels = {
    command_execution: '正在执行任务',
    file_change: '正在更新文件',
    mcp_tool_call: '正在连接工具',
    web_search: '正在检索资料',
    reasoning: '正在处理',
    agent_message: '正在整理结果',
  };
  return labels[type] ?? '正在推进任务';
}

export function goalStatus(status) {
  const states = {
    active: { state: 'active', label: '执行中', tone: 'blue' },
    paused: { state: 'paused', label: '已暂停', tone: 'amber' },
    blocked: { state: 'blocked', label: '受阻', tone: 'red' },
    usage_limited: { state: 'usage_limited', label: '用量受限', tone: 'amber' },
    budget_limited: { state: 'budget_limited', label: '预算已用完', tone: 'red' },
    complete: { state: 'complete', label: '已完成', tone: 'green' },
  };
  return states[status] ?? { state: 'unknown', label: '状态未知', tone: 'slate' };
}

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes) return `${minutes} 分钟`;
  return `${seconds} 秒`;
}

export function presentTask(row, snapshot = {}, now = Date.now()) {
  const progress = inferProgress({
    lifecycle: snapshot.lifecycle ?? row.turn_status,
    lastActivityAt: snapshot.lastActivityAt ?? row.last_activity_at ?? row.updated_at_ms,
    queued: Number(row.queued_count ?? 0),
    now,
  });
  const title = truncate(row.name || row.title || row.preview || '未命名任务', 80);
  const project = row.project_name || row.section_name || folderName(row.cwd) || '未分组';
  const latestUser = cleanUserMessage(row.latest_user || snapshot.latestUser || '');
  const goal = row.goal_id ? {
    id: row.goal_id,
    objective: String(row.goal_objective || '').trim(),
    status: goalStatus(row.goal_status),
    elapsedSeconds: Number(row.goal_time_used_seconds || 0),
    elapsed: formatDuration(row.goal_time_used_seconds),
  } : null;
  return {
    id: row.id,
    title,
    project,
    cwd: row.cwd,
    updatedAt: Math.max(Number(row.recency_at_ms || 0), Number(row.updated_at_ms || 0), Number(row.last_activity_at || 0), Number(snapshot.lastActivityAt || 0)),
    model: row.model || null,
    pinned: Boolean(row.is_pinned),
    queuedCount: Number(row.queued_count ?? 0),
    progress,
    activity: progress.state === 'running' ? activityLabel(snapshot.lastActivityType || row.last_item_type) : progress.label,
    latestTask: truncate(latestUser || row.preview || row.title, 220),
    latestResult: truncate(row.latest_assistant || snapshot.latestAssistant || '', 520),
    goal,
  };
}

export function folderName(path) {
  const clean = String(path ?? '').replace(/\/+$/, '');
  return clean ? clean.split('/').pop() : '';
}

export function validateMessageInput(body) {
  const threadId = String(body?.threadId ?? '').trim();
  const message = String(body?.message ?? '').trim();
  if (!/^[0-9a-f-]{20,}$/i.test(threadId)) return { ok: false, error: '任务 ID 无效' };
  if (!message) return { ok: false, error: '请输入消息' };
  if (message.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符` };
  return { ok: true, threadId, message };
}

export function isAuthorized(url, headers, token) {
  if (!token) return true;
  const bearer = String(headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  let session = '';
  try {
    const cookie = String(headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith('bridge_session='));
    session = cookie ? decodeURIComponent(cookie.slice('bridge_session='.length)) : '';
  } catch {
    session = '';
  }
  return url.searchParams.get('token') === token || bearer === token || session === token;
}

export function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[character]);
}
