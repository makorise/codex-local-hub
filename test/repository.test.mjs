import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as nodeExecFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CodexRepository, escapeSqlite, isClosedTurnError, isOptionalDataUnavailable, parseHistoryMessage } from '../src/repository.mjs';

const execFile = promisify(nodeExecFile);

const row = { id: '1234567890abcdef1234', name: 'Task', cwd: '/work', updated_at_ms: 1, recency_at_ms: 1, rollout_path: '/rollout', queued_count: 0 };

test('repository lists, caches details and escapes database paths', async () => {
  const calls = [];
  const repository = new CodexRepository({
    stateDb: "/state's.db",
    queueDb: "/queue's.db",
    historyDb: "/history's.db",
    goalsDb: "/goals's.db",
    now: () => 500_000,
    execFile: async (...args) => {
      calls.push(args);
      if (calls.length === 1) return { stdout: JSON.stringify([row]) };
      return { stdout: JSON.stringify([{ created_at_ms: 4, item_type: 'agentMessage', item_json: '{"id":"a","text":"Result"}', pending: 0 }]) };
    },
  });
  const tasks = await repository.listTasks();
  assert.equal(tasks[0].title, 'Task');
  assert.equal((await repository.getTask(row.id)).messages.length, 1);
  assert.match(calls[0][1][2], /queue''s\.db/);
  assert.match(calls[0][1][2], /history''s\.db/);
  assert.match(calls[0][1][2], /goals''s\.db/);
  assert.equal(escapeSqlite("a'b"), "a''b");
});

test('repository falls back when optional Codex databases are not initialized', async () => {
  const calls = [];
  const optionalError = Object.assign(new Error('query failed'), { stderr: 'Error: no such table: history_db.thread_items' });
  const repository = new CodexRepository({
    stateDb: '/state', queueDb: '/queue', historyDb: '/history', goalsDb: '/goals',
    execFile: async (_command, args) => {
      calls.push(args);
      if (calls.length === 1) throw optionalError;
      return { stdout: JSON.stringify([row]) };
    },
  });
  assert.equal((await repository.listTasks())[0].title, 'Task');
  assert.match(calls[1][2], /NULL AS latest_user/);

  repository.execFile = async (command) => {
    if (command === 'sqlite3') throw Object.assign(new Error('unable to open database file'), { stderr: '' });
    return { stdout: 'queued' };
  };
  assert.deepEqual(await repository.loadMessages(row.id), []);
  assert.deepEqual(await repository.loadQueuedTasks(row.id), []);
  assert.equal((await repository.sendMessage(row.id, 'continue')).output, 'queued');

  assert.equal(isOptionalDataUnavailable(optionalError), true);
  assert.equal(isOptionalDataUnavailable({ stderr: 'no such table: main.queued_items' }), true);
  assert.equal(isOptionalDataUnavailable(new Error('database is locked')), false);
  assert.equal(isOptionalDataUnavailable(), false);
});

test('repository does not hide real database failures', async () => {
  const failure = new Error('database is locked');
  const repository = new CodexRepository({
    stateDb: '/state', queueDb: '/queue', historyDb: '/history', goalsDb: '/goals',
    execFile: async () => { throw failure; },
  });
  await assert.rejects(repository.listTasks(), failure);
  await assert.rejects(repository.loadMessages(row.id), failure);
  await assert.rejects(repository.loadQueuedTasks(row.id), failure);
  await assert.rejects(repository.sendMessage(row.id, 'hello'), failure);
});

test('repository handles empty lists, misses and queue stdout or stderr', async () => {
  let response = { stdout: '' };
  let queueResponse = { stdout: '', stderr: 'queued' };
  const repository = new CodexRepository({
    stateDb: '/state', queueDb: '/queue', historyDb: '/history', goalsDb: '/goals', codexBin: '/codex',
    execFile: async (...args) => args[0] === 'sqlite3' ? response : queueResponse,
    readSnapshot: async () => ({}),
  });
  assert.deepEqual(await repository.listTasks(), []);
  assert.equal(await repository.getTask('missing'), null);
  assert.deepEqual(await repository.sendMessage(row.id, 'hello'), { accepted: true, mode: 'queued', output: 'queued' });
  queueResponse = { stdout: 'ok', stderr: 'ignored' };
  assert.equal((await repository.sendMessage(row.id, 'hello')).output, 'ok');
  queueResponse = {};
  assert.equal((await repository.sendMessage(row.id, 'hello')).output, '');
  const active = new CodexRepository({
    stateDb: '/state', queueDb: '/queue', historyDb: '/history', goalsDb: '/goals',
    execFile: async (command) => command === 'sqlite3' ? { stdout: '[{"turn_id":"active"}]' } : { stderr: 'waiting' },
  });
  assert.deepEqual(await active.sendMessage(row.id, 'later'), { accepted: true, mode: 'queued', output: 'waiting' });
  const defaults = new CodexRepository({
    stateDb: '/state', queueDb: '/queue', historyDb: '/history', goalsDb: '/goals',
    execFile: async () => ({ stdout: JSON.stringify([{ ...row, queued_count: null }]) }),
  });
  assert.equal((await defaults.listTasks()).length, 1);
});

test('task and project management uses Codex controls without deleting workspace files', async () => {
  const archived = [];
  const interrupted = [];
  const deletedProjects = [];
  let activeTurn = 'turn-active';
  let projectRow = { id: 'project-1', name: 'sync' };
  const repository = new CodexRepository({
    stateDb: '/state', queueDb: '/queue', historyDb: '/history', goalsDb: '/goals',
    execFile: async (_command, args) => {
      const sql = args[2];
      if (sql.includes('SELECT turn_id')) return { stdout: activeTurn ? JSON.stringify([{ turn_id: activeTurn, status: 'inProgress' }]) : '' };
      if (sql.includes('SELECT id, name FROM projects')) return { stdout: projectRow ? JSON.stringify([projectRow]) : '' };
      return { stdout: '' };
    },
    archiveTask: async (...args) => archived.push(args),
    interruptTurn: async (...args) => interrupted.push(args),
    deleteProject: async (...args) => deletedProjects.push(args),
  });
  repository.details.set(row.id, { ...row, projectId: 'project-1' });
  repository.details.set('other-thread', { id: 'other-thread', projectId: 'project-2' });

  assert.deepEqual(await repository.stopTask(row.id), { stopped: true, threadId: row.id });
  assert.deepEqual(interrupted, [[row.id, 'turn-active']]);
  activeTurn = '';
  await assert.rejects(repository.stopTask(row.id), (error) => error.statusCode === 409);

  assert.deepEqual(await repository.archiveThread(row.id), { archived: true, threadId: row.id });
  assert.deepEqual(archived, [[row.id]]);
  assert.equal(repository.details.has(row.id), false);
  await assert.rejects(repository.archiveThread('missing-thread'), (error) => error.statusCode === 404);

  repository.details.set(row.id, { ...row, projectId: 'project-1' });
  await assert.rejects(repository.removeProject('project-1', 'wrong'), (error) => error.statusCode === 409);
  assert.deepEqual(await repository.removeProject('project-1', 'sync'), {
    deleted: true, projectId: 'project-1', name: 'sync', filesDeleted: false,
  });
  assert.deepEqual(deletedProjects, [['project-1']]);
  assert.equal(repository.details.has(row.id), false);
  assert.equal(repository.details.has('other-thread'), true);
  projectRow = null;
  await assert.rejects(repository.removeProject('missing-project', 'sync'), (error) => error.statusCode === 404);

  repository.execFile = async () => { throw Object.assign(new Error('optional'), { stderr: 'no such table: thread_turns' }); };
  assert.equal(await repository.activeTurnId(row.id), null);
  const activeFailure = new Error('database locked');
  repository.execFile = async () => { throw activeFailure; };
  await assert.rejects(repository.activeTurnId(row.id), activeFailure);
  repository.execFile = async () => ({ stdout: '[]' });
  assert.equal(await repository.activeTurnId(row.id), null);

  repository.execFile = async () => ({ stdout: '[{"turn_id":"old","status":"completed"}]' });
  assert.equal(await repository.activeTurnId(row.id), null);
  repository.execFile = async () => ({ stdout: '[{"status":"inProgress"}]' });
  assert.equal(await repository.activeTurnId(row.id), null);

  const unsupported = new CodexRepository({
    stateDb: '/state', queueDb: '/queue', historyDb: '/history', goalsDb: '/goals',
    execFile: async (_command, args) => args[2].includes('SELECT turn_id')
      ? { stdout: '[{"turn_id":"turn","status":"inProgress"}]' }
      : { stdout: '[{"id":"project","name":"name"}]' },
  });
  unsupported.details.set(row.id, row);
  await assert.rejects(unsupported.stopTask(row.id), (error) => error.statusCode === 503);
  await assert.rejects(unsupported.archiveThread(row.id), (error) => error.statusCode === 503);
  await assert.rejects(unsupported.removeProject('project', 'name'), (error) => error.statusCode === 503);
});

test('history messages parse user, assistant, queued and invalid records', () => {
  assert.deepEqual(parseHistoryMessage({ created_at_ms: 1, item_type: 'agentMessage', item_json: '{"id":"a","text":" answer "}', pending: 0 }), { id: 'a', role: 'assistant', text: 'answer', timestamp: 1, pending: false });
  assert.equal(parseHistoryMessage({ created_at_ms: 2, item_type: 'userMessage', item_json: '{"content":[{"type":"text","text":"<environment_context>x"}]}', pending: 0 }), null);
  assert.deepEqual(parseHistoryMessage({ created_at_ms: 3, item_type: 'queuedMessage', item_json: '{"UserInput":{"content":[{"type":"text","text":"next"}]}}', pending: 1 }), { id: '3-queuedMessage', role: 'user', text: 'next', timestamp: 3, pending: true, queueOrder: 0, queueRevision: 0 });
  assert.deepEqual(parseHistoryMessage({ queue_item_id: 'queue-id', queue_order: 2, queue_revision: 7, created_at_ms: 4, item_type: 'queuedMessage', item_json: '{"UserInput":{"content":[{"type":"text","text":"<in-app-browser-context>x</in-app-browser-context>\\n## My request:\\nclean"}]}}', pending: 1 }), { id: 'queue-id', role: 'user', text: 'clean', timestamp: 4, pending: true, queueOrder: 2, queueRevision: 7 });
  assert.equal(parseHistoryMessage({ created_at_ms: 5, item_type: 'agentMessage', item_json: '{}', pending: 0 }), null);
  assert.equal(parseHistoryMessage({ item_json: '{' }), null);
});

test('closed turn errors are recognized without hiding unrelated failures', () => {
  assert.equal(isClosedTurnError(new Error('interaction is closed')), true);
  assert.equal(isClosedTurnError(new Error('turn completed before steer')), true);
  assert.equal(isClosedTurnError(new Error('当前回合已关闭')), true);
  assert.equal(isClosedTurnError(new Error('network unavailable')), false);
  assert.equal(isClosedTurnError(null), false);
});

test('history loaders return empty collections when databases have no rows', async () => {
  const repository = new CodexRepository({
    stateDb: '/state', queueDb: '/queue', historyDb: '/history', goalsDb: '/goals',
    execFile: async () => ({ stdout: '' }),
  });
  assert.deepEqual(await repository.loadMessages('1234567890abcdef1234'), []);
  assert.deepEqual(await repository.loadQueuedTasks('1234567890abcdef1234'), []);
});

test('queue mutations reorder and delete atomically with revision conflict protection', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'bridge-queue-'));
  const queueDb = join(directory, 'queue.sqlite');
  t.after(() => rm(directory, { recursive: true }));
  await execFile('sqlite3', [queueDb, `
    CREATE TABLE queued_items (id TEXT PRIMARY KEY NOT NULL, thread_id TEXT NOT NULL, payload_json TEXT NOT NULL, queue_order INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
    CREATE UNIQUE INDEX queued_items_thread_order_idx ON queued_items(thread_id, queue_order);
    CREATE TABLE queued_thread_revisions (revision INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL UNIQUE);
    CREATE TRIGGER queued_items_revision_after_insert AFTER INSERT ON queued_items BEGIN INSERT INTO queued_thread_revisions (thread_id) VALUES (NEW.thread_id) ON CONFLICT(thread_id) DO UPDATE SET revision = (SELECT COALESCE(MAX(revision), 0) + 1 FROM queued_thread_revisions); END;
    CREATE TRIGGER queued_items_revision_after_update AFTER UPDATE ON queued_items BEGIN INSERT INTO queued_thread_revisions (thread_id) VALUES (NEW.thread_id) ON CONFLICT(thread_id) DO UPDATE SET revision = (SELECT COALESCE(MAX(revision), 0) + 1 FROM queued_thread_revisions); END;
    CREATE TRIGGER queued_items_revision_after_delete AFTER DELETE ON queued_items BEGIN INSERT INTO queued_thread_revisions (thread_id) VALUES (OLD.thread_id) ON CONFLICT(thread_id) DO UPDATE SET revision = (SELECT COALESCE(MAX(revision), 0) + 1 FROM queued_thread_revisions); END;
    INSERT INTO queued_items VALUES
      ('aaaaaaaaaaaaaaaaaaaa', '1234567890abcdef1234', '{"UserInput":{"content":[{"type":"text","text":"first"}]}}', 1, 1, 1),
      ('bbbbbbbbbbbbbbbbbbbb', '1234567890abcdef1234', '{"UserInput":{"content":[{"type":"text","text":"second"}]}}', 2, 2, 2),
      ('cccccccccccccccccccc', '1234567890abcdef1234', '{"UserInput":{"content":[{"type":"text","text":"third"}]}}', 3, 3, 3);
  `]);
  const repository = new CodexRepository({
    stateDb: '/state', queueDb, historyDb: '/history', goalsDb: '/goals', now: () => 99,
  });
  const initial = await repository.loadQueuedTasks('1234567890abcdef1234');
  assert.deepEqual(initial.map((item) => item.text), ['first', 'second', 'third']);
  const reordered = await repository.reorderQueuedTasks('1234567890abcdef1234', [initial[2].id, initial[0].id, initial[1].id], initial[0].queueRevision);
  assert.deepEqual(reordered.map((item) => item.text), ['third', 'first', 'second']);
  assert.ok(reordered[0].queueRevision > initial[0].queueRevision);
  await assert.rejects(repository.reorderQueuedTasks('1234567890abcdef1234', reordered.map((item) => item.id), initial[0].queueRevision), (error) => error.statusCode === 409);
  await assert.rejects(repository.reorderQueuedTasks('1234567890abcdef1234', ['dddddddddddddddddddd'], reordered[0].queueRevision), /任务队列已变化/);
  const afterDelete = await repository.deleteQueuedTask('1234567890abcdef1234', reordered[1].id, reordered[0].queueRevision);
  assert.deepEqual(afterDelete.map((item) => item.text), ['third', 'second']);
  await assert.rejects(repository.deleteQueuedTask('1234567890abcdef1234', 'dddddddddddddddddddd', afterDelete[0].queueRevision), (error) => error.statusCode === 409);
});

test('queued task steering targets the active turn and removes only the steered item', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'bridge-steer-'));
  const queueDb = join(directory, 'queue.sqlite');
  const historyDb = join(directory, 'history.sqlite');
  const threadId = '1234567890abcdef1234';
  t.after(() => rm(directory, { recursive: true }));
  await execFile('sqlite3', [queueDb, `
    CREATE TABLE queued_items (id TEXT PRIMARY KEY NOT NULL, thread_id TEXT NOT NULL, payload_json TEXT NOT NULL, queue_order INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
    CREATE TABLE queued_thread_revisions (revision INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL UNIQUE);
    CREATE TRIGGER queued_items_revision_after_insert AFTER INSERT ON queued_items BEGIN INSERT INTO queued_thread_revisions (thread_id) VALUES (NEW.thread_id) ON CONFLICT(thread_id) DO UPDATE SET revision = (SELECT COALESCE(MAX(revision), 0) + 1 FROM queued_thread_revisions); END;
    CREATE TRIGGER queued_items_revision_after_delete AFTER DELETE ON queued_items BEGIN INSERT INTO queued_thread_revisions (thread_id) VALUES (OLD.thread_id) ON CONFLICT(thread_id) DO UPDATE SET revision = (SELECT COALESCE(MAX(revision), 0) + 1 FROM queued_thread_revisions); END;
    INSERT INTO queued_items VALUES
      ('aaaaaaaaaaaaaaaaaaaa', '${threadId}', '{"UserInput":{"content":[{"type":"text","text":"steer me"}]}}', 1, 1, 1),
      ('bbbbbbbbbbbbbbbbbbbb', '${threadId}', '{"UserInput":{"content":[{"type":"text","text":"keep me"}]}}', 2, 2, 2);
  `]);
  await execFile('sqlite3', [historyDb, 'CREATE TABLE thread_turns (thread_id TEXT, turn_id TEXT, status TEXT, rollout_ordinal INTEGER);']);
  const calls = [];
  const starts = [];
  const repository = new CodexRepository({
    stateDb: '/state', queueDb, historyDb, goalsDb: '/goals',
    steerMessage: async (...args) => { calls.push(args); return { accepted: true }; },
    startTurn: async (...args) => { starts.push(args); return { started: true }; },
  });
  repository.details.set(threadId, { cwd: '/work' });
  const initial = await repository.loadQueuedTasks(threadId);
  await assert.rejects(repository.steerQueuedTask(threadId, initial[0].id, initial[0].queueRevision + 1), (error) => error.statusCode === 409);
  const started = await repository.steerQueuedTask(threadId, initial[0].id, initial[0].queueRevision);
  assert.deepEqual(starts, [[threadId, 'steer me', '/work']]);
  assert.deepEqual(started.result, { started: true });
  assert.deepEqual(started.queuedTasks.map((item) => item.text), ['keep me']);
  await execFile('sqlite3', [historyDb, `INSERT INTO thread_turns VALUES ('${threadId}', 'turn-old', 'completed', 1), ('${threadId}', 'turn-active', 'inProgress', 2);`]);
  const remaining = await repository.loadQueuedTasks(threadId);
  const steered = await repository.steerQueuedTask(threadId, remaining[0].id, remaining[0].queueRevision);
  assert.deepEqual(calls, [[threadId, 'turn-active', 'keep me']]);
  assert.deepEqual(steered.result, { accepted: true });
  assert.deepEqual(steered.queuedTasks, []);

  await execFile('sqlite3', [queueDb, `INSERT INTO queued_items VALUES ('eeeeeeeeeeeeeeeeeeee', '${threadId}', '{"UserInput":{"content":[{"type":"text","text":"recover closed turn"}]}}', 1, 3, 3);`]);
  repository.steerMessage = async () => { throw new Error('interaction is closed'); };
  const closedItem = (await repository.loadQueuedTasks(threadId))[0];
  const recovered = await repository.steerQueuedTask(threadId, closedItem.id, closedItem.queueRevision);
  assert.equal(recovered.result.started, true);
  assert.deepEqual(starts.at(-1), [threadId, 'recover closed turn', '/work']);
  assert.deepEqual(recovered.queuedTasks, []);

  assert.deepEqual(await repository.startQueuedTaskIfIdle(threadId), { started: false, reason: 'active' });
  await execFile('sqlite3', [historyDb, `UPDATE thread_turns SET status = 'completed';`]);
  assert.deepEqual(await repository.startQueuedTaskIfIdle(threadId), { started: false, reason: 'empty' });
  await execFile('sqlite3', [queueDb, `INSERT INTO queued_items VALUES ('dddddddddddddddddddd', '${threadId}', '{"UserInput":{"content":[{"type":"text","text":"start safely"}]}}', 1, 3, 3);`]);
  const automatic = await repository.startQueuedTaskIfIdle(threadId);
  assert.equal(automatic.started, true);
  assert.equal(automatic.itemId, 'dddddddddddddddddddd');
  assert.deepEqual(starts.at(-1), [threadId, 'start safely', '/work']);
  assert.deepEqual(await repository.loadQueuedTasks(threadId), []);

  await execFile('sqlite3', [queueDb, `INSERT INTO queued_items VALUES ('cccccccccccccccccccc', '${threadId}', '{"UserInput":{"content":[{"type":"text","text":"preserve me"}]}}', 1, 3, 3);`]);
  const unsupported = new CodexRepository({ stateDb: '/state', queueDb, historyDb, goalsDb: '/goals' });
  unsupported.details.set(threadId, { cwd: '/work' });
  const preserved = await unsupported.loadQueuedTasks(threadId);
  await assert.rejects(unsupported.steerQueuedTask(threadId, preserved[0].id, preserved[0].queueRevision), (error) => error.statusCode === 503);
  assert.deepEqual((await unsupported.loadQueuedTasks(threadId)).map((item) => item.text), ['preserve me']);
  await assert.rejects(unsupported.startQueuedTaskIfIdle(threadId), (error) => error.statusCode === 503);
  assert.deepEqual((await unsupported.loadQueuedTasks(threadId)).map((item) => item.text), ['preserve me']);
  await execFile('sqlite3', [historyDb, `INSERT INTO thread_turns VALUES ('${threadId}', 'turn-new', 'inProgress', 3);`]);
  await assert.rejects(unsupported.steerQueuedTask(threadId, preserved[0].id, preserved[0].queueRevision), (error) => error.statusCode === 503);
});

test('thread working directory uses cached, stored and process fallbacks', async () => {
  const repository = new CodexRepository({
    stateDb: '/state', queueDb: '/queue', historyDb: '/history', goalsDb: '/goals',
    execFile: async () => ({ stdout: '[{"cwd":"/stored"}]' }),
  });
  repository.details.set('cached', { cwd: '/cached' });
  assert.equal(await repository.threadCwd('cached'), '/cached');
  assert.equal(await repository.threadCwd('stored'), '/stored');
  repository.execFile = async () => ({ stdout: '[{}]' });
  assert.equal(await repository.threadCwd('fallback'), process.cwd());
  repository.execFile = async () => ({ stdout: '' });
  assert.equal(await repository.threadCwd('empty'), process.cwd());
});
