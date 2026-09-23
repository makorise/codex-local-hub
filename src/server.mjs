import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createServer as nodeCreateServer } from 'node:http';
import { isAuthorized, safeJson, validateMessageInput } from './core.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function cleanRuntimeValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function resolveRuntimeInfo({
  root = process.cwd(),
  env = process.env,
  readManifest = (path) => readFile(path, 'utf8'),
} = {}) {
  try {
    const manifest = JSON.parse(await readManifest(join(root, 'core-manifest.json')));
    const version = cleanRuntimeValue(manifest.version);
    if (version) return { version, source: 'hot-update' };
  } catch {}
  return {
    version: cleanRuntimeValue(env.CODEX_LOCAL_HUB_VERSION) || 'unknown',
    source: cleanRuntimeValue(env.CODEX_LOCAL_HUB_CORE_SOURCE) || 'bundled',
  };
}

export async function readJsonBody(request, limit = 64 * 1024) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw Object.assign(new Error('JSON 格式无效'), { statusCode: 400 });
  }
}

export function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(safeJson(body));
}

export async function serveStatic(response, publicDir, pathname, extraHeaders = {}) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const safePath = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = join(publicDir, safePath);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not-file');
    response.writeHead(200, {
      'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      ...extraHeaders,
    });
    createReadStream(filePath).pipe(response);
  } catch {
    json(response, 404, { error: '页面不存在' });
  }
}

export function createBridgeServer({
  repository,
  token = '',
  requirePairing = false,
  publicDir,
  usageReader = async () => ({ available: false, limits: [] }),
  accountReader = async () => ({ available: false, name: null, initial: null }),
  deliveryInbox = { list: async () => [], open: async () => null, clear: async () => 0 },
  createServer = nodeCreateServer,
  pollMs = 1500,
  runtimeInfo = { version: 'unknown', source: 'bundled' },
}) {
  const clients = new Set();
  let cachedTasks = [];
  let cachedSignature = '';
  let timer = null;

  async function refresh() {
    try {
      cachedTasks = await repository.listTasks();
      const signature = safeJson(cachedTasks);
      if (signature !== cachedSignature) {
        cachedSignature = signature;
        const frame = `event: tasks\ndata: ${safeJson({ tasks: cachedTasks, syncedAt: Date.now() })}\n\n`;
        for (const client of clients) client.write(frame);
      }
      return cachedTasks;
    } catch (error) {
      const frame = `event: sync-error\ndata: ${safeJson({ error: error.message })}\n\n`;
      for (const client of clients) client.write(frame);
      throw error;
    }
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const pairingMatch = request.method === 'GET' && url.pathname.match(/^\/pair\/([^/]+)$/);
    if (requirePairing && pairingMatch) {
      let pairingToken = '';
      try { pairingToken = decodeURIComponent(pairingMatch[1]); } catch { pairingToken = ''; }
      if (pairingToken !== token) return json(response, 403, { error: '配对链接无效' });
      response.writeHead(303, {
        location: '/',
        'set-cookie': `bridge_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
        'cache-control': 'no-store',
      });
      response.end();
      return;
    }
    if (requirePairing && url.pathname.startsWith('/api/') && !isAuthorized(url, request.headers, token)) {
      return json(response, 401, { error: '访问口令无效' });
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json(response, 200, { ok: true, clients: clients.size, ...runtimeInfo });
      }
      if (request.method === 'GET' && url.pathname === '/api/tasks') {
        const tasks = await refresh();
        return json(response, 200, { tasks, syncedAt: Date.now() });
      }
      if (request.method === 'GET' && url.pathname === '/api/usage') {
        return json(response, 200, { usage: await usageReader() });
      }
      if (request.method === 'GET' && url.pathname === '/api/account') {
        return json(response, 200, { account: await accountReader() });
      }
      if (request.method === 'GET' && url.pathname === '/api/deliveries') {
        return json(response, 200, { deliveries: await deliveryInbox.list() });
      }
      if (request.method === 'DELETE' && url.pathname === '/api/deliveries') {
        return json(response, 200, { deleted: await deliveryInbox.clear() });
      }
      const deliveryMatch = request.method === 'GET' && url.pathname.match(/^\/api\/deliveries\/files\/([^/]+)$/);
      if (deliveryMatch) {
        let deliveryId;
        try { deliveryId = decodeURIComponent(deliveryMatch[1]); } catch { return json(response, 400, { error: '图片标识无效' }); }
        const delivery = await deliveryInbox.open(deliveryId);
        if (!delivery) return json(response, 404, { error: '图片不存在' });
        response.writeHead(200, {
          'content-type': delivery.mime,
          'content-length': delivery.size,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        });
        delivery.stream().pipe(response);
        return;
      }
      const taskMatch = request.method === 'GET' && url.pathname.match(/^\/api\/tasks\/([0-9a-f-]+)$/i);
      if (taskMatch) {
        const task = await repository.getTask(taskMatch[1]);
        return task ? json(response, 200, { task }) : json(response, 404, { error: '任务不存在' });
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        clients.add(response);
        response.write(`event: tasks\ndata: ${safeJson({ tasks: cachedTasks, syncedAt: Date.now() })}\n\n`);
        request.on('close', () => clients.delete(response));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/messages') {
        const checked = validateMessageInput(await readJsonBody(request));
        if (!checked.ok) return json(response, 400, { error: checked.error });
        const result = await repository.sendMessage(checked.threadId, checked.message);
        await refresh();
        return json(response, 202, result);
      }
      const queueMatch = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]+)\/queue$/i);
      if (request.method === 'PATCH' && queueMatch) {
        const body = await readJsonBody(request);
        const itemIds = body.itemIds;
        const revision = body.revision;
        if (!Array.isArray(itemIds) || itemIds.length < 1 || itemIds.length > 50 || new Set(itemIds).size !== itemIds.length || itemIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{20,}$/i.test(id)) || !Number.isSafeInteger(revision) || revision < 0) {
          return json(response, 400, { error: '队列顺序参数无效' });
        }
        const queuedTasks = await repository.reorderQueuedTasks(queueMatch[1], itemIds, revision);
        await refresh();
        return json(response, 200, { queuedTasks });
      }
      const queueItemMatch = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]+)\/queue\/([0-9a-f-]+)$/i);
      if (request.method === 'DELETE' && queueItemMatch) {
        const body = await readJsonBody(request);
        if (!Number.isSafeInteger(body.revision) || body.revision < 0) return json(response, 400, { error: '队列修订号无效' });
        const queuedTasks = await repository.deleteQueuedTask(queueItemMatch[1], queueItemMatch[2], body.revision);
        await refresh();
        return json(response, 200, { queuedTasks });
      }
      const steerItemMatch = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]+)\/queue\/([0-9a-f-]+)\/steer$/i);
      if (request.method === 'POST' && steerItemMatch) {
        const body = await readJsonBody(request);
        if (!Number.isSafeInteger(body.revision) || body.revision < 0) return json(response, 400, { error: '队列修订号无效' });
        const result = await repository.steerQueuedTask(steerItemMatch[1], steerItemMatch[2], body.revision);
        await refresh();
        return json(response, 200, result);
      }
      if (url.pathname.startsWith('/api/')) return json(response, 404, { error: '接口不存在' });
      return serveStatic(response, publicDir, url.pathname);
    } catch (error) {
      return json(response, error.statusCode || 500, { error: error.message || '服务暂时不可用' });
    }
  });

  server.on('listening', () => {
    timer = setInterval(() => refresh().catch(() => undefined), pollMs);
    timer.unref();
    refresh().catch(() => undefined);
  });
  server.on('close', () => {
    if (timer) clearInterval(timer);
    for (const client of clients) client.end();
    clients.clear();
  });
  return { server, refresh, getCachedTasks: () => cachedTasks };
}
