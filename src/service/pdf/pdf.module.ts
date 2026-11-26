import { Module } from '@nestjs/common';
import { PDF_RENDERER, UnavailablePdfRenderer } from './pdf-renderer';

@Module({
  providers: [{ provide: PDF_RENDERER, useClass: UnavailablePdfRenderer }],
  exports: [PDF_RENDERER],
})
export class PdfModule {}
