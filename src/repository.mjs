import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { presentTask } from './core.mjs';
import { cleanUserMessage, extractMessageText, isInternalMessage } from './core.mjs';

const defaultExec = promisify(nodeExecFile);

const TASK_SQL = `
SELECT t.id, t.name, t.title, t.preview, t.cwd, t.model, t.is_pinned,
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
LEFT JOIN projects p ON p.id = t.project_id
LEFT JOIN thread_sections s ON s.id = t.thread_section_id
LEFT JOIN goal_db.thread_goals g ON g.thread_id = t.id
WHERE t.archived = 0 AND t.preview <> '' AND t.thread_source = 'user'
ORDER BY t.is_pinned DESC, t.recency_at_ms DESC
LIMIT 80;`;

const BASIC_TASK_SQL = `
SELECT t.id, t.name, t.title, t.preview, t.cwd, t.model, t.is_pinned,
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
    steerMessage = async () => { throw Object.assign(new Error('当前 Codex 不支持立即执行'), { statusCode: 503 }); },
    startTurn = async () => { throw Object.assign(new Error('当前 Codex 不支持启动任务'), { statusCode: 503 }); },
  }) {
    this.stateDb = stateDb;
    this.queueDb = queueDb;
    this.historyDb = historyDb;
    this.goalsDb = goalsDb;
    this.codexBin = codexBin;
    this.execFile = execFile;
    this.now = now;
    this.steerMessage = steerMessage;
    this.startTurn = startTurn;
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
    const activeSql = `SELECT turn_id FROM thread_turns WHERE thread_id = '${escapeSqlite(threadId)}' AND status = 'inProgress' ORDER BY rollout_ordinal DESC LIMIT 1;`;
    const { stdout } = await this.execFile('sqlite3', ['-json', this.historyDb, activeSql], { maxBuffer: 1024 * 1024 });
    const activeTurn = stdout.trim() ? JSON.parse(stdout)[0]?.turn_id : null;
    const result = activeTurn
      ? await this.steerMessage(threadId, activeTurn, item.text)
      : await this.startTurn(threadId, item.text, await this.threadCwd(threadId));
    const deleteSql = `DELETE FROM queued_items WHERE thread_id = '${escapeSqlite(threadId)}' AND id = '${escapeSqlite(itemId)}';`;
    await this.execFile('sqlite3', [this.queueDb, deleteSql], { maxBuffer: 1024 * 1024 });
    return { result, queuedTasks: await this.loadQueuedTasks(threadId) };
  }

  async sendMessage(threadId, message) {
    const activeSql = `SELECT turn_id FROM thread_turns WHERE thread_id = '${escapeSqlite(threadId)}' AND status = 'inProgress' ORDER BY rollout_ordinal DESC LIMIT 1;`;
    let activeOutput = '';
    try {
      ({ stdout: activeOutput = '' } = await this.execFile('sqlite3', ['-json', this.historyDb, activeSql], { maxBuffer: 1024 * 1024 }));
    } catch (error) {
      if (!isOptionalDataUnavailable(error)) throw error;
    }
    const activeTurn = activeOutput.trim() ? JSON.parse(activeOutput)[0]?.turn_id : null;
    if (!activeTurn) {
      try {
        return { accepted: true, mode: 'started', result: await this.startTurn(threadId, message, await this.threadCwd(threadId)) };
      } catch (error) {
        const queued = await this.queueMessage(threadId, message);
        return { ...queued, warning: error.message };
      }
    }
    return this.queueMessage(threadId, message);
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
  return /no such table: (?:queue_db\.|history_db\.|goal_db\.|main\.)?(?:queued_items|queued_thread_revisions|thread_turns|thread_items|thread_goals|projects|thread_sections)\b/i.test(detail)
    || /unable to open database(?: file)?/i.test(detail);
}
