import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('task pane has bounded desktop and touch scrolling styles', () => {
  assert.match(styles, /\.app-shell \{[^}]*height: 100dvh;[^}]*overflow: hidden;/);
  assert.match(html, /<meta name="viewport" content="[^"]*maximum-scale=1, user-scalable=no[^"]*" \/>/);
  assert.match(styles, /html \{[^}]*touch-action: pan-x pan-y;/);
  assert.match(styles, /\.task-pane \{[^}]*overflow-y: auto;[^}]*overscroll-behavior-y: contain;[^}]*-webkit-overflow-scrolling: touch;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.task-pane \{[^}]*height: 100%;[^}]*overflow-y: auto;[^}]*touch-action: pan-y;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.detail-scroll \{[^}]*overflow-y: scroll;[^}]*touch-action: pan-y;/);
  assert.match(styles, /\.account-badge span \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.account-badge \{[^}]*max-width: 92px;/);
  assert.match(styles, /\.summary-row \{[^}]*min-height: 44px;[^}]*margin-bottom: 8px;/);
  assert.match(styles, /\.summary-row div \{[^}]*padding: 7px 9px;[^}]*display: flex;/);
  assert.match(styles, /\.usage-today \{[^}]*min-height: 28px;[^}]*justify-content: space-between;/);
});
