import type { FetchFn } from './academic-source.types';

export class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SourceHttpError';
  }
}

export interface HttpOptions {
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET with timeout and bounded exponential backoff for 429/5xx/network failures. */
export async function getText(
  fetchFn: FetchFn,
  url: string,
  options: HttpOptions,
): Promise<string> {
  let lastError: Error = new SourceHttpError('no attempt made');
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    if (attempt > 0) await sleep(options.backoffMs * 2 ** (attempt - 1));
    try {
      const response = await fetchFn(url, {
        headers: options.headers,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (response.ok) return await response.text();
      lastError = new SourceHttpError(
        `HTTP ${response.status} from ${new URL(url).host}`,
        response.status,
      );
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = new SourceHttpError(
        `Request to ${new URL(url).host} failed: ${(error as Error).message}`,
      );
    }
  }
  throw lastError;
}
