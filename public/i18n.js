const messages = {
  'zh-CN': {
    'brand.name': 'Codex 瞭望台', 'brand.unreadTitle': '({count}) Codex 瞭望台',
    'action.refresh': '刷新任务', 'action.close': '关闭', 'action.closeDetail': '关闭详情',
    'action.resume': '继续任务', 'action.back': '返回任务列表', 'action.send': '发送消息', 'action.switchLanguage': '切换为英文',
    'nav.taskList': '任务列表', 'nav.taskDetail': '任务详情', 'nav.taskFilter': '任务筛选',
    'install.title': '添加到手机桌面', 'install.summary': '像 App 一样快速打开，仅在同一局域网使用', 'install.action': '查看方法',
    'install.helpTitle': '添加到手机桌面', 'install.helpBody': 'iPhone / iPad：使用 Safari 打开本页，点击分享按钮，然后选择“添加到主屏幕”。\n\nAndroid：使用 Chrome 打开菜单，选择“添加到主屏幕”或“安装应用”。\n\n当前版本通过局域网连接，请确保手机与 Mac 位于同一 Wi-Fi。',
    'usage.title': 'Codex 用量', 'usage.unknownReset': '重置时间未知', 'usage.remaining': '{window}窗口剩余 {percent}%',
    'usage.reset': '{time} 重置', 'usage.aria': '查看 Codex 用量，{summary}', 'usage.used': '{window}窗口：已使用 {used}%，剩余 {remaining}%',
    'usage.plan': '套餐：{plan}', 'usage.loadFailure': '用量读取失败', 'usage.window.week': '周',
    'usage.window.minutes': '{count} 分钟', 'usage.window.hours': '{count} 小时', 'usage.window.days': '{count} 天',
    'usage.todayTitle': '今日 Token', 'usage.todayValue': '{count} tokens', 'usage.todayEmpty': '今日暂无记录',
    'usage.todayAria': '今日 Token：{summary}', 'usage.todayDetail': '总计 {total} · 输入 {input} · 输出 {output} · 缓存输入 {cached}',
    'usage.todayNote': '来自这台 Mac 今天保留的 Codex 会话日志；不包含网页端、其他设备或已删除的日志。',
    'delivery.title': '交付信箱', 'delivery.subtitle': '最近的图片结果', 'delivery.count': '{count} 张',
    'delivery.view': '查看图片：{title}', 'delivery.kicker': '图片交付', 'delivery.original': '查看原图', 'delivery.loadFailure': '交付信箱读取失败',
    'delivery.clear': '清空', 'delivery.clearAria': '清空交付信箱', 'delivery.confirmClear': '确认', 'delivery.confirmClearAria': '再次点击确认清空交付信箱',
    'delivery.cleared': '已清空 {count} 张图片', 'delivery.clearFailure': '清空交付信箱失败',
    'summary.running': '正在进行', 'summary.queued': '等待处理', 'summary.all': '全部任务', 'task.unread': '有新进展',
    'filter.all': '全部', 'filter.running': '进行中', 'filter.queued': '已排队', 'filter.done': '已完成',
    'project.uncategorized': '未分类', 'project.taskCountOne': '1 个任务', 'project.taskCountOther': '{count} 个任务',
    'project.toggle': '{action}{project}，{countLabel}', 'project.expand': '展开', 'project.collapse': '折叠',
    'empty.title': '选择一个任务', 'empty.summary': '查看最新进展，并从手机继续对话。',
    'empty.filtered': '没有符合条件的任务', 'empty.task': '等待新的任务', 'empty.taskContent': '暂无任务内容',
    'conversation.title': '对话记录', 'conversation.hint': '越上越早 · 最多 20 条', 'conversation.loading': '正在读取最近对话…', 'conversation.user': '你', 'conversation.newMessages': '有新消息 ↓',
    'context.lastQuestion': '最后问题', 'context.lastQuestionTitle': '最后一个问题', 'context.lastQuestionAria': '查看最后一个问题全文',
    'context.goal': '目标', 'context.goalTitle': '长程目标', 'context.goalAria': '查看长程目标，{status}，已执行 {elapsed}',
    'context.goalBody': '{objective}\n\n状态：{status}\n已执行：{elapsed}',
    'composer.label': '给当前任务发送新提示词', 'composer.placeholder': '输入新的提示词…', 'composer.hint': '消息会进入当前 Codex 任务',
    'composer.sending': '正在送入任务队列…', 'composer.saving': '已显示，正在安全写入队列…', 'composer.startedToast': '任务已开始执行', 'composer.queuedToast': '已安全加入等待队列',
    'composer.startedHint': '消息已送达，任务正在启动', 'composer.queuedHint': '已加入 Codex 桌面队列，将由桌面端自动接管', 'composer.failure': '发送失败，消息已放回输入框',
    'connection.connecting': '正在连接 Mac', 'connection.synced': '已同步 · {time}', 'connection.reconnecting': '正在重新连接', 'connection.offline': '无法连接 Mac',
    'account.aria': '当前 Codex 账号：{name}',
    'time.justNow': '刚刚', 'time.minutesAgo': '{count} 分钟前', 'time.hoursAgo': '{count} 小时前',
    'duration.hoursMinutes': '{hours} 小时 {minutes} 分钟', 'duration.minutes': '{minutes} 分钟', 'duration.seconds': '{seconds} 秒',
    'progress.running': '进行中', 'progress.paused': '已暂停', 'progress.failed': '需处理', 'progress.blocked': '受阻',
    'progress.limited': '用量受限', 'progress.usage_limited': '用量受限', 'progress.budget_limited': '预算已用完',
    'progress.queued': '已排队', 'progress.done': '已完成', 'progress.complete': '已完成', 'progress.idle': '待命',
    'progress.active': '执行中', 'progress.unknown': '状态未知',
    'activity.command_execution': '正在执行任务', 'activity.file_change': '正在更新文件', 'activity.mcp_tool_call': '正在连接工具',
    'activity.web_search': '正在检索资料', 'activity.reasoning': '正在处理', 'activity.agent_message': '正在整理结果', 'activity.default': '正在推进任务',
    'queue.count': '排队 {count}', 'queue.aria': '查看 {count} 条排队任务', 'queue.waiting': '{count} 条等待执行', 'queue.title': '任务队列',
    'queue.help': '数字越小越先执行。闪电会尝试把该消息立即注入当前回合；不会重启任务。', 'queue.priority': '优先',
    'queue.expand': '展开任务内容', 'queue.viewFull': '点击查看全文', 'queue.saving': '正在安全写入队列…', 'queue.raise': '提高优先级', 'queue.lower': '降低优先级',
    'queue.steer': '提升到队首', 'queue.delete': '删除排队任务', 'queue.deleteLabel': '删除', 'queue.confirmDelete': '再次点击确认删除', 'queue.confirm': '确认',
    'queue.emptyTitle': '队列已清空', 'queue.emptyBody': '当前没有等待执行的消息。', 'queue.reorderFailure': '优先级调整失败',
    'queue.reordered': '优先级已更新', 'queue.deleteFailure': '删除失败', 'queue.deleted': '已从队列移除',
    'queue.steering': '正在提升优先级…', 'queue.steerFailure': '调整优先级失败', 'queue.steered': '已提升到队首', 'queue.steeredToast': '已提升到队首',
    'modal.fullContent': '完整内容', 'error.readTask': '读取任务失败', 'error.sync': '同步失败', 'error.send': '发送失败',
    'resume.message': '请从上次中断的位置继续执行当前任务，先检查已有进展，不要重复已经完成的工作。',
    'resume.sending': '正在恢复任务…', 'resume.success': '任务已恢复执行', 'resume.failure': '恢复失败，请重试',
    'manage.open': '管理任务', 'manage.kicker': '任务管理', 'manage.stop': '停止当前执行', 'manage.stopHint': '保留任务和对话，可以稍后继续',
    'manage.archive': '归档任务', 'manage.archiveHint': '从当前任务列表隐藏，可在 Codex 中恢复',
    'manage.projectDelete': '从 Codex 删除项目', 'manage.projectDeleteHint': '只移除项目记录，不会删除电脑上的工程文件',
    'manage.confirmProject': '再次点击确认删除项目', 'manage.working': '正在处理…', 'manage.stopped': '任务已停止',
    'manage.archived': '任务已归档', 'manage.projectDeleted': '项目已从 Codex 删除，本地文件保持不变',
    'manage.stopFailure': '停止任务失败', 'manage.archiveFailure': '归档任务失败', 'manage.projectDeleteFailure': '删除项目失败',
  },
  en: {
    'brand.name': 'Codex Lookout', 'brand.unreadTitle': '({count}) Codex Lookout',
    'action.refresh': 'Refresh tasks', 'action.close': 'Close', 'action.closeDetail': 'Close details',
    'action.resume': 'Resume', 'action.back': 'Back to tasks', 'action.send': 'Send message', 'action.switchLanguage': 'Switch to Chinese',
    'nav.taskList': 'Task list', 'nav.taskDetail': 'Task details', 'nav.taskFilter': 'Task filters',
    'install.title': 'Add to Home Screen', 'install.summary': 'Open it like an app while on the same local network', 'install.action': 'How to',
    'install.helpTitle': 'Add to Home Screen', 'install.helpBody': 'iPhone / iPad: open this page in Safari, tap Share, then choose “Add to Home Screen”.\n\nAndroid: open the Chrome menu and choose “Add to Home screen” or “Install app”.\n\nThis release connects over your local network. Keep your phone and Mac on the same Wi-Fi.',
    'usage.title': 'Codex usage', 'usage.unknownReset': 'Reset time unavailable', 'usage.remaining': '{window} window: {percent}% remaining',
    'usage.reset': 'Resets {time}', 'usage.aria': 'View Codex usage: {summary}', 'usage.used': '{window} window: {used}% used, {remaining}% remaining',
    'usage.plan': 'Plan: {plan}', 'usage.loadFailure': 'Could not load usage', 'usage.window.week': 'Weekly',
    'usage.window.minutes': '{count} min', 'usage.window.hours': '{count} hr', 'usage.window.days': '{count} days',
    'usage.todayTitle': 'Tokens today', 'usage.todayValue': '{count} tokens', 'usage.todayEmpty': 'No usage recorded today',
    'usage.todayAria': 'Tokens today: {summary}', 'usage.todayDetail': '{total} total · {input} input · {output} output · {cached} cached input',
    'usage.todayNote': 'Read from today’s Codex session logs kept on this Mac; web, other-device, and deleted-session usage is not included.',
    'delivery.title': 'Delivery inbox', 'delivery.subtitle': 'Recent visual results', 'delivery.count': '{count} images',
    'delivery.view': 'View image: {title}', 'delivery.kicker': 'Image delivery', 'delivery.original': 'View original', 'delivery.loadFailure': 'Could not load the delivery inbox',
    'delivery.clear': 'Clear', 'delivery.clearAria': 'Clear the delivery inbox', 'delivery.confirmClear': 'Confirm', 'delivery.confirmClearAria': 'Tap again to clear the delivery inbox',
    'delivery.cleared': 'Cleared {count} images', 'delivery.clearFailure': 'Could not clear the delivery inbox',
    'summary.running': 'Running', 'summary.queued': 'Queued', 'summary.all': 'All tasks', 'task.unread': 'New activity',
    'filter.all': 'All', 'filter.running': 'Running', 'filter.queued': 'Queued', 'filter.done': 'Completed',
    'project.uncategorized': 'Uncategorized', 'project.taskCountOne': '1 task', 'project.taskCountOther': '{count} tasks',
    'project.toggle': '{action} {project}, {countLabel}', 'project.expand': 'Expand', 'project.collapse': 'Collapse',
    'empty.title': 'Choose a task', 'empty.summary': 'Check progress and continue the conversation from your phone.',
    'empty.filtered': 'No tasks match this filter', 'empty.task': 'Waiting for a new task', 'empty.taskContent': 'No task details yet',
    'conversation.title': 'Conversation', 'conversation.hint': 'Older above · latest 20', 'conversation.loading': 'Loading recent messages…', 'conversation.user': 'You', 'conversation.newMessages': 'New messages ↓',
    'context.lastQuestion': 'Last prompt', 'context.lastQuestionTitle': 'Latest prompt', 'context.lastQuestionAria': 'View the full latest prompt',
    'context.goal': 'Goal', 'context.goalTitle': 'Long-running goal', 'context.goalAria': 'View long-running goal, {status}, running for {elapsed}',
    'context.goalBody': '{objective}\n\nStatus: {status}\nElapsed: {elapsed}',
    'composer.label': 'Send a new prompt to the current task', 'composer.placeholder': 'Send a new prompt…', 'composer.hint': 'Your message will be sent to the current Codex task',
    'composer.sending': 'Sending to the task queue…', 'composer.saving': 'Shown now; saving safely to the queue…', 'composer.startedToast': 'Task started', 'composer.queuedToast': 'Safely added to the queue',
    'composer.startedHint': 'Message delivered. The task is starting.', 'composer.queuedHint': 'Added to the Codex Desktop queue; the desktop app will take over automatically.', 'composer.failure': 'Could not send. Your message was restored to the input.',
    'connection.connecting': 'Connecting to Mac', 'connection.synced': 'Synced · {time}', 'connection.reconnecting': 'Reconnecting', 'connection.offline': 'Could not connect to Mac',
    'account.aria': 'Current Codex account: {name}',
    'time.justNow': 'Just now', 'time.minutesAgo': '{count} min ago', 'time.hoursAgo': '{count} hr ago',
    'duration.hoursMinutes': '{hours} hr {minutes} min', 'duration.minutes': '{minutes} min', 'duration.seconds': '{seconds} sec',
    'progress.running': 'Running', 'progress.paused': 'Paused', 'progress.failed': 'Needs attention', 'progress.blocked': 'Blocked',
    'progress.limited': 'Usage limited', 'progress.usage_limited': 'Usage limited', 'progress.budget_limited': 'Budget exhausted',
    'progress.queued': 'Queued', 'progress.done': 'Completed', 'progress.complete': 'Completed', 'progress.idle': 'Ready',
    'progress.active': 'Running', 'progress.unknown': 'Unknown',
    'activity.command_execution': 'Running task', 'activity.file_change': 'Updating files', 'activity.mcp_tool_call': 'Connecting to a tool',
    'activity.web_search': 'Searching sources', 'activity.reasoning': 'Working', 'activity.agent_message': 'Preparing results', 'activity.default': 'Making progress',
    'queue.count': '{count} queued', 'queue.aria': 'View {count} queued tasks', 'queue.waiting': '{count} waiting', 'queue.title': 'Task queue',
    'queue.help': 'Lower numbers run first. The lightning button tries to inject the message into the current turn without restarting the task.', 'queue.priority': 'Priority',
    'queue.expand': 'Expand task details', 'queue.viewFull': 'Tap to view full text', 'queue.saving': 'Saving safely to the queue…', 'queue.raise': 'Raise priority', 'queue.lower': 'Lower priority',
    'queue.steer': 'Move to front', 'queue.delete': 'Delete queued task', 'queue.deleteLabel': 'Delete', 'queue.confirmDelete': 'Tap again to confirm deletion', 'queue.confirm': 'Confirm',
    'queue.emptyTitle': 'Queue is empty', 'queue.emptyBody': 'There are no messages waiting to run.', 'queue.reorderFailure': 'Could not change priority',
    'queue.reordered': 'Priority updated', 'queue.deleteFailure': 'Could not delete the task', 'queue.deleted': 'Removed from the queue',
    'queue.steering': 'Raising priority…', 'queue.steerFailure': 'Could not change priority', 'queue.steered': 'Moved to the front', 'queue.steeredToast': 'Moved to the front',
    'modal.fullContent': 'Full content', 'error.readTask': 'Could not load task', 'error.sync': 'Sync failed', 'error.send': 'Could not send message',
    'resume.message': 'Resume the current task from where it was interrupted. Inspect existing progress first and do not repeat completed work.',
    'resume.sending': 'Resuming task…', 'resume.success': 'Task resumed', 'resume.failure': 'Could not resume. Try again.',
    'manage.open': 'Manage task', 'manage.kicker': 'Task management', 'manage.stop': 'Stop current run', 'manage.stopHint': 'Keep the task and conversation so you can resume later',
    'manage.archive': 'Archive task', 'manage.archiveHint': 'Hide it from the current list; it can be restored in Codex',
    'manage.projectDelete': 'Remove project from Codex', 'manage.projectDeleteHint': 'Removes only the project record; files on this Mac are not deleted',
    'manage.confirmProject': 'Tap again to remove the project', 'manage.working': 'Working…', 'manage.stopped': 'Task stopped',
    'manage.archived': 'Task archived', 'manage.projectDeleted': 'Project removed from Codex; local files were kept',
    'manage.stopFailure': 'Could not stop the task', 'manage.archiveFailure': 'Could not archive the task', 'manage.projectDeleteFailure': 'Could not remove the project',
  },
};

let language = 'zh-CN';

export function normalizeLanguage(value) {
  return String(value || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function setLanguage(value) {
  language = normalizeLanguage(value);
  return language;
}

export function getLanguage() { return language; }

export function t(key, values = {}) {
  const template = messages[language][key] ?? key;
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
}

export function translationKeys(locale) {
  return Object.keys(messages[normalizeLanguage(locale)]).sort();
}

export function applyTranslations(root = document) {
  root.documentElement.lang = language;
  root.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-aria]').forEach((element) => { element.setAttribute('aria-label', t(element.dataset.i18nAria)); });
  root.title = t('brand.name');
  return language;
}

export function initializeLanguage({ stored, preferred } = {}) {
  return setLanguage(stored || preferred || 'zh-CN');
}
