import { ClaimLostError } from './claim-lost.error';

/**
 * Keeps a database lease alive while a long step runs (e.g. a research refresh), by calling
 * `renew` every `intervalMs`. Once a renewal reports the claim lost, the heartbeat stops and
 * `assertHeld()` throws, so the worker stops before its next paid step. A failed renewal due to a
 * transient database error is retried on the next beat; lease expiry remains the backstop.
 */
export class LeaseHeartbeat {
  private lost = false;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly what: string,
    private readonly renew: () => Promise<boolean>,
    intervalMs: number,
  ) {
    this.timer = setInterval(() => void this.beat(), intervalMs);
    this.timer.unref();
  }

  /** Renews now; throws ClaimLostError if another worker has taken the claim over. */
  async assertHeld(): Promise<void> {
    if (!this.lost && !(await this.renew())) this.lost = true;
    if (this.lost) throw new ClaimLostError(this.what);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private async beat(): Promise<void> {
    if (this.lost) return;
    try {
      if (!(await this.renew())) this.lost = true;
    } catch {
      // Transient: try again on the next beat.
    }
  }
}
