import { Module } from '@nestjs/common';
import { PDF_RENDERER } from './pdf-renderer';
import { PdfService } from './pdf.service';

@Module({
  providers: [PdfService, { provide: PDF_RENDERER, useExisting: PdfService }],
  exports: [PDF_RENDERER],
})
export class PdfModule {}
