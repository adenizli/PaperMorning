import { Injectable, Logger } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';
import { AppConfig } from '../../config/app.config';
import type { IssueContentModel } from '../../domain/publication/model/issue-content.model';
import { renderIssueHtml } from './issue-html.template';
import { PdfRenderer, PdfRenderError } from './pdf-renderer';

const FOOTER = `<div style="width:100%;font-size:8px;color:#666;text-align:center;font-family:Helvetica,Arial,sans-serif">
PaperMorning · <span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

/**
 * Server-side HTML -> PDF with headless Chromium (Playwright). One short-lived browser per render:
 * JavaScript disabled, every network/file request aborted, bounded time and concurrency, and the
 * browser is always closed. No LLM, no research, no external resources.
 */
@Injectable()
export class PdfService implements PdfRenderer {
  private readonly logger = new Logger(PdfService.name);
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly config: AppConfig) {}

  async render(content: IssueContentModel): Promise<Buffer> {
    const size = Buffer.byteLength(JSON.stringify(content));
    if (size > this.config.pdf.maxSnapshotBytes) {
      throw new PdfRenderError(
        `Issue snapshot is ${size} bytes; limit is ${this.config.pdf.maxSnapshotBytes}`,
        false,
      );
    }
    return this.renderHtml(renderIssueHtml(content));
  }

  /** Exposed for tests of the isolation guarantees; production callers use render(). */
  async renderHtml(html: string): Promise<Buffer> {
    await this.acquire();
    const { timeoutMs } = this.config.pdf;
    let browser: Browser | undefined;
    let timer: NodeJS.Timeout | undefined;

    const work = (async () => {
      browser = await chromium.launch({
        headless: true,
        chromiumSandbox: this.config.pdf.chromiumSandbox,
        executablePath: this.config.pdf.executablePath,
        timeout: timeoutMs,
      });
      const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
      await context.route('**/*', (route) => route.abort('blockedbyclient'));
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
      await page.emulateMedia({ media: 'print' });
      return page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: FOOTER,
        tagged: true,
        outline: true,
      });
    })();

    // Cleanup follows the work itself, not the caller: a browser that finishes launching after a
    // timeout is still closed, and the concurrency slot is held until Chromium is really gone.
    const closeBrowser = () =>
      browser?.close().catch((e: Error) => this.logger.warn(`browser close: ${e.message}`));
    void work
      .then(
        () => undefined,
        () => undefined,
      )
      .then(closeBrowser)
      .finally(() => this.release());

    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PdfRenderError(`PDF rendering exceeded ${timeoutMs} ms`)),
          timeoutMs,
        );
      });
      const pdf = await Promise.race([work, timeout]);
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new PdfRenderError('Chromium did not return a PDF document');
      }
      return pdf;
    } catch (error) {
      if (error instanceof PdfRenderError) {
        await closeBrowser(); // timed out: stop Chromium now if it is already running
        throw error;
      }
      throw new PdfRenderError(`Chromium PDF rendering failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.config.pdf.maxConcurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => (this.active++, resolve())));
  }

  private release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}
