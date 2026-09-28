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
