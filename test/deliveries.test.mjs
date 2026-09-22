import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, utimes, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DeliveryInbox, deliveryTitle, isDeliveryName } from '../src/deliveries.mjs';

test('delivery names and titles accept only supported local image files', () => {
  assert.equal(isDeliveryName('image.PNG'), true);
  assert.equal(isDeliveryName('photo.jpeg'), true);
  assert.equal(isDeliveryName('photo.gif'), true);
  assert.equal(isDeliveryName('photo.webp'), true);
  assert.equal(isDeliveryName('../image.png'), false);
  assert.equal(isDeliveryName('notes.txt'), false);
  assert.equal(isDeliveryName(null), false);
  assert.equal(deliveryTitle('1720000000000-deadbeef-Final_mockup.png'), 'Final mockup');
  assert.equal(deliveryTitle('plain_name.jpg'), 'plain name');
  assert.equal(deliveryTitle('___'), '图片交付');
});

test('delivery inbox lists newest images, enforces limits and opens safe streams', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'delivery-inbox-'));
  t.after(() => rm(directory, { recursive: true }));
  const old = join(directory, '1000000000000-aaaaaaaa-old.png');
  const recent = join(directory, '2000000000000-bbbbbbbb-recent.webp');
  const large = join(directory, '3000000000000-cccccccc-large.jpg');
  const fakeFile = join(directory, '4000000000000-dddddddd-folder.gif');
  await writeFile(old, 'old');
  await writeFile(recent, 'new');
  await writeFile(large, 'too-large');
  await mkdir(fakeFile);
  await writeFile(join(directory, 'ignore.txt'), 'ignored');
  await utimes(old, 1, 1);
  await utimes(recent, 2, 2);
  await utimes(large, 3, 3);

  const inbox = new DeliveryInbox({ directory, maxItems: 1, maxBytes: 5 });
  const deliveries = await inbox.list();
  assert.deepEqual(deliveries.map((item) => item.title), ['recent']);
  assert.equal(deliveries[0].mime, 'image/webp');
  assert.match(deliveries[0].url, /recent\.webp$/);
  await assert.rejects(stat(old), (error) => error.code === 'ENOENT');

  assert.equal(await inbox.open('../recent.webp'), null);
  assert.equal(await inbox.open('missing.png'), null);
  assert.equal(await inbox.open('3000000000000-cccccccc-large.jpg'), null);
  assert.equal(await inbox.open('4000000000000-dddddddd-folder.gif'), null);
  const opened = await inbox.open('2000000000000-bbbbbbbb-recent.webp');
  assert.equal(opened.mime, 'image/webp');
  const chunks = [];
  for await (const chunk of opened.stream()) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), 'new');

  const denied = new DeliveryInbox({ directory, statFile: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
  await assert.rejects(denied.open('image.png'), /denied/);
});

test('delivery inbox creates an absent directory and supports an empty result', async () => {
  const directory = join(await mkdtemp(join(tmpdir(), 'delivery-empty-')), 'nested');
  const inbox = new DeliveryInbox({ directory });
  assert.deepEqual(await inbox.list(), []);
  assert.equal((await stat(directory)).isDirectory(), true);
  await rm(join(directory, '..'), { recursive: true });
});

test('delivery inbox imports sandbox-safe staged images before listing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'delivery-staging-'));
  const directory = join(root, 'inbox');
  const stagingDirectory = join(root, 'outbox');
  t.after(() => rm(root, { recursive: true }));
  await mkdir(stagingDirectory);
  const staged = join(stagingDirectory, '2000000000000-aaaaaaaa-phone_result.png');
  await writeFile(staged, 'png');
  await writeFile(join(stagingDirectory, 'ignore.txt'), 'ignored');
  const inbox = new DeliveryInbox({ directory, stagingDirectory });
  const deliveries = await inbox.list();
  assert.deepEqual(deliveries.map((item) => item.title), ['phone result']);
  await assert.rejects(stat(staged), (error) => error.code === 'ENOENT');
  assert.equal((await stat(join(directory, deliveries[0].id))).isFile(), true);

  const sameDirectory = new DeliveryInbox({ directory, stagingDirectory: directory });
  assert.equal((await sameDirectory.list()).length, 1);
  const oversizedStaging = new DeliveryInbox({ directory, stagingDirectory, maxBytes: 1 });
  await writeFile(join(stagingDirectory, '3000000000000-bbbbbbbb-too_large.jpg'), 'large');
  await oversizedStaging.importStaging();
  assert.equal((await stat(join(stagingDirectory, '3000000000000-bbbbbbbb-too_large.jpg'))).isFile(), true);
});
