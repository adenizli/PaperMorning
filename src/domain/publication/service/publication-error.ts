import { LlmError } from '../../../service/llm/llm.types';

/** A classified, possibly retryable failure of a publication step. */
export class PublicationError extends Error {
  constructor(
    readonly kind: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PublicationError';
  }

  static from(error: unknown): PublicationError {
    if (error instanceof PublicationError) return error;
    if (error instanceof LlmError)
      return new PublicationError(error.kind, error.message, error.retryable);
    return new PublicationError('UNEXPECTED', (error as Error)?.message ?? String(error), true);
  }
}
