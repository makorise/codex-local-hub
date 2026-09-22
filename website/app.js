const INSTALL_PROMPTS = {
  en: 'Use $skill-installer to install https://github.com/brandonwang001/codex-local-hub/tree/main/.agents/skills/setup-codex-local-hub, then use $setup-codex-local-hub in this task to install or update Codex Local Hub, install its image-delivery skill, launch it, and verify phone access. Prefer the latest stable release; otherwise build from source. Preserve existing files and do not change my global Node.js environment.',
  'zh-CN': '使用 $skill-installer 安装 https://github.com/brandonwang001/codex-local-hub/tree/main/.agents/skills/setup-codex-local-hub，然后在当前任务中使用 $setup-codex-local-hub：安装或更新 Codex Local Hub、安装图片交付 Skill、启动程序并验证手机访问。优先使用最新正式版，否则从源码构建；保护已有文件，不要修改我的全局 Node.js 环境。',
};

const COPY = {
  en: {
    'a11y.skip': 'Skip to content', 'nav.features': 'Features', 'nav.how': 'How it works', 'nav.install': 'Install',
    'hero.eyebrow': 'LOCAL-FIRST · OPEN SOURCE · PHONE-FIRST', 'hero.title': 'Your Mac runs Codex.<br><em>You keep moving.</em>',
    'hero.copy': 'Codex Lookout turns long-running Codex work into a calm, mobile command center. Check progress, answer the next question, steer urgent work, and review visual results—without returning to your desk.',
    'hero.cta': 'Install with Codex', 'hero.source': 'View source', 'hero.coverage': 'test coverage', 'hero.recent': 'recent messages only', 'hero.cloud': 'hosted relay required',
    'stage.running': '3 tasks moving', 'stage.local': 'Your data stays local',
    'problem.kicker': 'THE REAL PROBLEM', 'problem.title': 'The agent is autonomous.<br>Your attention still isn’t.',
    'problem.copy': 'Long tasks create a strange kind of waiting: you leave the work to Codex, but keep checking the Mac to see whether it finished, failed, or needs one small answer.',
    'problem.one.title': 'The silent wait', 'problem.one.copy': 'A 40-minute task can stop after minute four because Codex needs a clarification you never saw.',
    'problem.two.title': 'Context switching', 'problem.two.copy': 'You return to the Mac just to check one status, then lose focus to the full desktop again.',
    'problem.three.title': 'Invisible outcomes', 'problem.three.copy': 'Screenshots and visual results exist on the host, while the person approving them is somewhere else.',
    'solution.kicker': 'THE SOLUTION', 'solution.title': 'A lookout post<br>for work in motion.',
    'solution.copy': 'Codex Lookout adds a lightweight local layer around the Codex desktop app. It reads only the useful visible state, serves a phone-ready workspace over trusted Wi-Fi, and returns your instructions to the right task.',
    'solution.pointOne': 'No browser scraping and no copied full-chat archive', 'solution.pointTwo': 'No third-party dashboard between your Mac and phone', 'solution.pointThree': 'No changes to your global Node.js environment',
    'flow.mac': 'Your Mac', 'flow.macSmall': 'Codex keeps working', 'flow.read': 'reads local state', 'flow.hubSmall': 'filters, syncs, relays', 'flow.sync': 'trusted Wi-Fi', 'flow.phone': 'Your phone', 'flow.phoneSmall': 'you decide what’s next', 'flow.return': 'Prompts and queue actions travel back to the selected task',
    'features.kicker': 'BUILT FOR THE HUMAN IN THE LOOP', 'features.title': 'Everything that matters.<br>Nothing that doesn’t.', 'features.copy': 'A focused surface for monitoring, deciding, and moving work forward—not a miniature remote desktop.',
    'features.live.label': 'LIVE TASK VIEW', 'features.live.title': 'Know what is moving—and what is waiting.', 'features.live.copy': 'See running, queued, paused, failed, and completed work grouped by project, with long-running goal status and elapsed time.',
    'features.reply.label': 'TWO-WAY CONTROL', 'features.reply.title': 'Reply without walking back.', 'features.reply.copy': 'Continue an idle task, queue the next prompt, or steer urgent context into the active run.',
    'features.queue.label': 'PRIORITY QUEUE', 'features.queue.title': 'Shape the work ahead.', 'features.queue.copy': 'Reorder queued prompts, remove stale ideas, and promote the one that matters now.',
    'features.inbox.label': 'DELIVERY INBOX', 'features.inbox.title': 'Review visual results anywhere.', 'features.inbox.copy': 'Receive recent screenshots and image outputs on your phone, then clear the inbox when review is done.',
    'features.usage.label': 'USAGE AWARENESS', 'features.usage.title': 'See capacity before planning more.', 'features.usage.copy': 'Keep current usage and reset timing beside the tasks that consume it.',
    'features.privacy.label': 'LOCAL BY DEFAULT', 'features.privacy.title': 'Your work stays where it started.', 'features.privacy.copy': 'The current release stays on your trusted local network. Hidden reasoning is never mirrored, and only a small recent window is shown.',
    'moment.kicker': 'A SMALL CHANGE IN YOUR DAY', 'moment.title': 'Start the task.<br>Leave the desk.', 'moment.copy': 'Codex keeps the keyboard. You keep the decisions.',
    'moment.one.title': 'Launch', 'moment.one.copy': 'Open the Mac host and scan the QR code.', 'moment.two.title': 'Move', 'moment.two.copy': 'Keep your phone on the same trusted Wi-Fi.', 'moment.three.title': 'Intervene', 'moment.three.copy': 'Reply only when the work actually needs you.',
    'install.kicker': 'INSTALL IN ONE CONVERSATION', 'install.title': 'Let Codex install<br>its own lookout.', 'install.copy': 'No terminal tutorial. Copy one request into Codex; the setup skill preserves existing files, avoids your global Node.js environment, installs the companion delivery skill, launches the app, and verifies phone access.',
    'install.promptLabel': 'PASTE INTO CODEX', 'install.copyButton': 'Copy prompt', 'install.copied': 'Installation prompt copied',
    'install.stepOne.title': 'Paste the request', 'install.stepOne.copy': 'Codex installs the reusable setup skill.', 'install.stepTwo.title': 'Let it verify', 'install.stepTwo.copy': 'Tests, architecture, signature, and launch are checked.', 'install.stepThree.title': 'Scan and go', 'install.stepThree.copy': 'The QR code opens the local address directly.',
    'install.requirements': 'Requires macOS 15+, Codex desktop, and a phone on the same trusted Wi-Fi.', 'install.release': 'Browse releases ↗', 'install.compatibility': 'Downloads currently keep the Codex Local Hub app name so existing installations can update safely.',
    'open.kicker': 'OPEN SOURCE, LOCAL-FIRST', 'open.title': 'Built in public.<br>Useful in private.', 'open.copy': 'Inspect the implementation, run the complete test suite, suggest an improvement, or adapt the local bridge for your workflow.', 'open.cta': 'Explore on GitHub',
    'footer.note': 'Independent open-source project. Not affiliated with or endorsed by OpenAI.', 'footer.security': 'Security', 'footer.license': 'MIT License',
  },
  'zh-CN': {
    'a11y.skip': '跳到正文', 'nav.features': '功能', 'nav.how': '工作原理', 'nav.install': '安装',
    'hero.eyebrow': '本地优先 · 开源 · 为手机而生', 'hero.title': 'Mac 继续运行 Codex。<br><em>你继续生活。</em>',
    'hero.copy': 'Codex 瞭望台把长时间运行的 Codex 任务变成一个安静、清晰的手机控制台。看进度、回答问题、立即调整任务、验收图片结果，不必再走回电脑前。',
    'hero.cta': '让 Codex 安装', 'hero.source': '查看源码', 'hero.coverage': '测试覆盖率', 'hero.recent': '条最近消息', 'hero.cloud': '公网中继依赖',
    'stage.running': '3 个任务正在推进', 'stage.local': '数据留在本地',
    'problem.kicker': '真正的问题', 'problem.title': 'Agent 已经可以自主工作。<br>你的注意力却还没有自由。',
    'problem.copy': '长任务制造了一种奇怪的等待：工作已经交给 Codex，你却仍要不断查看 Mac，确认它是完成了、失败了，还是只差你回答一个小问题。',
    'problem.one.title': '无声的等待', 'problem.one.copy': '一个预计 40 分钟的任务，可能在第 4 分钟就因等待澄清而停住，而你毫不知情。',
    'problem.two.title': '被迫切换场景', 'problem.two.copy': '你只是想看一眼状态，却必须回到电脑前，再次被完整桌面打断注意力。',
    'problem.three.title': '看不见的交付', 'problem.three.copy': '截图和视觉结果已经生成在宿主电脑上，负责验收的人却在另一个房间。',
    'solution.kicker': '我们的解决方案', 'solution.title': '给运行中的工作，<br>建一座瞭望台。',
    'solution.copy': 'Codex 瞭望台在桌面端外增加一层轻量的本地服务：只读取真正有用的可见状态，通过可信 Wi-Fi 提供手机工作台，再把你的指令准确送回对应任务。',
    'solution.pointOne': '不抓取网页，也不复制完整聊天档案', 'solution.pointTwo': 'Mac 与手机之间没有第三方托管面板', 'solution.pointThree': '不修改你的全局 Node.js 环境',
    'flow.mac': '你的 Mac', 'flow.macSmall': 'Codex 持续工作', 'flow.read': '读取本地状态', 'flow.hubSmall': '筛选、同步、中继', 'flow.sync': '可信局域网', 'flow.phone': '你的手机', 'flow.phoneSmall': '你决定下一步', 'flow.return': '提示词与队列操作准确返回选中的任务',
    'features.kicker': '为需要介入的人而设计', 'features.title': '重要的信息都在。<br>不重要的都不打扰。', 'features.copy': '它不是缩小版远程桌面，而是一个专门用于查看、判断和推进任务的工作界面。',
    'features.live.label': '实时任务视图', 'features.live.title': '知道什么正在推进，什么正在等待。', 'features.live.copy': '按项目查看进行中、排队、暂停、失败和已完成任务，同时掌握长程目标、状态与执行时长。',
    'features.reply.label': '双向控制', 'features.reply.title': '不走回电脑，也能继续对话。', 'features.reply.copy': '继续空闲任务、排入下一条提示词，或把紧急内容立即 steer 到当前回合。',
    'features.queue.label': '优先级队列', 'features.queue.title': '安排接下来要做的事。', 'features.queue.copy': '拖动调整优先级、删除已经过时的想法，或者立即推进最重要的一条。',
    'features.inbox.label': '交付信箱', 'features.inbox.title': '在任何地方验收视觉结果。', 'features.inbox.copy': '从手机查看最近的截图和图片交付，确认完成后可以一键清空信箱副本。',
    'features.usage.label': '用量感知', 'features.usage.title': '布置任务前先了解余量。', 'features.usage.copy': '把当前用量和重置时间放在任务旁边，帮助你更合理地安排工作。',
    'features.privacy.label': '默认留在本地', 'features.privacy.title': '工作从哪里开始，就留在哪里。', 'features.privacy.copy': '当前版本只在可信局域网内运行；不镜像隐藏思考，只展示少量最近可见内容。',
    'moment.kicker': '对一天很小，却很重要的改变', 'moment.title': '启动任务。<br>离开电脑。', 'moment.copy': 'Codex 负责键盘，你只负责关键决定。',
    'moment.one.title': '启动', 'moment.one.copy': '打开 Mac 宿主程序，扫描二维码。', 'moment.two.title': '离开', 'moment.two.copy': '让手机和 Mac 保持在同一可信 Wi-Fi。', 'moment.three.title': '介入', 'moment.three.copy': '只在任务真正需要你的时候回复。',
    'install.kicker': '一次对话完成安装', 'install.title': '让 Codex 安装<br>自己的瞭望台。', 'install.copy': '不用照着终端教程逐行操作。复制一段话给 Codex，安装 Skill 会保护已有文件、不改全局 Node.js、安装图片交付 Skill、启动程序，并验证手机访问。',
    'install.promptLabel': '复制到 CODEX', 'install.copyButton': '复制安装词', 'install.copied': '安装提示词已复制',
    'install.stepOne.title': '粘贴安装词', 'install.stepOne.copy': 'Codex 自动安装可复用的 Setup Skill。', 'install.stepTwo.title': '自动验证', 'install.stepTwo.copy': '检查测试、架构、签名与程序启动。', 'install.stepThree.title': '扫码即用', 'install.stepThree.copy': '二维码直接打开局域网网址。',
    'install.requirements': '需要 macOS 15+、Codex 桌面端，以及连接同一可信 Wi-Fi 的手机。', 'install.release': '查看正式版本 ↗', 'install.compatibility': '为保证已有安装可以安全升级，当前下载包仍保留 Codex Local Hub 应用名称。',
    'open.kicker': '开源，本地优先', 'open.title': '在公开环境中构建。<br>在私人环境中使用。', 'open.copy': '你可以检查实现、运行完整测试、提出改进建议，或让这座本地桥梁适应自己的工作流。', 'open.cta': '前往 GitHub',
    'footer.note': '独立开源项目，与 OpenAI 没有隶属关系或官方背书。', 'footer.security': '安全说明', 'footer.license': 'MIT 许可证',
  },
};

export const normalizeLanguage = (value) => String(value || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
export const preferredLanguage = (savedLanguage, browserLanguage) => normalizeLanguage(savedLanguage || browserLanguage);
let language = preferredLanguage(localStorage.getItem('codex-lookout-language'), navigator.language);

export function applyLanguage(nextLanguage) {
  language = normalizeLanguage(nextLanguage);
  const dictionary = COPY[language];
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const value = dictionary[node.dataset.i18n];
    if (value) node.textContent = value;
  });
  document.querySelectorAll('[data-i18n-html]').forEach((node) => {
    const value = dictionary[node.dataset.i18nHtml];
    if (value) node.innerHTML = value;
  });
  document.querySelector('[data-install-prompt]').textContent = INSTALL_PROMPTS[language];
  document.querySelector('[data-lang-label]').textContent = language === 'zh-CN' ? 'EN' : '中文';
  const localized = language === 'zh-CN' ? 'zh-CN' : 'en';
  document.querySelector('[data-product-image="desktop"]').src = `assets/desktop-dashboard.${localized}.png`;
  document.querySelector('[data-product-image="mobile"]').src = `assets/mobile-conversation.${localized}.png`;
  document.title = language === 'zh-CN' ? 'Codex 瞭望台 — 离开电脑，仍然掌控任务' : 'Codex Lookout — Your Codex workspace, within reach';
  localStorage.setItem('codex-lookout-language', language);
}

document.querySelector('.language-toggle').addEventListener('click', () => applyLanguage(language === 'zh-CN' ? 'en' : 'zh-CN'));

let toastTimer;
export function showToast(message) {
  const toast = document.querySelector('[data-toast]');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

export async function copyInstallPrompt() {
  await navigator.clipboard.writeText(INSTALL_PROMPTS[language]);
  showToast(COPY[language]['install.copied']);
}

document.querySelector('[data-copy-prompt]').addEventListener('click', () => copyInstallPrompt());

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -28px' });

document.querySelectorAll('.reveal').forEach((node, index) => {
  node.style.transitionDelay = `${Math.min(index % 4, 3) * 65}ms`;
  observer.observe(node);
});

applyLanguage(language);
