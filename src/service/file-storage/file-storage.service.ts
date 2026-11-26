import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { constants } from 'fs';
import { lstat, mkdir, open, rename, unlink } from 'fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { AppConfig } from '../../config/app.config';
import { FileStorage, FileStorageError, StoredFileInfo } from './file-storage';

const KEY_PATTERN = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/;

/**
 * Private filesystem storage under <DATA_DIR>/private. Keys are validated and resolved strictly
 * inside the root; symlinks are refused; writes go to a temporary file in the same directory,
 * are fsynced and atomically renamed, so readers never see partial files.
 */
@Injectable()
export class FileStorageService implements FileStorage {
  private readonly root: string;

  constructor(config: AppConfig) {
    this.root = resolve(config.storage.dataDir, 'private');
  }

  async write(key: string, bytes: Buffer): Promise<StoredFileInfo> {
    const target = this.resolveKey(key);
    const directory = dirname(target);
    await this.io(() => mkdir(directory, { recursive: true, mode: 0o700 }));
    await this.assertNoSymlinks(directory);

    const temp = join(directory, `.${randomBytes(8).toString('hex')}.tmp`);
    try {
      const handle = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, target);
      const dirHandle = await open(directory, constants.O_RDONLY);
      await dirHandle.sync().finally(() => dirHandle.close());
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw this.ioError(error);
    }
    return {
      key,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  async read(key: string): Promise<Buffer> {
    const target = this.resolveKey(key);
    await this.assertNoSymlinks(dirname(target));
    try {
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await handle.stat()).isFile())
          throw new FileStorageError(`Not a regular file: ${key}`, 'INVALID_KEY');
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof FileStorageError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new FileStorageError(`File not found: ${key}`, 'NOT_FOUND');
      if (code === 'ELOOP')
        throw new FileStorageError(`Symlinks are not allowed: ${key}`, 'INVALID_KEY');
      throw this.ioError(error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await lstat(this.resolveKey(key))).isFile();
    } catch (error) {
      if (error instanceof FileStorageError) throw error;
      return false;
    }
  }

  private resolveKey(key: string): string {
    if (
      typeof key !== 'string' ||
      key.length > 255 ||
      !KEY_PATTERN.test(key) ||
      key.split('/').includes('..')
    ) {
      throw new FileStorageError(`Invalid storage key: ${JSON.stringify(key)}`, 'INVALID_KEY');
    }
    const target = resolve(this.root, key);
    const rel = relative(this.root, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new FileStorageError(`Storage key escapes the private root: ${key}`, 'INVALID_KEY');
    }
    return target;
  }

  /** Refuses any symlink between the private root and the target directory. */
  private async assertNoSymlinks(directory: string): Promise<void> {
    let current = this.root;
    const parts = relative(this.root, directory).split(sep).filter(Boolean);
    for (const part of ['', ...parts]) {
      current = part ? join(current, part) : current;
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new FileStorageError(`Symlinks are not allowed in storage paths`, 'INVALID_KEY');
        }
      } catch (error) {
        if (error instanceof FileStorageError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw this.ioError(error);
      }
    }
  }

  private async io<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.ioError(error);
    }
  }

  private ioError(error: unknown): FileStorageError {
    if (error instanceof FileStorageError) return error;
    const code = (error as NodeJS.ErrnoException).code;
    const reason =
      code === 'ENOSPC'
        ? 'disk full'
        : code === 'EACCES'
          ? 'permission denied'
          : (error as Error).message;
    return new FileStorageError(`Private file storage failed: ${reason}`, 'IO_ERROR');
  }
}
