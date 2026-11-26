import { Module } from '@nestjs/common';
import { FILE_STORAGE, UnavailableFileStorage } from './file-storage';

@Module({
  providers: [{ provide: FILE_STORAGE, useClass: UnavailableFileStorage }],
  exports: [FILE_STORAGE],
})
export class FileStorageModule {}
