export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface StoredFileInfo {
  key: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Private persistent file storage addressed by opaque keys (never public URLs or raw paths).
 * Writes must be atomic: readers never observe a partially written file.
 */
export interface FileStorage {
  write(key: string, bytes: Buffer): Promise<StoredFileInfo>;
  read(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export class FileStorageError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_CONFIGURED' | 'NOT_FOUND' | 'INVALID_KEY' | 'IO_ERROR' = 'IO_ERROR',
  ) {
    super(message);
    this.name = 'FileStorageError';
  }
}

/** Default until real storage is wired: fails explicitly. */
export class UnavailableFileStorage implements FileStorage {
  write(): Promise<StoredFileInfo> {
    return Promise.reject(new FileStorageError('No file storage is configured', 'NOT_CONFIGURED'));
  }
  read(): Promise<Buffer> {
    return Promise.reject(new FileStorageError('No file storage is configured', 'NOT_CONFIGURED'));
  }
  exists(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
