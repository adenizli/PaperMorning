/**
 * Thrown when a worker tries to change a leased record after its claim was taken over by a newer
 * worker (its fencing token no longer matches). The stale worker must stop without writing.
 */
export class ClaimLostError extends Error {
  constructor(what: string) {
    super(`${what}: claim was taken over by another worker; stale write rejected`);
    this.name = 'ClaimLostError';
  }
}
