import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyTranslations, getLanguage, initializeLanguage, normalizeLanguage, setLanguage, t, translationKeys } from '../public/i18n.js';

test('web translations normalize, fall back and update content, placeholders and labels', () => {
  assert.equal(normalizeLanguage('zh-Hans'), 'zh-CN');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage(), 'en');
  assert.equal(initializeLanguage(), 'zh-CN');
  assert.equal(initializeLanguage({ preferred: 'zh-TW' }), 'zh-CN');
  assert.equal(getLanguage(), 'zh-CN');
  assert.equal(t('missing.key'), 'missing.key');
  assert.equal(initializeLanguage({ stored: 'en', preferred: 'zh-CN' }), 'en');
  assert.deepEqual(translationKeys('en'), translationKeys('zh-CN'));
  assert.equal(t('time.minutesAgo', { count: 3 }), '3 min ago');

  const dom = new JSDOM('<!doctype html><html><body><p data-i18n="brand.name"></p><input data-i18n-placeholder="composer.placeholder"><button data-i18n-aria="action.close"></button></body></html>');
  applyTranslations(dom.window.document);
  assert.equal(dom.window.document.documentElement.lang, 'en');
  assert.equal(dom.window.document.querySelector('p').textContent, 'Codex Lookout');
  assert.equal(dom.window.document.querySelector('input').placeholder, 'Send a new prompt…');
  assert.equal(dom.window.document.querySelector('button').getAttribute('aria-label'), 'Close');
  assert.equal(setLanguage('zh-CN'), 'zh-CN');
  dom.window.close();
});
