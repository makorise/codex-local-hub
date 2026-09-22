import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../website/index.html', import.meta.url), 'utf8');

async function setup({ savedLanguage, browserLanguage = '' } = {}) {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8792/', pretendToBeVisual: true });
  if (savedLanguage) dom.window.localStorage.setItem('codex-lookout-language', savedLanguage);
  Object.defineProperty(dom.window.navigator, 'language', { configurable: true, value: browserLanguage });
  const clipboardWrites = [];
  const timerCallbacks = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value) => { clipboardWrites.push(value); } },
  });
  const missingText = dom.window.document.createElement('span');
  missingText.dataset.i18n = 'missing.key';
  dom.window.document.body.append(missingText);
  const missingHtml = dom.window.document.createElement('span');
  missingHtml.dataset.i18nHtml = 'missing.html';
  dom.window.document.body.append(missingHtml);

  class FakeIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.unobserved = [];
      FakeIntersectionObserver.instances.push(this);
    }
    observe(target) {
      this.callback([{ isIntersecting: false, target }, { isIntersecting: true, target }]);
    }
    unobserve(target) { this.unobserved.push(target); }
  }
  FakeIntersectionObserver.instances = [];

  const names = ['window', 'document', 'navigator', 'localStorage', 'IntersectionObserver', 'setTimeout', 'clearTimeout'];
  const descriptors = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: dom.window },
    document: { configurable: true, writable: true, value: dom.window.document },
    navigator: { configurable: true, writable: true, value: dom.window.navigator },
    localStorage: { configurable: true, writable: true, value: dom.window.localStorage },
    IntersectionObserver: { configurable: true, writable: true, value: FakeIntersectionObserver },
    setTimeout: { configurable: true, writable: true, value: (callback) => { timerCallbacks.push(callback); return 7; } },
    clearTimeout: { configurable: true, writable: true, value: () => undefined },
  });

  const module = await import('../website/app.js');
  const cleanup = () => {
    dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
  return { dom, module, clipboardWrites, timerCallbacks, observers: FakeIntersectionObserver.instances, cleanup };
}

test('product website localizes, animates and copies the one-message installer', async (t) => {
  const { dom, module, clipboardWrites, timerCallbacks, observers, cleanup } = await setup({ savedLanguage: 'zh-CN', browserLanguage: 'en-US' });
  t.after(cleanup);
  const { document } = dom.window;
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.match(document.title, /瞭望台/);
  assert.match(document.querySelector('h1').textContent, /Mac 继续运行/);
  assert.match(document.querySelector('[data-product-image="desktop"]').src, /desktop-dashboard\.zh-CN\.png$/);
  assert.equal(document.querySelectorAll('.reveal:not(.visible)').length, 0);
  assert.equal(observers[0].options.threshold, 0.12);
  assert.ok(observers[0].unobserved.length > 0);

  document.querySelector('.language-toggle').click();
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(dom.window.localStorage.getItem('codex-lookout-language'), 'en');
  assert.match(document.querySelector('h1').textContent, /Your Mac runs Codex/);
  assert.match(document.querySelector('[data-product-image="mobile"]').src, /mobile-conversation\.en\.png$/);

  document.querySelector('[data-copy-prompt]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clipboardWrites.length, 1);
  assert.match(clipboardWrites[0], /Use \$skill-installer/);
  assert.equal(document.querySelector('[data-toast]').classList.contains('visible'), true);
  assert.equal(document.querySelector('[data-toast]').textContent, 'Installation prompt copied');
  timerCallbacks.at(-1)();
  assert.equal(document.querySelector('[data-toast]').classList.contains('visible'), false);

  await module.copyInstallPrompt();
  assert.equal(clipboardWrites.length, 2);
  module.showToast('Direct toast');
  assert.equal(document.querySelector('[data-toast]').textContent, 'Direct toast');
  assert.equal(module.normalizeLanguage(null), 'en');
  assert.equal(module.preferredLanguage('', ''), 'en');
  assert.equal(module.preferredLanguage('zh-CN', 'en-US'), 'zh-CN');

  document.querySelector('.language-toggle').click();
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.match(document.querySelector('[data-install-prompt]').textContent, /使用 \$skill-installer/);
  module.applyLanguage('zh-TW');
  assert.equal(dom.window.document.documentElement.lang, 'zh-CN');
});
