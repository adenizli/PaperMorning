import type { IssueContentModel } from '../../domain/publication/model/issue-content.model';
import type { RenderIssueOptions } from './issue-html.template';

export const PDF_RENDERER = Symbol('PDF_RENDERER');

/**
 * Renders the frozen, validated issue snapshot (the same object the web API serves) into real
 * PDF bytes. Deterministic: no LLM, no research, no network.
 */
export interface PdfRenderer {
  render(content: IssueContentModel, options?: RenderIssueOptions): Promise<Buffer>;
}

export class PdfRenderError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'PdfRenderError';
  }
}
