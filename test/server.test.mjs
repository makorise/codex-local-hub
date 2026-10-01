import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import { Readable } from 'node:stream';
import { createBridgeServer, readJsonBody, resolveRuntimeInfo } from '../src/server.mjs';

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  const body = response.headers.get('content-type')?.includes('application/json') ? (text ? JSON.parse(text) : null) : text;
  return { status: response.status, body, headers: response.headers };
}

test('JSON body reader accepts valid and rejects invalid or oversized payloads', async () => {
  async function* chunks(parts) { for (const part of parts) yield Buffer.from(part); }
  assert.deepEqual(await readJsonBody(chunks([])), {});
  assert.deepEqual(await readJsonBody(chunks(['{"a":', '1}'])), { a: 1 });
  await assert.rejects(readJsonBody(chunks(['{'])), (error) => error.statusCode === 400);
  await assert.rejects(readJsonBody(chunks(['12345']), 2), (error) => error.statusCode === 413);
});

test('runtime info identifies hot updates and safe bundled fallbacks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bridge-runtime-'));
  await writeFile(join(root, 'core-manifest.json'), JSON.stringify({ version: '0.2.4' }));
  assert.deepEqual(await resolveRuntimeInfo({ root }), { version: '0.2.4', source: 'hot-update' });
  await rm(root, { recursive: true });
  assert.deepEqual(await resolveRuntimeInfo({
    root: '/active-core',
    readManifest: async (path) => {
      assert.equal(path, '/active-core/core-manifest.json');
      return JSON.stringify({ version: ' 0.2.4 ' });
    },
  }), { version: '0.2.4', source: 'hot-update' });
  assert.deepEqual(await resolveRuntimeInfo({
    env: { CODEX_LOCAL_HUB_VERSION: ' 0.2.4 ', CODEX_LOCAL_HUB_CORE_SOURCE: ' bundled ' },
    readManifest: async () => JSON.stringify({ version: 204 }),
  }), { version: '0.2.4', source: 'bundled' });
  assert.deepEqual(await resolveRuntimeInfo({
    env: {},
    readManifest: async () => { throw new Error('missing'); },
  }), { version: 'unknown', source: 'bundled' });
  assert.deepEqual(await resolveRuntimeInfo({
    env: {},
    readManifest: async () => JSON.stringify({ version: '   ' }),
  }), { version: 'unknown', source: 'bundled' });
});

test('mobile version API reports releases and safely delegates hot updates to the Mac host', async (t) => {
  const publicDir = await mkdtemp(join(tmpdir(), 'bridge-version-'));
  await writeFile(join(publicDir, 'index.html'), 'ok');
  const repository = { listTasks: async () => [] };
  let version = { currentVersion: '0.2.9', latestVersion: '0.3.0', state: 'available', updateAvailable: true, canUpdate: true, requiresDesktop: false };
  const reads = [];
  const requests = [];
  const bridge = createBridgeServer({
    repository,
    publicDir,
    pollMs: 60_000,
    updateReader: async (options) => { reads.push(options); return version; },
    requestHostUpdate: async (value) => { requests.push(value); },
  });
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  t.after(async () => { bridge.server.closeAllConnections(); await new Promise((resolve) => bridge.server.close(resolve)); await rm(publicDir, { recursive: true }); });

  assert.equal((await request(base, '/api/version')).body.version.latestVersion, '0.3.0');
  assert.deepEqual(reads.at(-1), { force: false });
  assert.equal((await request(base, '/api/version?refresh=1')).status, 200);
  assert.deepEqual(reads.at(-1), { force: true });
  assert.equal((await request(base, '/api/update', { method: 'POST' })).status, 202);
  assert.equal((await request(base, '/api/update', { method: 'POST' })).status, 202);
  assert.equal(requests.length, 1);

  version = { ...version, updateAvailable: false, canUpdate: false, state: 'latest' };
  assert.deepEqual((await request(base, '/api/update', { method: 'POST' })).body.accepted, false);
  version = { ...version, updateAvailable: true, requiresDesktop: true };
  assert.equal((await request(base, '/api/update', { method: 'POST' })).status, 409);
});

test('mobile hot update failures remain retryable and unsupported hosts fail closed', async (t) => {
  const publicDir = await mkdtemp(join(tmpdir(), 'bridge-version-failure-'));
  await writeFile(join(publicDir, 'index.html'), 'ok');
  const repository = { listTasks: async () => [] };
  const available = { currentVersion: '0.2.9', latestVersion: '0.3.0', state: 'available', updateAvailable: true, canUpdate: true, requiresDesktop: false };
  let attempts = 0;
  const failingBridge = createBridgeServer({
    repository,
    publicDir,
    pollMs: 60_000,
    updateReader: async () => available,
    requestHostUpdate: async () => { attempts += 1; throw new Error('host busy'); },
  });
  await new Promise((resolve) => failingBridge.server.listen(0, '127.0.0.1', resolve));
  const failingBase = `http://127.0.0.1:${failingBridge.server.address().port}`;
  assert.equal((await request(failingBase, '/api/update', { method: 'POST' })).status, 500);
  assert.equal((await request(failingBase, '/api/update', { method: 'POST' })).status, 500);
  assert.equal(attempts, 2);
  failingBridge.server.closeAllConnections();
  await new Promise((resolve) => failingBridge.server.close(resolve));

  const unsupported = createBridgeServer({ repository, publicDir, pollMs: 60_000, updateReader: async () => available });
  await new Promise((resolve) => unsupported.server.listen(0, '127.0.0.1', resolve));
  const unsupportedBase = `http://127.0.0.1:${unsupported.server.address().port}`;
  assert.equal((await request(unsupportedBase, '/api/update', { method: 'POST' })).status, 409);
  unsupported.server.closeAllConnections();
  await new Promise((resolve) => unsupported.server.close(resolve));
  await rm(publicDir, { recursive: true });
});

test('bridge server serves authenticated API, static files, SSE and messages', async (t) => {
  const publicDir = await mkdtemp(join(tmpdir(), 'bridge-public-'));
  await writeFile(join(publicDir, 'index.html'), '<h1>ok</h1>');
  await writeFile(join(publicDir, 'app.js'), 'export {};');
  await writeFile(join(publicDir, 'manifest.webmanifest'), '{}');
  await writeFile(join(publicDir, 'data.bin'), 'x');
  await mkdir(join(publicDir, 'folder'));
  let tasks = [{ id: '1234567890abcdef1234', title: 'Task', progress: { state: 'idle' } }];
  const sent = [];
  const queueMutations = [];
  const managementMutations = [];
  const repository = {
    listTasks: async () => tasks,
    getTask: async (id) => id === tasks[0]?.id ? { ...tasks[0], messages: [] } : null,
    sendMessage: async (id, message) => { sent.push([id, message]); return { accepted: true }; },
    reorderQueuedTasks: async (id, itemIds, revision) => { queueMutations.push(['reorder', id, itemIds, revision]); return itemIds.map((itemId, index) => ({ id: itemId, queueOrder: index + 1 })); },
    deleteQueuedTask: async (id, itemId, revision) => { queueMutations.push(['delete', id, itemId, revision]); return []; },
    stopTask: async (id) => { managementMutations.push(['stop', id]); return { stopped: true, threadId: id }; },
    archiveThread: async (id) => { managementMutations.push(['archive', id]); return { archived: true, threadId: id }; },
    removeProject: async (id, name) => { managementMutations.push(['delete-project', id, name]); return { deleted: true, projectId: id, name, filesDeleted: false }; },
    listProjects: async () => [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'sync' }],
    activitySummary: async () => ({ totalTurns: 8, completedTurns: 7, projectCount: 1, days: [] }),
  };
  const deliveryInbox = {
    list: async () => [{ id: 'image.png', title: '交付图', createdAt: 1, size: 3, mime: 'image/png', url: '/api/deliveries/files/image.png' }],
    open: async (id) => id === 'image.png' ? { mime: 'image/png', size: 3, stream: () => Readable.from(Buffer.from('png')) } : null,
    clear: async () => 1,
  };
  const account = { available: true, name: 'alice', initial: 'A' };
  const bridge = createBridgeServer({ repository, token: 'secret', requirePairing: true, publicDir, deliveryInbox, accountReader: async () => account, pollMs: 60_000, runtimeInfo: { version: '0.2.4', source: 'hot-update' } });
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  t.after(async () => { bridge.server.closeAllConnections(); await new Promise((resolve) => bridge.server.close(resolve)); await rm(publicDir, { recursive: true }); });

  assert.equal((await request(base, '/api/health')).status, 401);
  assert.deepEqual((await request(base, '/api/health?token=secret')).body, { ok: true, clients: 0, version: '0.2.4', source: 'hot-update' });
  const defaultVersion = (await request(base, '/api/version?token=secret')).body.version;
  assert.deepEqual({ ...defaultVersion, checkedAt: 0 }, {
    currentVersion: '0.2.4', latestVersion: null, state: 'unavailable', updateAvailable: false,
    canUpdate: false, requiresDesktop: false, releaseUrl: null, checkedAt: 0,
  });
  assert.equal(typeof defaultVersion.checkedAt, 'number');
  assert.equal((await request(base, '/api/tasks', { headers: { authorization: 'Bearer secret' } })).body.tasks.length, 1);
  assert.equal((await request(base, '/api/projects?token=secret')).body.projects[0].name, 'sync');
  assert.equal((await request(base, '/api/activity?token=secret')).body.activity.completedTurns, 7);
  assert.deepEqual((await request(base, '/api/usage?token=secret')).body.usage, { available: false, limits: [] });
  assert.deepEqual((await request(base, '/api/account?token=secret')).body.account, account);
  assert.equal((await request(base, '/api/deliveries?token=secret')).body.deliveries[0].title, '交付图');
  assert.deepEqual((await request(base, '/api/deliveries?token=secret', { method: 'DELETE' })).body, { deleted: 1 });
  const deliveredImage = await request(base, '/api/deliveries/files/image.png?token=secret');
  assert.equal(deliveredImage.status, 200);
  assert.equal(deliveredImage.body, 'png');
  assert.equal(deliveredImage.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await request(base, '/api/deliveries/files/missing.png?token=secret')).status, 404);
  assert.equal((await request(base, '/api/deliveries/files/%E0%A4%A?token=secret')).status, 400);
  assert.equal((await request(base, '/api/tasks/1234567890abcdef1234?token=secret')).status, 200);
  assert.equal((await request(base, '/api/tasks/aaaaaaaaaaaaaaaaaaaa?token=secret')).status, 404);
  assert.equal((await request(base, '/api/missing?token=secret')).status, 404);
  const home = await request(base, '/');
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('set-cookie'), null);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await request(base, '/pair/wrong', { redirect: 'manual' })).status, 403);
  assert.equal((await request(base, '/pair/%E0%A4%A', { redirect: 'manual' })).status, 403);
  const pairing = await request(base, '/pair/secret', { redirect: 'manual' });
  assert.equal(pairing.status, 303);
  assert.equal(pairing.headers.get('location'), '/');
  assert.match(pairing.headers.get('set-cookie'), /bridge_session=secret/);
  assert.equal((await request(base, '/api/health', { headers: { cookie: 'bridge_session=secret' } })).status, 200);
  assert.equal((await request(base, '/index.html')).status, 200);
  assert.equal((await request(base, '/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await request(base, '/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  assert.equal((await request(base, '/data.bin')).headers.get('content-type'), 'application/octet-stream');
  assert.equal((await request(base, '/folder')).status, 404);
  assert.equal((await request(base, '/missing')).status, 404);

  const invalid = await request(base, '/api/messages?token=secret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(invalid.status, 400);
  const accepted = await request(base, '/api/messages?token=secret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: tasks[0].id, message: 'hello' }) });
  assert.equal(accepted.status, 202);
  assert.deepEqual(sent, [[tasks[0].id, 'hello']]);

  const queuePath = `/api/tasks/${tasks[0].id}/queue?token=secret`;
  const invalidQueueBodies = [
    {},
    { itemIds: [], revision: 1 },
    { itemIds: Array.from({ length: 51 }, (_, index) => `${index}`.padStart(20, 'a')), revision: 1 },
    { itemIds: ['aaaaaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaaaaaa'], revision: 1 },
    { itemIds: [1], revision: 1 },
    { itemIds: ['bad'], revision: 1 },
    { itemIds: ['aaaaaaaaaaaaaaaaaaaa'], revision: 1.5 },
    { itemIds: ['aaaaaaaaaaaaaaaaaaaa'], revision: -1 },
  ];
  for (const body of invalidQueueBodies) {
    assert.equal((await request(base, queuePath, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 400);
  }
  const order = ['bbbbbbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaaaaaa'];
  const reordered = await request(base, queuePath, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemIds: order, revision: 7 }) });
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.body.queuedTasks.map((item) => item.id), order);
  const itemPath = `/api/tasks/${tasks[0].id}/queue/${order[0]}?token=secret`;
  assert.equal((await request(base, itemPath, { method: 'DELETE', body: JSON.stringify({ revision: 1.5 }) })).status, 400);
  assert.equal((await request(base, itemPath, { method: 'DELETE', body: JSON.stringify({ revision: -1 }) })).status, 400);
  assert.equal((await request(base, itemPath, { method: 'DELETE', body: JSON.stringify({ revision: 8 }) })).status, 200);
  const steerPath = `${itemPath.replace('?token=secret', '')}/steer?token=secret`;
  assert.equal((await request(base, steerPath, { method: 'POST', body: JSON.stringify({ revision: 9 }) })).status, 404);
  assert.deepEqual(queueMutations, [
    ['reorder', tasks[0].id, order, 7],
    ['delete', tasks[0].id, order[0], 8],
  ]);

  const managedThreadId = tasks[0].id;
  assert.deepEqual((await request(base, `/api/tasks/${managedThreadId}/stop?token=secret`, { method: 'POST' })).body, { stopped: true, threadId: managedThreadId });
  const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const createTaskPath = `/api/projects/${projectId}/tasks?token=secret`;
  assert.equal((await request(base, createTaskPath, { method: 'POST', body: JSON.stringify({ message: '不再支持' }) })).status, 404);
  assert.equal((await request(base, `/api/projects/${projectId}?token=secret`, { method: 'DELETE', body: '{}' })).status, 400);
  assert.equal((await request(base, `/api/projects/${projectId}?token=secret`, { method: 'DELETE', body: JSON.stringify({ name: 'x'.repeat(201) }) })).status, 400);
  assert.deepEqual((await request(base, `/api/projects/${projectId}?token=secret`, { method: 'DELETE', body: JSON.stringify({ name: ' sync ' }) })).body, { deleted: true, projectId, name: 'sync', filesDeleted: false });
  assert.deepEqual((await request(base, `/api/tasks/${managedThreadId}/archive?token=secret`, { method: 'POST' })).body, { archived: true, threadId: managedThreadId });
  assert.deepEqual(managementMutations, [
    ['stop', managedThreadId],
    ['delete-project', projectId, 'sync'],
    ['archive', managedThreadId],
  ]);

  await new Promise((resolve, reject) => {
    const stream = get(`${base}/api/events?token=secret`, (response) => {
      response.once('data', (chunk) => {
        assert.match(chunk.toString(), /event: tasks/);
        response.destroy();
        resolve();
      });
    });
    stream.on('error', reject);
  });

  assert.equal(bridge.getCachedTasks().length, 1);
  await bridge.refresh();
  tasks = [{ ...tasks[0], title: 'Changed' }];
  await bridge.refresh();
  await new Promise((resolve) => setTimeout(resolve, 2));
});

test('bridge server allows direct trusted-LAN access by default', async (t) => {
  const publicDir = await mkdtemp(join(tmpdir(), 'bridge-direct-'));
  await writeFile(join(publicDir, 'index.html'), '<h1>direct</h1>');
  const repository = {
    listTasks: async () => [{ id: '1234567890abcdef1234', title: 'Visible' }],
  };
  const bridge = createBridgeServer({ repository, publicDir, pollMs: 60_000 });
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  t.after(async () => {
    bridge.server.closeAllConnections();
    await new Promise((resolve) => bridge.server.close(resolve));
    await rm(publicDir, { recursive: true });
  });

  assert.equal((await request(base, '/api/health')).status, 200);
  assert.equal((await request(base, '/api/tasks')).body.tasks[0].title, 'Visible');
  assert.equal(bridge.scheduleIdleWake('missing-control'), false);
  assert.deepEqual((await request(base, '/api/account')).body.account, { available: false, name: null, initial: null });
  assert.equal((await request(base, '/pair/anything', { redirect: 'manual' })).status, 404);
});

test('bridge coalesces overlapping refreshes so slow storage cannot create a process stampede', async () => {
  let releaseRefresh;
  const gate = new Promise((resolve) => { releaseRefresh = resolve; });
  let listCalls = 0;
  const bridge = createBridgeServer({
    repository: {
      listTasks: async () => {
        listCalls += 1;
        await gate;
        return [];
      },
    },
    publicDir: '/unused',
    pollMs: 60_000,
  });
  const first = bridge.refresh();
  const second = bridge.refresh();
  assert.equal(first, second);
  assert.equal(listCalls, 1);
  releaseRefresh();
  await Promise.all([first, second]);
  await bridge.refresh();
  assert.equal(listCalls, 2);
});

test('queued prompts wake idle tasks once through the native Codex Desktop owner', async (t) => {
  const publicDir = await mkdtemp(join(tmpdir(), 'bridge-native-queue-'));
  await writeFile(join(publicDir, 'index.html'), '<h1>native queue</h1>');
  let launchCalls = 0;
  let failRefresh = false;
  let wakeResult = { started: true };
  let wakeFailure = null;
  let currentTime = 1_000;
  const deferred = [];
  const repository = {
    listTasks: async () => {
      if (failRefresh) throw new Error('refresh delayed');
      return [{ id: 'thread', queuedCount: 1, progress: { state: 'queued' } }];
    },
    sendMessage: async () => ({ accepted: true, mode: 'queued' }),
    wakeQueuedTaskIfIdle: async () => {
      launchCalls += 1;
      if (wakeFailure) throw wakeFailure;
      return wakeResult;
    },
  };
  const bridge = createBridgeServer({
    repository,
    publicDir,
    defer: (callback) => deferred.push(callback),
    now: () => currentTime,
    wakeRetryMs: 60_000,
    pollMs: 60_000,
  });
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    bridge.server.closeAllConnections();
    await new Promise((resolve) => bridge.server.close(resolve));
    await rm(publicDir, { recursive: true });
  });
  await bridge.refresh();
  assert.equal(deferred.length, 1);
  await deferred.shift()();
  assert.equal(launchCalls, 1);
  currentTime += 60_001;
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  assert.equal((await request(base, '/api/messages', {
    method: 'POST',
    body: JSON.stringify({ threadId: '1234567890abcdef1234', message: 'persist first' }),
  })).status, 202);
  assert.equal((await request(base, '/api/messages', {
    method: 'POST',
    body: JSON.stringify({ threadId: '1234567890abcdef1234', message: 'persist second' }),
  })).status, 202);
  assert.equal(launchCalls, 1);
  await deferred.shift()();
  assert.equal(launchCalls, 2);

  wakeResult = { started: false, reason: 'active' };
  assert.equal(bridge.scheduleIdleWake('active-thread'), true);
  await deferred.pop()();
  wakeFailure = new Error('desktop busy');
  assert.equal(bridge.scheduleIdleWake('failed-thread'), true);
  await deferred.pop()();
  assert.equal(bridge.scheduleIdleWake('failed-thread'), false);
  currentTime += 60_001;
  assert.equal(bridge.scheduleIdleWake('failed-thread'), true);
  await deferred.pop()();
  failRefresh = true;
  await deferred.shift()();
  assert.equal(launchCalls, 5);
});

test('bridge reports repository and message failures and closes active streams', async (t) => {
  const publicDir = await mkdtemp(join(tmpdir(), 'bridge-errors-'));
  let failure = new Error('sync failed');
  const repository = {
    listTasks: async () => { throw failure; },
    getTask: async () => null,
    sendMessage: async () => { throw new Error('queue failed'); },
    reorderQueuedTasks: async () => { throw new Error('reorder failed'); },
    deleteQueuedTask: async () => { throw new Error('delete failed'); },
    stopTask: async () => { throw new Error('stop failed'); },
    archiveThread: async () => { throw new Error('archive failed'); },
    removeProject: async () => { throw new Error('project delete failed'); },
    listProjects: async () => { throw new Error('project list failed'); },
    activitySummary: async () => { throw new Error('activity failed'); },
  };
  const bridge = createBridgeServer({
    repository,
    token: '',
    publicDir,
    usageReader: async () => { throw new Error('usage failed'); },
    accountReader: async () => { throw new Error('account failed'); },
    pollMs: 60_000,
  });
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  t.after(async () => rm(publicDir, { recursive: true }));
  assert.equal((await request(base, '/api/tasks')).status, 500);
  assert.equal((await request(base, '/api/projects')).status, 500);
  assert.equal((await request(base, '/api/activity')).status, 500);
  assert.equal((await request(base, '/api/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/tasks', { method: 'POST', body: JSON.stringify({ message: 'x' }) })).status, 404);
  assert.equal((await request(base, '/api/messages', { method: 'POST', body: JSON.stringify({ threadId: '1234567890abcdef1234', message: 'hello' }) })).status, 500);
  assert.equal((await request(base, '/api/tasks/1234567890abcdef1234/queue', { method: 'PATCH', body: JSON.stringify({ itemIds: ['aaaaaaaaaaaaaaaaaaaa'], revision: 1 }) })).status, 500);
  assert.equal((await request(base, '/api/tasks/1234567890abcdef1234/queue/aaaaaaaaaaaaaaaaaaaa', { method: 'DELETE', body: JSON.stringify({ revision: 1 }) })).status, 500);
  assert.equal((await request(base, '/api/tasks/1234567890abcdef1234/queue/aaaaaaaaaaaaaaaaaaaa/steer', { method: 'POST', body: JSON.stringify({ revision: 1 }) })).status, 404);
  assert.equal((await request(base, '/api/tasks/1234567890abcdef1234/stop', { method: 'POST' })).status, 500);
  assert.equal((await request(base, '/api/tasks/1234567890abcdef1234/archive', { method: 'POST' })).status, 500);
  assert.equal((await request(base, '/api/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { method: 'DELETE', body: JSON.stringify({ name: 'sync' }) })).status, 500);
  assert.equal((await request(base, '/api/usage')).status, 500);
  assert.equal((await request(base, '/api/account')).status, 500);

  await new Promise((resolve, reject) => {
    const stream = get(`${base}/api/events`, (response) => {
      let chunks = '';
      let handled = false;
      response.on('data', async (chunk) => {
        chunks += chunk;
        if (handled || !chunks.includes('event: tasks')) return;
        handled = true;
        try { await assert.rejects(bridge.refresh(), /sync failed/); } catch (error) { reject(error); return; }
        response.destroy();
        bridge.server.closeAllConnections();
        bridge.server.close(resolve);
      });
    });
    stream.on('error', reject);
  });
  failure = {};
  const second = createBridgeServer({ repository, token: '', publicDir, pollMs: 1 });
  await new Promise((resolve) => second.server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => setTimeout(resolve, 4));
  const base2 = `http://127.0.0.1:${second.server.address().port}`;
  assert.equal((await request(base2, '/api/tasks')).body.error, '服务暂时不可用');
  assert.deepEqual((await request(base2, '/api/deliveries')).body.deliveries, []);
  assert.deepEqual((await request(base2, '/api/deliveries', { method: 'DELETE' })).body, { deleted: 0 });
  assert.equal((await request(base2, '/api/deliveries/files/missing.png')).status, 404);
  second.server.closeAllConnections();
  await new Promise((resolve) => second.server.close(resolve));
});
