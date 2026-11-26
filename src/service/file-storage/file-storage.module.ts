import { Module } from '@nestjs/common';
import { FILE_STORAGE } from './file-storage';
import { FileStorageService } from './file-storage.service';

@Module({
  providers: [FileStorageService, { provide: FILE_STORAGE, useExisting: FileStorageService }],
  exports: [FILE_STORAGE],
})
export class FileStorageModule {}
