import { applyTranslations, getLanguage, initializeLanguage, setLanguage, t } from './i18n.js';

const state = {
  tasks: [],
  projects: [],
  selectedId: null,
  filter: 'all',
  details: new Map(),
  usage: null,
  activity: null,
  account: null,
  version: null,
  deliveries: [],
  syncedAt: null,
  unreadTaskIds: new Set(),
  hasSyncedTasks: false,
  connected: false,
};

function stripTokenFromUrl() {
  const cleanUrl = new URL(location.href);
  if (cleanUrl.searchParams.has('token')) {
    cleanUrl.searchParams.delete('token');
    history.replaceState(null, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }
}
stripTokenFromUrl();
localStorage.removeItem('bridge-token');
localStorage.removeItem('codex-local-hub-language');
function preferredLanguage(navigatorObject) {
  return navigatorObject.languages?.[0] || navigatorObject.language || 'zh-CN';
}
initializeLanguage({
  stored: localStorage.getItem('codex-local-hub-language-choice'),
  preferred: preferredLanguage(window.navigator),
});
applyTranslations();

const $ = (selector) => document.querySelector(selector);
const list = $('#task-list');
const detailPane = $('#detail-pane');
const detail = $('#task-detail');
const empty = $('#empty-state');
const input = $('#message-input');
let toastTimer;
let source;
let queueNotice = null;
let optimisticSequence = 0;
let activityRange = 7;

function api(path) {
  return new URL(path, location.origin);
}

function ignoreFailure() { return undefined; }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return t('time.justNow');
  if (seconds < 3600) return t('time.minutesAgo', { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('time.hoursAgo', { count: Math.floor(seconds / 3600) });
  return new Intl.DateTimeFormat(getLanguage(), { month: 'short', day: 'numeric' }).format(timestamp);
}

function localizedProgress(task) {
  const known = new Set(['running', 'paused', 'failed', 'blocked', 'limited', 'queued', 'done', 'idle']);
  if (known.has(task.progress.state)) return t(`progress.${task.progress.state}`);
  return getLanguage() === 'en' && /[\u3400-\u9fff]/u.test(task.progress.label || '') ? t('progress.unknown') : task.progress.label;
}

function localizedActivity(task) {
  if (task.progress.state !== 'running') return localizedProgress(task);
  const activityKeys = {
    '正在执行任务': 'command_execution', '正在更新文件': 'file_change', '正在连接工具': 'mcp_tool_call',
    '正在检索资料': 'web_search', '正在处理': 'reasoning', '正在整理结果': 'agent_message', '正在推进任务': 'default',
  };
  const key = activityKeys[task.activity];
  if (key) return t(`activity.${key}`);
  return getLanguage() === 'en' && /[\u3400-\u9fff]/u.test(task.activity || '') ? t('activity.default') : task.activity;
}

function localizedGoalStatus(goal) {
  const stateKey = goal?.status?.state || 'unknown';
  const known = new Set(['active', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete', 'unknown']);
  return t(`progress.${known.has(stateKey) ? stateKey : 'unknown'}`);
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return t('duration.hoursMinutes', { hours, minutes });
  if (minutes) return t('duration.minutes', { minutes });
  return t('duration.seconds', { seconds });
}

function localizedError(error, fallbackKey) {
  const message = String(error || '').trim();
  if (!message || (getLanguage() === 'en' && /[\u3400-\u9fff]/u.test(message))) return t(fallbackKey);
  return message;
}

function visibleTasks() {
  return state.tasks.filter((task) => {
    return state.filter === 'all'
      || (state.filter === 'queued' ? task.queuedCount > 0 : task.progress.state === state.filter);
  });
}

function projectName(task) {
  return String(task.project || '').trim();
}

function projectLabel(name) {
  return name || t('project.uncategorized');
}

function projectTaskCount(count) {
  return t(count === 1 ? 'project.taskCountOne' : 'project.taskCountOther', { count });
}

function groupTasksByProject(tasks) {
  const groups = new Map();
  tasks.forEach((task) => {
    const name = projectName(task);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(task);
  });
  return [...groups].map(([name, projectTasks]) => ({ name, tasks: projectTasks }));
}

function orderTasksByProject(tasks) {
  return groupTasksByProject(tasks).flatMap((group) => group.tasks);
}

function projectCollapseKey(name) {
  return `codex-local-hub-project-collapsed:${encodeURIComponent(name)}`;
}

function isProjectCollapsed(name) {
  return localStorage.getItem(projectCollapseKey(name)) === '1';
}

function setProjectCollapsed(name, collapsed) {
  if (collapsed) localStorage.setItem(projectCollapseKey(name), '1');
  else localStorage.removeItem(projectCollapseKey(name));
}

function taskReadKey(id) {
  return `codex-lookout-task-read:${id}`;
}

function updateUnreadPresentation() {
  const count = state.unreadTaskIds.size;
  document.title = count ? t('brand.unreadTitle', { count }) : t('brand.name');
  return count;
}

function markTaskRead(task) {
  if (!task) return false;
  const changed = state.unreadTaskIds.delete(task.id);
  localStorage.setItem(taskReadKey(task.id), String(Math.max(0, Number(task.updatedAt) || Date.now())));
  updateUnreadPresentation();
  return changed;
}

function isTaskActivelyViewed(id) {
  return state.selectedId === id && detailPane.classList.contains('is-open') && !document.hidden;
}

function syncUnreadTasks(previousTasks, nextTasks, initialSync = false) {
  const nextIds = new Set(nextTasks.map((task) => task.id));
  for (const id of state.unreadTaskIds) {
    if (!nextIds.has(id)) state.unreadTaskIds.delete(id);
  }
  nextTasks.forEach((task) => {
    const previous = previousTasks.get(task.id);
    const readAt = Math.max(0, Number(localStorage.getItem(taskReadKey(task.id))) || 0);
    if (isTaskActivelyViewed(task.id)) {
      markTaskRead(task);
    } else if (initialSync) {
      if (readAt && Number(task.updatedAt) > readAt) state.unreadTaskIds.add(task.id);
      else if (!readAt) localStorage.setItem(taskReadKey(task.id), String(Math.max(0, Number(task.updatedAt) || Date.now())));
    } else if (!previous || taskViewChanged(previous, task)) {
      state.unreadTaskIds.add(task.id);
    }
  });
  return updateUnreadPresentation();
}

function renderTaskCard(task, showProject = false) {
  const project = projectLabel(projectName(task));
  const unread = state.unreadTaskIds.has(task.id);
  const model = String(task.model || '').trim();
  return `
    <button class="task-card ${showProject ? 'shows-project' : ''} ${task.id === state.selectedId ? 'is-selected' : ''} ${unread ? 'is-unread' : ''}" type="button" data-id="${escapeHtml(task.id)}">
      ${showProject ? `<span class="task-project">${escapeHtml(project)}</span>` : ''}
      <div class="task-card-head">
        <h3 title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</h3>
        <span class="task-card-meta">
          ${unread ? `<span class="unread-dot" role="status" aria-label="${escapeHtml(t('task.unread'))}" title="${escapeHtml(t('task.unread'))}"></span>` : ''}
          <span class="status-pill" data-tone="${escapeHtml(task.progress.tone)}">${escapeHtml(localizedProgress(task))}</span>
          <time>${relativeTime(task.updatedAt)}</time>
        </span>
      </div>
      <p>${escapeHtml(task.latestTask || t('empty.task'))}</p>
      <div class="task-card-foot"><span>${escapeHtml(localizedActivity(task))}</span>${model ? `<span class="task-model" title="${escapeHtml(model)}" aria-label="${escapeHtml(t('task.model', { model }))}">${escapeHtml(model)}</span>` : ''}</div>
    </button>`;
}

function renderList() {
  const tasks = visibleTasks();
  updateUnreadPresentation();
  $('#active-count').textContent = state.tasks.filter((task) => task.progress.state === 'running').length;
  $('#queued-count').textContent = state.tasks.reduce((total, task) => total + task.queuedCount, 0);
  $('#done-count').textContent = state.tasks.filter((task) => task.progress.state === 'done').length;
  $('#task-count').textContent = state.tasks.length;
  if (!tasks.length) {
    list.innerHTML = `<div class="list-empty">${escapeHtml(t('empty.filtered'))}</div>`;
    return;
  }
  if (tasks.length <= 5) {
    list.innerHTML = orderTasksByProject(tasks).map((task) => renderTaskCard(task, true)).join('');
  } else {
    list.innerHTML = groupTasksByProject(tasks).map((group, index) => {
      const label = projectLabel(group.name);
      const collapsed = isProjectCollapsed(group.name);
      const action = collapsed ? t('project.expand') : t('project.collapse');
      const countLabel = projectTaskCount(group.tasks.length);
      const groupId = `project-group-${index}`;
      return `
        <section class="project-group ${collapsed ? 'is-collapsed' : ''}" data-project="${escapeHtml(group.name)}">
          <button class="project-group-toggle" type="button" aria-expanded="${!collapsed}" aria-controls="${groupId}" aria-label="${escapeHtml(t('project.toggle', { action, project: label, countLabel }))}">
            <span class="project-heading"><strong>${escapeHtml(label)}</strong></span>
            <span class="project-count">${escapeHtml(countLabel)}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
          </button>
          <div id="${groupId}" class="project-group-tasks" ${collapsed ? 'hidden' : ''}>${group.tasks.map((task) => renderTaskCard(task)).join('')}</div>
        </section>`;
    }).join('');
  }
  list.querySelectorAll('.project-group-toggle').forEach((button) => button.addEventListener('click', () => {
    const name = button.closest('.project-group').dataset.project;
    setProjectCollapsed(name, button.getAttribute('aria-expanded') === 'true');
    renderList();
  }));
  list.querySelectorAll('.task-card').forEach((card) => card.addEventListener('click', () => selectTask(card.dataset.id)));
}

function selectTask(id) {
  state.selectedId = id;
  markTaskRead(state.tasks.find((task) => task.id === id));
  renderList();
  renderDetail();
  detailPane.classList.add('is-open');
  history.replaceState(null, '', `#${id}`);
  loadDetail(id, { followLatest: true }).catch((error) => showToast(error.message));
}

function captureConversationScroll(followLatest = false) {
  const scroller = $('.detail-scroll');
  if (!scroller) return null;
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const scrollerTop = scroller.getBoundingClientRect().top;
  const anchor = [...$('#recent-messages').querySelectorAll('.message-row')]
    .find((row) => row.getBoundingClientRect().bottom > scrollerTop + 1);
  return {
    followLatest: followLatest || maxScrollTop - scroller.scrollTop <= 8,
    scrollTop: Math.max(0, scroller.scrollTop),
    anchorId: anchor?.dataset.messageId || null,
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - scrollerTop : 0,
  };
}

function restoreConversationScroll(snapshot) {
  if (!snapshot) return;
  const scroller = $('.detail-scroll');
  if (!scroller) return;
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  if (snapshot.followLatest) {
    scroller.scrollTop = maxScrollTop;
    return;
  }
  const anchor = snapshot.anchorId
    ? [...$('#recent-messages').querySelectorAll('.message-row')].find((row) => row.dataset.messageId === snapshot.anchorId)
    : null;
  if (anchor) {
    const currentOffset = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop = Math.min(Math.max(0, snapshot.scrollTop + currentOffset - snapshot.anchorOffset), maxScrollTop);
    return;
  }
  scroller.scrollTop = Math.min(snapshot.scrollTop, maxScrollTop);
}

function messageSignature(messages = []) {
  return messages.map((message) => [message.id, message.role, message.text, message.timestamp, Boolean(message.pending)].join('\u001f')).join('\u001e');
}

function scrollConversationToLatest() {
  const scroller = $('.detail-scroll');
  if (!scroller) return;
  const indicator = $('#new-message-indicator');
  if (!indicator.hidden) {
    delete $('#recent-messages').dataset.signature;
    renderDetail({ followLatest: true });
  }
  scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  indicator.hidden = true;
}

function renderDetail({ followLatest = false } = {}) {
  const scrollSnapshot = captureConversationScroll(followLatest);
  const task = state.tasks.find((item) => item.id === state.selectedId);
  if (!task) {
    detailPane.classList.add('is-empty');
    detail.hidden = true;
    empty.hidden = false;
    return;
  }
  detailPane.classList.remove('is-empty');
  detail.hidden = false;
  empty.hidden = true;
  $('#detail-project').textContent = task.project;
  $('#detail-title').textContent = task.title;
  $('#detail-status').textContent = localizedProgress(task);
  $('#detail-status').dataset.tone = task.progress.tone;
  $('#resume-button').hidden = task.progress.state !== 'paused';
  $('#detail-latest-task').textContent = task.latestTask || t('empty.taskContent');
  const goalCard = $('#goal-card');
  goalCard.hidden = !task.goal;
  if (task.goal) {
    const goalStatus = localizedGoalStatus(task.goal);
    const goalElapsed = formatDuration(task.goal.elapsedSeconds);
    $('#goal-objective').textContent = task.goal.objective;
    $('#goal-elapsed').textContent = goalElapsed;
    $('#goal-status').textContent = goalStatus;
    goalCard.setAttribute('aria-label', t('context.goalAria', { status: goalStatus, elapsed: goalElapsed }));
  }
  const full = state.details.get(task.id);
  const messages = full?.messages || [];
  const queuedTasks = full?.queuedTasks || [];
  $('#queue-card').hidden = queuedTasks.length === 0;
  $('#queue-count-label').textContent = t('queue.count', { count: queuedTasks.length });
  $('#queue-card').setAttribute('aria-label', t('queue.aria', { count: queuedTasks.length }));
  const messageList = $('#recent-messages');
  const signature = messageSignature(messages);
  const sameTask = messageList.dataset.taskId === task.id;
  const previousLastMessageId = sameTask ? messageList.dataset.lastMessageId : '';
  const lastMessageId = String(messages.at(-1)?.id || '');
  const receivedNewMessage = previousLastMessageId && lastMessageId && previousLastMessageId !== lastMessageId;
  if (receivedNewMessage && !scrollSnapshot.followLatest) {
    $('#new-message-indicator').hidden = false;
    return;
  }
  if (!sameTask || messageList.dataset.signature !== signature) {
    messageList.innerHTML = messages.length ? messages.map((message) => `
      <div class="message-row ${message.role === 'user' ? 'is-user' : 'is-assistant'}" data-message-id="${escapeHtml(message.id)}">
        <div class="message-bubble">
          <p>${escapeHtml(message.text)}</p>
          <time>${message.role === 'user' ? t('conversation.user') : 'Codex'} · ${relativeTime(message.timestamp)}</time>
        </div>
      </div>`).join('') : `<div class="list-empty">${escapeHtml(t('conversation.loading'))}</div>`;
    messageList.dataset.taskId = task.id;
    messageList.dataset.signature = signature;
    messageList.dataset.lastMessageId = lastMessageId;
    $('#new-message-indicator').hidden = true;
    restoreConversationScroll(scrollSnapshot);
  } else if (followLatest) {
    scrollConversationToLatest();
  }
}

function switchLanguage() {
  const next = getLanguage() === 'zh-CN' ? 'en' : 'zh-CN';
  setLanguage(next);
  localStorage.setItem('codex-local-hub-language-choice', next);
  applyTranslations();
  delete $('#recent-messages').dataset.signature;
  $('#language-button').textContent = languageButtonLabel();
  renderList();
  renderDetail();
  renderUsage();
  renderAccount();
  renderVersion();
  renderDeliveries();
  resetDeliveryClearButton();
  if (state.syncedAt) {
    const time = new Date(state.syncedAt).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit' });
    setConnection(true, t('connection.synced', { time }));
  }
  return next;
}

function languageButtonLabel() { return getLanguage() === 'zh-CN' ? 'EN' : '中文'; }

function shouldShowInstallTip() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return window.innerWidth <= 760 && !standalone && localStorage.getItem('codex-local-hub-install-dismissed') !== '1';
}

function renderInstallTip() {
  $('#install-tip').hidden = !shouldShowInstallTip();
}

function registerServiceWorker() {
  const localSecureContext = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!localSecureContext || !window.navigator.serviceWorker) return Promise.resolve(false);
  return window.navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).then(async (registration) => {
    try { await registration.update?.(); } catch { /* The active worker can keep serving this visit. */ }
    return true;
  }).catch(() => false);
}

function updateTasks(payload) {
  const previousTasks = new Map(state.tasks.map((task) => [task.id, task]));
  const initialSync = !state.hasSyncedTasks;
  const previous = state.tasks.find((task) => task.id === state.selectedId);
  state.tasks = payload.tasks || [];
  state.hasSyncedTasks = true;
  syncUnreadTasks(previousTasks, state.tasks, initialSync);
  state.syncedAt = payload.syncedAt;
  const time = new Date(payload.syncedAt).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit' });
  setConnection(true, t('connection.synced', { time }));
  if (!state.selectedId && location.hash) state.selectedId = location.hash.slice(1);
  renderList();
  const current = state.tasks.find((task) => task.id === state.selectedId);
  if (current && location.hash.slice(1) === current.id) detailPane.classList.add('is-open');
  const changed = taskViewChanged(previous, current);
  if (changed) renderDetail();
  if (current && changed) {
    loadDetail(current.id).catch(() => undefined);
  }
}

function taskViewChanged(previous, current) {
  if (!previous || !current) return previous !== current;
  return previous.updatedAt !== current.updatedAt
    || previous.progress.state !== current.progress.state
    || previous.activity !== current.activity
    || previous.queuedCount !== current.queuedCount
    || previous.latestTask !== current.latestTask
    || previous.latestResult !== current.latestResult
    || previous.title !== current.title
    || previous.project !== current.project
    || previous.projectId !== current.projectId
    || previous.goal?.elapsedSeconds !== current.goal?.elapsedSeconds
    || previous.goal?.status?.state !== current.goal?.status?.state;
}

async function loadDetail(id, { followLatest = false } = {}) {
  const response = await fetch(api(`/api/tasks/${id}`));
  const payload = await response.json();
  if (!response.ok) throw new Error(localizedError(payload.error, 'error.readTask'));
  state.details.set(id, payload.task);
  if (state.selectedId === id) {
    renderDetail({ followLatest });
  }
}

async function loadProjects() {
  const response = await fetch(api('/api/projects'));
  const payload = await response.json();
  if (!response.ok) throw new Error(localizedError(payload.error, 'create.failure'));
  state.projects = payload.projects || [];
  return state.projects;
}

function setConnection(online, text) {
  state.connected = online;
  const dot = $('#connection-dot');
  dot.classList.toggle('is-online', online);
  dot.classList.toggle('is-offline', !online);
  $('#connection-text').textContent = text;
}

function safeIssueDiagnostics() {
  return {
    version: state.version?.currentVersion || 'unknown',
    service: state.connected ? 'healthy' : 'offline',
    language: getLanguage(),
  };
}

function buildIssueUrl(diagnostics = safeIssueDiagnostics()) {
  const body = `### What happened\n\nPlease describe the problem.\n\n### Safe diagnostics\n- Codex Lookout: v${diagnostics.version}\n- Service: ${diagnostics.service}\n- Language: ${diagnostics.language}\n\nNo task content, IP address, or local path is included.`;
  const query = new URLSearchParams({ title: '[Bug]: ', body });
  return `https://github.com/makorise/codex-local-hub/issues/new?${query}`;
}

function reportIssue() {
  const url = buildIssueUrl();
  window.open(url, '_blank', 'noopener,noreferrer');
  return url;
}

function versionStateLabel(version = state.version) {
  return t(`version.state.${version?.state || 'unavailable'}`);
}

function renderVersion() {
  const button = $('#version-button');
  const version = state.version;
  button.hidden = !version;
  if (!version) return;
  const current = version.currentVersion || t('version.unknown');
  const latest = version.latestVersion || t('version.unknown');
  $('#version-current').textContent = `v${current}`;
  $('#version-state').textContent = versionStateLabel(version);
  button.classList.toggle('is-update', version.state === 'available');
  button.setAttribute('aria-label', t('version.aria', { current, status: versionStateLabel(version), latest }));
}

function renderVersionDetails() {
  const version = state.version;
  if (!version) return false;
  $('#modal-kicker').textContent = t('version.kicker');
  $('#modal-title').textContent = t('version.title');
  const current = version.currentVersion || t('version.unknown');
  const latest = version.latestVersion || t('version.unknown');
  const canUpdate = version.state === 'available' && version.canUpdate;
  const requiresDesktop = version.state === 'available' && !version.canUpdate;
  const modalContent = $('#modal-content');
  modalContent.className = 'modal-content version-dashboard';
  modalContent.innerHTML = `<section class="version-card">
    <span>${escapeHtml(versionStateLabel(version))}</span>
    <strong>${escapeHtml(t(`version.summary.${version.state || 'unavailable'}`))}</strong>
    <div class="version-compare">
      <div class="version-number"><small>${escapeHtml(t('version.current'))}</small><strong>v${escapeHtml(current)}</strong></div>
      <span class="version-arrow" aria-hidden="true">→</span>
      <div class="version-number"><small>${escapeHtml(t('version.latest'))}</small><strong>v${escapeHtml(latest)}</strong></div>
    </div>
  </section>
  <div class="version-actions">
    ${canUpdate ? `<button class="version-action" type="button" data-action="version-update">${escapeHtml(t('version.update', { version: latest }))}</button>` : ''}
    <button class="version-action secondary" type="button" data-action="version-refresh">${escapeHtml(t('version.check'))}</button>
  </div>
  <div class="version-support-actions">
    <a class="version-action secondary" href="https://github.com/makorise/codex-local-hub" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t('success.starAria'))}">${escapeHtml(t('success.star'))}</a>
    <button class="version-action secondary" type="button" data-action="report-issue">${escapeHtml(t('success.report'))}</button>
  </div>
  ${requiresDesktop ? `<p class="version-note">${escapeHtml(t('version.requiresDesktop'))}</p>` : ''}
  <p class="version-note">${escapeHtml(t('version.note'))}</p>`;
  $('#content-modal').hidden = false;
  document.body.classList.add('modal-open');
  return true;
}

async function loadVersion({ force = false } = {}) {
  const response = await fetch(api(`/api/version${force ? '?refresh=1' : ''}`));
  const payload = await response.json();
  if (!response.ok) throw new Error(localizedError(payload.error, 'version.updateFailure'));
  state.version = payload.version;
  renderVersion();
  return state.version;
}

async function waitForRuntimeVersion(previousVersion, { attempts = 40, pause = (delay) => new Promise((resolve) => setTimeout(resolve, delay)), fetchImpl = fetch } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await pause(1_500);
    try {
      const response = await fetchImpl(api('/api/health'), { cache: 'no-store' });
      if (!response.ok) continue;
      const health = await response.json();
      if (health.version && health.version !== previousVersion) return health.version;
    } catch {
      // A brief disconnect is expected while the Mac restarts the local service.
    }
  }
  return null;
}

async function requestPhoneUpdate() {
  const previousVersion = state.version?.currentVersion;
  const action = $('#modal-content').querySelector('[data-action="version-update"]');
  if (action) {
    action.disabled = true;
    action.textContent = t('version.updating');
  }
  try {
    const response = await fetch(api('/api/update'), { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(localizedError(payload.error, 'version.updateFailure'));
    if (!payload.accepted) {
      state.version = payload.version;
      renderVersion();
      renderVersionDetails();
      return false;
    }
    state.version = { ...payload.version, state: 'installing' };
    renderVersion();
    renderVersionDetails();
    showToast(t('version.updateAccepted'));
    const installedVersion = await waitForRuntimeVersion(previousVersion);
    if (!installedVersion) throw new Error(t('version.updateFailure'));
    await loadVersion({ force: true });
    showToast(t('version.updateComplete', { version: installedVersion }));
    renderVersionDetails();
    return true;
  } catch (error) {
    await loadVersion({ force: true }).catch(() => undefined);
    renderVersionDetails();
    showToast(localizedError(error.message, 'version.updateFailure'));
    return false;
  }
}

function formatReset(timestamp) {
  if (!timestamp) return t('usage.unknownReset');
  return new Intl.DateTimeFormat(getLanguage(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function formatResetCountdown(timestamp, now = Date.now()) {
  const resetAt = Number(timestamp);
  const currentTime = Number(now);
  if (!timestamp || !Number.isFinite(resetAt) || !Number.isFinite(currentTime)) return t('usage.unknownReset');
  const remainingMs = resetAt - currentTime;
  if (remainingMs <= 0) return t('usage.resetPending');
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return t('usage.countdown.daysHours', { days, hours });
  if (hours) return t('usage.countdown.hoursMinutes', { hours, minutes });
  return t('usage.countdown.minutes', { minutes });
}

function usageWindowLabel(limit) {
  const minutes = Number(limit.windowDurationMins || 0);
  if (minutes === 10_080 || (!minutes && limit.label === '周')) return t('usage.window.week');
  if (minutes && minutes < 60) return t('usage.window.minutes', { count: minutes });
  if (minutes && minutes < 1_440) return t('usage.window.hours', { count: Math.round(minutes / 60) });
  if (minutes) return t('usage.window.days', { count: Math.round(minutes / 1_440) });
  if (getLanguage() === 'en' && /[\u3400-\u9fff]/u.test(limit.label || '')) return t('usage.window.week');
  return limit.label || t('usage.window.week');
}

function formatTokenCount(value) {
  return new Intl.NumberFormat(getLanguage(), { notation: 'compact', maximumFractionDigits: 1 }).format(Math.max(0, Number(value) || 0));
}

function renderTodayTokens(usage = state.usage?.todayTokens) {
  const row = $('#usage-today');
  row.hidden = !usage?.available;
  if (row.hidden) return '';
  const value = usage.recorded ? t('usage.todayValue', { count: formatTokenCount(usage.totalTokens) }) : t('usage.todayEmpty');
  $('#usage-today-value').textContent = value;
  return value;
}

function renderUsage() {
  const card = $('#usage-card');
  const limits = state.usage?.limits || [];
  card.hidden = limits.length === 0;
  if (!limits.length) return;
  const lowest = Math.min(...limits.map((limit) => limit.remainingPercent));
  const primary = limits[0];
  const plan = state.usage?.planType || '';
  $('#usage-plan').textContent = plan ? plan[0].toUpperCase() + plan.slice(1) : '';
  const summaries = limits.map((limit) => t('usage.remaining', { window: usageWindowLabel(limit), percent: limit.remainingPercent }));
  $('#usage-summary').textContent = summaries.join(' · ');
  $('#usage-reset').textContent = limits.map((limit) => t('usage.resetCompact', {
    window: usageWindowLabel(limit),
    time: formatReset(limit.resetsAt),
  })).join(' · ');
  $('#usage-ring-value').textContent = lowest;
  $('#usage-ring').style.setProperty('--remaining', lowest);
  card.dataset.tone = lowest <= 10 ? 'red' : lowest <= 30 ? 'amber' : 'green';
  const todaySummary = renderTodayTokens();
  const currentSummary = summaries.join(getLanguage() === 'zh-CN' ? '，' : ', ');
  card.setAttribute('aria-label', `${t('usage.aria', { summary: currentSummary })}${todaySummary ? ` · ${t('usage.todayAria', { summary: todaySummary })}` : ''}`);
}

async function loadUsage() {
  try {
    const response = await fetch(api('/api/usage'));
    if (!response.ok) throw new Error(t('usage.loadFailure'));
    state.usage = (await response.json()).usage;
    renderUsage();
  } catch {
    state.usage = null;
    renderUsage();
  }
}

async function loadActivity() {
  try {
    const response = await fetch(api('/api/activity'));
    if (!response.ok) throw new Error(t('activity.loadFailure'));
    state.activity = (await response.json()).activity;
  } catch {
    state.activity = null;
  }
  return state.activity;
}

function activityChartGeometry(days = []) {
  const series = days.length ? days : [{ turns: 0 }];
  const max = Math.max(1, ...series.map((day) => Math.max(0, Number(day.turns) || 0)));
  const points = series.map((day, index) => ({
    x: 8 + (304 * index) / Math.max(1, series.length - 1),
    y: 108 - (96 * Math.max(0, Number(day.turns) || 0)) / max,
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const area = `${line} L ${points.at(-1).x.toFixed(2)} 112 L ${points[0].x.toFixed(2)} 112 Z`;
  return { max, points, line, area };
}

function activityDayLabel(date) {
  return new Intl.DateTimeFormat(getLanguage(), { month: 'numeric', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
}

function renderActivityDashboard(range = activityRange) {
  const activity = state.activity;
  if (!activity) return false;
  activityRange = range === 30 ? 30 : 7;
  const allDays = activity.days || [];
  const days = allDays.slice(-activityRange);
  const chartDays = days.map((day) => ({ ...day, turns: Number(day.completedTurns || 0) }));
  const chart = activityChartGeometry(chartDays);
  const peak = chartDays.reduce((best, day) => day.turns > best.turns ? day : best, chartDays[0] || { date: '', turns: 0 });
  const rangeTurns = chartDays.reduce((sum, day) => sum + day.turns, 0);
  const rangeActiveDays = chartDays.filter((day) => day.turns > 0).length;
  const limits = state.usage?.limits || [];
  const primary = limits[0];
  const today = state.usage?.todayTokens;
  const todayTokens = today?.recorded ? formatTokenCount(today.totalTokens) : '—';
  const duration = formatDuration(Math.round(Number(activity.totalDurationMs || 0) / 1000));
  const firstDay = days[0]?.date;
  const middleDay = days[Math.floor(days.length / 2)]?.date || firstDay;
  const lastDay = days.at(-1)?.date || firstDay;
  const accountName = state.account?.name || t('activity.localAccount');
  const resetWindows = limits.map((limit) => `
    <article class="activity-limit">
      <header><span>${escapeHtml(usageWindowLabel(limit))}</span><strong>${limit.remainingPercent}%</strong></header>
      <div class="activity-limit-track" aria-hidden="true"><i style="--remaining:${limit.remainingPercent}"></i></div>
      <footer>
        <span>${escapeHtml(t('usage.resetsIn', { countdown: formatResetCountdown(limit.resetsAt) }))}</span>
        <time datetime="${limit.resetsAt ? new Date(limit.resetsAt).toISOString() : ''}">${escapeHtml(formatReset(limit.resetsAt))}</time>
      </footer>
    </article>`).join('');
  $('#modal-kicker').textContent = t('activity.kicker');
  $('#modal-title').textContent = t('activity.title');
  $('#content-modal .modal-sheet').classList.add('activity-sheet');
  const modalContent = $('#modal-content');
  modalContent.className = 'modal-content activity-dashboard';
  modalContent.innerHTML = `
    <section class="activity-hero">
      <div class="activity-hero-glow" aria-hidden="true"></div>
      <span>${escapeHtml(t('activity.eyebrow', { account: accountName }))}</span>
      <strong>${escapeHtml(t('activity.hero', { count: activity.completedTurns }))}</strong>
      <small>${escapeHtml(t('activity.period'))}</small>
      ${primary ? `<div class="activity-allowance"><i style="--remaining:${primary.remainingPercent}"></i><span>${escapeHtml(t('activity.allowance', { window: usageWindowLabel(primary), percent: primary.remainingPercent }))}</span></div>` : ''}
    </section>
    <section class="activity-metrics" aria-label="${escapeHtml(t('activity.metrics'))}">
      <article><span>${escapeHtml(t('activity.tokensToday'))}</span><strong>${escapeHtml(todayTokens)}</strong><small>tokens</small></article>
      <article><span>${escapeHtml(t('activity.completedTurns'))}</span><strong>${activity.completedTurns}</strong><small>${escapeHtml(t('activity.turnsUnit'))}</small></article>
      <article><span>${escapeHtml(t('activity.runTime'))}</span><strong>${escapeHtml(duration)}</strong><small>${escapeHtml(t('activity.localOnly'))}</small></article>
      <article><span>${escapeHtml(t('activity.projects'))}</span><strong>${activity.projectCount}</strong><small>${escapeHtml(t('activity.projectsUnit'))}</small></article>
    </section>
    ${limits.length ? `<section class="activity-limits">
      <header><div><span>${escapeHtml(t('activity.limits'))}</span><strong>${escapeHtml(t(limits.length === 1 ? 'activity.limitCycleOne' : 'activity.limitCycleOther', { count: limits.length }))}</strong></div><small>${escapeHtml(t('activity.limitHint'))}</small></header>
      <div class="activity-limit-grid">${resetWindows}</div>
    </section>` : ''}
    <section class="activity-chart-card">
      <header>
        <div><span>${escapeHtml(t('activity.rhythm'))}</span><strong>${escapeHtml(t('activity.rhythmSummary', { days: rangeActiveDays, turns: rangeTurns }))}</strong></div>
        <div class="activity-range" role="group" aria-label="${escapeHtml(t('activity.range'))}">
          <button type="button" data-action="activity-range" data-range="7" class="${activityRange === 7 ? 'is-active' : ''}">${escapeHtml(t('activity.sevenDays'))}</button>
          <button type="button" data-action="activity-range" data-range="30" class="${activityRange === 30 ? 'is-active' : ''}">${escapeHtml(t('activity.thirtyDays'))}</button>
        </div>
      </header>
      <div class="activity-chart" aria-label="${escapeHtml(t('activity.chartAria', { count: peak.turns }))}">
        <svg viewBox="0 0 320 120" preserveAspectRatio="none" role="img">
          <defs><linearGradient id="activity-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#79aaff" stop-opacity=".34"/><stop offset="1" stop-color="#7964ff" stop-opacity="0"/></linearGradient></defs>
          <path class="activity-chart-grid" d="M8 12H312 M8 44H312 M8 76H312 M8 108H312" />
          <path class="activity-chart-area" d="${chart.area}" />
          <path class="activity-chart-line" d="${chart.line}" />
          ${chart.points.map((point, index) => index === chart.points.length - 1 ? `<circle cx="${point.x}" cy="${point.y}" r="4" />` : '').join('')}
        </svg>
      </div>
      <div class="activity-chart-labels"><span>${firstDay ? activityDayLabel(firstDay) : ''}</span><span>${middleDay ? activityDayLabel(middleDay) : ''}</span><span>${lastDay ? activityDayLabel(lastDay) : ''}</span></div>
      <p>${peak.date ? escapeHtml(t('activity.peak', { date: activityDayLabel(peak.date), count: peak.turns })) : escapeHtml(t('activity.noActivity'))}</p>
    </section>
    <section class="activity-facts">
      <article><span>${escapeHtml(t('activity.newTasks'))}</span><strong>${activity.recentTaskCount}</strong></article>
      <article><span>${escapeHtml(t('activity.activeDays'))}</span><strong>${activity.activeDays}</strong></article>
      <article><span>${escapeHtml(t('activity.allTasks'))}</span><strong>${activity.taskCount}</strong></article>
    </section>
    <p class="activity-note">${escapeHtml(t('activity.note'))}</p>`;
  $('#content-modal').hidden = false;
  document.body.classList.add('modal-open');
  $('#modal-close').focus();
  return true;
}

function renderAccount() {
  const badge = $('#account-badge');
  const account = state.account;
  badge.hidden = !account?.available || !account.name;
  if (badge.hidden) return;
  $('#account-name').textContent = account.name;
  $('#account-initial').textContent = account.initial || '#';
  badge.setAttribute('aria-label', t('account.aria', { name: account.name }));
}

async function loadAccount() {
  try {
    const response = await fetch(api('/api/account'));
    if (!response.ok) throw new Error('account');
    state.account = (await response.json()).account;
  } catch {
    state.account = null;
  }
  renderAccount();
}

function renderDeliveries() {
  const inbox = $('#delivery-inbox');
  const deliveries = state.deliveries || [];
  inbox.hidden = deliveries.length === 0;
  $('#delivery-count').textContent = deliveries.length ? t('delivery.count', { count: deliveries.length }) : '';
  $('#delivery-list').innerHTML = deliveries.map((delivery) => `
    <button class="delivery-thumb" type="button" data-delivery-id="${escapeHtml(delivery.id)}" aria-label="${escapeHtml(t('delivery.view', { title: delivery.title }))}">
      <img src="${escapeHtml(delivery.url)}" alt="" loading="lazy" />
      <span><strong>${escapeHtml(delivery.title)}</strong><small>${relativeTime(delivery.createdAt)}</small></span>
    </button>`).join('');
}

function deliverySignature(deliveries = []) {
  return deliveries.map((item) => `${item.id}:${item.createdAt}:${item.size}:${item.title}:${item.url}`).join('|');
}

async function loadDeliveries() {
  try {
    const response = await fetch(api('/api/deliveries'));
    if (!response.ok) throw new Error(t('delivery.loadFailure'));
    const deliveries = (await response.json()).deliveries;
    if (deliverySignature(deliveries) === deliverySignature(state.deliveries)) return;
    state.deliveries = deliveries;
    renderDeliveries();
  } catch { /* 保留当前缩略图，避免网络抖动时闪烁。 */ }
}

function resetDeliveryClearButton() {
  const button = $('#delivery-clear');
  button.disabled = false;
  delete button.dataset.confirming;
  button.textContent = t('delivery.clear');
  button.setAttribute('aria-label', t('delivery.clearAria'));
}

async function clearDeliveries() {
  const response = await fetch(api('/api/deliveries'), { method: 'DELETE' });
  const result = await response.json();
  if (!response.ok) throw new Error(localizedError(result.error, 'delivery.clearFailure'));
  state.deliveries = [];
  renderDeliveries();
  showToast(t('delivery.cleared', { count: result.deleted }));
  return result.deleted;
}

function showDelivery(delivery) {
  $('#modal-kicker').textContent = t('delivery.kicker');
  $('#modal-title').textContent = delivery.title;
  const modalContent = $('#modal-content');
  modalContent.className = 'modal-content delivery-view';
  modalContent.innerHTML = `<figure>
    <img src="${escapeHtml(delivery.url)}" alt="${escapeHtml(delivery.title)}" />
    <figcaption>${relativeTime(delivery.createdAt)} · ${Math.max(1, Math.round(delivery.size / 1024))} KB</figcaption>
  </figure>
  <a class="delivery-open" href="${escapeHtml(delivery.url)}" target="_blank" rel="noopener">${escapeHtml(t('delivery.original'))}</a>`;
  $('#content-modal').hidden = false;
  document.body.classList.add('modal-open');
  $('#modal-close').focus();
}

async function loadTasks() {
  const response = await fetch(api('/api/tasks'));
  if (!response.ok) throw new Error(localizedError((await response.json()).error, 'error.sync'));
  updateTasks(await response.json());
}

async function refreshTasks() {
  const button = $('#refresh-button');
  const selectedId = state.selectedId;
  button.disabled = true;
  button.classList.add('is-refreshing');
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-label', t('action.refreshing'));
  let succeeded = false;
  try {
    await loadTasks();
    if (selectedId) await loadDetail(selectedId);
    showToast(t('action.refreshed'));
    succeeded = true;
  } catch (error) {
    showToast(localizedError(error.message, 'error.sync'));
  } finally {
    button.disabled = false;
    button.classList.remove('is-refreshing');
    button.removeAttribute('aria-busy');
    button.setAttribute('aria-label', t('action.refresh'));
  }
  return succeeded;
}

async function sendTaskMessage(message, threadId = state.selectedId) {
  if (!message || !threadId) return null;
  const response = await fetch(api('/api/messages'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ threadId, message }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(localizedError(result.error, 'error.send'));
  return result;
}

function addOptimisticQueueItem(threadId, text) {
  const full = state.details.get(threadId) || { messages: [], queuedTasks: [] };
  const queuedTasks = full.queuedTasks || [];
  const item = {
    id: `optimistic-${Date.now()}-${++optimisticSequence}`,
    role: 'user',
    text,
    timestamp: Date.now(),
    pending: true,
    optimistic: true,
    queueOrder: queuedTasks.length + 1,
    queueRevision: queueRevision(queuedTasks),
  };
  if (!state.details.has(threadId)) state.details.set(threadId, full);
  applyQueuedTasks([...queuedTasks, item], threadId);
  return item.id;
}

function removeOptimisticQueueItem(threadId, itemId) {
  const full = state.details.get(threadId);
  if (!full) return false;
  applyQueuedTasks((full.queuedTasks || []).filter((item) => item.id !== itemId), threadId);
  return true;
}

function connectEvents() {
  source?.close();
  source = new EventSource(api('/api/events'));
  source.addEventListener('tasks', (event) => updateTasks(JSON.parse(event.data)));
  source.addEventListener('sync-error', (event) => showToast(localizedError(JSON.parse(event.data).error, 'error.sync')));
  source.onerror = () => setConnection(false, t('connection.reconnecting'));
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function showContent(title, content) {
  $('#modal-kicker').textContent = t('modal.fullContent');
  $('#modal-title').textContent = title;
  const modalContent = $('#modal-content');
  modalContent.className = 'modal-content';
  modalContent.textContent = content;
  $('#content-modal').hidden = false;
  document.body.classList.add('modal-open');
  $('#modal-close').focus();
}

function queueRevision(queuedTasks) {
  return queuedTasks[0]?.queueRevision ?? 0;
}

function applyQueuedTasks(queuedTasks, threadId = state.selectedId) {
  const full = state.details.get(threadId);
  if (full) state.details.set(threadId, { ...full, queuedTasks });
  state.tasks = state.tasks.map((task) => task.id === threadId ? { ...task, queuedCount: queuedTasks.length } : task);
  renderList();
  if (threadId === state.selectedId) renderDetail();
}

function renderQueueManager() {
  const queuedTasks = state.details.get(state.selectedId)?.queuedTasks || [];
  $('#modal-kicker').textContent = t('queue.waiting', { count: queuedTasks.length });
  $('#modal-title').textContent = t('queue.title');
  const modalContent = $('#modal-content');
  modalContent.className = 'modal-content queue-manager';
  modalContent.innerHTML = queuedTasks.length ? `
    <p class="queue-help">${escapeHtml(t('queue.help'))}</p>
    ${queueNotice ? `<div class="queue-notice" data-tone="${escapeHtml(queueNotice.tone)}" role="status">${escapeHtml(queueNotice.text)}</div>` : ''}
    <ol class="queue-manager-list">
      ${queuedTasks.map((message, index) => `
        <li data-queue-id="${escapeHtml(message.id)}" class="${message.optimistic ? 'is-saving' : ''}">
          <span class="queue-rank"><strong>${index + 1}</strong><small>${escapeHtml(t('queue.priority'))}</small></span>
          <button class="queue-copy" type="button" data-action="expand" aria-label="${escapeHtml(t('queue.expand'))}">
            <strong>${escapeHtml(message.text)}</strong>
            <small>${message.optimistic ? escapeHtml(t('queue.saving')) : `${relativeTime(message.timestamp)} · ${escapeHtml(t('queue.viewFull'))}`}</small>
          </button>
          <span class="queue-controls">
            <button type="button" data-action="up" aria-label="${escapeHtml(t('queue.raise'))}" ${index === 0 || message.optimistic ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5" /></svg>
            </button>
            <button type="button" data-action="down" aria-label="${escapeHtml(t('queue.lower'))}" ${index === queuedTasks.length - 1 || message.optimistic ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
            </button>
            <button class="queue-delete" type="button" data-action="delete" aria-label="${escapeHtml(t('queue.delete'))}" ${message.optimistic ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>
              <span>${escapeHtml(t('queue.deleteLabel'))}</span>
            </button>
          </span>
        </li>`).join('')}
    </ol>` : `<div class="queue-empty"><span>✓</span><strong>${escapeHtml(t('queue.emptyTitle'))}</strong><p>${escapeHtml(t('queue.emptyBody'))}</p></div>`;
  $('#content-modal').hidden = false;
  document.body.classList.add('modal-open');
}

function renderTaskManagement() {
  const task = state.tasks.find((item) => item.id === state.selectedId);
  if (!task) return;
  $('#modal-kicker').textContent = t('manage.kicker');
  $('#modal-title').textContent = task.title;
  const modalContent = $('#modal-content');
  modalContent.className = 'modal-content management-menu';
  modalContent.innerHTML = `<div class="management-actions">
    ${task.progress.state === 'running' ? `<button class="management-action" type="button" data-action="stop">
      <span><strong>${escapeHtml(t('manage.stop'))}</strong><small>${escapeHtml(t('manage.stopHint'))}</small></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z" /></svg>
    </button>` : ''}
    <button class="management-action" type="button" data-action="archive">
      <span><strong>${escapeHtml(t('manage.archive'))}</strong><small>${escapeHtml(t('manage.archiveHint'))}</small></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M6 7v12h12V7M9 11h6M5 4h14v3H5z" /></svg>
    </button>
    ${task.projectId ? `<button class="management-action" type="button" data-action="delete-project">
      <span><strong>${escapeHtml(t('manage.projectDelete'))}</strong><small>${escapeHtml(t('manage.projectDeleteHint'))}</small></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" /></svg>
    </button>` : ''}
  </div>`;
  $('#content-modal').hidden = false;
  document.body.classList.add('modal-open');
}

async function stopSelectedTask() {
  const taskId = state.selectedId;
  const response = await fetch(api(`/api/tasks/${taskId}/stop`), { method: 'POST' });
  const payload = await response.json();
  if (!response.ok) throw new Error(localizedError(payload.error, 'manage.stopFailure'));
  closeContent();
  showToast(t('manage.stopped'));
  await loadTasks();
  if (state.tasks.some((task) => task.id === taskId)) await loadDetail(taskId);
  return payload;
}

async function archiveSelectedTask() {
  const taskId = state.selectedId;
  const response = await fetch(api(`/api/tasks/${taskId}/archive`), { method: 'POST' });
  const payload = await response.json();
  if (!response.ok) throw new Error(localizedError(payload.error, 'manage.archiveFailure'));
  state.tasks = state.tasks.filter((task) => task.id !== taskId);
  state.details.delete(taskId);
  state.selectedId = null;
  closeContent();
  detailPane.classList.remove('is-open');
  history.replaceState(null, '', location.pathname + location.search);
  renderList();
  renderDetail();
  showToast(t('manage.archived'));
  return payload;
}

async function deleteSelectedProject() {
  const task = state.tasks.find((item) => item.id === state.selectedId);
  if (!task?.projectId) throw new Error(t('manage.projectDeleteFailure'));
  const response = await fetch(api(`/api/projects/${task.projectId}`), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: task.project }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(localizedError(payload.error, 'manage.projectDeleteFailure'));
  closeContent();
  await loadTasks();
  if (state.tasks.some((item) => item.id === state.selectedId)) await loadDetail(state.selectedId);
  showToast(t('manage.projectDeleted'));
  return payload;
}

async function handleManagementAction(button) {
  const action = button.dataset.action;
  if (action === 'delete-project' && !button.dataset.confirming) {
    button.dataset.confirming = 'true';
    button.classList.add('is-confirming');
    button.querySelector('strong').textContent = t('manage.confirmProject');
    return false;
  }
  const content = $('#modal-content');
  content.classList.add('is-busy');
  let succeeded = false;
  try {
    if (action === 'stop') await stopSelectedTask();
    if (action === 'archive') await archiveSelectedTask();
    if (action === 'delete-project') await deleteSelectedProject();
    succeeded = true;
  } catch (error) {
    const fallback = action === 'stop' ? 'manage.stopFailure' : action === 'archive' ? 'manage.archiveFailure' : 'manage.projectDeleteFailure';
    showToast(localizedError(error.message, fallback));
  }
  content.classList.remove('is-busy');
  return succeeded;
}

async function reorderQueue(itemId, direction) {
  const queuedTasks = state.details.get(state.selectedId)?.queuedTasks || [];
  const index = queuedTasks.findIndex((message) => message.id === itemId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= queuedTasks.length) return;
  const reordered = [...queuedTasks];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  const response = await fetch(api(`/api/tasks/${state.selectedId}/queue`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemIds: reordered.map((message) => message.id), revision: queueRevision(queuedTasks) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(localizedError(payload.error, 'queue.reorderFailure'));
  applyQueuedTasks(payload.queuedTasks);
  renderQueueManager();
  showToast(t('queue.reordered'));
}

async function deleteQueueItem(itemId) {
  const queuedTasks = state.details.get(state.selectedId)?.queuedTasks || [];
  const response = await fetch(api(`/api/tasks/${state.selectedId}/queue/${itemId}`), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: queueRevision(queuedTasks) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(localizedError(payload.error, 'queue.deleteFailure'));
  applyQueuedTasks(payload.queuedTasks);
  renderQueueManager();
  showToast(t('queue.deleted'));
}

function closeContent() {
  $('#content-modal').hidden = true;
  $('#content-modal .modal-sheet').classList.remove('activity-sheet');
  document.body.classList.remove('modal-open');
}

function resizeComposer() {
  const scroller = $('.detail-scroll');
  const keepAtBottom = scroller && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 8;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
  if (keepAtBottom) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
}

$('#message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || !state.selectedId) return;
  const threadId = state.selectedId;
  const optimisticId = addOptimisticQueueItem(threadId, message);
  input.value = '';
  resizeComposer();
  const button = $('#send-button');
  button.disabled = true;
  $('#composer-hint').textContent = t('composer.saving');
  try {
    await sendTaskMessage(message, threadId);
    showToast(t('composer.queuedToast'));
    $('#composer-hint').textContent = t('composer.queuedHint');
    await loadDetail(threadId, { followLatest: true }).catch(() => undefined);
  } catch (error) {
    removeOptimisticQueueItem(threadId, optimisticId);
    if (!input.value.trim() && state.selectedId === threadId) {
      input.value = message;
      resizeComposer();
    }
    showToast(localizedError(error.message, 'error.send'));
    $('#composer-hint').textContent = t('composer.failure');
  } finally {
    button.disabled = false;
  }
});

input.addEventListener('input', resizeComposer);
$('#language-button').textContent = languageButtonLabel();
$('#language-button').addEventListener('click', switchLanguage);
$('#version-button').addEventListener('click', renderVersionDetails);
$('#install-help').addEventListener('click', () => showContent(t('install.helpTitle'), t('install.helpBody')));
$('#install-dismiss').addEventListener('click', () => {
  localStorage.setItem('codex-local-hub-install-dismissed', '1');
  renderInstallTip();
});
$('#resume-button').addEventListener('click', async () => {
  const button = $('#resume-button');
  button.disabled = true;
  $('#composer-hint').textContent = t('resume.sending');
  try {
    await sendTaskMessage(t('resume.message'));
    showToast(t('resume.success'));
    $('#composer-hint').textContent = t('resume.success');
  } catch (error) {
    showToast(localizedError(error.message, 'resume.failure'));
    $('#composer-hint').textContent = t('resume.failure');
  } finally {
    button.disabled = false;
  }
});
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('is-active', item === button));
  renderList();
}));
$('#refresh-button').addEventListener('click', refreshTasks);
$('#delivery-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delivery-id]');
  const delivery = state.deliveries.find((item) => item.id === button?.dataset.deliveryId);
  if (delivery) showDelivery(delivery);
});
$('#delivery-clear').addEventListener('click', async () => {
  const button = $('#delivery-clear');
  if (!button.dataset.confirming) {
    button.dataset.confirming = 'true';
    button.textContent = t('delivery.confirmClear');
    button.setAttribute('aria-label', t('delivery.confirmClearAria'));
    return;
  }
  button.disabled = true;
  try {
    await clearDeliveries();
  } catch (error) {
    showToast(localizedError(error.message, 'delivery.clearFailure'));
  } finally {
    resetDeliveryClearButton();
  }
});
$('#back-button').addEventListener('click', () => {
  detailPane.classList.remove('is-open');
  history.replaceState(null, '', location.pathname + location.search);
});
$('#latest-task-preview').addEventListener('click', () => {
  const task = state.tasks.find((item) => item.id === state.selectedId);
  if (task) showContent(t('context.lastQuestionTitle'), task.latestTask || t('empty.taskContent'));
});
$('#queue-card').addEventListener('click', () => {
  const queuedTasks = state.details.get(state.selectedId)?.queuedTasks || [];
  if (queuedTasks.length) {
    queueNotice = null;
    renderQueueManager();
  }
});
$('#task-menu-button').addEventListener('click', renderTaskManagement);
$('#modal-content').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'activity-range') {
    renderActivityDashboard(Number(button.dataset.range));
    return;
  }
  if (button.dataset.action === 'version-refresh') {
    button.disabled = true;
    await loadVersion({ force: true }).then(renderVersionDetails).catch((error) => showToast(localizedError(error.message, 'version.updateFailure')));
    return;
  }
  if (button.dataset.action === 'version-update') {
    await requestPhoneUpdate();
    return;
  }
  if (button.dataset.action === 'report-issue') {
    reportIssue();
    return;
  }
  if ($('#modal-content').classList.contains('management-menu')) {
    await handleManagementAction(button);
    return;
  }
  const row = button?.closest('[data-queue-id]');
  if (!row || !$('#modal-content').classList.contains('queue-manager')) return;
  const action = button.dataset.action;
  if (action === 'expand') {
    row.classList.toggle('is-expanded');
    return;
  }
  if (action === 'delete' && !button.dataset.confirming) {
    button.dataset.confirming = 'true';
    button.classList.add('is-confirming');
    button.setAttribute('aria-label', t('queue.confirmDelete'));
    button.querySelector('span').textContent = t('queue.confirm');
    return;
  }
  $('#modal-content').classList.add('is-busy');
  try {
    if (action === 'up') await reorderQueue(row.dataset.queueId, -1);
    if (action === 'down') await reorderQueue(row.dataset.queueId, 1);
    if (action === 'delete') await deleteQueueItem(row.dataset.queueId);
  } catch (error) {
    await loadDetail(state.selectedId).catch(() => undefined);
    queueNotice = { tone: 'error', text: error.message };
    renderQueueManager();
  } finally {
    $('#modal-content').classList.remove('is-busy');
  }
});
$('#goal-card').addEventListener('click', () => {
  const goal = state.tasks.find((item) => item.id === state.selectedId)?.goal;
  if (goal) showContent(t('context.goalTitle'), t('context.goalBody', {
    objective: goal.objective,
    status: localizedGoalStatus(goal),
    elapsed: formatDuration(goal.elapsedSeconds),
  }));
});
$('#usage-card').addEventListener('click', async () => {
  if (!state.activity) await loadActivity();
  if (!renderActivityDashboard()) showToast(t('activity.loadFailure'));
});
$('#modal-close').addEventListener('click', closeContent);
$('.modal-backdrop').addEventListener('click', closeContent);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeContent(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    markTaskRead(state.tasks.find((task) => task.id === state.selectedId));
    renderList();
  }
});
$('#new-message-indicator').addEventListener('click', scrollConversationToLatest);
$('.detail-scroll').addEventListener('scroll', () => {
  const scroller = $('.detail-scroll');
  if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 8) scrollConversationToLatest();
}, { passive: true });

async function startDashboard() {
  renderInstallTip();
  registerServiceWorker();
  try {
    await Promise.all([loadTasks(), loadProjects()]);
    connectEvents();
    loadUsage();
    loadVersion().catch(ignoreFailure);
    loadActivity();
    loadAccount();
    loadDeliveries();
    setInterval(loadUsage, 60_000);
    setInterval(loadActivity, 60_000);
    setInterval(loadDeliveries, 5_000);
  } catch (error) {
    setConnection(false, t('connection.offline'));
    showToast(localizedError(error.message, 'error.sync'));
    connectEvents();
  }
}

startDashboard();

export {
  state,
  preferredLanguage,
  stripTokenFromUrl,
  api,
  ignoreFailure,
  escapeHtml,
  relativeTime,
  localizedProgress,
  localizedActivity,
  localizedGoalStatus,
  formatDuration,
  localizedError,
  visibleTasks,
  projectName,
  projectLabel,
  projectTaskCount,
  groupTasksByProject,
  orderTasksByProject,
  projectCollapseKey,
  isProjectCollapsed,
  setProjectCollapsed,
  taskReadKey,
  updateUnreadPresentation,
  markTaskRead,
  isTaskActivelyViewed,
  syncUnreadTasks,
  renderTaskCard,
  renderList,
  selectTask,
  renderDetail,
  captureConversationScroll,
  restoreConversationScroll,
  messageSignature,
  scrollConversationToLatest,
  switchLanguage,
  languageButtonLabel,
  shouldShowInstallTip,
  renderInstallTip,
  registerServiceWorker,
  updateTasks,
  taskViewChanged,
  loadDetail,
  loadProjects,
  setConnection,
  safeIssueDiagnostics,
  buildIssueUrl,
  reportIssue,
  versionStateLabel,
  renderVersion,
  renderVersionDetails,
  loadVersion,
  waitForRuntimeVersion,
  requestPhoneUpdate,
  formatReset,
  formatResetCountdown,
  usageWindowLabel,
  formatTokenCount,
  renderTodayTokens,
  renderUsage,
  loadUsage,
  loadActivity,
  activityChartGeometry,
  activityDayLabel,
  renderActivityDashboard,
  renderAccount,
  loadAccount,
  renderDeliveries,
  deliverySignature,
  loadDeliveries,
  resetDeliveryClearButton,
  clearDeliveries,
  showDelivery,
  loadTasks,
  refreshTasks,
  sendTaskMessage,
  addOptimisticQueueItem,
  removeOptimisticQueueItem,
  connectEvents,
  showToast,
  showContent,
  queueRevision,
  applyQueuedTasks,
  renderQueueManager,
  renderTaskManagement,
  stopSelectedTask,
  archiveSelectedTask,
  deleteSelectedProject,
  handleManagementAction,
  reorderQueue,
  deleteQueueItem,
  closeContent,
  resizeComposer,
  startDashboard,
};
