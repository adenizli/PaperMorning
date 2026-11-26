import { Injectable, Logger } from '@nestjs/common';
import { ContentCoverage } from '../../../common/enum/research.enum';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import { AppConfig } from '../../../config/app.config';
import { fingerprint } from '../../../common/text/fingerprint';
import { findUnsupportedNumbers } from '../../../common/text/numeric-claims';
import { LlmService } from '../../../service/llm/llm.service';
import { LlmTask } from '../../../service/llm/llm.types';
import type { KnowledgeLevel } from '../../account';
import type { ResearchPaperView } from '../../research';
import type {
  AcademicOpportunity,
  IndustryOpportunity,
  OutlookClaim,
  OutlookMaturity,
  OutlookReportModel,
} from '../model/outlook-report.model';
import { GenerationStatus } from '../model/article-variant.model';
import { IssueRepositoryService } from '../repository/issue-repository.service';
import {
  OutlookGenerationRecord,
  OutlookGenerationRepositoryService,
  MAX_OUTLOOK_ATTEMPTS,
} from '../repository/outlook-generation-repository.service';
import { PublicationError } from './publication-error';

export const OUTLOOK_PROMPT_VERSION = 'outlook-v1';
export const OUTLOOK_SCHEMA_VERSION = 1;
export const OUTLOOK_TITLE = 'Ufuk Raporu — Araştırma ve Uygulama Fırsatları';
const MATURITIES: OutlookMaturity[] = ['RESEARCH', 'EARLY_PROTOTYPE', 'FIELD_TESTED'];
export const SINGLE_PAPER_NOTE =
  'Bu sayıda yalnızca tek bir çalışma bulunduğundan makaleler arası sentez kurulamadı; aşağıdaki değerlendirme tek kaynağa dayanır.';

export interface OutlookPaper {
  paperKey: string;
  view: ResearchPaperView;
}

const CLAIM = {
  type: 'object',
  properties: {
    statement: { type: 'string' },
    paperKeys: { type: 'array', items: { type: 'string' } },
  },
  required: ['statement', 'paperKeys'],
  additionalProperties: false,
};
const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const STRINGS = { type: 'array', items: { type: 'string' } };

const OUTLOOK_SCHEMA = {
  type: 'object',
  properties: {
    synthesis: CLAIM,
    evidence: { type: 'array', items: CLAIM },
    inferences: { type: 'array', items: CLAIM },
    academicOpportunities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          hypothesis: { type: 'string' },
          firstExperiment: { type: 'string' },
          metrics: STRINGS,
          risks: { type: 'string' },
          paperKeys: STRINGS,
        },
        required: ['question', 'hypothesis', 'firstExperiment', 'metrics', 'risks', 'paperKeys'],
        additionalProperties: false,
      },
    },
    industryOpportunities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          idea: { type: 'string' },
          need: { type: 'string' },
          pilot: { type: 'string' },
          metrics: STRINGS,
          barriers: STRINGS,
          maturity: { type: 'string', enum: MATURITIES },
          paperKeys: STRINGS,
        },
        required: ['idea', 'need', 'pilot', 'metrics', 'barriers', 'maturity', 'paperKeys'],
        additionalProperties: false,
      },
    },
    development: {
      type: 'object',
      properties: { direction: { type: 'string' }, uncertainties: STRINGS, falsifiers: STRINGS },
      required: ['direction', 'uncertainties', 'falsifiers'],
      additionalProperties: false,
    },
    nextStep: {
      type: 'object',
      properties: { action: { type: 'string' }, measure: { type: 'string' } },
      required: ['action', 'measure'],
      additionalProperties: false,
    },
    insufficientEvidence: {
      type: 'object',
      properties: {
        academic: NULLABLE_STRING,
        industry: NULLABLE_STRING,
        synthesis: NULLABLE_STRING,
      },
      required: ['academic', 'industry', 'synthesis'],
      additionalProperties: false,
    },
    teaser: { type: 'string' },
  },
  required: [
    'synthesis',
    'evidence',
    'inferences',
    'academicOpportunities',
    'industryOpportunities',
    'development',
    'nextStep',
    'insufficientEvidence',
    'teaser',
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Sen PaperMorning dergisinin kapanış bölümü "Ufuk Raporu"nu Türkçe yazıyorsun. Bu bölüm haberleri yeniden özetlemez; çalışmaları BİRLİKTE yorumlar.
Kesin kurallar:
- Yalnızca verilen yapılandırılmış analizleri kullan. Her iddia ve öneri paperKeys alanında verilen anahtarlardan (P1, P2, ...) en az birine dayanmalı. Başka kaynak uydurma.
- "evidence" yalnızca kaynakların gerçekten gösterdiği bulgulardır. "inferences" PaperMorning'in makaleler arası çıkarımıdır ve kanıtlanmış sonuç gibi yazılmaz.
- Akademik fırsat: açık kalan soru, test edilebilir hipotez, düşük maliyetli ilk deney ve ölçülecek metrikler. "Yayınlanabilir/özgün" iddiasında bulunma.
- Sektörel fırsat: hangi ihtiyacı karşıladığı, küçük bir pilot, ölçülecek metrikler, engeller (maliyet, ölçek, regülasyon, veri, güvenlik) ve olgunluk (RESEARCH / EARLY_PROTOTYPE / FIELD_TESTED). "Kesin büyüyecek", "kesin kazandırır" gibi ifadeler yasak.
- Kanıt yetersizse fırsat uydurma: ilgili dizi boş kalsın ve insufficientEvidence alanında nedenini açıkla. Aksi halde bu alanlar null olsun.
- development: kanıtın gösterdiği yön, belirsizlikler ve bu yorumu çürütebilecek koşullar.
- nextStep: okurun bu hafta yapabileceği somut ve ölçülebilir ilk adım.
- Analizlerde geçmeyen hiçbir sayıyı yazma. Çalışmalar yalnızca özete dayanıyorsa bunu belirsizlikler arasında an.
- teaser: e-posta için bölümün en güçlü önerisini anlatan 1–2 cümle.`;

/**
 * Builds the closing Ufuk Raporu from already-analyzed research (no re-reading of papers).
 * Reuses an identical report (same analyses, language, level, model/prompt) from any issue.
 */
/**
 * Writes or reuses the closing Ufuk Raporu. Coordination is keyed by the outlook fingerprint in
 * `outlook_generation`: at most one worker pays for a fingerprint at a time, everyone else reuses
 * the stored result, and a finished report is persisted before the issue that needs it is frozen,
 * so a later publication failure cannot lose it.
 */
@Injectable()
export class OutlookService {
  private readonly logger = new Logger(OutlookService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly llm: LlmService,
    private readonly issues: IssueRepositoryService,
    private readonly generations: OutlookGenerationRepositoryService,
  ) {}

  fingerprintFor(papers: OutlookPaper[], language: string, level: KnowledgeLevel): string {
    return fingerprint({
      papers: papers.map((p) => `${p.paperKey}:${p.view.analysisFingerprint}`),
      language,
      knowledgeLevel: level,
      model: this.llm.modelFor(LlmTask.OUTLOOK),
      promptVersion: OUTLOOK_PROMPT_VERSION,
      schemaVersion: OUTLOOK_SCHEMA_VERSION,
    });
  }

  /** The claim outlives the longest bounded Claude call, so a healthy writer keeps it. */
  leaseSeconds(): number {
    const callBoundSeconds = Math.ceil(this.llm.maxCallDurationMs() / 1000);
    return Math.max(this.config.publication.leaseSeconds, callBoundSeconds + 60);
  }

  async getOrCreate(
    papers: OutlookPaper[],
    language: string,
    level: KnowledgeLevel,
    options: { waitMs?: number; pollMs?: number } = {},
  ): Promise<OutlookReportModel> {
    if (papers.length === 0)
      throw new PublicationError('NO_CONTENT', 'Outlook needs at least one paper', false);
    const fp = this.fingerprintFor(papers, language, level);

    const stored = await this.generations.findByFingerprint(fp);
    if (stored?.status === GenerationStatus.COMPLETED) return reportOf(stored, fp);
    // Reports frozen into issues before outlook_generation existed.
    const legacy = await this.issues.findOutlookByFingerprint(fp);
    if (legacy) return legacy;
    if (!this.llm.isAvailable()) {
      throw new PublicationError(
        'NOT_CONFIGURED',
        'ANTHROPIC_API_KEY is not configured; Ufuk Raporu not written',
        true,
      );
    }

    const claim = await this.generations.claim({
      fingerprint: fp,
      model: this.llm.modelFor(LlmTask.OUTLOOK),
      promptVersion: OUTLOOK_PROMPT_VERSION,
      leaseSeconds: this.leaseSeconds(),
    });
    if (claim.outcome !== 'CLAIMED') return this.waitForOther(claim.record, fp, options);

    let report: OutlookReportModel;
    try {
      const result = await this.llm.generateJson({
        task: LlmTask.OUTLOOK,
        system: SYSTEM_PROMPT,
        schema: OUTLOOK_SCHEMA,
        maxTokens: 10_000,
        prompt: buildPrompt(papers, level),
      });
      report = validateOutlook(result.data, papers, { fingerprint: fp, model: result.model });
    } catch (error) {
      const failure = PublicationError.from(error);
      const recorded = await this.generations.fail(claim.record.id, claim.claimToken, failure);
      if (!recorded) return this.afterLostClaim(claim.record, fp, options);
      throw failure;
    }
    try {
      // Persisted (shared, reusable) before any later publication step can fail.
      return reportOf(
        await this.generations.complete(claim.record.id, claim.claimToken, report),
        fp,
      );
    } catch (error) {
      if (error instanceof ClaimLostError) return this.afterLostClaim(claim.record, fp, options);
      throw error;
    }
  }

  /** A newer worker owns the generation: reuse its result instead of our discarded one. */
  private async afterLostClaim(
    record: OutlookGenerationRecord,
    fp: string,
    options: { waitMs?: number; pollMs?: number },
  ): Promise<OutlookReportModel> {
    this.logger.warn(`Ufuk Raporu ${fp.slice(0, 12)}: claim taken over; using the newer result`);
    return this.waitForOther((await this.generations.findById(record.id)) ?? record, fp, options);
  }

  private async waitForOther(
    busy: OutlookGenerationRecord,
    fp: string,
    { waitMs = 120_000, pollMs = 1_000 }: { waitMs?: number; pollMs?: number },
  ): Promise<OutlookReportModel> {
    const deadline = Date.now() + waitMs;
    let current = busy;
    for (let first = true; first || Date.now() < deadline; first = false) {
      if (!first) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        current = (await this.generations.findById(busy.id)) ?? current;
      }
      if (current.status === GenerationStatus.COMPLETED) return reportOf(current, fp);
      if (current.status === GenerationStatus.FAILED) {
        throw new PublicationError(
          current.errorKind ?? 'OUTLOOK_FAILED',
          current.errorMessage ?? 'Ufuk Raporu generation failed',
          current.retryable && current.attemptCount < MAX_OUTLOOK_ATTEMPTS,
        );
      }
    }
    throw new PublicationError(
      'IN_PROGRESS',
      'Ufuk Raporu for this research package is being written by another worker',
      true,
    );
  }
}

/** Never hand out a report stored under a different fingerprint. */
function reportOf(record: OutlookGenerationRecord, fp: string): OutlookReportModel {
  if (!record.report || record.report.fingerprint !== fp || record.fingerprint !== fp) {
    throw new PublicationError('OUTLOOK_MISMATCH', 'Stored Ufuk Raporu does not match', false);
  }
  return record.report;
}

function buildPrompt(papers: OutlookPaper[], level: KnowledgeLevel): string {
  const items = papers.map(({ paperKey, view }) => ({
    paperKey,
    title: view.title,
    topic: view.topicKey,
    publicationStatus: view.publicationStatus,
    coverage: view.coverage === ContentCoverage.ABSTRACT_ONLY ? 'ABSTRACT_ONLY' : 'FULL_TEXT',
    summary: view.analysis.summary,
    contribution: view.analysis.contribution,
    findings: view.analysis.findings,
    limitations: view.analysis.limitations,
    openQuestions: view.analysis.openQuestions,
  }));
  return `Okurun bilgi düzeyi: ${level} (açıklama derinliğini buna göre ayarla; bilimsel gerçeklik değişmez).\nBu sayının çalışmaları:\n${JSON.stringify(items, null, 2)}`;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  typeof value === 'object' && value !== null ? (value as Obj) : {};
const items = (value: unknown): Obj[] => (Array.isArray(value) ? value.slice(0, 6).map(obj) : []);

/** Validates untrusted model output; every citation must point at a paper of this issue. */
export function validateOutlook(
  data: unknown,
  papers: OutlookPaper[],
  meta: { fingerprint: string; model: string },
): OutlookReportModel {
  const fail = (message: string): never => {
    throw new PublicationError('VALIDATION_FAILED', `Outlook output invalid: ${message}`, true);
  };
  if (typeof data !== 'object' || data === null) fail('not an object');
  const d = obj(data);
  const validKeys = new Set(papers.map((p) => p.paperKey));
  const text = (value: unknown, field: string, max = 1500): string =>
    typeof value === 'string' && value.trim()
      ? value.trim().slice(0, max)
      : fail(`${field} is empty`);
  const optional = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 800) : null;
  const strings = (value: unknown, field: string, min = 0): string[] => {
    const list = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      : [];
    if (list.length < min) fail(`${field} needs at least ${min} item(s)`);
    return list.slice(0, 8).map((v) => v.trim().slice(0, 500));
  };
  const keys = (value: unknown, field: string): string[] => {
    const list = strings(value, `${field}.paperKeys`, 1);
    const unknown = list.filter((k) => !validKeys.has(k));
    if (unknown.length > 0) fail(`${field} cites unknown papers ${unknown.join(', ')}`);
    return [...new Set(list)];
  };
  const claim = (value: Obj, field: string): OutlookClaim => ({
    statement: text(value.statement, `${field}.statement`),
    paperKeys: keys(value.paperKeys, field),
  });

  const academicOpportunities: AcademicOpportunity[] = items(d.academicOpportunities).map(
    (o, i) => ({
      question: text(o.question, `academic[${i}].question`),
      hypothesis: text(o.hypothesis, `academic[${i}].hypothesis`),
      firstExperiment: text(o.firstExperiment, `academic[${i}].firstExperiment`),
      metrics: strings(o.metrics, `academic[${i}].metrics`, 1),
      risks: text(o.risks, `academic[${i}].risks`),
      paperKeys: keys(o.paperKeys, `academic[${i}]`),
    }),
  );
  const industryOpportunities: IndustryOpportunity[] = items(d.industryOpportunities).map(
    (o, i) => ({
      idea: text(o.idea, `industry[${i}].idea`),
      need: text(o.need, `industry[${i}].need`),
      pilot: text(o.pilot, `industry[${i}].pilot`),
      metrics: strings(o.metrics, `industry[${i}].metrics`, 1),
      barriers: strings(o.barriers, `industry[${i}].barriers`, 1),
      maturity: MATURITIES.includes(o.maturity as OutlookMaturity)
        ? (o.maturity as OutlookMaturity)
        : fail(`industry[${i}].maturity invalid`),
      paperKeys: keys(o.paperKeys, `industry[${i}]`),
    }),
  );
  const gaps = obj(d.insufficientEvidence);
  const insufficientEvidence = {
    academic: optional(gaps.academic),
    industry: optional(gaps.industry),
    synthesis: optional(gaps.synthesis),
  };
  if (academicOpportunities.length === 0 && !insufficientEvidence.academic) {
    fail('no academic opportunity and no stated reason for insufficient evidence');
  }
  if (industryOpportunities.length === 0 && !insufficientEvidence.industry) {
    fail('no industry opportunity and no stated reason for insufficient evidence');
  }
  if (papers.length < 2 && !insufficientEvidence.synthesis)
    insufficientEvidence.synthesis = SINGLE_PAPER_NOTE;

  const development = obj(d.development);
  const nextStep = obj(d.nextStep);
  const report: OutlookReportModel = {
    fingerprint: meta.fingerprint,
    title: OUTLOOK_TITLE,
    synthesis: claim(obj(d.synthesis), 'synthesis'),
    evidence: items(d.evidence).map((c, i) => claim(c, `evidence[${i}]`)),
    inferences: items(d.inferences).map((c, i) => claim(c, `inferences[${i}]`)),
    academicOpportunities,
    industryOpportunities,
    development: {
      direction: text(development.direction, 'development.direction'),
      uncertainties: strings(development.uncertainties, 'development.uncertainties', 1),
      falsifiers: strings(development.falsifiers, 'development.falsifiers'),
    },
    nextStep: {
      action: text(nextStep.action, 'nextStep.action'),
      measure: text(nextStep.measure, 'nextStep.measure'),
    },
    insufficientEvidence,
    teaser: text(d.teaser, 'teaser', 400),
    model: meta.model,
    promptVersion: OUTLOOK_PROMPT_VERSION,
  };
  if (report.evidence.length === 0) fail('evidence must cite at least one source-backed finding');

  const source = papers
    .map((p) => `${p.view.title}\n${p.view.abstract ?? ''}\n${JSON.stringify(p.view.analysis)}`)
    .join('\n');
  const generated = JSON.stringify({ ...report, fingerprint: '', model: '', promptVersion: '' });
  const unsupported = findUnsupportedNumbers(generated, source);
  if (unsupported.length > 0)
    fail(`numbers not present in the analyses: ${unsupported.slice(0, 5).join(', ')}`);
  return report;
}
