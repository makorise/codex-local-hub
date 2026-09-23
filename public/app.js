import { applyTranslations, getLanguage, initializeLanguage, setLanguage, t } from './i18n.js';

const state = {
  tasks: [],
  selectedId: null,
  filter: 'all',
  details: new Map(),
  usage: null,
  account: null,
  deliveries: [],
  syncedAt: null,
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

function api(path) {
  return new URL(path, location.origin);
}

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

function renderTaskCard(task, showProject = false) {
  const project = projectLabel(projectName(task));
  return `
    <button class="task-card ${showProject ? 'shows-project' : ''} ${task.id === state.selectedId ? 'is-selected' : ''}" type="button" data-id="${escapeHtml(task.id)}">
      <div class="task-card-top">
        ${showProject ? `<span class="task-project">${escapeHtml(project)}</span>` : ''}
        <span class="status-pill" data-tone="${escapeHtml(task.progress.tone)}">${escapeHtml(localizedProgress(task))}</span>
      </div>
      <h3>${escapeHtml(task.title)}</h3>
      <p>${escapeHtml(task.latestTask || t('empty.task'))}</p>
      <div class="task-card-foot"><span>${escapeHtml(localizedActivity(task))}</span><time>${relativeTime(task.updatedAt)}</time></div>
    </button>`;
}

function renderList() {
  const tasks = visibleTasks();
  $('#active-count').textContent = state.tasks.filter((task) => task.progress.state === 'running').length;
  $('#queued-count').textContent = state.tasks.reduce((total, task) => total + task.queuedCount, 0);
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
  renderList();
  renderDetail();
  detailPane.classList.add('is-open');
  history.replaceState(null, '', `#${id}`);
  loadDetail(id).catch((error) => showToast(error.message));
}

function renderDetail() {
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
  $('#recent-messages').innerHTML = messages.length ? messages.map((message) => `
    <div class="message-row ${message.role === 'user' ? 'is-user' : 'is-assistant'}">
      <div class="message-bubble">
        <p>${escapeHtml(message.text)}</p>
        <time>${message.role === 'user' ? t('conversation.user') : 'Codex'} · ${relativeTime(message.timestamp)}</time>
      </div>
    </div>`).join('') : `<div class="list-empty">${escapeHtml(t('conversation.loading'))}</div>`;
}

function switchLanguage() {
  const next = getLanguage() === 'zh-CN' ? 'en' : 'zh-CN';
  setLanguage(next);
  localStorage.setItem('codex-local-hub-language-choice', next);
  applyTranslations();
  $('#language-button').textContent = languageButtonLabel();
  renderList();
  renderDetail();
  renderUsage();
  renderAccount();
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
  return window.navigator.serviceWorker.register('/service-worker.js').then(() => true).catch(() => false);
}

function updateTasks(payload) {
  const previous = state.tasks.find((task) => task.id === state.selectedId);
  state.tasks = payload.tasks || [];
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
    || previous.queuedCount !== current.queuedCount
    || previous.latestTask !== current.latestTask
    || previous.title !== current.title
    || previous.project !== current.project
    || previous.goal?.elapsedSeconds !== current.goal?.elapsedSeconds
    || previous.goal?.status?.state !== current.goal?.status?.state;
}

async function loadDetail(id) {
  const response = await fetch(api(`/api/tasks/${id}`));
  const payload = await response.json();
  if (!response.ok) throw new Error(localizedError(payload.error, 'error.readTask'));
  state.details.set(id, payload.task);
  if (state.selectedId === id) {
    renderDetail();
    requestAnimationFrame(() => {
      const scroller = $('.detail-scroll');
      scroller.scrollTop = scroller.scrollHeight;
    });
  }
}

function setConnection(online, text) {
  const dot = $('#connection-dot');
  dot.classList.toggle('is-online', online);
  dot.classList.toggle('is-offline', !online);
  $('#connection-text').textContent = text;
}

function formatReset(timestamp) {
  if (!timestamp) return t('usage.unknownReset');
  return new Intl.DateTimeFormat(getLanguage(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
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
  $('#usage-reset').textContent = t('usage.reset', { time: formatReset(primary.resetsAt) });
  $('#usage-ring-value').textContent = lowest;
  $('#usage-ring').style.setProperty('--remaining', lowest);
  card.dataset.tone = lowest <= 10 ? 'red' : lowest <= 30 ? 'amber' : 'green';
  card.setAttribute('aria-label', t('usage.aria', { summary: summaries.join(getLanguage() === 'zh-CN' ? '，' : ', ') }));
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

async function sendTaskMessage(message) {
  if (!message || !state.selectedId) return null;
  const response = await fetch(api('/api/messages'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ threadId: state.selectedId, message }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(localizedError(result.error, 'error.send'));
  return result;
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

function applyQueuedTasks(queuedTasks) {
  const full = state.details.get(state.selectedId);
  if (full) state.details.set(state.selectedId, { ...full, queuedTasks });
  state.tasks = state.tasks.map((task) => task.id === state.selectedId ? { ...task, queuedCount: queuedTasks.length } : task);
  renderList();
  renderDetail();
}

function renderQueueManager() {
  const queuedTasks = state.details.get(state.selectedId)?.queuedTasks || [];
  $('#modal-kicker').textContent = t('queue.waiting', { count: queuedTasks.length });
  $('#modal-title').textContent = t('queue.title');
  const modalContent = $('#modal-content');
  modalContent.className = `modal-content queue-manager${queueNotice?.tone === 'progress' ? ' is-busy' : ''}`;
  modalContent.innerHTML = queuedTasks.length ? `
    <p class="queue-help">${escapeHtml(t('queue.help'))}</p>
    ${queueNotice ? `<div class="queue-notice" data-tone="${escapeHtml(queueNotice.tone)}" role="status">${escapeHtml(queueNotice.text)}</div>` : ''}
    <ol class="queue-manager-list">
      ${queuedTasks.map((message, index) => `
        <li data-queue-id="${escapeHtml(message.id)}">
          <span class="queue-rank"><strong>${index + 1}</strong><small>${escapeHtml(t('queue.priority'))}</small></span>
          <button class="queue-copy" type="button" data-action="expand" aria-label="${escapeHtml(t('queue.expand'))}">
            <strong>${escapeHtml(message.text)}</strong>
            <small>${relativeTime(message.timestamp)} · ${escapeHtml(t('queue.viewFull'))}</small>
          </button>
          <span class="queue-controls">
            <button type="button" data-action="up" aria-label="${escapeHtml(t('queue.raise'))}" ${index === 0 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5" /></svg>
            </button>
            <button type="button" data-action="down" aria-label="${escapeHtml(t('queue.lower'))}" ${index === queuedTasks.length - 1 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
            </button>
            <button class="queue-steer" type="button" data-action="steer" aria-label="${escapeHtml(t('queue.steer'))}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" /></svg>
            </button>
            <button class="queue-delete" type="button" data-action="delete" aria-label="${escapeHtml(t('queue.delete'))}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>
              <span>${escapeHtml(t('queue.deleteLabel'))}</span>
            </button>
          </span>
        </li>`).join('')}
    </ol>` : `<div class="queue-empty"><span>✓</span><strong>${escapeHtml(t('queue.emptyTitle'))}</strong><p>${escapeHtml(t('queue.emptyBody'))}</p></div>`;
  $('#content-modal').hidden = false;
  document.body.classList.add('modal-open');
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

async function steerQueueItem(itemId) {
  const queuedTasks = state.details.get(state.selectedId)?.queuedTasks || [];
  queueNotice = { tone: 'progress', text: t('queue.steering') };
  renderQueueManager();
  const response = await fetch(api(`/api/tasks/${state.selectedId}/queue/${itemId}/steer`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: queueRevision(queuedTasks) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(localizedError(payload.error, 'queue.steerFailure'));
  queueNotice = { tone: 'success', text: t('queue.steered') };
  applyQueuedTasks(payload.queuedTasks);
  renderQueueManager();
  showToast(t('queue.steeredToast'));
}

function closeContent() {
  $('#content-modal').hidden = true;
  document.body.classList.remove('modal-open');
}

function resizeComposer() {
  const scroller = $('.detail-scroll');
  const keepAtBottom = scroller && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 32;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
  if (keepAtBottom) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
}

$('#message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || !state.selectedId) return;
  const button = $('#send-button');
  button.disabled = true;
  $('#composer-hint').textContent = t('composer.sending');
  try {
    const result = await sendTaskMessage(message);
    input.value = '';
    resizeComposer();
    const started = result.mode === 'started';
    showToast(t(started ? 'composer.startedToast' : 'composer.queuedToast'));
    $('#composer-hint').textContent = t(started ? 'composer.startedHint' : 'composer.queuedHint');
  } catch (error) {
    showToast(localizedError(error.message, 'error.send'));
    $('#composer-hint').textContent = t('composer.failure');
  } finally {
    button.disabled = false;
  }
});

input.addEventListener('input', resizeComposer);
$('#language-button').textContent = languageButtonLabel();
$('#language-button').addEventListener('click', switchLanguage);
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
$('#refresh-button').addEventListener('click', () => loadTasks().catch((error) => showToast(error.message)));
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
$('#modal-content').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  const row = button?.closest('[data-queue-id]');
  if (!button || !row || !$('#modal-content').classList.contains('queue-manager')) return;
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
    if (action === 'steer') await steerQueueItem(row.dataset.queueId);
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
$('#usage-card').addEventListener('click', () => {
  const limits = state.usage?.limits || [];
  if (!limits.length) return;
  const rows = limits.map((limit) => `${t('usage.used', {
    window: usageWindowLabel(limit),
    used: limit.usedPercent,
    remaining: limit.remainingPercent,
  })}\n${t('usage.reset', { time: formatReset(limit.resetsAt) })}`);
  showContent(t('usage.title'), `${rows.join('\n\n')}${state.usage.planType ? `\n\n${t('usage.plan', { plan: state.usage.planType })}` : ''}`);
});
$('#modal-close').addEventListener('click', closeContent);
$('.modal-backdrop').addEventListener('click', closeContent);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeContent(); });

async function startDashboard() {
  renderInstallTip();
  registerServiceWorker();
  try {
    await loadTasks();
    connectEvents();
    loadUsage();
    loadAccount();
    loadDeliveries();
    setInterval(loadUsage, 60_000);
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
  renderTaskCard,
  renderList,
  selectTask,
  renderDetail,
  switchLanguage,
  languageButtonLabel,
  shouldShowInstallTip,
  renderInstallTip,
  registerServiceWorker,
  updateTasks,
  taskViewChanged,
  loadDetail,
  setConnection,
  formatReset,
  usageWindowLabel,
  renderUsage,
  loadUsage,
  renderAccount,
  loadAccount,
  renderDeliveries,
  deliverySignature,
  loadDeliveries,
  resetDeliveryClearButton,
  clearDeliveries,
  showDelivery,
  loadTasks,
  sendTaskMessage,
  connectEvents,
  showToast,
  showContent,
  queueRevision,
  applyQueuedTasks,
  renderQueueManager,
  reorderQueue,
  deleteQueueItem,
  steerQueueItem,
  closeContent,
  resizeComposer,
  startDashboard,
};
