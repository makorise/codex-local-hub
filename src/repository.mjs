import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { presentTask } from './core.mjs';
import { cleanUserMessage, extractMessageText, isInternalMessage } from './core.mjs';

const defaultExec = promisify(nodeExecFile);

const TASK_SQL = `
SELECT t.id, t.name, t.title, t.preview, t.cwd, t.model, t.is_pinned, p.id AS project_id,
       t.updated_at_ms, t.recency_at_ms, t.rollout_path,
       p.name AS project_name, s.name AS section_name,
       (SELECT COUNT(*) FROM queue_db.queued_items qi WHERE qi.thread_id = t.id) AS queued_count,
       (SELECT json_extract(qi.payload_json, '$.UserInput.content[0].text') FROM queue_db.queued_items qi WHERE qi.thread_id = t.id ORDER BY qi.queue_order DESC LIMIT 1) AS queued_message,
       (SELECT ht.status FROM history_db.thread_turns ht WHERE ht.thread_id = t.id ORDER BY ht.rollout_ordinal DESC LIMIT 1) AS turn_status,
       (SELECT hi.item_type FROM history_db.thread_items hi WHERE hi.thread_id = t.id ORDER BY hi.rollout_ordinal DESC LIMIT 1) AS last_item_type,
       (SELECT hi.created_at_ms FROM history_db.thread_items hi WHERE hi.thread_id = t.id ORDER BY hi.rollout_ordinal DESC LIMIT 1) AS last_activity_at,
       (SELECT json_extract(hi.item_json, '$.content[0].text') FROM history_db.thread_items hi WHERE hi.thread_id = t.id AND hi.item_type = 'userMessage' ORDER BY hi.rollout_ordinal DESC LIMIT 1) AS latest_user,
       (SELECT json_extract(hi.item_json, '$.text') FROM history_db.thread_items hi WHERE hi.thread_id = t.id AND hi.item_type = 'agentMessage' ORDER BY hi.rollout_ordinal DESC LIMIT 1) AS latest_assistant,
       g.goal_id, g.objective AS goal_objective, g.status AS goal_status,
       g.time_used_seconds AS goal_time_used_seconds
FROM threads t
LEFT JOIN projects p ON p.id = COALESCE(t.project_id, (
  SELECT pr.project_id FROM project_roots pr
  WHERE t.cwd = pr.path OR t.cwd LIKE pr.path || '/%'
  ORDER BY LENGTH(pr.path) DESC LIMIT 1
))
LEFT JOIN thread_sections s ON s.id = t.thread_section_id
LEFT JOIN goal_db.thread_goals g ON g.thread_id = t.id
WHERE t.archived = 0 AND t.preview <> '' AND t.thread_source = 'user'
ORDER BY t.is_pinned DESC, t.recency_at_ms DESC
LIMIT 80;`;

const BASIC_TASK_SQL = `
SELECT t.id, t.name, t.title, t.preview, t.cwd, t.model, t.is_pinned, NULL AS project_id,
       t.updated_at_ms, t.recency_at_ms, t.rollout_path,
       NULL AS project_name, NULL AS section_name,
       0 AS queued_count, NULL AS queued_message,
       NULL AS turn_status, NULL AS last_item_type, NULL AS last_activity_at,
       NULL AS latest_user, NULL AS latest_assistant,
       NULL AS goal_id, NULL AS goal_objective, NULL AS goal_status,
       NULL AS goal_time_used_seconds
FROM threads t
WHERE t.archived = 0 AND t.preview <> '' AND t.thread_source = 'user'
ORDER BY t.is_pinned DESC, t.recency_at_ms DESC
LIMIT 80;`;

export class CodexRepository {
  constructor({
    stateDb,
    queueDb,
    historyDb,
    goalsDb,
    codexBin = 'codex',
    execFile = defaultExec,
    now = () => Date.now(),
    archiveTask = async () => { throw Object.assign(new Error('当前 Codex 不支持归档任务'), { statusCode: 503 }); },
    interruptTurn = async () => { throw Object.assign(new Error('当前 Codex 不支持停止任务'), { statusCode: 503 }); },
    deleteProject = async () => { throw Object.assign(new Error('当前 Codex 不支持删除项目'), { statusCode: 503 }); },
  }) {
    this.stateDb = stateDb;
    this.queueDb = queueDb;
    this.historyDb = historyDb;
    this.goalsDb = goalsDb;
    this.codexBin = codexBin;
    this.execFile = execFile;
    this.now = now;
    this.archiveTask = archiveTask;
    this.interruptTurn = interruptTurn;
    this.deleteProject = deleteProject;
    this.details = new Map();
  }

  async listTasks() {
    const attach = `ATTACH DATABASE '${escapeSqlite(this.queueDb)}' AS queue_db; ATTACH DATABASE '${escapeSqlite(this.historyDb)}' AS history_db; ATTACH DATABASE '${escapeSqlite(this.goalsDb)}' AS goal_db; ${TASK_SQL}`;
    let stdout;
    try {
      ({ stdout } = await this.execFile('sqlite3', ['-json', this.stateDb, attach], { maxBuffer: 8 * 1024 * 1024 }));
    } catch (error) {
      if (!isOptionalDataUnavailable(error)) throw error;
      ({ stdout } = await this.execFile('sqlite3', ['-json', this.stateDb, BASIC_TASK_SQL], { maxBuffer: 8 * 1024 * 1024 }));
    }
    const rows = stdout.trim() ? JSON.parse(stdout) : [];
    const tasks = rows.map((row) => {
      const task = presentTask(row, {}, this.now());
      this.details.set(row.id, task);
      return task;
    });
    return tasks;
  }

  async getTask(threadId) {
    if (!this.details.has(threadId)) await this.listTasks();
    const task = this.details.get(threadId);
    if (!task) return null;
    const [messages, queuedTasks] = await Promise.all([this.loadMessages(threadId), this.loadQueuedTasks(threadId)]);
    return { ...task, messages, queuedTasks };
  }

  async loadMessages(threadId) {
    const sql = `SELECT created_at_ms, item_type, item_json, 0 AS pending FROM thread_items WHERE thread_id = '${escapeSqlite(threadId)}' AND item_type IN ('userMessage', 'agentMessage') ORDER BY rollout_ordinal DESC LIMIT 24;`;
    let stdout;
    try {
      ({ stdout } = await this.execFile('sqlite3', ['-json', this.historyDb, sql], { maxBuffer: 4 * 1024 * 1024 }));
    } catch (error) {
      if (isOptionalDataUnavailable(error)) return [];
      throw error;
    }
    const rows = stdout.trim() ? JSON.parse(stdout) : [];
    return rows.reverse().map(parseHistoryMessage).filter(Boolean).slice(-20);
  }

  async loadQueuedTasks(threadId) {
    const sql = `SELECT qi.id AS queue_item_id, qi.created_at_ms, qi.queue_order, COALESCE(qr.revision, 0) AS queue_revision, 'queuedMessage' AS item_type, qi.payload_json AS item_json, 1 AS pending FROM queued_items qi LEFT JOIN queued_thread_revisions qr ON qr.thread_id = qi.thread_id WHERE qi.thread_id = '${escapeSqlite(threadId)}' ORDER BY qi.queue_order ASC LIMIT 50;`;
    let stdout;
    try {
      ({ stdout } = await this.execFile('sqlite3', ['-json', this.queueDb, sql], { maxBuffer: 2 * 1024 * 1024 }));
    } catch (error) {
      if (isOptionalDataUnavailable(error)) return [];
      throw error;
    }
    const rows = stdout.trim() ? JSON.parse(stdout) : [];
    return rows.map(parseHistoryMessage).filter(Boolean);
  }

  async reorderQueuedTasks(threadId, itemIds, revision) {
    const requested = itemIds.map((id, index) => `('${escapeSqlite(id)}', ${index + 1})`).join(', ');
    const escapedThread = escapeSqlite(threadId);
    const timestamp = this.now();
    const sql = `
BEGIN IMMEDIATE;
CREATE TEMP TABLE requested_queue (id TEXT PRIMARY KEY, desired_order INTEGER NOT NULL UNIQUE);
INSERT INTO requested_queue (id, desired_order) VALUES ${requested};
CREATE TEMP TABLE mutation_guard (valid INTEGER NOT NULL);
INSERT INTO mutation_guard (valid)
SELECT CASE WHEN
  COALESCE((SELECT revision FROM queued_thread_revisions WHERE thread_id = '${escapedThread}'), 0) = ${revision}
  AND (SELECT COUNT(*) FROM queued_items WHERE thread_id = '${escapedThread}') = (SELECT COUNT(*) FROM requested_queue)
  AND NOT EXISTS (SELECT 1 FROM requested_queue rq LEFT JOIN queued_items qi ON qi.id = rq.id AND qi.thread_id = '${escapedThread}' WHERE qi.id IS NULL)
THEN 1 ELSE 0 END;
UPDATE queued_items SET queue_order = -queue_order - 1000000, updated_at_ms = ${timestamp}
WHERE thread_id = '${escapedThread}' AND (SELECT valid FROM mutation_guard) = 1;
UPDATE queued_items
SET queue_order = (SELECT desired_order FROM requested_queue WHERE requested_queue.id = queued_items.id), updated_at_ms = ${timestamp}
WHERE thread_id = '${escapedThread}' AND id IN (SELECT id FROM requested_queue) AND (SELECT valid FROM mutation_guard) = 1;
COMMIT;
SELECT valid FROM mutation_guard;`;
    const { stdout } = await this.execFile('sqlite3', ['-json', this.queueDb, sql], { maxBuffer: 2 * 1024 * 1024 });
    const valid = JSON.parse(stdout)[0].valid === 1;
    if (!valid) throw Object.assign(new Error('任务队列已变化，请刷新后重试'), { statusCode: 409 });
    return this.loadQueuedTasks(threadId);
  }

  async deleteQueuedTask(threadId, itemId, revision) {
    const escapedThread = escapeSqlite(threadId);
    const escapedItem = escapeSqlite(itemId);
    const sql = `
BEGIN IMMEDIATE;
CREATE TEMP TABLE mutation_guard (valid INTEGER NOT NULL);
INSERT INTO mutation_guard (valid)
SELECT CASE WHEN
  COALESCE((SELECT revision FROM queued_thread_revisions WHERE thread_id = '${escapedThread}'), 0) = ${revision}
  AND EXISTS (SELECT 1 FROM queued_items WHERE thread_id = '${escapedThread}' AND id = '${escapedItem}')
THEN 1 ELSE 0 END;
DELETE FROM queued_items WHERE thread_id = '${escapedThread}' AND id = '${escapedItem}' AND (SELECT valid FROM mutation_guard) = 1;
COMMIT;
SELECT valid FROM mutation_guard;`;
    const { stdout } = await this.execFile('sqlite3', ['-json', this.queueDb, sql], { maxBuffer: 2 * 1024 * 1024 });
    const valid = JSON.parse(stdout)[0].valid === 1;
    if (!valid) throw Object.assign(new Error('任务队列已变化，请刷新后重试'), { statusCode: 409 });
    return this.loadQueuedTasks(threadId);
  }

  async steerQueuedTask(threadId, itemId, revision) {
    const queuedTasks = await this.loadQueuedTasks(threadId);
    const item = queuedTasks.find((message) => message.id === itemId);
    if (!item || item.queueRevision !== revision) throw Object.assign(new Error('任务队列已变化，请刷新后重试'), { statusCode: 409 });
    if (queuedTasks[0].id === itemId) {
      return { result: { accepted: true, mode: 'already-first' }, queuedTasks };
    }
    const itemIds = [itemId, ...queuedTasks.filter((message) => message.id !== itemId).map((message) => message.id)];
    const reordered = await this.reorderQueuedTasks(threadId, itemIds, revision);
    return { result: { accepted: true, mode: 'prioritized' }, queuedTasks: reordered };
  }

  async sendMessage(threadId, message) {
    // Persist first so the phone can return without waiting for a completed
    // task to create its next Codex turn. A background dispatcher starts idle
    // threads only after this durable queue write succeeds.
    return this.queueMessage(threadId, message);
  }

  async stopTask(threadId) {
    const turnId = await this.activeTurnId(threadId);
    if (!turnId) throw Object.assign(new Error('这个任务当前没有正在执行的回合'), { statusCode: 409 });
    await this.interruptTurn(threadId, turnId);
    return { stopped: true, threadId };
  }

  async archiveThread(threadId) {
    if (!this.details.has(threadId)) await this.listTasks();
    if (!this.details.has(threadId)) throw Object.assign(new Error('任务不存在或已经归档'), { statusCode: 404 });
    await this.archiveTask(threadId);
    this.details.delete(threadId);
    return { archived: true, threadId };
  }

  async removeProject(projectId, expectedName) {
    const sql = `SELECT id, name FROM projects WHERE id = '${escapeSqlite(projectId)}' LIMIT 1;`;
    const { stdout = '' } = await this.execFile('sqlite3', ['-json', this.stateDb, sql], { maxBuffer: 1024 * 1024 });
    const project = stdout.trim() ? JSON.parse(stdout)[0] : null;
    if (!project) throw Object.assign(new Error('项目不存在或已经删除'), { statusCode: 404 });
    if (String(project.name) !== String(expectedName)) throw Object.assign(new Error('项目名称不匹配，请刷新后重试'), { statusCode: 409 });
    await this.deleteProject(projectId);
    for (const [threadId, task] of this.details) {
      if (task.projectId === projectId) this.details.delete(threadId);
    }
    return { deleted: true, projectId, name: project.name, filesDeleted: false };
  }

  async activeTurnId(threadId) {
    const sql = `SELECT turn_id, status FROM thread_turns WHERE thread_id = '${escapeSqlite(threadId)}' ORDER BY rollout_ordinal DESC LIMIT 1;`;
    let stdout = '';
    try {
      ({ stdout = '' } = await this.execFile('sqlite3', ['-json', this.historyDb, sql], { maxBuffer: 1024 * 1024 }));
    } catch (error) {
      if (isOptionalDataUnavailable(error)) return null;
      throw error;
    }
    if (!stdout.trim()) return null;
    const latest = JSON.parse(stdout)[0];
    return latest?.status === 'inProgress' ? latest.turn_id || null : null;
  }

  async queueMessage(threadId, message) {
    const { stdout = '', stderr = '' } = await this.execFile(this.codexBin, ['queue', '--thread', threadId, '--message', message], { maxBuffer: 1024 * 1024 });
    return { accepted: true, mode: 'queued', output: String(stdout || stderr).trim() };
  }

  async threadCwd(threadId) {
    const cached = this.details.get(threadId)?.cwd;
    if (cached) return cached;
    const sql = `SELECT cwd FROM threads WHERE id = '${escapeSqlite(threadId)}' LIMIT 1;`;
    const { stdout = '' } = await this.execFile('sqlite3', ['-json', this.stateDb, sql], { maxBuffer: 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout)[0]?.cwd || process.cwd() : process.cwd();
  }
}

export function parseHistoryMessage(row) {
  try {
    const item = JSON.parse(row.item_json);
    const queued = row.item_type === 'queuedMessage';
    const role = row.item_type === 'agentMessage' ? 'assistant' : 'user';
    const rawText = queued ? extractMessageText(item.UserInput?.content) : role === 'assistant' ? String(item.text ?? '').trim() : extractMessageText(item.content);
    const text = role === 'user' ? cleanUserMessage(rawText) : rawText;
    if (isInternalMessage(text)) return null;
    return {
      id: row.queue_item_id || item.id || `${row.created_at_ms}-${row.item_type}`,
      role,
      text,
      timestamp: Number(row.created_at_ms),
      pending: Boolean(row.pending),
      ...(queued ? { queueOrder: Number(row.queue_order ?? 0), queueRevision: Number(row.queue_revision ?? 0) } : {}),
    };
  } catch {
    return null;
  }
}

export function escapeSqlite(value) {
  return String(value).replaceAll("'", "''");
}

export function isOptionalDataUnavailable(error) {
  const detail = `${error?.message || ''}\n${error?.stderr || ''}`;
  return /no such table: (?:queue_db\.|history_db\.|goal_db\.|main\.)?(?:queued_items|queued_thread_revisions|thread_turns|thread_items|thread_goals|projects|project_roots|thread_sections)\b/i.test(detail)
    || /unable to open database(?: file)?/i.test(detail);
}

export function isClosedTurnError(error) {
  return /(?:thread|turn|interaction|channel).*(?:closed|completed|interrupted|not found)|(?:closed|completed|interrupted).*(?:thread|turn|interaction|channel)|已关闭|已经关闭|已完成|已中断|找不到.*(?:任务|回合)/i.test(String(error?.message || error || ''));
}
