import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MESSAGE_LENGTH,
  activityLabel,
  cleanUserMessage,
  extractMessageText,
  folderName,
  formatDuration,
  goalStatus,
  inferProgress,
  isAuthorized,
  isInternalMessage,
  presentTask,
  safeJson,
  truncate,
  validateMessageInput,
} from '../src/core.mjs';

test('text helpers normalize, extract and filter visible messages', () => {
  assert.equal(truncate(null), '');
  assert.equal(truncate('  a   b  ', 10), 'a b');
  assert.equal(truncate('abcdef', 5), 'abcd…');
  assert.equal(extractMessageText(null), '');
  assert.equal(extractMessageText([null, { type: 'image', url: 'x' }, { type: 'output_text', text: ' A ' }, { type: 'input_text' }, { type: 'text', text: 'B' }]), 'A \n\nB');
  assert.equal(isInternalMessage(''), true);
  assert.equal(isInternalMessage(null), true);
  assert.equal(isInternalMessage('<image_resize_notice>x'), true);
  assert.equal(isInternalMessage('<environment_context>x'), true);
  assert.equal(isInternalMessage('<recommended_plugins>x'), true);
  assert.equal(isInternalMessage('<app-context>x'), true);
  assert.equal(isInternalMessage('<skills_instructions>x'), true);
  assert.equal(isInternalMessage('<permissions type="x">'), true);
  assert.equal(isInternalMessage('visible'), false);
  assert.equal(cleanUserMessage(null), '');
  assert.equal(cleanUserMessage('<in-app-browser-context>x'), '');
  assert.equal(cleanUserMessage('prefix\n## My request:\nfirst\n## My request:\nreal'), 'real');
  assert.equal(cleanUserMessage(' plain '), 'plain');
  assert.equal(folderName('/a/b/'), 'b');
  assert.equal(folderName(''), '');
});

test('progress inference covers queued, active, paused, done, fresh and idle states', () => {
  assert.equal(inferProgress({ queued: 1 }).state, 'queued');
  assert.equal(inferProgress({ lifecycle: 'task_started', queued: 0 }).state, 'running');
  assert.equal(inferProgress({ lifecycle: 'inProgress', queued: 1 }).state, 'running');
  assert.equal(inferProgress({ lifecycle: 'turn_aborted', queued: 0 }).state, 'paused');
  assert.equal(inferProgress({ lifecycle: 'interrupted', queued: 0 }).state, 'paused');
  assert.equal(inferProgress({ lifecycle: 'failed', queued: 0 }).state, 'failed');
  assert.equal(inferProgress({ lifecycle: 'task_complete', queued: 0 }).state, 'done');
  assert.equal(inferProgress({ lifecycle: 'completed', queued: 0 }).state, 'done');
  assert.equal(inferProgress({ lastActivityAt: 950, now: 1000, queued: 0 }).label, '同步中');
  assert.equal(inferProgress({ lastActivityAt: 1, now: 200_000, queued: 0 }).state, 'idle');
  assert.equal(activityLabel('file_change'), '正在更新文件');
  assert.equal(activityLabel('unknown'), '正在推进任务');
});

test('goal presentation covers every state and readable elapsed time', () => {
  assert.deepEqual(goalStatus('active'), { state: 'active', label: '执行中', tone: 'blue' });
  assert.equal(goalStatus('paused').label, '已暂停');
  assert.equal(goalStatus('blocked').label, '受阻');
  assert.equal(goalStatus('usage_limited').label, '用量受限');
  assert.equal(goalStatus('budget_limited').label, '预算已用完');
  assert.equal(goalStatus('complete').label, '已完成');
  assert.equal(goalStatus('other').label, '状态未知');
  assert.equal(formatDuration(-1), '0 秒');
  assert.equal(formatDuration(undefined), '0 秒');
  assert.equal(formatDuration(42), '42 秒');
  assert.equal(formatDuration(125), '2 分钟');
  assert.equal(formatDuration(7_501), '2 小时 5 分钟');
});

test('task presentation selects safe fallbacks and running activity', () => {
  const base = { id: 'id', cwd: '/work/demo', updated_at_ms: 4, recency_at_ms: 5, queued_count: 0, is_pinned: 1 };
  const running = presentTask({ ...base, name: 'Named', project_name: 'Project', model: 'model' }, { lifecycle: 'task_started', lastActivityType: 'web_search', lastActivityAt: 10, latestUser: 'Next', latestAssistant: 'Result' }, 10);
  assert.deepEqual({ title: running.title, project: running.project, activity: running.activity, pinned: running.pinned }, { title: 'Named', project: 'Project', activity: '正在检索资料', pinned: true });
  assert.equal(running.updatedAt, Date.parse('1970-01-01T00:00:00.010Z'));
  const idle = presentTask({ ...base, name: '', title: '', preview: '', project_name: '', section_name: 'Pinned', recency_at_ms: 0, is_pinned: 0 }, {}, 200_000);
  assert.equal(idle.title, '未命名任务');
  assert.equal(idle.project, 'Pinned');
  assert.equal(idle.activity, '待命');
  assert.equal(idle.latestResult, '');
  assert.equal(presentTask({ ...base, name: '', title: 'T', project_name: '', section_name: '', cwd: '', recency_at_ms: 0 }, {}, 200_000).project, '未分组');
  const fallbacks = presentTask({ id: 'x', name: '', title: '', preview: 'Preview', cwd: null, updated_at_ms: 0, recency_at_ms: null, queued_count: null }, { lastActivityAt: 0, messages: null }, 200_000);
  assert.equal(fallbacks.title, 'Preview');
  assert.equal(fallbacks.updatedAt, 0);
  const queued = presentTask({ ...base, queued_count: 2, queued_message: 'Next', latest_user: 'Previous', latest_assistant: 'Latest', last_activity_at: 12, last_item_type: 'agentMessage', turn_status: 'inProgress' }, {}, 20);
  assert.equal(queued.progress.state, 'running');
  assert.equal(queued.queuedCount, 2);
  assert.equal(queued.latestTask, 'Previous');
  assert.equal(queued.latestResult, 'Latest');
  assert.equal(queued.goal, null);
  const goal = presentTask({ ...base, goal_id: 'g', goal_objective: 'Ship it', goal_status: 'active', goal_time_used_seconds: 3661 }, {}, 20).goal;
  assert.deepEqual(goal, { id: 'g', objective: 'Ship it', status: { state: 'active', label: '执行中', tone: 'blue' }, elapsedSeconds: 3661, elapsed: '1 小时 1 分钟' });
  const emptyGoal = presentTask({ ...base, goal_id: 'g', goal_objective: '', goal_status: 'unknown', goal_time_used_seconds: 0 }, {}, 20).goal;
  assert.equal(emptyGoal.objective, '');
  assert.equal(emptyGoal.elapsedSeconds, 0);
  const cleaned = presentTask({ ...base, latest_user: '<in-app-browser-context>x</in-app-browser-context>\n## My request:\nVisible request' }, {}, 20);
  assert.equal(cleaned.latestTask, 'Visible request');
});

test('message validation and authorization reject unsafe requests', () => {
  assert.equal(validateMessageInput({ threadId: 'bad', message: 'x' }).error, '任务 ID 无效');
  assert.equal(validateMessageInput(undefined).error, '任务 ID 无效');
  assert.equal(validateMessageInput({ threadId: '1234567890abcdef1234', message: ' ' }).error, '请输入消息');
  assert.match(validateMessageInput({ threadId: '1234567890abcdef1234', message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }).error, /不能超过/);
  assert.deepEqual(validateMessageInput({ threadId: ' 1234567890abcdef1234 ', message: ' hi ' }), { ok: true, threadId: '1234567890abcdef1234', message: 'hi' });
  const url = new URL('http://x/?token=secret');
  assert.equal(isAuthorized(url, {}, ''), true);
  assert.equal(isAuthorized(url, {}, 'secret'), true);
  assert.equal(isAuthorized(new URL('http://x/'), { authorization: 'Bearer secret' }, 'secret'), true);
  assert.equal(isAuthorized(new URL('http://x/'), { cookie: 'theme=dark; bridge_session=secret' }, 'secret'), true);
  assert.equal(isAuthorized(new URL('http://x/'), { cookie: 'bridge_session=%E0%A4%A' }, 'secret'), false);
  assert.equal(isAuthorized(new URL('http://x/'), { authorization: 'Basic secret' }, 'secret'), false);
  assert.equal(safeJson({ value: '<a>&' }), '{"value":"\\u003ca\\u003e\\u0026"}');
});
