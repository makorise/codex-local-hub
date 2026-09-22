const INSTALL_PROMPTS = {
  en: 'Use $skill-installer to install https://github.com/makorise/codex-local-hub/tree/main/.agents/skills/setup-codex-local-hub, then use $setup-codex-local-hub in this task to install or update Codex Local Hub, launch it, and verify phone access. Preserve existing files and do not change my global Node.js environment.',
  'zh-CN': '使用 $skill-installer 安装 https://github.com/makorise/codex-local-hub/tree/main/.agents/skills/setup-codex-local-hub，然后在当前任务中使用 $setup-codex-local-hub：安装或更新 Codex Local Hub、启动程序并验证手机访问。保护已有文件，不要修改我的全局 Node.js 环境。',
};

const COPY = {
  en: {
    'a11y.skip': 'Skip to content', 'nav.features': 'Features', 'nav.how': 'How it works', 'nav.install': 'Install',
    'hero.eyebrow': 'LOCAL-FIRST · FOR CODEX', 'hero.title': 'Step away from your Mac.<br><em>Stay with the task.</em>',
    'hero.copy': 'See progress, reply, reorder queued work, and review screenshots from your phone. Your Codex work stays on your local network.',
    'hero.install': 'Copy install prompt', 'hero.source': 'View source', 'hero.local': 'Local network', 'hero.twoway': 'Two-way control', 'hero.open': 'Open source', 'hero.running': '3 tasks active',
    'features.label': 'WHAT IT DOES', 'features.title': 'Only the controls you need.',
    'features.progress.title': 'Track progress', 'features.progress.copy': 'Running, queued, paused, and finished tasks—grouped by project.',
    'features.reply.title': 'Reply and steer', 'features.reply.copy': 'Continue a task or send urgent context into the active turn.',
    'features.queue.title': 'Manage the queue', 'features.queue.copy': 'Reorder priorities or remove work you no longer need.',
    'features.inbox.title': 'Review results', 'features.inbox.copy': 'Open recent screenshots and visual deliveries on your phone.',
    'how.label': 'HOW IT WORKS', 'how.title': 'Your Mac does the work.<br>Your phone stays in reach.',
    'how.copy': 'A lightweight local service reads the useful Codex state and sends your actions back to the selected task. No hosted dashboard and no second chat archive.',
    'how.mac': 'Mac', 'how.macCopy': 'Codex keeps running', 'how.hubCopy': 'Syncs on trusted Wi-Fi', 'how.phone': 'Phone', 'how.phoneCopy': 'You decide what is next',
    'install.label': 'ONE-MESSAGE INSTALL', 'install.title': 'Paste once. Codex handles the rest.', 'install.copy': 'The setup skill installs or updates the app, starts it, and verifies phone access.',
    'install.requirements': 'macOS 15+ · Codex desktop · Same trusted Wi-Fi', 'install.promptLabel': 'PASTE INTO CODEX', 'install.copyButton': 'Copy',
    'install.compatibility': 'Downloads keep the Codex Local Hub app name so existing installations can update safely.', 'install.copied': 'Installation prompt copied',
    'footer.note': 'Independent open-source project. Not affiliated with OpenAI.', 'footer.download': 'Download',
  },
  'zh-CN': {
    'a11y.skip': '跳到正文', 'nav.features': '功能', 'nav.how': '原理', 'nav.install': '安装',
    'hero.eyebrow': '本地优先 · 为 CODEX 而生', 'hero.title': '离开电脑。<br><em>任务仍在手边。</em>',
    'hero.copy': '用手机看进度、回复消息、调整队列、验收截图。你的 Codex 工作始终留在局域网内。',
    'hero.install': '复制安装词', 'hero.source': '查看源码', 'hero.local': '局域网运行', 'hero.twoway': '双向控制', 'hero.open': '开源', 'hero.running': '3 个任务正在推进',
    'features.label': '核心功能', 'features.title': '只留下真正需要的控制。',
    'features.progress.title': '查看进度', 'features.progress.copy': '按项目查看运行、排队、暂停和已完成任务。',
    'features.reply.title': '回复与 Steer', 'features.reply.copy': '继续任务，或把紧急内容立即送入当前回合。',
    'features.queue.title': '管理队列', 'features.queue.copy': '调整优先级，删除已经不需要的任务。',
    'features.inbox.title': '验收结果', 'features.inbox.copy': '直接在手机上打开最近的截图和图片交付。',
    'how.label': '工作原理', 'how.title': 'Mac 负责工作。<br>手机负责决定。',
    'how.copy': '轻量本地服务读取必要的 Codex 状态，再把操作送回指定任务。没有托管面板，也不复制完整对话。',
    'how.mac': 'Mac', 'how.macCopy': 'Codex 持续运行', 'how.hubCopy': '通过可信 Wi-Fi 同步', 'how.phone': '手机', 'how.phoneCopy': '你决定下一步',
    'install.label': '一句话完成安装', 'install.title': '复制一次，剩下的交给 Codex。', 'install.copy': 'Setup Skill 会自动安装或更新程序、启动服务并验证手机访问。',
    'install.requirements': 'macOS 15+ · Codex 桌面端 · 同一可信 Wi-Fi', 'install.promptLabel': '复制到 CODEX', 'install.copyButton': '复制',
    'install.compatibility': '为保证已有安装可以安全升级，下载包仍保留 Codex Local Hub 应用名称。', 'install.copied': '安装词已复制',
    'footer.note': '独立开源项目，与 OpenAI 没有隶属关系。', 'footer.download': '下载',
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
  document.title = language === 'zh-CN' ? 'Codex 瞭望台 — 任务始终在手边' : 'Codex Lookout — Codex on your phone';
  localStorage.setItem('codex-lookout-language', language);
}

document.querySelector('.language-button').addEventListener('click', () => applyLanguage(language === 'zh-CN' ? 'en' : 'zh-CN'));

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

document.querySelectorAll('[data-copy-prompt]').forEach((button) => button.addEventListener('click', () => copyInstallPrompt()));

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -28px' });

document.querySelectorAll('.reveal').forEach((node, index) => {
  node.style.transitionDelay = `${Math.min(index % 4, 3) * 55}ms`;
  observer.observe(node);
});

applyLanguage(language);
