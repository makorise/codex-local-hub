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
});
