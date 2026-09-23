import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('all user-facing surfaces use the Codex Lookout brand', async () => {
  const surfaces = await Promise.all([
    'public/index.html',
    'public/i18n.js',
    'public/manifest.webmanifest',
    'desktop/CodexBridgeApp.swift',
    'desktop/Info.plist',
    'desktop/en.lproj/InfoPlist.strings',
    'desktop/zh-Hans.lproj/InfoPlist.strings',
    'docs/assets/social-preview/codex-local-hub-social-preview.html',
  ].map(read));

  for (const source of surfaces) {
    assert.doesNotMatch(source, /Codex Local Hub|Codex 随身工作台|Codex 掌上任务台|CODEX LOCAL HUB/u);
  }
  assert.match(surfaces.join('\n'), /Codex Lookout/u);
  assert.match(surfaces.join('\n'), /Codex 瞭望台/u);
});

test('marketing and release surfaces keep one explicit compatibility note', async () => {
  const [readme, readmeZh, website, websiteCopy, release] = await Promise.all([
    read('README.md'),
    read('README.zh-CN.md'),
    read('website/index.html'),
    read('website/app.js'),
    read('.github/workflows/release.yml'),
  ]);

  assert.match(readme, /## Why Codex Lookout\?/u);
  assert.equal((readme.match(/Previously released as Codex Local Hub\./gu) || []).length, 1);
  assert.equal((readmeZh.match(/旧版本曾使用 Codex Local Hub 名称/gu) || []).length, 1);
  assert.equal((website.match(/Previously released as Codex Local Hub\./gu) || []).length, 1);
  assert.equal((websiteCopy.match(/Previously released as Codex Local Hub\./gu) || []).length, 1);
  assert.equal((websiteCopy.match(/旧版本曾使用 Codex Local Hub 名称/gu) || []).length, 1);
  assert.match(release, /--title "Codex Lookout v\$version"/u);
});
