import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

export function isDeliveryName(name) {
  return typeof name === 'string' && basename(name) === name && TYPES.has(extname(name).toLowerCase());
}

export function deliveryTitle(name) {
  const extension = extname(name);
  const stem = basename(name, extension);
  const match = stem.match(/^\d+-[0-9a-f]{8}-(.+)$/i);
  return String(match?.[1] || stem).replaceAll('_', ' ').trim() || '图片交付';
}

export class DeliveryInbox {
  constructor({
    directory,
    stagingDirectory = null,
    maxItems = 20,
    maxBytes = 20 * 1024 * 1024,
    ensureDir = mkdir,
    readDirectory = readdir,
    statFile = stat,
    removeFile = unlink,
    copyDelivery = copyFile,
    streamFile = createReadStream,
  }) {
    this.directory = directory;
    this.stagingDirectory = stagingDirectory;
    this.maxItems = maxItems;
    this.maxBytes = maxBytes;
    this.ensureDir = ensureDir;
    this.readDirectory = readDirectory;
    this.statFile = statFile;
    this.removeFile = removeFile;
    this.copyDelivery = copyDelivery;
    this.streamFile = streamFile;
  }

  async list() {
    await this.ensureDir(this.directory, { recursive: true });
    await this.importStaging();
    const names = (await this.readDirectory(this.directory)).filter(isDeliveryName);
    const inspected = await Promise.all(names.map(async (name) => {
      const path = join(this.directory, name);
      const info = await this.statFile(path);
      if (!info.isFile() || info.size > this.maxBytes) return null;
      return { id: name, title: deliveryTitle(name), createdAt: info.mtimeMs, size: info.size, mime: TYPES.get(extname(name).toLowerCase()), path };
    }));
    const sorted = inspected.filter(Boolean).sort((left, right) => right.createdAt - left.createdAt);
    await Promise.all(sorted.slice(this.maxItems).map((item) => this.removeFile(item.path)));
    return sorted.slice(0, this.maxItems).map(({ path, ...item }) => ({ ...item, url: `/api/deliveries/files/${encodeURIComponent(item.id)}` }));
  }

  async importStaging() {
    if (!this.stagingDirectory || this.stagingDirectory === this.directory) return;
    await this.ensureDir(this.stagingDirectory, { recursive: true });
    const names = (await this.readDirectory(this.stagingDirectory)).filter(isDeliveryName);
    await Promise.all(names.map(async (name) => {
      const source = join(this.stagingDirectory, name);
      const info = await this.statFile(source);
      if (!info.isFile() || info.size > this.maxBytes) return;
      await this.copyDelivery(source, join(this.directory, name));
      await this.removeFile(source);
    }));
  }

  async clearDirectory(directory) {
    await this.ensureDir(directory, { recursive: true });
    const names = (await this.readDirectory(directory)).filter(isDeliveryName);
    await Promise.all(names.map((name) => this.removeFile(join(directory, name))));
    return names.length;
  }

  async clear() {
    const deleted = await this.clearDirectory(this.directory);
    if (!this.stagingDirectory || this.stagingDirectory === this.directory) return deleted;
    return deleted + await this.clearDirectory(this.stagingDirectory);
  }

  async open(id) {
    if (!isDeliveryName(id)) return null;
    const path = join(this.directory, id);
    try {
      const info = await this.statFile(path);
      if (!info.isFile() || info.size > this.maxBytes) return null;
      return { path, size: info.size, mime: TYPES.get(extname(id).toLowerCase()), stream: () => this.streamFile(path) };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }
}
