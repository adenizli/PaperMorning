/**
 * Stable operator contract of the CLI: one JSON document on stdout (logs go to stderr) and an
 * exit code derived from the outcome, so scripts never mistake a failure for success.
 *
 *   0   done: READY, SENT, ALREADY_SENT, OK
 *   1   failed: FAILED, UNKNOWN (ambiguous delivery, operator must resolve), ERROR
 *   2   usage error (bad or missing arguments)
 *   3   nothing done by design: SKIPPED, NOT_OPTED_IN, NOT_READY, DISABLED
 *   75  temporary: IN_PROGRESS (retry later; EX_TEMPFAIL)
 *
 * Read-only commands (status, plans, usage) exit 0 whenever they could answer; the state they
 * report is in `outcome`/`state`.
 */
export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, NOTHING_DONE: 3, TEMPORARY: 75 } as const;

const BY_OUTCOME: Record<string, number> = {
  OK: EXIT.OK,
  READY: EXIT.OK,
  SENT: EXIT.OK,
  ALREADY_SENT: EXIT.OK,
  FAILED: EXIT.FAILED,
  UNKNOWN: EXIT.FAILED,
  ERROR: EXIT.FAILED,
  USAGE_ERROR: EXIT.USAGE,
  SKIPPED: EXIT.NOTHING_DONE,
  NOT_OPTED_IN: EXIT.NOTHING_DONE,
  NOT_READY: EXIT.NOTHING_DONE,
  DISABLED: EXIT.NOTHING_DONE,
  IN_PROGRESS: EXIT.TEMPORARY,
};

export function exitCodeFor(outcome: string): number {
  return BY_OUTCOME[outcome] ?? EXIT.FAILED;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface CliResult {
  outcome: string;
  [key: string]: unknown;
}

/** The JSON document printed on stdout. */
export function envelope(command: string, result: CliResult): Record<string, unknown> {
  return { command, ...result, exitCode: exitCodeFor(result.outcome) };
}
