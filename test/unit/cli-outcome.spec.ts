import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { previewTarget, systemCheck } from '../../src/bootstrap/cli';
import { envelope, EXIT, exitCodeFor, UsageError } from '../../src/bootstrap/cli-outcome';
import { DeliveryStatus } from '../../src/domain/publication/model/email-delivery.model';
import { IssueStatus } from '../../src/domain/publication/model/issue.model';
import {
  PublicationRunModel,
  PublicationRunStatus,
  PublicationStage,
} from '../../src/domain/publication/model/publication-run.model';
import { describePublicationStatus } from '../../src/domain/publication/service/publication-status';
import { testConfig } from '../support/test-config';

describe('CLI outcome contract', () => {
  it('maps outcomes to stable exit codes (a FAILED preparation is never exit 0)', () => {
    expect(exitCodeFor('READY')).toBe(EXIT.OK);
    expect(exitCodeFor('SENT')).toBe(0);
    expect(exitCodeFor('ALREADY_SENT')).toBe(0);
    expect(exitCodeFor('OK')).toBe(0);
    expect(exitCodeFor('FAILED')).toBe(1);
    expect(exitCodeFor('UNKNOWN')).toBe(1);
    expect(exitCodeFor('ERROR')).toBe(1);
    expect(exitCodeFor('USAGE_ERROR')).toBe(2);
    expect(exitCodeFor('SKIPPED')).toBe(3);
    expect(exitCodeFor('NOT_OPTED_IN')).toBe(3);
    expect(exitCodeFor('NOT_READY')).toBe(3);
    expect(exitCodeFor('DISABLED')).toBe(3);
    expect(exitCodeFor('IN_PROGRESS')).toBe(75);
    expect(exitCodeFor('SOMETHING_NEW')).toBe(1); // unknown outcomes fail closed
  });

  it('prints command, outcome and exit code in one JSON document', () => {
    expect(envelope('publication:prepare', { outcome: 'FAILED', reason: 'x' })).toEqual({
      command: 'publication:prepare',
      outcome: 'FAILED',
      reason: 'x',
      exitCode: 1,
    });
  });

  it('writes previews only to new files outside DATA_DIR (or stdout)', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'pm-data-'));
    const config = testConfig({ DATA_DIR: dataDir });
    expect(previewTarget('-', 'id', config)).toBe('-');
    expect(previewTarget(undefined, 'id', config)).toMatch(/papermorning-preview-id-\d+\.pdf$/);
    expect(() => previewTarget(join(dataDir, 'private', 'x.pdf'), 'id', config)).toThrow(
      UsageError,
    );
    expect(() => previewTarget(dataDir, 'id', config)).toThrow(UsageError);
    const existing = join(mkdtempSync(join(tmpdir(), 'pm-out-')), 'exists.pdf');
    writeFileSync(existing, 'x');
    expect(() => previewTarget(existing, 'id', config)).toThrow(/already exists/);
  });

  it('system:check reports effective switches without secrets', () => {
    const config = testConfig({
      ANTHROPIC_API_KEY: 'sk-ant-secret-value',
      SMTP_HOST: 'smtp.example.org',
      SMTP_FROM: 'PaperMorning <pm@example.org>',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'smtp-secret-value',
      SCHEDULER_ENABLED: 'false',
      MAIL_ENABLED: 'false',
    });
    const report = systemCheck(config);
    expect(report.scheduler.enabledInServer).toBe(false);
    expect(report.mail).toMatchObject({ enabled: false, smtpHostConfigured: true });
    expect(report.llm.apiKeyConfigured).toBe(true);
    const json = JSON.stringify(report);
    expect(json).not.toContain('sk-ant-secret-value');
    expect(json).not.toContain('smtp-secret-value');
    expect(json).not.toContain('smtp.example.org');
  });
});

describe('publication:status next-step rules (same as the run claim)', () => {
  const now = new Date('2026-11-27T06:00:00Z');
  const run = (overrides: Partial<PublicationRunModel>): PublicationRunModel => ({
    id: 'run',
    userId: 'u',
    issueDate: '2026-11-27',
    status: PublicationRunStatus.FAILED,
    stage: PublicationStage.WRITING,
    checkpoint: {},
    attemptCount: 1,
    retryable: true,
    errorKind: 'VALIDATION_FAILED',
    errorMessage: 'x',
    nextAttemptAt: null,
    leaseExpiresAt: null,
    lateAt: null,
    issueId: null,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    ...overrides,
  });
  const status = (r: PublicationRunModel | null) =>
    describePublicationStatus({ issue: null, run: r, delivery: null, maxAttempts: 5, now });

  it('not started -> prepare now', () => {
    expect(status(null)).toMatchObject({ state: 'NOT_STARTED', next: { action: 'PREPARE' } });
  });

  it('failed in back-off -> wait until nextAttemptAt, then eligible', () => {
    const later = new Date('2026-11-27T06:20:00Z');
    expect(status(run({ nextAttemptAt: later }))).toMatchObject({
      state: 'FAILED',
      run: { attempts: 1, maxAttempts: 5, nextAttemptAt: later.toISOString() },
      next: { action: 'WAIT', at: later.toISOString() },
    });
    expect(status(run({ nextAttemptAt: new Date('2026-11-27T05:59:00Z') })).next).toMatchObject({
      action: 'PREPARE',
      reason: 'Retry eligible (attempt 2/5)',
    });
  });

  it('non-retryable or exhausted -> manual', () => {
    expect(status(run({ retryable: false })).next.action).toBe('MANUAL');
    expect(status(run({ attemptCount: 5 })).next).toMatchObject({
      action: 'MANUAL',
      reason: 'Attempts exhausted (5/5)',
    });
  });

  it('running -> wait for the lease, or take over after it expired', () => {
    const lease = new Date('2026-11-27T06:10:00Z');
    expect(
      status(run({ status: PublicationRunStatus.RUNNING, leaseExpiresAt: lease })),
    ).toMatchObject({ state: 'IN_PROGRESS', next: { action: 'WAIT', at: lease.toISOString() } });
    expect(
      status(
        run({
          status: PublicationRunStatus.RUNNING,
          leaseExpiresAt: new Date('2026-11-27T05:00:00Z'),
        }),
      ).next.action,
    ).toBe('PREPARE');
  });

  it('READY issue -> nothing to do; shows PDF checksum and delivery', () => {
    const view = describePublicationStatus({
      issue: {
        id: 'i',
        userId: 'u',
        issueDate: '2026-11-26',
        timezone: 'Europe/Istanbul',
        language: 'tr',
        status: IssueStatus.READY,
        content: { issueNumber: 1 } as never,
        contentHash: 'h',
        pdfStorageKey: 'k',
        pdfSha256: 'abc',
        pdfSizeBytes: 10,
        createdAt: now,
        publishedAt: now,
      },
      run: run({ status: PublicationRunStatus.COMPLETED }),
      delivery: {
        status: DeliveryStatus.DISABLED,
        attemptCount: 0,
        nextAttemptAt: null,
      } as never,
      maxAttempts: 5,
      now,
    });
    expect(view).toMatchObject({
      state: 'READY',
      issue: { issueNumber: 1, pdf: { sha256: 'abc', sizeBytes: 10 } },
      delivery: { status: 'DISABLED' },
      next: { action: 'NONE' },
    });
  });
});
