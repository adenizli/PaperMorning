import { createHash } from 'crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileStorageService } from '../../../src/service/file-storage/file-storage.service';
import { testConfig } from '../../support/test-config';

describe('FileStorageService (real filesystem)', () => {
  let dataDir: string;
  let storage: FileStorageService;
  const make = () => new FileStorageService(testConfig({ DATA_DIR: dataDir }));

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pm-storage-'));
    storage = make();
  });

  it('writes atomically with private permissions and reads back after a "restart"', async () => {
    const bytes = Buffer.from('%PDF-1.7\nçalışma\n%%EOF');
    const info = await storage.write('issues/user-1/issue-1.pdf', bytes);
    expect(info).toEqual({
      key: 'issues/user-1/issue-1.pdf',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });

    const path = join(dataDir, 'private', 'issues', 'user-1', 'issue-1.pdf');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dataDir, 'private', 'issues')).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(dataDir, 'private', 'issues', 'user-1'))).toEqual(['issue-1.pdf']);

    const restarted = make();
    expect((await restarted.read('issues/user-1/issue-1.pdf')).equals(bytes)).toBe(true);
    expect(await restarted.exists('issues/user-1/issue-1.pdf')).toBe(true);
    expect(await restarted.exists('issues/user-1/missing.pdf')).toBe(false);
    await expect(restarted.read('issues/user-1/missing.pdf')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.each([
    '../escape.pdf',
    'issues/../../escape.pdf',
    '/etc/passwd',
    'issues\\win.pdf',
    '',
    'issues//x.pdf',
    'issues/.hidden',
    'a'.repeat(300),
  ])('rejects unsafe key %p', async (key) => {
    await expect(storage.write(key, Buffer.from('x'))).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
    await expect(storage.read(key)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('refuses to follow symlinks out of the private root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'pm-outside-'));
    writeFileSync(join(outside, 'secret.pdf'), 'secret');
    mkdirSync(join(dataDir, 'private'), { recursive: true });
    symlinkSync(outside, join(dataDir, 'private', 'issues'));
    await expect(storage.read('issues/secret.pdf')).rejects.toMatchObject({ code: 'INVALID_KEY' });
    await expect(storage.write('issues/new.pdf', Buffer.from('x'))).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });

    mkdirSync(join(dataDir, 'private', 'direct'), { recursive: true });
    symlinkSync(join(outside, 'secret.pdf'), join(dataDir, 'private', 'direct', 'link.pdf'));
    await expect(storage.read('direct/link.pdf')).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('never leaves a corrupt or partial file under concurrent writes to one key', async () => {
    const versions = Array.from({ length: 8 }, (_, i) => Buffer.alloc(200_000, i + 1));
    await Promise.all(versions.map((v) => storage.write('issues/u/same.pdf', v)));
    const final = await storage.read('issues/u/same.pdf');
    expect(versions.some((v) => v.equals(final))).toBe(true);
    expect(readdirSync(join(dataDir, 'private', 'issues', 'u'))).toEqual(['same.pdf']);
  });

  it('reports I/O failures (e.g. unwritable volume) without leaving partial files', async () => {
    await storage.write('issues/u/first.pdf', Buffer.from('a'));
    const dir = join(dataDir, 'private', 'issues', 'u');
    chmodSync(dir, 0o500);
    try {
      await expect(storage.write('issues/u/second.pdf', Buffer.from('b'))).rejects.toMatchObject({
        code: 'IO_ERROR',
        message: expect.stringMatching(/permission denied/),
      });
      expect(readdirSync(dir)).toEqual(['first.pdf']);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
