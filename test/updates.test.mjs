import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, createUpdateReader, describeRelease, semanticVersion } from '../src/updates.mjs';

function release(overrides = {}) {
  const version = overrides.version || '0.3.0';
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/makorise/codex-local-hub/releases/tag/v${version}`,
    draft: false,
    prerelease: false,
    assets: [{
      name: `Codex-Local-Hub-core-${version}.zip`,
      browser_download_url: `https://github.com/makorise/codex-local-hub/releases/download/v${version}/Codex-Local-Hub-core-${version}.zip`,
      digest: `sha256:${'a'.repeat(64)}`,
    }],
    ...overrides,
  };
}

test('semantic versions and release descriptions stay stable and trusted', () => {
  assert.deepEqual(semanticVersion(' v1.2.3+7 '), [1, 2, 3]);
  assert.equal(semanticVersion('1.2'), null);
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('broken', '1.2.3'), null);

  const available = describeRelease(release(), { currentVersion: '0.2.9', hostUpdateEnabled: true, checkedAt: 10 });
  assert.deepEqual(available, {
    currentVersion: '0.2.9', latestVersion: '0.3.0', state: 'available', updateAvailable: true,
    canUpdate: true, requiresDesktop: false,
    releaseUrl: 'https://github.com/makorise/codex-local-hub/releases/tag/v0.3.0', checkedAt: 10,
  });
  assert.equal(describeRelease(release(), { currentVersion: '0.3.0' }).state, 'latest');
  assert.equal(describeRelease(release(), { currentVersion: '0.4.0' }).state, 'ahead');
  assert.deepEqual(describeRelease(release(), { currentVersion: '0.2.9', checkedAt: 10 }), {
    ...available, canUpdate: false, requiresDesktop: true, checkedAt: available.checkedAt,
  });
  assert.equal(describeRelease(release({ assets: [] }), { currentVersion: '0.2.9', hostUpdateEnabled: true }).requiresDesktop, true);
  assert.equal(describeRelease(release({ assets: [{ name: 'Codex-Local-Hub-core-0.3.0.zip', browser_download_url: 'https://example.com/core.zip', digest: `sha256:${'a'.repeat(64)}` }] }), { currentVersion: '0.2.9', hostUpdateEnabled: true }).canUpdate, false);
  assert.equal(describeRelease(release({ assets: [{ name: 'Codex-Local-Hub-core-0.3.0.zip', browser_download_url: 'bad', digest: 'bad' }] }), { currentVersion: '0.2.9', hostUpdateEnabled: true }).canUpdate, false);
  for (const payload of [null, release({ tag_name: 'beta' }), release({ draft: true }), release({ prerelease: true }), release({ html_url: 'http://example.com' })]) {
    assert.equal(describeRelease(payload, { currentVersion: '0.2.9' }).state, 'unavailable');
  }
  assert.equal(describeRelease(release(), { currentVersion: 'broken' }).state, 'unavailable');
});

test('update reader caches, shares requests, refreshes, and fails closed', async () => {
  let now = 100;
  let calls = 0;
  let resolveFetch;
  const reader = createUpdateReader({
    currentVersion: '0.2.9', hostUpdateEnabled: true, ttlMs: 20, now: () => now,
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.equal(options.headers['user-agent'], 'Codex-Lookout/0.2.9');
      if (calls === 1) await new Promise((resolve) => { resolveFetch = resolve; });
      return { ok: true, json: async () => release() };
    },
  });
  const first = reader();
  const shared = reader();
  resolveFetch();
  assert.strictEqual(await first, await shared);
  assert.equal(calls, 1);
  assert.equal((await reader()).state, 'available');
  assert.equal(calls, 1);
  now = 121;
  assert.equal((await reader()).latestVersion, '0.3.0');
  assert.equal(calls, 2);
  await reader({ force: true });
  assert.equal(calls, 3);

  const offline = createUpdateReader({ currentVersion: '0.2.9', now: () => 200, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await offline()).state, 'unavailable');
  const rejected = createUpdateReader({ currentVersion: '0.2.9', now: () => 201, fetchImpl: async () => ({ ok: false }) });
  assert.equal((await rejected()).state, 'unavailable');
});

test('update reader falls back to GitHub release redirects when the API is rate limited', async () => {
  const digest = 'b'.repeat(64);
  const requests = [];
  const reader = createUpdateReader({
    currentVersion: '0.2.9', hostUpdateEnabled: true, now: () => 300,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (String(url).includes('api.github.com')) return { ok: false, status: 403 };
      if (String(url).endsWith('/releases/latest')) {
        return { ok: true, url: 'https://github.com/makorise/codex-local-hub/releases/tag/v0.3.0' };
      }
      return { ok: true, text: async () => `${digest}  Codex-Local-Hub-core-0.3.0.zip\n` };
    },
  });
  assert.deepEqual(await reader(), {
    currentVersion: '0.2.9', latestVersion: '0.3.0', state: 'available', updateAvailable: true,
    canUpdate: true, requiresDesktop: false,
    releaseUrl: 'https://github.com/makorise/codex-local-hub/releases/tag/v0.3.0', checkedAt: 300,
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[1].options.method, 'HEAD');
  assert.match(requests[2].url, /Codex-Local-Hub-core-0\.3\.0\.zip\.sha256$/);

  const current = createUpdateReader({
    currentVersion: '0.3.0', now: () => 301,
    fetchImpl: async (url) => String(url).includes('api.github.com')
      ? { ok: false, status: 403 }
      : { ok: true, url: 'https://github.com/makorise/codex-local-hub/releases/tag/v0.3.0' },
  });
  assert.equal((await current()).state, 'latest');

  const untrusted = createUpdateReader({
    currentVersion: '0.2.9', now: () => 302,
    fetchImpl: async (url) => String(url).includes('api.github.com')
      ? { ok: false, status: 403 }
      : { ok: true, url: 'https://example.com/makorise/codex-local-hub/releases/tag/v0.3.0' },
  });
  assert.equal((await untrusted()).state, 'unavailable');

  const malformed = createUpdateReader({
    currentVersion: '0.2.9', now: () => 303,
    fetchImpl: async (url) => String(url).includes('api.github.com')
      ? { ok: false, status: 403 }
      : { ok: true, url: '%' },
  });
  assert.equal((await malformed()).state, 'unavailable');

  for (const badUrl of [
    undefined,
    'http://github.com/makorise/codex-local-hub/releases/tag/v0.3.0',
    'https://github.com/makorise/another-project/releases/tag/v0.3.0',
    'https://github.com/makorise/codex-local-hub/releases/tag/vnot-a-version',
  ]) {
    const badRedirect = createUpdateReader({
      currentVersion: '0.2.9', now: () => 303,
      fetchImpl: async (url) => String(url).includes('api.github.com')
        ? { ok: false, status: 403 }
        : { ok: true, url: badUrl },
    });
    assert.equal((await badRedirect()).state, 'unavailable');
  }

  let recoveredCalls = 0;
  const recovered = createUpdateReader({
    currentVersion: '0.3.0', now: () => 304,
    fetchImpl: async () => {
      recoveredCalls += 1;
      if (recoveredCalls === 1) throw new Error('API offline');
      return { ok: true, url: 'https://github.com/makorise/codex-local-hub/releases/tag/v0.3.0' };
    },
  });
  assert.equal((await recovered()).state, 'latest');

  let missingCalls = 0;
  const missing = createUpdateReader({
    currentVersion: '0.2.9', now: () => 305,
    fetchImpl: async () => {
      missingCalls += 1;
      if (missingCalls === 1) throw new Error('API offline');
      return { ok: false, status: 503 };
    },
  });
  assert.equal((await missing()).state, 'unavailable');

  let noCoreCalls = 0;
  const noCore = createUpdateReader({
    currentVersion: '0.2.9', hostUpdateEnabled: true, now: () => 306,
    fetchImpl: async (url) => {
      noCoreCalls += 1;
      if (String(url).includes('api.github.com')) return { ok: false, status: 403 };
      if (String(url).endsWith('/releases/latest')) return { ok: true, url: 'https://github.com/makorise/codex-local-hub/releases/tag/v0.3.0' };
      return { ok: false, status: 404 };
    },
  });
  assert.equal((await noCore()).requiresDesktop, true);

  const badChecksum = createUpdateReader({
    currentVersion: '0.2.9', hostUpdateEnabled: true, now: () => 307,
    fetchImpl: async (url) => {
      if (String(url).includes('api.github.com')) return { ok: false, status: 403 };
      if (String(url).endsWith('/releases/latest')) return { ok: true, url: 'https://github.com/makorise/codex-local-hub/releases/tag/v0.3.0' };
      return { ok: true, text: async () => 'not-a-checksum' };
    },
  });
  assert.equal((await badChecksum()).canUpdate, false);
});
