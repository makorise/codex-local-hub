const DEFAULT_ENDPOINT = 'https://api.github.com/repos/makorise/codex-local-hub/releases/latest';

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

export function createUpdateReader({
  currentVersion,
  hostUpdateEnabled = false,
  fetchImpl = fetch,
  endpoint = DEFAULT_ENDPOINT,
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
      try {
        const response = await fetchImpl(endpoint, {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': `Codex-Lookout/${currentVersion}`,
            'x-github-api-version': '2022-11-28',
          },
        });
        if (!response.ok) return unavailable(timestamp);
        cached = describeRelease(await response.json(), { currentVersion, hostUpdateEnabled, checkedAt: timestamp });
        return cached;
      } catch {
        return unavailable(timestamp);
      }
    })();
    inFlight = request;
    const result = await request;
    inFlight = null;
    return result;
  };
}
