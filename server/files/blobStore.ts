import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

/** Where uploaded files (slides, homework attachments, curricula) are kept. */
export interface BlobStore {
  save(key: string, data: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<Readable>;
  readBuffer(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private full(key: string) {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid file key');
    return resolved;
  }

  async save(key: string, data: Buffer): Promise<void> {
    const file = this.full(key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, data);
  }

  async read(key: string): Promise<Readable> {
    return fs.createReadStream(this.full(key));
  }

  async readBuffer(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.full(key));
  }

  async remove(key: string): Promise<void> {
    await fs.promises.rm(this.full(key), { force: true });
  }
}

export class GcsBlobStore implements BlobStore {
  constructor(
    private readonly app: App,
    private readonly bucketName?: string,
  ) {}

  private file(key: string) {
    return getStorage(this.app).bucket(this.bucketName).file(key);
  }

  async save(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.file(key).save(data, { contentType, resumable: false });
  }

  async read(key: string): Promise<Readable> {
    return this.file(key).createReadStream();
  }

  async readBuffer(key: string): Promise<Buffer> {
    const [buf] = await this.file(key).download();
    return buf;
  }

  async remove(key: string): Promise<void> {
    await this.file(key).delete({ ignoreNotFound: true });
  }
}
