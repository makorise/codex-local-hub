const DEFAULT_ENDPOINT = 'https://api.github.com/repos/makorise/codex-local-hub/releases/latest';
const DEFAULT_FALLBACK_ENDPOINT = 'https://github.com/makorise/codex-local-hub/releases/latest';
const RELEASE_PATH_PREFIX = '/makorise/codex-local-hub/releases/tag/v';

export function semanticVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/);
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left, right) {
  const a = semanticVersion(left);
  const b = semanticVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function trustedCoreAsset(payload, version) {
  const expectedName = `Codex-Local-Hub-core-${version}.zip`;
  const asset = payload.assets?.find((item) => item?.name === expectedName);
  const digest = String(asset?.digest || '');
  let url;
  try { url = new URL(asset?.browser_download_url); } catch { return false; }
  return url.protocol === 'https:'
    && url.hostname === 'github.com'
    && /^sha256:[0-9a-f]{64}$/i.test(digest);
}

export function describeRelease(payload, { currentVersion, hostUpdateEnabled = false, checkedAt = Date.now() }) {
  const current = semanticVersion(currentVersion);
  const latest = semanticVersion(payload?.tag_name);
  const trustedPage = (() => {
    try {
      const url = new URL(payload?.html_url);
      return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : null;
    } catch { return null; }
  })();
  if (!current || !latest || payload?.draft || payload?.prerelease || !trustedPage) {
    return { currentVersion, latestVersion: null, state: 'unavailable', updateAvailable: false, canUpdate: false, requiresDesktop: false, releaseUrl: null, checkedAt };
  }
  const normalizedLatest = latest.join('.');
  const comparison = compareVersions(currentVersion, normalizedLatest);
  const updateAvailable = comparison < 0;
  const hasCore = trustedCoreAsset(payload, normalizedLatest);
  return {
    currentVersion,
    latestVersion: normalizedLatest,
    state: updateAvailable ? 'available' : comparison > 0 ? 'ahead' : 'latest',
    updateAvailable,
    canUpdate: updateAvailable && hasCore && hostUpdateEnabled,
    requiresDesktop: updateAvailable && (!hasCore || !hostUpdateEnabled),
    releaseUrl: trustedPage,
    checkedAt,
  };
}

function fallbackVersion(response) {
  try {
    const url = new URL(response?.url);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(RELEASE_PATH_PREFIX)) return null;
    const value = decodeURIComponent(url.pathname.slice(RELEASE_PATH_PREFIX.length));
    return semanticVersion(value)?.join('.') || null;
  } catch {
    return null;
  }
}

async function fallbackRelease(fetchImpl, endpoint, currentVersion) {
  const response = await fetchImpl(endpoint, {
    method: 'HEAD',
    redirect: 'follow',
    headers: { 'user-agent': `Codex-Lookout/${currentVersion}` },
  });
  if (!response.ok) return null;
  const version = fallbackVersion(response);
  if (!version) return null;
  const htmlUrl = `https://github.com/makorise/codex-local-hub/releases/tag/v${version}`;
  const payload = { tag_name: `v${version}`, html_url: htmlUrl, draft: false, prerelease: false, assets: [] };
  if (compareVersions(currentVersion, version) >= 0) return payload;

  const assetName = `Codex-Local-Hub-core-${version}.zip`;
  const downloadBase = `https://github.com/makorise/codex-local-hub/releases/download/v${version}`;
  const checksum = await fetchImpl(`${downloadBase}/${assetName}.sha256`, {
    redirect: 'follow',
    headers: { 'user-agent': `Codex-Lookout/${currentVersion}` },
  });
  if (!checksum.ok) return payload;
  const digest = String(await checksum.text()).trim().match(/^([0-9a-f]{64})(?:\s|$)/i)?.[1];
  if (digest) payload.assets.push({
    name: assetName,
    browser_download_url: `${downloadBase}/${assetName}`,
    digest: `sha256:${digest.toLowerCase()}`,
  });
  return payload;
}

export function createUpdateReader({
  currentVersion,
  hostUpdateEnabled = false,
  fetchImpl = fetch,
  endpoint = DEFAULT_ENDPOINT,
  fallbackEndpoint = DEFAULT_FALLBACK_ENDPOINT,
  ttlMs = 15 * 60_000,
  now = Date.now,
} = {}) {
  let cached = null;
  let inFlight = null;
  const unavailable = (checkedAt = now()) => ({
    currentVersion,
    latestVersion: null,
    state: 'unavailable',
    updateAvailable: false,
    canUpdate: false,
    requiresDesktop: false,
    releaseUrl: null,
    checkedAt,
  });
  return async ({ force = false } = {}) => {
    const timestamp = now();
    if (!force && cached && timestamp - cached.checkedAt < ttlMs) return cached;
    if (inFlight) return inFlight;
    const request = (async () => {
      let payload = null;
      try {
        const response = await fetchImpl(endpoint, {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': `Codex-Lookout/${currentVersion}`,
            'x-github-api-version': '2022-11-28',
          },
        });
        if (response.ok) payload = await response.json();
      } catch { /* The public release redirect below is the quota-free fallback. */ }
      if (!payload) {
        try { payload = await fallbackRelease(fetchImpl, fallbackEndpoint, currentVersion); }
        catch { return unavailable(timestamp); }
      }
      if (!payload) return unavailable(timestamp);
      cached = describeRelease(payload, { currentVersion, hostUpdateEnabled, checkedAt: timestamp });
      return cached;
    })();
    inFlight = request;
    const result = await request;
    inFlight = null;
    return result;
  };
}
