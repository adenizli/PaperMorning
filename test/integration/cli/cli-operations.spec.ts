import { INestApplication } from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { DataSource } from 'typeorm';
import { cliCommands } from '../../../src/bootstrap/cli';
import { envelope, UsageError } from '../../../src/bootstrap/cli-outcome';
import { sha256Hex } from '../../../src/common/text/fingerprint';
import { KnowledgeLevel, TopicPriority } from '../../../src/domain/account';
import { FakeAnthropic } from '../../support/fake-anthropic';
import { FakeMailTransport, InMemoryFileStorage } from '../../support/fake-integrations';
import { extractPdfText } from '../../support/pdf-text';
import {
  cannedArticle,
  createReader,
  routingHandler,
  seedAnalyzedPaper,
  taskOf,
} from '../../support/publication-fixtures';
import { createResearchApp } from '../../support/research-app';
import { TEST_DATABASE_URL } from '../../support/test-env';

jest.setTimeout(120_000);

const DATE = '2026-11-26';
const topics = [
  {
    topicKey: 'robotics',
    priority: TopicPriority.HIGH,
    knowledgeLevel: KnowledgeLevel.INTERMEDIATE,
  },
];

/** Operator CLI against real PostgreSQL and the real PDF renderer; Claude is faked. */
describe('operator CLI (PostgreSQL)', () => {
  let app: INestApplication;
  let fake: FakeAnthropic;
  let storage: InMemoryFileStorage;

  async function boot(handler = routingHandler(), env: Record<string, string> = {}) {
    fake = new FakeAnthropic(handler);
    storage = new InMemoryFileStorage();
    app = await createResearchApp({
      anthropic: fake,
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      storage,
      mail: new FakeMailTransport(),
      env: { RESEARCH_HAIKU_SCREENING: 'false', PUBLICATION_RETRY_BACKOFF_MINUTES: '10', ...env },
    });
  }
  afterEach(() => app?.close());

  const run = (command: string, args: Record<string, string>) =>
    cliCommands[command](app, args).then((result) => envelope(command, result));

  it('READY -> exit 0; preview re-renders the frozen snapshot without touching anything', async () => {
    await boot();
    await seedAnalyzedPaper(app, 'robotics');
    await createReader(app, 'reader_cli', topics);

    const prepared = await run('publication:prepare', { user: 'reader_cli', date: DATE });
    expect(prepared).toMatchObject({ outcome: 'READY', exitCode: 0, issueStatus: 'READY' });
    const issueId = prepared.issueId as string;

    const db = app.get(DataSource);
    const rowOf = async () =>
      JSON.stringify(await db.query('SELECT * FROM issue WHERE id = $1', [issueId]));
    const runOf = async () =>
      JSON.stringify(
        await db.query('SELECT * FROM publication_run WHERE issue_id = $1', [issueId]),
      );
    const before = { row: await rowOf(), run: await runOf(), llm: fake.calls.length };
    const storedBefore = new Map(storage.files);

    const out = join(mkdtempSync(join(tmpdir(), 'pm-preview-')), 'preview.pdf');
    const preview = await run('issue:preview', { issue: issueId, out });
    expect(preview).toMatchObject({
      outcome: 'OK',
      exitCode: 0,
      issueStatus: 'READY',
      template: 'issue-print-v3',
      claudeCalls: 0,
      published: { verifiedUnchanged: true },
    });

    // Immutable: same issue row (status, snapshot, checksum, storage key), same run, same bytes.
    expect(await rowOf()).toBe(before.row);
    expect(await runOf()).toBe(before.run);
    expect(fake.calls.length).toBe(before.llm);
    expect([...storage.files.keys()]).toEqual([...storedBefore.keys()]);
    for (const [key, bytes] of storedBefore)
      expect(storage.files.get(key)!.equals(bytes)).toBe(true);
    const [issue] = await db.query('SELECT pdf_sha256 FROM issue WHERE id = $1', [issueId]);
    expect((preview.published as { sha256: string }).sha256).toBe(issue.pdf_sha256);

    // The preview is a separate, visibly marked document.
    const bytes = readFileSync(out);
    expect(sha256Hex(bytes)).toBe((preview.preview as { sha256: string }).sha256);
    expect(sha256Hex(bytes)).not.toBe(issue.pdf_sha256);
    expect(extractPdfText(bytes).text).toContain('QA ÖNİZLEMESİ');

    // A second preview never overwrites the first file.
    await expect(run('issue:preview', { issue: issueId, out })).rejects.toBeInstanceOf(UsageError);

    const status = await run('publication:status', { user: 'reader_cli', date: DATE });
    expect(status).toMatchObject({
      outcome: 'OK',
      exitCode: 0,
      state: 'READY',
      issue: { id: issueId, status: 'READY' },
      next: { action: 'NONE' },
    });
  });

  it('FAILED -> exit 1 with observable back-off; no paid retry before it is due', async () => {
    await boot(routingHandler({ ARTICLE: () => ({ data: { headline: 'eksik' } }) }));
    await seedAnalyzedPaper(app, 'robotics');
    await createReader(app, 'reader_fail', topics);

    const first = await run('publication:prepare', { user: 'reader_fail', date: DATE });
    expect(first).toMatchObject({
      outcome: 'FAILED',
      exitCode: 1,
      retry: { attempts: 1, maxAttempts: 5, retryable: true, errorKind: 'VALIDATION_FAILED' },
    });
    const nextAttemptAt = (first.retry as { nextAttemptAt: string }).nextAttemptAt;
    expect(new Date(nextAttemptAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);

    const writes = fake.calls.filter((c) => taskOf(c) === 'ARTICLE').length;
    const second = await run('publication:prepare', { user: 'reader_fail', date: DATE });
    expect(second).toMatchObject({ outcome: 'FAILED', exitCode: 1, retry: { attempts: 1 } });
    expect(fake.calls.filter((c) => taskOf(c) === 'ARTICLE').length).toBe(writes);

    const status = await run('publication:status', { user: 'reader_fail', date: DATE });
    expect(status).toMatchObject({
      exitCode: 0,
      state: 'FAILED',
      issue: null,
      run: { attempts: 1, errorKind: 'VALIDATION_FAILED', nextAttemptAt },
      next: { action: 'WAIT', at: nextAttemptAt },
    });
  });

  it('ops:status: today, next runs, latest READY/SENT, budget and failures, read-only', async () => {
    let articles = 0;
    await boot(
      routingHandler({
        // The second article (the 2026-11-26 issue) invents a number: VALIDATION_FAILED.
        ARTICLE: () => {
          const data = cannedArticle();
          if (++articles === 2) {
            (data.sections as { key: string; body: string }[]).find(
              (s) => s.key === 'evidence',
            )!.body = 'Hata %73 azaldı.';
          }
          return { data };
        },
      }),
      { PUBLICATION_MAX_ARTICLES: '1' },
    );
    await seedAnalyzedPaper(app, 'robotics');
    await seedAnalyzedPaper(app, 'robotics');
    await createReader(app, 'reader_ops', topics);
    expect(
      await run('publication:prepare', { user: 'reader_ops', date: '2026-11-25' }),
    ).toMatchObject({ outcome: 'READY' });
    expect(await run('publication:prepare', { user: 'reader_ops', date: DATE })).toMatchObject({
      outcome: 'FAILED',
      exitCode: 1,
    });

    const db = app.get(DataSource);
    const snapshot = async () =>
      JSON.stringify(
        await db.query(
          `SELECT (SELECT count(*) FROM issue) AS issues, (SELECT count(*) FROM publication_run) AS runs,
                  (SELECT max(updated_at) FROM publication_run) AS run_changed,
                  (SELECT count(*) FROM article_variant) AS variants,
                  (SELECT count(*) FROM email_delivery) AS deliveries,
                  (SELECT count(*) FROM llm_usage) AS llm`,
        ),
      );
    const before = { db: await snapshot(), calls: fake.calls.length };

    // 07:00 in Istanbul on the failed day.
    const status = await run('ops:status', { user: 'reader_ops', at: '2026-11-26T04:00:00Z' });
    expect(status).toMatchObject({
      outcome: 'OK',
      exitCode: 0,
      scheduler: { enabledInServer: false, prepareLocalTime: '06:00', deliveryLocalTime: '08:00' },
      mail: { enabled: expect.any(Boolean) },
      llm: { utcDay: '2026-11-26', budgetUsd: expect.any(Number) },
    });
    const [reader] = status.readers as Record<string, unknown>[];
    expect(reader).toMatchObject({
      user: 'reader_ops',
      timezone: 'Europe/Istanbul',
      issueDate: DATE,
      localTime: '07:00',
      preparationWindow: { from: '2026-11-26T03:00:00.000Z', until: '2026-11-26T07:00:00.000Z' },
      nextPreparationAt: '2026-11-27T03:00:00.000Z',
      nextDeliveryAt: '2026-11-26T05:00:00.000Z',
      today: {
        state: 'FAILED',
        run: { attempts: 1, errorKind: 'VALIDATION_FAILED', stage: 'WRITING' },
        next: { action: expect.stringMatching(/^(WAIT|PREPARE)$/) },
      },
      latestReady: { issueDate: '2026-11-25' },
      latestSent: null,
    });
    const failures = status.failures as {
      articleVariants: Record<string, unknown>[];
      analyses: unknown[];
    };
    expect(failures.analyses).toEqual([]);
    expect(failures.articleVariants).toEqual([
      expect.objectContaining({
        promptVersion: 'article-v3',
        attempts: 1,
        maxAttempts: 3,
        retryable: true,
        retryEligible: true,
        errorKind: 'VALIDATION_FAILED',
        error: expect.stringContaining('numbers not present'),
      }),
    ]);

    // Today's real UTC day: the calls made above are counted against the budget.
    const now = await run('ops:status', { limit: '5' });
    const llm = now.llm as Record<string, number>;
    expect(llm.calls).toBeGreaterThan(0);
    expect(llm.remainingUsd).toBeCloseTo(llm.budgetUsd - llm.spentUsd - llm.inFlightUsd, 6);
    await expect(run('ops:status', { limit: '0' })).rejects.toBeInstanceOf(UsageError);

    expect({ db: await snapshot(), calls: fake.calls.length }).toEqual(before);
  });

  it('SKIPPED -> exit 3; unknown reader -> usage error', async () => {
    await boot();
    await createReader(app, 'reader_none', []);
    expect(await run('publication:prepare', { user: 'reader_none', date: DATE })).toMatchObject({
      outcome: 'SKIPPED',
      exitCode: 3,
    });
    await expect(run('publication:status', { user: 'nobody', date: DATE })).rejects.toBeInstanceOf(
      UsageError,
    );
    await expect(run('publication:status', { user: 'reader_none' })).rejects.toThrow(/--date/);
  });
});

/** The real process: JSON only on stdout, logs on stderr, exit codes as documented. */
describe('operator CLI process contract', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    SCHEDULER_ENABLED: 'false',
  };
  const cli = (args: string[]) =>
    new Promise<{ code: number; stdout: Buffer; stderr: string }>((done) => {
      execFile(
        process.execPath,
        ['-r', 'ts-node/register/transpile-only', 'src/bootstrap/cli.ts', ...args],
        { cwd: root, env, encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 },
        (error, stdout, stderr) =>
          done({
            code: error ? Number((error as { code?: number }).code ?? 1) : 0,
            stdout,
            stderr: stderr.toString('utf8'),
          }),
      );
    });

  it('unknown command -> exit 2 with a JSON result', async () => {
    const { code, stdout } = await cli(['no:such-command']);
    expect(code).toBe(2);
    expect(JSON.parse(stdout.toString('utf8'))).toMatchObject({
      outcome: 'USAGE_ERROR',
      exitCode: 2,
    });
  });

  it('Nest logs never pollute stdout', async () => {
    const { code, stdout, stderr } = await cli([
      'publication:status',
      '--user',
      'nobody',
      '--date',
      DATE,
    ]);
    expect(code).toBe(2);
    expect(JSON.parse(stdout.toString('utf8'))).toMatchObject({
      command: 'publication:status',
      outcome: 'USAGE_ERROR',
      error: 'No user nobody',
    });
    expect(stderr).toContain('Starting Nest application');
  });

  it('pdf:smoke renders with real Chromium and no database; PDF on stdout, JSON on stderr', async () => {
    const { code, stdout, stderr } = await cli(['pdf:smoke', '--out', '-']);
    expect(code).toBe(0);
    expect(stdout.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const result = JSON.parse(stderr.slice(stderr.indexOf('{'))) as Record<string, unknown>;
    expect(result).toMatchObject({ command: 'pdf:smoke', outcome: 'OK', exitCode: 0 });
    expect(result.pages).toBeGreaterThanOrEqual(1);
    expect(extractPdfText(stdout).text).toContain('çğıöşü ÇĞİÖŞÜ');
  });

  it('pdf:smoke refuses PDF_CHROMIUM_SANDBOX=true in the container runtime before launching', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pm-smoke-')), 'never.pdf');
    const { code, stdout } = await new Promise<{ code: number; stdout: string }>((done) =>
      execFile(
        process.execPath,
        [
          '-r',
          'ts-node/register/transpile-only',
          'src/bootstrap/cli.ts',
          'pdf:smoke',
          '--out',
          out,
        ],
        {
          cwd: root,
          env: { ...env, PAPERMORNING_RUNTIME: 'container', PDF_CHROMIUM_SANDBOX: 'true' },
        },
        (error, stdout) =>
          done({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout }),
      ),
    );
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      outcome: 'ERROR',
      error: expect.stringContaining('PDF_CHROMIUM_SANDBOX=true cannot work inside') as unknown,
    });
    expect(existsSync(out)).toBe(false);
  });
});
