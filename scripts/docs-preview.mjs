import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.DOCS_PREVIEW_PORT || 8791);
const host = '127.0.0.1';
const taskId = '11111111-2222-4333-8444-555555555555';
const now = Date.now();

const tasks = [
  {
    id: taskId,
    title: 'Polish the mobile onboarding flow',
    project: 'codex-local-hub',
    updatedAt: now - 18_000,
    activity: 'Updating files',
    latestTask: 'Finish the responsive layout, verify accessibility, and prepare the release screenshots.',
    queuedCount: 2,
    progress: { state: 'running', label: 'Running', tone: 'blue' },
    goal: {
      id: 'goal-demo',
      objective: 'Ship a reliable mobile dashboard with a clear onboarding experience.',
      elapsedSeconds: 4_860,
      status: { state: 'active', label: 'Running', tone: 'blue' },
    },
  },
  {
    id: '22222222-3333-4444-8555-666666666666',
    title: 'Review release security checklist',
    project: 'desktop-client',
    updatedAt: now - 240_000,
    activity: 'Queued',
    latestTask: 'Validate pairing, local-network boundaries, and secret storage.',
    queuedCount: 1,
    progress: { state: 'queued', label: 'Queued', tone: 'violet' },
    goal: null,
  },
  {
    id: '33333333-4444-4555-8666-777777777777',
    title: 'Prepare launch notes',
    project: 'docs',
    updatedAt: now - 4_800_000,
    activity: 'Completed',
    latestTask: 'Document installation and the local-first architecture.',
    queuedCount: 0,
    progress: { state: 'done', label: 'Completed', tone: 'green' },
    goal: null,
  },
];

const detail = {
  ...tasks[0],
  messages: [
    {
      id: 'message-1',
      role: 'user',
      text: 'Make the mobile workspace feel calm, compact, and easy to operate with one hand.',
      timestamp: now - 210_000,
      pending: false,
    },
    {
      id: 'message-2',
      role: 'assistant',
      text: 'The responsive layout is ready. I am checking the task states, queue controls, and input behavior now.',
      timestamp: now - 95_000,
      pending: false,
    },
    {
      id: 'message-3',
      role: 'user',
      text: 'Great. Keep the latest message visible and make the goal and queue available beside the composer.',
      timestamp: now - 38_000,
      pending: false,
    },
  ],
  queuedTasks: [
    {
      id: 'queue-11111111111111',
      role: 'user',
      text: 'Run the final accessibility pass.',
      timestamp: now - 25_000,
      pending: true,
      queueOrder: 1,
      queueRevision: 3,
    },
    {
      id: 'queue-22222222222222',
      role: 'user',
      text: 'Generate the release checklist.',
      timestamp: now - 12_000,
      pending: true,
      queueOrder: 2,
      queueRevision: 3,
    },
  ],
};

const tasksZhCN = tasks.map((task, index) => ({
  ...task,
  title: ['完善手机端引导体验', '检查发布安全清单', '准备发布说明'][index],
  project: ['随身工作台', '桌面客户端', '项目文档'][index],
  activity: ['正在更新文件', '已排队', '已完成'][index],
  latestTask: [
    '完成响应式布局，检查无障碍体验，并准备发布截图。',
    '检查设备配对、局域网边界和密钥存储。',
    '说明安装方式和本地优先的工作原理。',
  ][index],
  progress: [
    { state: 'running', label: '进行中', tone: 'blue' },
    { state: 'queued', label: '已排队', tone: 'violet' },
    { state: 'done', label: '已完成', tone: 'green' },
  ][index],
  goal: index === 0 ? {
    ...task.goal,
    objective: '交付稳定、清晰并适合单手操作的手机任务工作台。',
    status: { state: 'active', label: '执行中', tone: 'blue' },
  } : null,
}));

const detailZhCN = {
  ...detail,
  ...tasksZhCN[0],
  messages: [
    {
      id: 'message-1',
      role: 'user',
      text: '让手机工作台保持安静、紧凑，并且适合单手操作。',
      timestamp: now - 210_000,
      pending: false,
    },
    {
      id: 'message-2',
      role: 'assistant',
      text: '响应式布局已经完成。我正在检查任务状态、队列控制和输入体验。',
      timestamp: now - 95_000,
      pending: false,
    },
    {
      id: 'message-3',
      role: 'user',
      text: '很好。保持最后一条消息可见，并把目标和队列放在输入框旁边。',
      timestamp: now - 38_000,
      pending: false,
    },
  ],
  queuedTasks: [
    { ...detail.queuedTasks[0], text: '完成最后一轮无障碍检查。' },
    { ...detail.queuedTasks[1], text: '生成发布前检查清单。' },
  ],
};

const usage = {
  available: true,
  planType: 'pro',
  limits: [
    {
      label: 'Weekly',
      windowDurationMins: 10_080,
      usedPercent: 28,
      remainingPercent: 72,
      resetsAt: now + 3 * 86_400_000,
    },
  ],
};

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function serveStatic(pathname, response, language) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = normalize(join(root, requested));
  if (!file.startsWith(root)) return json(response, { error: 'Not found' }, 404);
  try {
    let body = await readFile(file);
    if (requested === 'index.html') {
      const selected = language === 'zh-CN' ? 'zh-CN' : 'en';
      body = Buffer.from(String(body).replace(
        '<script type="module" src="/app.js?v=23"></script>',
        `<script>localStorage.setItem('codex-local-hub-language-choice', '${selected}');localStorage.setItem('codex-local-hub-install-dismissed', '1');</script>\n    <script type="module" src="/app.js?v=23"></script>`,
      ));
    }
    response.writeHead(200, { 'content-type': mimeTypes[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    json(response, { error: 'Not found' }, 404);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  const referrer = request.headers.referer ? new URL(request.headers.referer) : null;
  const language = (url.searchParams.get('lang') || referrer?.searchParams.get('lang')) === 'zh-CN' ? 'zh-CN' : 'en';
  const localizedTasks = language === 'zh-CN' ? tasksZhCN : tasks;
  const localizedDetail = language === 'zh-CN' ? detailZhCN : detail;
  if (request.method === 'GET' && url.pathname === '/api/tasks') {
    return json(response, { tasks: localizedTasks, syncedAt: now });
  }
  if (request.method === 'GET' && url.pathname === `/api/tasks/${taskId}`) {
    return json(response, { task: localizedDetail });
  }
  if (request.method === 'GET' && url.pathname === '/api/usage') return json(response, { usage });
  if (request.method === 'GET' && url.pathname === '/api/deliveries') return json(response, { deliveries: [] });
  if (request.method === 'GET' && url.pathname === '/api/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.write(`event: tasks\ndata: ${JSON.stringify({ tasks: localizedTasks, syncedAt: now })}\n\n`);
    return;
  }
  return serveStatic(url.pathname, response, language);
});

server.listen(port, host, () => {
  console.log(`Sanitized documentation preview: http://${host}:${port}/?lang=en#${taskId}`);
});
