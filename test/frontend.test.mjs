import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

test('unsupported task creation and steer controls are absent from the phone UI', () => {
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.querySelector('#new-task-button'), null);
  assert.equal(dom.window.document.querySelector('.task-toolbar .filters')?.firstElementChild?.dataset.filter, 'all');
  assert.doesNotMatch(html, /new-task|data-action="steer"/);
  assert.doesNotMatch(css, /new-task|queue-steer|project-picker/);
  assert.match(css, /\.connection-dot\s*\{[^}]*flex:\s*0 0 7px;/s);
  const mobileCss = css.slice(css.indexOf('@media (max-width: 760px)'));
  assert.match(mobileCss, /\.modal-sheet\s*\{[^}]*max-height:\s*calc\(100dvh - max\(8px, env\(safe-area-inset-top\)\)\);/s);
  assert.match(html, /styles\.css\?v=44/);
  assert.match(html, /app\.js\?v=48/);
  assert.match(serviceWorker, /styles\.css\?v=44/);
  assert.match(serviceWorker, /app\.js\?v=48/);
  assert.match(serviceWorker, /['"]\/i18n\.js['"]/);
});

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function task(overrides = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: '同步任务',
    project: 'sync',
    projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    updatedAt: Date.now(),
    activity: '正在推进',
    model: 'gpt-6-sol',
    latestTask: '处理前端问题',
    queuedCount: 3,
    progress: { state: 'running', label: '进行中', tone: 'blue' },
    goal: { objective: '完成移动端', elapsed: '3 分钟', elapsedSeconds: 180, status: { state: 'active', label: '执行中' } },
    ...overrides,
  };
}

function queue(revision = 8) {
  return [
    { id: 'aaaaaaaaaaaaaaaaaaaa', role: 'user', text: '第一条任务', timestamp: Date.now() - 120_000, pending: true, queueOrder: 1, queueRevision: revision },
    { id: 'bbbbbbbbbbbbbbbbbbbb', role: 'user', text: '第二条任务', timestamp: Date.now() - 60_000, pending: true, queueOrder: 2, queueRevision: revision },
    { id: 'cccccccccccccccccccc', role: 'user', text: '第三条任务', timestamp: Date.now(), pending: true, queueOrder: 3, queueRevision: revision },
  ];
}

function todayTokens(overrides = {}) {
  return {
    available: true, recorded: true, date: '2026-09-23', eventCount: 4, fileCount: 2,
    inputTokens: 12_000, cachedInputTokens: 8_000, outputTokens: 345,
    reasoningOutputTokens: 123, totalTokens: 12_345, ...overrides,
  };
}

function activitySummary(overrides = {}) {
  const anchor = new Date('2026-09-28T12:00:00');
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() - (29 - index));
    return {
      date: date.toISOString().slice(0, 10),
      turns: index % 4,
      completedTurns: index % 5,
      durationMs: (index % 5) * 60_000,
    };
  });
  return {
    days, activeDays: 24, totalTurns: 43, completedTurns: 60,
    totalDurationMs: 7_260_000, projectCount: 3, taskCount: 18,
    recentTaskCount: 6, archivedTaskCount: 2, updatedAt: Date.now(), ...overrides,
  };
}

class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = String(url);
    this.listeners = new Map();
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
  close() { this.closed = true; }
}

async function setup({ failing = new Map(), empty = false, taskCount = 1 } = {}) {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8787/?token=secret#11111111-1111-1111-1111-111111111111', pretendToBeVisual: true });
  const openedUrls = [];
  dom.window.open = (...args) => { openedUrls.push(args); return null; };
  dom.window.localStorage.setItem('codex-local-hub-language-choice', 'zh-CN');
  const previous = {};
  for (const name of ['window', 'document', 'location', 'history', 'localStorage', 'EventSource', 'fetch', 'requestAnimationFrame', 'setInterval', 'setTimeout', 'clearTimeout']) previous[name] = globalThis[name];
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    history: dom.window.history,
    localStorage: dom.window.localStorage,
    EventSource: FakeEventSource,
    requestAnimationFrame: (callback) => { callback(); return 1; },
    setInterval: () => 1,
    setTimeout: (callback) => { callback(); return 1; },
    clearTimeout: () => undefined,
  });
  FakeEventSource.instances = [];
  let queued = queue();
  let messageMode = 'started';
  let versionInfo = { currentVersion: '0.2.38', latestVersion: '0.2.38', state: 'latest', updateAvailable: false, canUpdate: false, requiresDesktop: false, checkedAt: Date.now() };
  let runtimeVersion = '0.2.38';
  let updateResponse = { accepted: true, version: { currentVersion: '0.2.38', latestVersion: '0.2.39', state: 'available', updateAvailable: true, canUpdate: true, requiresDesktop: false } };
  const deliveryTimestamp = Date.now();
  const sampleDeliveries = [
    { id: 'one.png', title: '首页截图', createdAt: deliveryTimestamp, size: 200, mime: 'image/png', url: '/api/deliveries/files/one.png' },
    { id: 'two.jpg', title: '最终效果', createdAt: deliveryTimestamp - 60_000, size: 2048, mime: 'image/jpeg', url: '/api/deliveries/files/two.jpg' },
  ];
  let deliveries = empty ? [] : sampleDeliveries;
  const calls = [];
  const availableTasks = Array.from({ length: taskCount }, (_, index) => task(index === 0 ? {} : {
    id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    title: `同步任务 ${index + 1}`,
    project: `project-${(index % 4) + 1}`,
    updatedAt: Date.now() - index * 60_000,
  }));
  const projects = [{ id: task().projectId, name: 'sync' }, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'growth' }];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push([url.pathname, options.method || 'GET', options.body]);
    if (failing.has(url.pathname)) return response({ error: failing.get(url.pathname) }, 500);
    if (url.pathname === '/api/tasks') return response({ tasks: empty ? [] : availableTasks, syncedAt: Date.now() });
    if (url.pathname === '/api/version') return response({ version: versionInfo });
    if (url.pathname === '/api/health') return response({ ok: true, version: runtimeVersion });
    if (url.pathname === '/api/update' && options.method === 'POST') return response(updateResponse, updateResponse.error ? 409 : 202);
    if (url.pathname === '/api/projects') return response({ projects: empty ? [] : projects });
    if (url.pathname === `/api/projects/${task().projectId}/tasks` && options.method === 'POST') {
      const createdMessage = JSON.parse(options.body).message;
      return response({ created: true, threadId: createdMessage === '未出现在列表' ? 'new-thread' : task().id, projectId: task().projectId, project: 'sync' }, 201);
    }
    if (url.pathname === '/api/usage') return response({ usage: empty ? { available: false, limits: [], todayTokens: { available: false } } : { planType: 'pro', limits: [{ label: '周', usedPercent: 20, remainingPercent: 80, resetsAt: Date.now() + 60_000 }], todayTokens: todayTokens() } });
    if (url.pathname === '/api/activity') return response({ activity: activitySummary(empty ? { days: [], activeDays: 0, totalTurns: 0, completedTurns: 0, totalDurationMs: 0, projectCount: 0, taskCount: 0, recentTaskCount: 0 } : {}) });
    if (url.pathname === '/api/account') return response({ account: empty ? { available: false, name: null, initial: null } : { available: true, name: 'alice', initial: 'A' } });
    if (url.pathname === '/api/deliveries' && options.method === 'DELETE') {
      const deleted = deliveries.length;
      deliveries = [];
      return response({ deleted });
    }
    if (url.pathname === '/api/deliveries') return response({ deliveries });
    if (url.pathname === `/api/tasks/${task().id}`) return response({ task: { ...task(), messages: empty ? [] : [{ id: 'm1', role: 'assistant', text: '结果', timestamp: Date.now(), pending: false }], queuedTasks: empty ? [] : queued } });
    if (url.pathname === `/api/tasks/${task().id}/stop` && options.method === 'POST') return response({ stopped: true, threadId: task().id });
    if (url.pathname === `/api/tasks/${task().id}/archive` && options.method === 'POST') return response({ archived: true, threadId: task().id });
    if (url.pathname === `/api/projects/${task().projectId}` && options.method === 'DELETE') return response({ deleted: true, projectId: task().projectId, name: JSON.parse(options.body).name, filesDeleted: false });
    if (url.pathname === `/api/tasks/${task().id}/queue` && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      queued = body.itemIds.map((id) => queued.find((item) => item.id === id)).map((item, index) => ({ ...item, queueOrder: index + 1, queueRevision: 9 }));
      return response({ queuedTasks: queued });
    }
    if (url.pathname.endsWith('/steer') && options.method === 'POST') {
      const itemId = url.pathname.split('/').at(-2);
      queued = [queued.find((item) => item.id === itemId), ...queued.filter((item) => item.id !== itemId)].filter(Boolean).map((item, index) => ({ ...item, queueOrder: index + 1, queueRevision: 11 }));
      return response({ result: { accepted: true, mode: 'prioritized' }, queuedTasks: queued });
    }
    if (url.pathname.startsWith(`/api/tasks/${task().id}/queue/`) && options.method === 'DELETE') {
      queued = queued.filter((item) => !url.pathname.endsWith(item.id)).map((item) => ({ ...item, queueRevision: 10 }));
      return response({ queuedTasks: queued });
    }
    if (url.pathname === '/api/messages') return response({ accepted: true, mode: messageMode }, 202);
    return response({ error: 'missing' }, 404);
  };
  const module = await import(`../public/app.js?test=${Date.now()}-${Math.random()}`);
  await new Promise((resolve) => setImmediate(resolve));
  const cleanup = () => {
    dom.window.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  };
  return {
    dom, module, calls, failing, openedUrls,
    setMessageMode: (mode) => { messageMode = mode; },
    setVersionInfo: (value) => { versionInfo = value; },
    setRuntimeVersion: (value) => { runtimeVersion = value; },
    setUpdateResponse: (value) => { updateResponse = value; },
    cleanup,
  };
}

test('frontend renders tasks, details, usage and every queue interaction', async (t) => {
  const failures = new Map();
  const { dom, module: ui, calls, failing: activeFailures, openedUrls, setMessageMode, setVersionInfo, setRuntimeVersion, setUpdateResponse, cleanup } = await setup({ failing: failures, taskCount: 24 });
  t.after(cleanup);
  const document = dom.window.document;
  assert.equal(dom.window.location.search, '');
  ui.stripTokenFromUrl();
  assert.equal(ui.ignoreFailure(), undefined);
  assert.equal(document.querySelector('#version-current').textContent, 'v0.2.38');
  assert.equal(document.querySelector('#version-state').textContent, '最新');
  assert.equal(document.querySelector('#success-card').hidden, false);
  assert.match(document.querySelector('#success-card').textContent, /已连接.*v0\.2\.38.*服务正常/s);
  assert.match(document.querySelector('.success-actions a').href, /github\.com\/makorise\/codex-local-hub/);
  document.querySelector('#report-issue').click();
  assert.equal(openedUrls.length, 1);
  const issueUrl = new URL(openedUrls[0][0]);
  assert.equal(issueUrl.origin + issueUrl.pathname, 'https://github.com/makorise/codex-local-hub/issues/new');
  assert.match(issueUrl.searchParams.get('body'), /Codex Lookout: v0\.2\.38/);
  assert.match(issueUrl.searchParams.get('body'), /Service: healthy/);
  assert.doesNotMatch(issueUrl.searchParams.get('body'), /同步任务|192\.168|\/Users\//);
  assert.deepEqual(ui.safeIssueDiagnostics(), { version: '0.2.38', service: 'healthy', language: 'zh-CN' });
  assert.match(ui.buildIssueUrl({ version: '1.2.3', service: 'offline', language: 'en' }), /issues\/new\?/);
  ui.state.connected = false;
  ui.state.version = null;
  assert.equal(ui.renderSuccessState(), false);
  assert.deepEqual(ui.safeIssueDiagnostics(), { version: 'unknown', service: 'offline', language: 'zh-CN' });
  ui.setConnection(true, '已同步');
  ui.state.version = { currentVersion: 'unknown' };
  assert.equal(ui.renderSuccessState(), false);
  ui.state.version = { currentVersion: '0.2.38', latestVersion: '0.2.38', state: 'latest' };
  assert.equal(ui.renderSuccessState(), true);
  document.querySelector('#version-button').click();
  assert.equal(document.querySelector('#modal-title').textContent, 'Codex 瞭望台版本');
  assert.match(document.querySelector('.version-card').textContent, /最新正式版/);
  document.querySelector('[data-action="version-refresh"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some(([path]) => path === '/api/version'));
  ui.closeContent();
  const latestVersion = { currentVersion: '0.2.39', latestVersion: '0.2.39', state: 'latest', updateAvailable: false, canUpdate: false, requiresDesktop: false };
  const availableVersion = { currentVersion: '0.2.38', latestVersion: '0.2.39', state: 'available', updateAvailable: true, canUpdate: true, requiresDesktop: false };
  ui.state.version = { ...availableVersion, canUpdate: false, requiresDesktop: true };
  ui.renderVersion();
  ui.renderVersionDetails();
  assert.match(document.querySelector('.version-note').textContent, /Mac 宿主程序/);
  ui.state.version = { ...availableVersion };
  ui.renderVersion();
  ui.renderVersionDetails();
  assert.equal(document.querySelector('#version-button').classList.contains('is-update'), true);
  setVersionInfo(latestVersion);
  setRuntimeVersion('0.2.39');
  assert.equal(await ui.requestPhoneUpdate(), true);
  assert.equal(ui.state.version.state, 'latest');
  ui.state.version = { ...availableVersion };
  setUpdateResponse({ accepted: false, version: latestVersion });
  ui.renderVersionDetails();
  document.querySelector('[data-action="version-update"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.state.version.state, 'latest');
  setUpdateResponse({ error: '需要电脑更新', version: { ...availableVersion, canUpdate: false, requiresDesktop: true } });
  setVersionInfo({ ...availableVersion, canUpdate: false, requiresDesktop: true });
  ui.state.version = { ...availableVersion };
  assert.equal(await ui.requestPhoneUpdate(), false);
  ui.state.version = { ...availableVersion, state: 'ahead' };
  ui.renderVersion();
  assert.equal(document.querySelector('#version-state').textContent, '开发版');
  ui.state.version = { ...availableVersion, state: 'unavailable', latestVersion: null };
  ui.renderVersionDetails();
  assert.match(document.querySelector('.version-card').textContent, /暂时无法读取/);
  ui.state.version = {};
  ui.renderVersion();
  ui.renderVersionDetails();
  assert.equal(ui.versionStateLabel(null), '待检查');
  assert.match(document.querySelector('.version-card').textContent, /未知/);
  ui.state.version = null;
  ui.renderVersion();
  assert.equal(document.querySelector('#version-button').hidden, true);
  assert.equal(ui.renderVersionDetails(), false);
  setVersionInfo(latestVersion);
  assert.equal((await ui.loadVersion()).state, 'latest');
  activeFailures.set('/api/version', 'version unavailable');
  ui.state.version = { ...availableVersion };
  ui.renderVersionDetails();
  document.querySelector('[data-action="version-refresh"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(ui.loadVersion({ force: true }), /version unavailable/);
  activeFailures.delete('/api/version');
  assert.equal(await ui.waitForRuntimeVersion('0.2.38', { attempts: 1, pause: async () => {}, fetchImpl: async () => response({}, 500) }), null);
  assert.equal(await ui.waitForRuntimeVersion('0.2.38', { attempts: 1, pause: async () => {}, fetchImpl: async () => { throw new Error('restart'); } }), null);
  assert.equal(await ui.waitForRuntimeVersion('0.2.38', { attempts: 1, pause: async () => {}, fetchImpl: async () => response({ version: '0.2.38' }) }), null);
  assert.equal(await ui.waitForRuntimeVersion('0.2.38', { attempts: 1, pause: async () => {}, fetchImpl: async () => response({ version: '0.2.39' }) }), '0.2.39');
  ui.state.version = { ...availableVersion };
  setUpdateResponse({ accepted: true, version: availableVersion });
  setRuntimeVersion('0.2.38');
  activeFailures.set('/api/version', 'version unavailable');
  assert.equal(await ui.requestPhoneUpdate(), false);
  activeFailures.delete('/api/version');
  setVersionInfo(latestVersion);
  setRuntimeVersion('0.2.39');
  assert.equal(document.querySelectorAll('.task-card').length, 24);
  assert.equal(document.querySelector('.task-model').textContent, 'gpt-6-sol');
  assert.equal(document.querySelector('.task-model').getAttribute('aria-label'), '任务模型：gpt-6-sol');
  assert.doesNotMatch(ui.renderTaskCard(task({ model: null })), /task-model/);
  const firstCardHead = document.querySelector('.task-card-head');
  assert.equal(firstCardHead.querySelector('h3').textContent, '同步任务');
  assert.equal(firstCardHead.querySelector('.status-pill') !== null, true);
  assert.equal(firstCardHead.querySelector('time') !== null, true);
  assert.equal(document.querySelectorAll('.project-group').length, 5);
  assert.equal(document.querySelector('#task-count').textContent, '24');
  assert.equal(document.querySelector('#active-count').textContent, '24');
  assert.equal(document.querySelector('#queued-count').textContent, '72');
  assert.equal(document.querySelector('#done-count').textContent, '0');
  assert.equal(document.querySelector('.project-heading strong').textContent, 'sync');
  const firstProjectToggle = document.querySelector('.project-group-toggle');
  firstProjectToggle.click();
  assert.equal(document.querySelector('.project-group-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(document.querySelector('.project-group-tasks').hidden, true);
  assert.equal(document.querySelectorAll('.project-group-tasks:not([hidden]) .task-card').length, 23);
  assert.equal(ui.isProjectCollapsed('sync'), true);
  document.querySelector('.project-group-toggle').click();
  assert.equal(document.querySelector('.project-group-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelectorAll('.task-card').length, 24);
  assert.equal(ui.isProjectCollapsed('sync'), false);
  assert.equal(ui.projectName({ project: null }), '');
  assert.equal(ui.projectLabel(''), '未分类');
  assert.equal(ui.projectTaskCount(1), '1 个任务');
  assert.equal(ui.projectTaskCount(2), '2 个任务');
  assert.equal(ui.groupTasksByProject([]).length, 0);
  const groupedOrder = ui.orderTasksByProject([
    task({ id: 'a1', project: 'A' }), task({ id: 'b1', project: 'B' }), task({ id: 'a2', project: 'A' }),
  ]);
  assert.deepEqual(groupedOrder.map((item) => item.id), ['a1', 'a2', 'b1']);
  const originalTasks = ui.state.tasks;
  const originalSelectedId = ui.state.selectedId;
  const unreadOne = task({ id: 'unread-one', updatedAt: 100, title: '后台任务一' });
  const unreadTwo = task({ id: 'unread-two', updatedAt: 100, title: '后台任务二' });
  const alreadyRead = task({ id: 'already-read', updatedAt: 100, title: '已读任务' });
  const invalidInitialTime = task({ id: 'invalid-initial-time', updatedAt: 'invalid' });
  ui.state.selectedId = null;
  document.querySelector('#detail-pane').classList.remove('is-open');
  ui.state.unreadTaskIds.clear();
  localStorage.removeItem(ui.taskReadKey(unreadOne.id));
  localStorage.removeItem(ui.taskReadKey(invalidInitialTime.id));
  localStorage.setItem(ui.taskReadKey(unreadTwo.id), '50');
  localStorage.setItem(ui.taskReadKey(alreadyRead.id), '200');
  assert.equal(ui.syncUnreadTasks(new Map(), [unreadOne, unreadTwo, alreadyRead, invalidInitialTime], true), 1);
  assert.equal(localStorage.getItem(ui.taskReadKey(unreadOne.id)), '100');
  assert.ok(Number(localStorage.getItem(ui.taskReadKey(invalidInitialTime.id))) > 0);
  assert.equal(ui.state.unreadTaskIds.has(unreadTwo.id), true);
  assert.equal(ui.state.unreadTaskIds.has(alreadyRead.id), false);
  ui.state.tasks = [unreadOne, unreadTwo, alreadyRead];
  ui.renderList();
  assert.equal(document.querySelectorAll('.unread-dot').length, 1);
  assert.equal(document.querySelector('.unread-dot').getAttribute('aria-label'), '有新进展');
  assert.equal(document.title, '(1) Codex 瞭望台');
  assert.equal(ui.markTaskRead(null), false);
  assert.equal(ui.markTaskRead(unreadTwo), true);
  assert.equal(ui.markTaskRead(unreadTwo), false);
  ui.markTaskRead({ id: 'negative-time', updatedAt: -1 });
  assert.equal(localStorage.getItem(ui.taskReadKey('negative-time')), '0');
  ui.markTaskRead({ id: 'invalid-time', updatedAt: 'invalid' });
  assert.ok(Number(localStorage.getItem(ui.taskReadKey('invalid-time'))) > 0);

  ui.state.unreadTaskIds.add('gone');
  ui.state.unreadTaskIds.add(unreadOne.id);
  const changedOne = { ...unreadOne, updatedAt: 101 };
  const newTask = task({ id: 'new-task', updatedAt: 100 });
  assert.equal(ui.syncUnreadTasks(new Map([[unreadOne.id, unreadOne], [alreadyRead.id, alreadyRead]]), [changedOne, alreadyRead, newTask]), 2);
  assert.equal(ui.state.unreadTaskIds.has('gone'), false);
  assert.equal(ui.state.unreadTaskIds.has(unreadOne.id), true);
  assert.equal(ui.state.unreadTaskIds.has(newTask.id), true);
  assert.equal(ui.state.unreadTaskIds.has(alreadyRead.id), false);

  ui.state.tasks = [alreadyRead];
  ui.state.selectedId = alreadyRead.id;
  assert.equal(ui.isTaskActivelyViewed(alreadyRead.id), false);
  document.querySelector('#detail-pane').classList.add('is-open');
  ui.state.unreadTaskIds.add(alreadyRead.id);
  assert.equal(ui.isTaskActivelyViewed(alreadyRead.id), true);
  assert.equal(ui.isTaskActivelyViewed('another-task'), false);
  assert.equal(ui.syncUnreadTasks(new Map([[alreadyRead.id, alreadyRead]]), [alreadyRead]), 0);
  const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  assert.equal(ui.isTaskActivelyViewed(alreadyRead.id), false);
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
  assert.equal(document.title, 'Codex 瞭望台');

  ui.state.unreadTaskIds.clear();
  ui.state.tasks = originalTasks;
  ui.state.selectedId = originalSelectedId;
  document.querySelector('#detail-pane').classList.add('is-open');
  ui.state.tasks = originalTasks.slice(0, 5);
  ui.renderList();
  assert.equal(document.querySelectorAll('.project-group').length, 0);
  assert.equal(document.querySelectorAll('.task-project').length, 5);
  ui.state.tasks = originalTasks;
  ui.renderList();
  assert.equal(document.querySelector('#detail-pane').classList.contains('is-open'), true);
  assert.equal(document.querySelector('#usage-summary').textContent, '周窗口剩余 80%');
  assert.match(document.querySelector('#usage-today-value').textContent, /1\.2万 tokens/);
  assert.match(document.querySelector('#usage-card').getAttribute('aria-label'), /今日 Token/);
  assert.equal(document.querySelector('#account-badge').hidden, false);
  assert.equal(document.querySelector('#account-name').textContent, 'alice');
  assert.equal(document.querySelector('#account-initial').textContent, 'A');
  assert.equal(document.querySelector('#account-badge').getAttribute('aria-label'), '当前 Codex 账号：alice');
  assert.equal(document.querySelectorAll('.delivery-thumb').length, 2);
  assert.equal(document.querySelector('#delivery-inbox').hidden, false);
  assert.equal(document.querySelector('#new-task-button'), null);
  assert.equal(document.querySelector('[data-action="steer"]'), null);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/projects') return response({ projects: null });
    return originalFetch(input, options);
  };
  assert.deepEqual(await ui.loadProjects(), []);
  globalThis.fetch = originalFetch;
  activeFailures.set('/api/projects', 'projects unavailable');
  await assert.rejects(ui.loadProjects(), /projects unavailable/);
  activeFailures.delete('/api/projects');
  document.querySelector('#language-button').click();
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.querySelector('[data-filter="all"] span').textContent, 'All');
  assert.equal(document.querySelector('#connection-text').textContent.includes('Synced'), true);
  assert.equal(document.querySelector('#account-badge').getAttribute('aria-label'), 'Current Codex account: alice');
  assert.equal(document.querySelector('#usage-summary').textContent, 'Weekly window: 80% remaining');
  assert.match(document.querySelector('#usage-card').getAttribute('aria-label'), /Tokens today/);
  assert.equal(document.querySelector('#delivery-count').textContent, '2 images');
  assert.equal(document.querySelector('.task-card-foot span').textContent, 'Making progress');
  assert.equal(document.querySelector('#refresh-button').getAttribute('aria-label'), 'Refresh tasks');
  assert.equal(ui.relativeTime(Date.now() - 10_000), 'Just now');
  assert.match(ui.relativeTime(Date.now() - 120_000), /min ago/);
  assert.match(ui.relativeTime(Date.now() - 7_200_000), /hr ago/);
  assert.equal(ui.formatReset(0), 'Reset time unavailable');
  assert.equal(ui.formatDuration(0), '0 sec');
  assert.equal(ui.formatDuration(60), '1 min');
  assert.equal(ui.formatDuration(3_661), '1 hr 1 min');
  assert.equal(ui.usageWindowLabel({ windowDurationMins: 30 }), '30 min');
  assert.equal(ui.usageWindowLabel({ windowDurationMins: 120 }), '2 hr');
  assert.equal(ui.usageWindowLabel({ windowDurationMins: 2_880 }), '2 days');
  assert.equal(ui.usageWindowLabel({ windowDurationMins: 10_080 }), 'Weekly');
  assert.equal(ui.usageWindowLabel({ label: '周' }), 'Weekly');
  assert.equal(ui.usageWindowLabel({ label: '自定义' }), 'Weekly');
  assert.equal(ui.usageWindowLabel({ label: 'Custom' }), 'Custom');
  assert.equal(ui.usageWindowLabel({}), 'Weekly');
  assert.equal(ui.formatTokenCount(-2), '0');
  assert.equal(ui.formatTokenCount(), '0');
  assert.equal(ui.formatTokenCount(12_345), '12.3K');
  assert.equal(ui.localizedProgress(task({ progress: { state: 'mystery', label: '未知', tone: 'slate' } })), 'Unknown');
  assert.equal(ui.localizedProgress(task({ progress: { state: 'mystery', label: '', tone: 'slate' } })), '');
  assert.equal(ui.localizedActivity(task({ activity: '正在更新文件' })), 'Updating files');
  assert.equal(ui.localizedActivity(task({ activity: '正在推进' })), 'Making progress');
  assert.equal(ui.localizedActivity(task({ activity: 'Custom activity' })), 'Custom activity');
  assert.equal(ui.localizedActivity(task({ activity: '' })), '');
  assert.equal(ui.localizedActivity(task({ progress: { state: 'paused', label: '已暂停', tone: 'amber' } })), 'Paused');
  assert.equal(ui.localizedGoalStatus({ status: { state: 'unexpected' } }), 'Unknown');
  assert.equal(ui.localizedGoalStatus(), 'Unknown');
  assert.equal(ui.localizedError('中文错误', 'error.sync'), 'Sync failed');
  assert.equal(ui.localizedError('', 'error.sync'), 'Sync failed');
  assert.equal(ui.localizedError('Network down', 'error.sync'), 'Network down');
  assert.equal(ui.preferredLanguage({ languages: ['en-US'], language: 'zh-CN' }), 'en-US');
  assert.equal(ui.preferredLanguage({ languages: [], language: 'en-GB' }), 'en-GB');
  assert.equal(ui.preferredLanguage({}), 'zh-CN');
  ui.state.syncedAt = null;
  document.querySelector('#language-button').click();
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(ui.localizedError('中文错误', 'error.sync'), '中文错误');
  assert.equal(ui.localizedProgress(task({ progress: { state: 'mystery', label: '未知', tone: 'slate' } })), '未知');
  assert.equal(ui.usageWindowLabel({ label: '自定义' }), '自定义');
  assert.equal(ui.renderTodayTokens(null), '');
  assert.equal(document.querySelector('#usage-today').hidden, true);
  assert.match(ui.renderTodayTokens(todayTokens()), /tokens/);
  assert.equal(ui.renderTodayTokens(todayTokens({ recorded: false })), '今日暂无记录');
  ui.state.account = { available: true, name: 'bob', initial: '' };
  ui.renderAccount();
  assert.equal(document.querySelector('#account-initial').textContent, '#');
  ui.state.account = null;
  ui.renderAccount();
  assert.equal(document.querySelector('#account-badge').hidden, true);
  await ui.loadAccount();
  assert.equal(document.querySelector('#account-name').textContent, 'alice');
  assert.equal(await ui.sendTaskMessage(''), null);

  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 390 });
  ui.renderInstallTip();
  assert.equal(document.querySelector('#install-tip').hidden, false);
  document.querySelector('#install-help').click();
  assert.match(document.querySelector('#modal-content').textContent, /Safari/);
  ui.closeContent();
  document.querySelector('#install-dismiss').click();
  assert.equal(document.querySelector('#install-tip').hidden, true);
  localStorage.removeItem('codex-local-hub-install-dismissed');
  Object.defineProperty(dom.window.navigator, 'standalone', { configurable: true, value: true });
  assert.equal(ui.shouldShowInstallTip(), false);
  Object.defineProperty(dom.window.navigator, 'standalone', { configurable: true, value: false });
  dom.window.matchMedia = () => ({ matches: true });
  assert.equal(ui.shouldShowInstallTip(), false);
  dom.window.matchMedia = () => ({ matches: false });
  assert.equal(ui.shouldShowInstallTip(), true);

  let serviceWorkerUpdates = 0;
  Object.defineProperty(dom.window.navigator, 'serviceWorker', { configurable: true, value: { register: async (path, options) => {
    assert.equal(path, '/service-worker.js');
    assert.deepEqual(options, { updateViaCache: 'none' });
    return { update: async () => { serviceWorkerUpdates += 1; } };
  } } });
  assert.equal(await ui.registerServiceWorker(), true);
  assert.equal(serviceWorkerUpdates, 1);
  Object.defineProperty(dom.window.navigator, 'serviceWorker', { configurable: true, value: { register: async () => ({ update: async () => { throw new Error('offline'); } }) } });
  assert.equal(await ui.registerServiceWorker(), true);
  Object.defineProperty(dom.window.navigator, 'serviceWorker', { configurable: true, value: { register: async () => { throw new Error('no'); } } });
  assert.equal(await ui.registerServiceWorker(), false);
  const localLocation = globalThis.location;
  globalThis.location = { protocol: 'https:', hostname: 'hub.example' };
  Object.defineProperty(dom.window.navigator, 'serviceWorker', { configurable: true, value: { register: async () => ({}) } });
  assert.equal(await ui.registerServiceWorker(), true);
  globalThis.location = { protocol: 'http:', hostname: 'hub.example' };
  assert.equal(await ui.registerServiceWorker(), false);
  globalThis.location = localLocation;
  const stableThumbnail = document.querySelector('.delivery-thumb');
  await ui.loadDeliveries();
  assert.equal(document.querySelector('.delivery-thumb'), stableThumbnail);
  assert.equal(ui.deliverySignature(), '');
  document.querySelector('.delivery-thumb').click();
  assert.equal(document.querySelector('#modal-title').textContent, '首页截图');
  assert.match(document.querySelector('.delivery-view').textContent, /1 KB/);
  ui.closeContent();
  document.querySelectorAll('.delivery-thumb')[1].click();
  assert.match(document.querySelector('.delivery-view').textContent, /2 KB/);
  ui.closeContent();
  document.querySelector('#delivery-list').click();
  const originalDeliveries = [...ui.state.deliveries];
  document.querySelector('#delivery-clear').click();
  assert.equal(document.querySelector('#delivery-clear').textContent, '确认');
  assert.match(document.querySelector('#delivery-clear').getAttribute('aria-label'), /再次点击/);
  document.querySelector('#delivery-clear').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.querySelector('#delivery-inbox').hidden, true);
  assert.ok(calls.some(([path, method]) => path === '/api/deliveries' && method === 'DELETE'));
  ui.state.deliveries = originalDeliveries;
  ui.renderDeliveries();
  ui.resetDeliveryClearButton();
  assert.equal(document.querySelector('#recent-messages').textContent.includes('结果'), true);
  document.querySelector('.task-card').click();
  await new Promise((resolve) => setImmediate(resolve));
  const detailScroller = document.querySelector('.detail-scroll');
  Object.defineProperties(detailScroller, {
    scrollHeight: { configurable: true, value: 1_000 },
    clientHeight: { configurable: true, value: 300 },
    scrollTop: { configurable: true, writable: true, value: 240 },
  });
  await ui.loadDetail(task().id);
  assert.equal(detailScroller.scrollTop, 240);
  const stableMessage = { id: 'm1', role: 'assistant', text: '结果', timestamp: 1, pending: false };
  ui.state.details.set(task().id, { messages: [stableMessage], queuedTasks: queue() });
  ui.renderDetail();
  const unchangedMessageRow = document.querySelector('.message-row');
  ui.renderDetail();
  assert.equal(document.querySelector('.message-row'), unchangedMessageRow);
  assert.equal(ui.messageSignature([stableMessage]), ui.messageSignature([stableMessage]));
  assert.equal(ui.messageSignature(), '');
  assert.match(ui.messageSignature([{ ...stableMessage, pending: true }]), /true/);

  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this === detailScroller) return { top: 100, bottom: 400 };
    if (this.dataset?.messageId === 'm1') {
      const top = this === unchangedMessageRow ? 140 : 110;
      return { top, bottom: top + 40 };
    }
    if (this.dataset?.messageId === 'm2') return { top: 160, bottom: 200 };
    return originalRect.call(this);
  };
  const anchored = ui.captureConversationScroll();
  assert.equal(anchored.anchorId, 'm1');
  assert.equal(anchored.anchorOffset, 40);
  const editedMessage = { ...stableMessage, text: '结果已更新' };
  ui.state.details.set(task().id, {
    messages: [editedMessage],
    queuedTasks: queue(),
  });
  ui.renderDetail();
  assert.equal(detailScroller.scrollTop, 210);
  const anchoredMessageRow = document.querySelector('.message-row');
  ui.state.details.set(task().id, {
    messages: [editedMessage, { id: 'm2', role: 'assistant', text: '新消息', timestamp: 2, pending: false }],
    queuedTasks: queue(),
  });
  ui.renderDetail();
  assert.equal(detailScroller.scrollTop, 210);
  assert.equal(document.querySelector('.message-row'), anchoredMessageRow);
  assert.doesNotMatch(document.querySelector('#recent-messages').textContent, /新消息/);
  assert.equal(document.querySelector('#new-message-indicator').hidden, false);
  dom.window.HTMLElement.prototype.getBoundingClientRect = originalRect;

  document.querySelector('#new-message-indicator').click();
  assert.equal(detailScroller.scrollTop, 700);
  assert.equal(document.querySelector('#new-message-indicator').hidden, true);
  assert.match(document.querySelector('#recent-messages').textContent, /新消息/);
  document.querySelector('#new-message-indicator').hidden = false;
  detailScroller.scrollTop = 100;
  detailScroller.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(document.querySelector('#new-message-indicator').hidden, false);
  detailScroller.scrollTop = 700;
  detailScroller.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(document.querySelector('#new-message-indicator').hidden, true);
  ui.state.details.set(task().id, {
    messages: [stableMessage, { id: 'm2', role: 'assistant', text: '新消息', timestamp: 2 }, { id: 'm3', role: 'assistant', text: '最新消息', timestamp: 3 }],
    queuedTasks: queue(),
  });
  ui.renderDetail({ followLatest: true });
  assert.equal(document.querySelector('#new-message-indicator').hidden, true);
  ui.renderDetail({ followLatest: true });
  assert.equal(detailScroller.scrollTop, 700);
  detailScroller.scrollTop = 696;
  assert.equal(ui.captureConversationScroll().followLatest, true);
  detailScroller.scrollTop = 240;
  await ui.loadDetail(task().id, { followLatest: true });
  assert.equal(detailScroller.scrollTop, 700);
  ui.restoreConversationScroll(null);
  detailScroller.scrollTop = -4;
  assert.equal(ui.captureConversationScroll().scrollTop, 0);
  const detailScrollerParent = detailScroller.parentNode;
  const detailScrollerNext = detailScroller.nextSibling;
  detailScroller.remove();
  assert.equal(ui.captureConversationScroll(), null);
  ui.restoreConversationScroll({ followLatest: true, scrollTop: 0 });
  ui.scrollConversationToLatest();
  detailScrollerParent.insertBefore(detailScroller, detailScrollerNext);
  assert.equal(ui.escapeHtml('<a>\'"&'), '&lt;a&gt;&#39;&quot;&amp;');
  assert.equal(ui.escapeHtml(null), '');
  assert.equal(ui.api('/api/tasks').pathname, '/api/tasks');
  assert.equal(ui.relativeTime(Date.now() - 10_000), '刚刚');
  assert.match(ui.relativeTime(Date.now() - 120_000), /分钟前/);
  assert.match(ui.relativeTime(Date.now() - 7_200_000), /小时前/);
  assert.ok(ui.relativeTime(Date.now() - 172_800_000));
  assert.equal(ui.formatReset(0), '重置时间未知');
  await ui.loadUsage();

  document.querySelector('#task-menu-button').click();
  assert.equal(document.querySelectorAll('.management-action').length, 3);
  const projectDelete = document.querySelector('[data-action="delete-project"]');
  projectDelete.click();
  assert.equal(projectDelete.classList.contains('is-confirming'), true);
  assert.match(projectDelete.textContent, /再次点击/);
  projectDelete.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some(([path, method]) => path === `/api/projects/${task().projectId}` && method === 'DELETE'));
  document.querySelector('#task-menu-button').click();
  document.querySelector('[data-action="stop"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some(([path, method]) => path === `/api/tasks/${task().id}/stop` && method === 'POST'));

  document.querySelector('#queue-card').click();
  assert.equal(document.querySelectorAll('.queue-manager-list li').length, 3);
  document.querySelector('[data-action="expand"]').click();
  assert.equal(document.querySelector('.queue-manager-list li').classList.contains('is-expanded'), true);
  await ui.reorderQueue(queue()[1].id, -1);
  assert.equal(document.querySelector('.queue-copy strong').textContent, '第二条任务');
  document.querySelector('[data-action="delete"]').click();
  assert.equal(document.querySelector('[data-action="delete"]').textContent.trim(), '确认');
  await ui.deleteQueueItem(document.querySelector('[data-queue-id]').dataset.queueId);
  assert.equal(document.querySelectorAll('.queue-manager-list li').length, 2);

  document.querySelector('#modal-close').click();
  assert.equal(document.querySelector('#content-modal').hidden, true);
  document.querySelector('#latest-task-preview').click();
  assert.equal(document.querySelector('#modal-title').textContent, '最后一个问题');
  document.querySelector('.modal-backdrop').click();
  document.querySelector('#goal-card').click();
  assert.match(document.querySelector('#modal-content').textContent, /完成移动端/);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  document.querySelector('#usage-card').click();
  assert.equal(document.querySelector('#modal-title').textContent, '活动数据');
  assert.equal(document.querySelector('.modal-sheet').classList.contains('activity-sheet'), true);
  assert.equal(document.querySelectorAll('.activity-metrics article').length, 4);
  assert.match(document.querySelector('.activity-dashboard').textContent, /近 30 天完成了 60 个工作回合/);
  assert.match(document.querySelector('.activity-dashboard').textContent, /今日 Token/);
  assert.match(document.querySelector('.activity-dashboard').textContent, /本周余量 80%/);
  assert.equal(document.querySelector('[data-range="7"]').classList.contains('is-active'), true);
  document.querySelector('[data-range="30"]').click();
  assert.equal(document.querySelector('[data-range="30"]').classList.contains('is-active'), true);
  assert.match(document.querySelector('.activity-chart-line').getAttribute('d'), /^M /);
  document.querySelector('#modal-close').click();
  assert.equal(document.querySelector('.modal-sheet').classList.contains('activity-sheet'), false);

  const textarea = document.querySelector('#message-input');
  textarea.value = '继续处理';
  textarea.dispatchEvent(new dom.window.Event('input'));
  document.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(textarea.value, '');
  assert.match(document.querySelector('#composer-hint').textContent, /桌面端自动接管/);
  assert.ok(calls.some(([path, method]) => path === '/api/messages' && method === 'POST'));
  setMessageMode('queued');
  textarea.value = '稍后处理';
  document.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#composer-hint').textContent, /桌面端自动接管/);
  failures.set(`/api/tasks/${task().id}`, 'detail refresh failed');
  textarea.value = '详情稍后刷新';
  document.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  failures.delete(`/api/tasks/${task().id}`);

  ui.state.tasks = [task({ progress: { state: 'paused', label: '已暂停', tone: 'amber' } })];
  ui.state.selectedId = task().id;
  ui.renderDetail();
  assert.equal(document.querySelector('#resume-button').hidden, false);
  document.querySelector('#resume-button').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#composer-hint').textContent, /已恢复/);
  failures.set('/api/messages', 'resume failed');
  document.querySelector('#resume-button').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#composer-hint').textContent, /恢复失败/);
  failures.delete('/api/messages');

  document.querySelector('[data-filter="queued"]').click();
  document.querySelector('[data-filter="done"]').click();
  assert.match(document.querySelector('#task-list').textContent, /没有符合条件/);
  document.querySelector('[data-filter="all"]').click();
  const refreshButton = document.querySelector('#refresh-button');
  refreshButton.click();
  assert.equal(refreshButton.disabled, true);
  assert.equal(refreshButton.classList.contains('is-refreshing'), true);
  assert.equal(refreshButton.getAttribute('aria-busy'), 'true');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshButton.disabled, false);
  assert.equal(refreshButton.classList.contains('is-refreshing'), false);
  assert.equal(refreshButton.hasAttribute('aria-busy'), false);
  assert.equal(refreshButton.getAttribute('aria-label'), '刷新任务');
  assert.equal(document.querySelector('#toast').textContent, '已刷新');
  failures.set(`/api/tasks/${task().id}`, 'refresh detail failed');
  assert.equal(await ui.refreshTasks(), false);
  assert.match(document.querySelector('#toast').textContent, /refresh detail failed/);
  failures.delete(`/api/tasks/${task().id}`);
  document.querySelector('#back-button').click();
  assert.equal(document.querySelector('#detail-pane').classList.contains('is-open'), false);

  const source = FakeEventSource.instances.at(-1);
  source.emit('tasks', { tasks: [task({ title: '更新后的任务', updatedAt: Date.now() + 1 })], syncedAt: Date.now() });
  source.emit('sync-error', { error: '暂时断开' });
  source.onerror();
  assert.equal(document.querySelector('#connection-text').textContent, '正在重新连接');
  ui.connectEvents();
  assert.equal(source.closed, true);
  FakeEventSource.instances.at(-1).emit('sync-error', {});

  const baseTask = task();
  assert.equal(ui.taskViewChanged(baseTask, baseTask), false);
  ui.switchLanguage();
  assert.equal(ui.localizedProgress(task({ progress: { state: 'mystery', label: 'Unknown', tone: 'slate' } })), 'Unknown');
  ui.switchLanguage();
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, updatedAt: baseTask.updatedAt + 1 }), true);
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, progress: { ...baseTask.progress, state: 'idle' } }), true);
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, activity: 'new activity' }), true);
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, queuedCount: 2 }), true);
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, latestTask: 'changed' }), true);
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, latestResult: 'changed' }), true);
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, title: 'changed' }), true);
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, project: 'changed' }), true);
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, projectId: 'changed' }), true);
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, goal: { ...baseTask.goal, elapsedSeconds: 181 } }), true);
  assert.equal(ui.taskViewChanged(baseTask, { ...baseTask, goal: { ...baseTask.goal, status: { state: 'done', label: '完成' } } }), true);

  ui.state.tasks = [baseTask];
  ui.state.selectedId = baseTask.id;
  const detailLoadsBeforeStreamUpdate = calls.filter(([path]) => path === `/api/tasks/${baseTask.id}`).length;
  ui.updateTasks({ tasks: [{ ...baseTask, latestResult: '正在持续输出的新结果' }], syncedAt: Date.now() });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.filter(([path]) => path === `/api/tasks/${baseTask.id}`).length > detailLoadsBeforeStreamUpdate);

  ui.state.filter = 'queued';
  ui.state.tasks = [task({ queuedCount: 0 }), task({ id: '22222222-2222-2222-2222-222222222222', queuedCount: 1 })];
  assert.equal(ui.visibleTasks().length, 1);
  ui.state.filter = 'running';
  assert.equal(ui.visibleTasks().length, 2);
  ui.state.filter = 'done';
  assert.equal(ui.visibleTasks().length, 0);
  ui.state.filter = 'all';
  ui.state.selectedId = 'missing';
  ui.state.tasks = [task({ latestTask: '' })];
  ui.renderList();
  assert.match(document.querySelector('.task-card').textContent, /等待新的任务/);

  ui.state.selectedId = task().id;
  ui.state.tasks = [task({ latestTask: '', goal: null })];
  ui.state.details.delete(task().id);
  ui.renderDetail();
  assert.match(document.querySelector('#recent-messages').textContent, /正在读取/);
  ui.state.details.set(task().id, { messages: [
    { id: 'u', role: 'user', text: '问题', timestamp: Date.now() },
    { id: 'a', role: 'assistant', text: '回答', timestamp: Date.now() },
  ], queuedTasks: [] });
  ui.renderDetail();
  assert.equal(document.querySelectorAll('.message-row.is-user').length, 1);

  ui.state.usage = { planType: '', limits: [{ label: '周', usedPercent: 95, remainingPercent: 5, resetsAt: 0 }] };
  ui.renderUsage();
  assert.equal(document.querySelector('#usage-card').dataset.tone, 'red');
  document.querySelector('#usage-card').click();
  ui.state.usage = { limits: [{ label: '周', usedPercent: 80, remainingPercent: 20, resetsAt: Date.now() }], todayTokens: todayTokens({ recorded: false }) };
  ui.renderUsage();
  assert.equal(document.querySelector('#usage-card').dataset.tone, 'amber');
  document.querySelector('#usage-card').click();
  ui.state.usage = null;
  ui.renderUsage();
  document.querySelector('#usage-card').click();
  assert.equal(document.querySelector('.activity-allowance'), null);
  assert.deepEqual(ui.activityChartGeometry(), {
    max: 1,
    points: [{ x: 8, y: 108 }],
    line: 'M 8.00 108.00',
    area: 'M 8.00 108.00 L 8.00 112 L 8.00 112 Z',
  });
  const mixedChart = ui.activityChartGeometry([{ turns: -2 }, { turns: 'bad' }, { turns: 4 }]);
  assert.equal(mixedChart.max, 4);
  assert.equal(mixedChart.points.length, 3);
  assert.match(ui.activityDayLabel('2026-09-28'), /9.*28/);
  ui.state.activity = null;
  assert.equal(ui.renderActivityDashboard(), false);
  ui.state.account = null;
  ui.state.activity = activitySummary({ days: [], activeDays: 0, totalTurns: 0, completedTurns: 0, totalDurationMs: 0 });
  assert.equal(ui.renderActivityDashboard(9), true);
  assert.match(document.querySelector('.activity-dashboard').textContent, /本机账号/);
  assert.match(document.querySelector('.activity-chart-card').textContent, /还没有完成的工作回合/);
  delete ui.state.activity.days;
  assert.equal(ui.renderActivityDashboard(), true);
  ui.closeContent();
  ui.state.activity = activitySummary();

  dom.window.history.replaceState(null, '', '/');
  ui.state.selectedId = null;
  ui.updateTasks({ tasks: [], syncedAt: Date.now() });
  dom.window.history.replaceState(null, '', `/#${task().id}`);
  ui.updateTasks({ tasks: [baseTask], syncedAt: Date.now() });
  await new Promise((resolve) => setImmediate(resolve));
  ui.updateTasks({ tasks: [baseTask], syncedAt: Date.now() });
  ui.updateTasks({ syncedAt: Date.now() });

  failures.set(`/api/tasks/${task().id}`, 'selection failed');
  ui.state.tasks = [baseTask];
  ui.state.selectedId = null;
  ui.renderList();
  document.querySelector('.task-card').click();
  await new Promise((resolve) => setImmediate(resolve));
  failures.delete(`/api/tasks/${task().id}`);

  failures.set(`/api/tasks/${task().id}`, 'refresh detail failed');
  ui.state.tasks = [baseTask];
  ui.state.selectedId = task().id;
  ui.updateTasks({ tasks: [{ ...baseTask, updatedAt: baseTask.updatedAt + 2 }], syncedAt: Date.now() });
  await new Promise((resolve) => setImmediate(resolve));
  failures.delete(`/api/tasks/${task().id}`);

  failures.set(`/api/tasks/${task().id}`, 'detail failed');
  await assert.rejects(ui.loadDetail(task().id), /detail failed/);
  failures.set(`/api/tasks/${task().id}`, '');
  await assert.rejects(ui.loadDetail(task().id), /读取任务失败/);
  failures.delete(`/api/tasks/${task().id}`);
  ui.state.selectedId = 'another';
  await ui.loadDetail(task().id);

  failures.set('/api/tasks', 'sync failed');
  await assert.rejects(ui.loadTasks(), /sync failed/);
  failures.set('/api/tasks', '');
  await assert.rejects(ui.loadTasks(), /同步失败/);
  failures.delete('/api/tasks');

  ui.state.selectedId = task().id;
  ui.state.tasks = [baseTask];
  ui.state.details.set(task().id, { ...baseTask, messages: [], queuedTasks: queue() });
  ui.renderDetail();
  ui.renderQueueManager();
  ui.state.details.set(task().id, { ...baseTask, messages: [], queuedTasks: queue() });
  ui.renderQueueManager();
  document.querySelectorAll('[data-action="down"]')[0].click();
  await new Promise((resolve) => setImmediate(resolve));
  document.querySelectorAll('[data-action="up"]')[1].click();
  await new Promise((resolve) => setImmediate(resolve));
  const deleteThroughHandler = document.querySelector('[data-action="delete"]');
  deleteThroughHandler.click();
  deleteThroughHandler.click();
  await new Promise((resolve) => setImmediate(resolve));

  const modalContent = document.querySelector('#modal-content');
  modalContent.click();
  modalContent.innerHTML = '<button data-action="noop">x</button>';
  modalContent.querySelector('button').click();
  modalContent.innerHTML = '<div data-queue-id="x"><button data-action="noop">x</button></div>';
  modalContent.className = 'modal-content';
  modalContent.querySelector('button').click();

  failures.set(`/api/tasks/${task().id}/queue`, '');
  ui.state.details.set(task().id, { queuedTasks: queue() });
  await assert.rejects(ui.reorderQueue(queue()[1].id, -1), /优先级调整失败/);
  failures.delete(`/api/tasks/${task().id}/queue`);
  failures.set(`/api/tasks/${task().id}/queue/${queue()[0].id}`, 'delete failed');
  await assert.rejects(ui.deleteQueueItem(queue()[0].id), /delete failed/);
  failures.set(`/api/tasks/${task().id}/queue/${queue()[0].id}`, '');
  await assert.rejects(ui.deleteQueueItem(queue()[0].id), /删除失败/);
  failures.delete(`/api/tasks/${task().id}/queue/${queue()[0].id}`);
  ui.state.details.delete(task().id);
  ui.state.tasks = [baseTask, task({ id: '22222222-2222-2222-2222-222222222222' })];
  ui.applyQueuedTasks([]);
  ui.renderQueueManager();
  await ui.reorderQueue('missing', 1);
  failures.set(`/api/tasks/${task().id}/queue/${queue()[0].id}`, '');
  await assert.rejects(ui.deleteQueueItem(queue()[0].id), /删除失败/);
  failures.delete(`/api/tasks/${task().id}/queue/${queue()[0].id}`);
  ui.state.details.set(task().id, { queuedTasks: queue() });
  await ui.reorderQueue('missing', 1);
  await ui.reorderQueue(queue()[2].id, 1);

  const scroller = document.querySelector('.detail-scroll');
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 100 },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
  ui.resizeComposer();
  scroller.scrollTop = 900;
  ui.resizeComposer();
  const scrollerParent = scroller.parentNode;
  scroller.remove();
  ui.resizeComposer();
  scrollerParent.insertBefore(scroller, scrollerParent.querySelector('.composer-dock'));

  document.querySelector('#latest-task-preview').click();
  ui.state.tasks = [task({ latestTask: '' })];
  document.querySelector('#latest-task-preview').click();
  ui.state.tasks = [];
  document.querySelector('#latest-task-preview').click();
  ui.state.details.delete(task().id);
  document.querySelector('#queue-card').click();
  document.querySelector('#goal-card').click();
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));

  failures.set('/api/usage', 'usage failed');
  failures.set('/api/activity', 'activity failed');
  failures.set('/api/account', 'account failed');
  failures.set('/api/deliveries', 'delivery failed');
  failures.set('/api/messages', 'send failed');
  failures.set(`/api/tasks/${task().id}/queue`, 'reorder failed');
  const currentThumbnail = document.querySelector('.delivery-thumb');
  await ui.loadUsage();
  assert.equal(document.querySelector('#usage-card').hidden, true);
  ui.state.activity = null;
  document.querySelector('#usage-card').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#toast').textContent, /活动数据读取失败/);
  assert.equal(await ui.loadActivity(), null);
  failures.delete('/api/activity');
  assert.equal((await ui.loadActivity()).completedTurns, 60);
  await ui.loadAccount();
  assert.equal(document.querySelector('#account-badge').hidden, true);
  await ui.loadDeliveries();
  assert.equal(document.querySelector('#delivery-inbox').hidden, false);
  assert.equal(document.querySelector('.delivery-thumb'), currentThumbnail);
  document.querySelector('#delivery-clear').click();
  document.querySelector('#delivery-clear').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#toast').textContent, /delivery failed/);
  assert.equal(document.querySelector('#delivery-clear').disabled, false);
  failures.delete('/api/deliveries');
  await ui.loadDeliveries();
  ui.state.deliveries = null;
  ui.renderDeliveries();
  assert.equal(document.querySelector('#delivery-inbox').hidden, true);
  ui.state.selectedId = null;
  ui.renderDetail();
  assert.equal(document.querySelector('#empty-state').hidden, false);
  ui.state.tasks = [];
  ui.renderList();
  assert.match(document.querySelector('#task-list').textContent, /没有符合条件/);
  assert.equal(ui.queueRevision([]), 0);
  assert.equal(await ui.sendTaskMessage('有内容', null), null);
  assert.equal(ui.taskViewChanged(null, null), false);
  assert.equal(ui.taskViewChanged(null, task()), true);

  ui.state.tasks = [task({ goal: null })];
  ui.state.selectedId = task().id;
  ui.state.details.set(task().id, { ...task(), messages: [], queuedTasks: queue() });
  ui.renderDetail();
  ui.renderQueueManager();
  document.querySelectorAll('[data-action="up"]')[1].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('.queue-notice').textContent, /reorder failed/);
  await ui.reorderQueue('missing', -1);
  await ui.reorderQueue(queue()[0].id, -1);

  textarea.value = '失败消息';
  document.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#composer-hint').textContent, /发送失败/);
  assert.equal(textarea.value, '失败消息');
  textarea.value = '仍会失败';
  document.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  textarea.value = '用户已经输入的新内容';
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(textarea.value, '用户已经输入的新内容');
  textarea.value = '切换页面时失败';
  document.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  ui.state.selectedId = 'another-thread';
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(textarea.value, '');
  ui.state.selectedId = task().id;
  failures.set('/api/messages', '');
  textarea.value = '默认失败消息';
  document.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#toast').textContent, /发送失败/);
  textarea.value = '   ';
  document.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

  ui.applyQueuedTasks([]);
  ui.applyQueuedTasks([], 'no-detail-thread');
  assert.equal(ui.removeOptimisticQueueItem('missing-thread', 'missing-item'), false);
  const detachedId = ui.addOptimisticQueueItem('detached-thread', '后台任务');
  assert.equal(ui.state.details.get('detached-thread').queuedTasks[0].id, detachedId);
  ui.state.details.set('queue-less-thread', { messages: [] });
  assert.equal(ui.removeOptimisticQueueItem('queue-less-thread', 'missing-item'), true);
  ui.state.details.set('queue-less-thread', { messages: [] });
  ui.addOptimisticQueueItem('queue-less-thread', '默认队列');
  ui.state.details.set(task().id, { messages: [], queuedTasks: [] });
  const optimisticId = ui.addOptimisticQueueItem(task().id, '立即出现');
  ui.renderQueueManager();
  assert.match(document.querySelector('.queue-copy small').textContent, /安全写入/);
  assert.equal(document.querySelector('[data-action="steer"]'), null);
  assert.equal(ui.removeOptimisticQueueItem(task().id, optimisticId), true);
  const regular = queue();
  ui.applyQueuedTasks([regular[0], { ...regular[1], id: 'optimistic-middle', optimistic: true }, regular[2]]);
  ui.renderQueueManager();
  const savingRow = document.querySelector('[data-queue-id="optimistic-middle"]');
  assert.equal(savingRow.querySelector('[data-action="up"]').disabled, true);
  assert.equal(savingRow.querySelector('[data-action="down"]').disabled, true);
  ui.applyQueuedTasks([]);
  ui.renderQueueManager();
  assert.match(document.querySelector('#modal-content').textContent, /队列已清空/);
  ui.showContent('标题', '内容');
  ui.closeContent();
  ui.setConnection(true, '在线');
  ui.showToast('完成');
  assert.equal(document.querySelector('#toast').classList.contains('is-visible'), false);

  failures.set('/api/tasks', 'refresh failed');
  document.querySelector('#refresh-button').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#toast').textContent, /refresh failed/);
  failures.delete('/api/tasks');

  failures.set(`/api/tasks/${task().id}/queue`, 'handler failed');
  failures.set(`/api/tasks/${task().id}`, 'handler detail failed');
  ui.state.tasks = [baseTask];
  ui.state.selectedId = task().id;
  ui.state.details.set(task().id, { queuedTasks: queue(), messages: [] });
  ui.renderDetail();
  ui.renderQueueManager();
  document.querySelectorAll('[data-action="up"]')[1].click();
  await new Promise((resolve) => setImmediate(resolve));
  failures.delete(`/api/tasks/${task().id}/queue`);
  failures.delete(`/api/tasks/${task().id}`);

  ui.state.tasks = [];
  ui.state.selectedId = null;
  ui.renderTaskManagement();
  ui.state.tasks = [task({ projectId: null, progress: { state: 'idle', label: '待命', tone: 'slate' } })];
  ui.state.selectedId = task().id;
  ui.renderDetail();
  ui.renderTaskManagement();
  assert.equal(document.querySelectorAll('.management-action').length, 1);
  await assert.rejects(ui.deleteSelectedProject(), /删除项目失败/);

  ui.state.tasks = [baseTask];
  ui.state.selectedId = task().id;
  failures.set(`/api/tasks/${task().id}/stop`, 'stop failed');
  ui.renderTaskManagement();
  document.querySelector('[data-action="stop"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#toast').textContent, /stop failed/);
  failures.delete(`/api/tasks/${task().id}/stop`);

  failures.set(`/api/projects/${task().projectId}`, 'project failed');
  ui.renderTaskManagement();
  const failedProjectDelete = document.querySelector('[data-action="delete-project"]');
  failedProjectDelete.click();
  failedProjectDelete.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#toast').textContent, /project failed/);
  failures.delete(`/api/projects/${task().projectId}`);

  failures.set(`/api/tasks/${task().id}/archive`, 'archive failed');
  ui.renderTaskManagement();
  document.querySelector('[data-action="archive"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector('#toast').textContent, /archive failed/);
  failures.delete(`/api/tasks/${task().id}/archive`);
  ui.renderTaskManagement();
  document.querySelector('[data-action="archive"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.state.selectedId, null);
  assert.equal(document.querySelector('#detail-pane').classList.contains('is-open'), false);
  assert.equal(await ui.refreshTasks(), true);

  failures.set('/api/tasks', 'tasks failed');
  await ui.startDashboard();
  assert.equal(document.querySelector('#connection-text').textContent, '无法连接 Mac');
});
