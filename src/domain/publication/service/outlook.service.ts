import { Injectable, Logger } from '@nestjs/common';
import { ContentCoverage } from '../../../common/enum/research.enum';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import { AppConfig } from '../../../config/app.config';
import { fingerprint } from '../../../common/text/fingerprint';
import { findAbsenceInferences } from '../../../common/text/evidence-grounding';
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
  OutlookMode,
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

/**
 * outlook-v2 (2026-11-27): separate single-study / cross-study instructions, evidence-grounding
 * rules, `contrasts`, and per-mode item limits. Part of the fingerprint, so v1 reports are never
 * reused for new issues; reports frozen into published issues are untouched.
 */
export const OUTLOOK_PROMPT_VERSION = 'outlook-v2';
export const OUTLOOK_SCHEMA_VERSION = 2;
export const OUTLOOK_TITLE = 'Ufuk Raporu — Araştırma ve Uygulama Fırsatları';
const MATURITIES: OutlookMaturity[] = ['RESEARCH', 'EARLY_PROTOTYPE', 'FIELD_TESTED'];
export const SINGLE_PAPER_NOTE =
  'Bu sayıda yalnızca tek bir çalışma bulunduğundan makaleler arası sentez kurulamadı; aşağıdaki değerlendirme tek kaynağa dayanır.';

/** Item limits per mode. Extra items are dropped deterministically (no paid regeneration). */
export const OUTLOOK_LIMITS: Record<
  OutlookMode,
  {
    evidence: number;
    inferences: number;
    contrasts: number;
    academic: number;
    industry: number;
    uncertainties: number;
    falsifiers: number;
    listItems: number;
  }
> = {
  SINGLE_STUDY: {
    evidence: 3,
    inferences: 2,
    contrasts: 0,
    academic: 2,
    industry: 1,
    uncertainties: 3,
    falsifiers: 2,
    listItems: 3,
  },
  CROSS_STUDY: {
    evidence: 6,
    inferences: 4,
    contrasts: 4,
    academic: 3,
    industry: 2,
    uncertainties: 4,
    falsifiers: 3,
    listItems: 4,
  },
};

export function outlookModeFor(paperCount: number): OutlookMode {
  return paperCount < 2 ? 'SINGLE_STUDY' : 'CROSS_STUDY';
}

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
    contrasts: { type: 'array', items: CLAIM },
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
    'contrasts',
    'academicOpportunities',
    'industryOpportunities',
    'development',
    'nextStep',
    'insufficientEvidence',
    'teaser',
  ],
  additionalProperties: false,
};

const single = OUTLOOK_LIMITS.SINGLE_STUDY;
const cross = OUTLOOK_LIMITS.CROSS_STUDY;

export const OUTLOOK_SYSTEM_PROMPT = `Sen PaperMorning dergisinin kapanış bölümü "Ufuk Raporu"nu Türkçe yazıyorsun. Bu bölüm makaleleri yeniden özetlemez; onları eleştirel olarak yorumlar ve denenebilir fırsatlar önerir.

Kanıt kuralları:
- Yalnızca verilen özetleri ve yapılandırılmış analizleri kullan. Her iddia ve öneri paperKeys alanında verilen anahtarlardan (P1, P2, ...) en az birine dayanmalı. Başka kaynak uydurma.
- "evidence" yalnızca kaynakların gerçekten bildirdiği bulgulardır; "yazarlar ... bildiriyor" diye aktar. "inferences" PaperMorning'in yorumudur ve kanıtlanmış sonuç gibi yazılmaz. Öneriler (akademik/sektörel fırsatlar, nextStep) ayrıca önerdir.
- Bildirilmeyen veriden sonuç çıkarma: kaynak "on kombinasyonun dokuzunda iyileşme" diyorsa onuncu hakkında hiçbir şey bilinmez; "onuncuda iyileşme yok" yazma, "kalan bir kombinasyonun sonucu belirtilmiyor" de.
- Karşılaştırma tabanı, örneklem, veri kümesi veya deney koşulları belirtilmemişse karşılaştırmaları nitele ve genelleme yapma. Ön baskı ve yalnızca özete dayanan analizlerde kesinlik düzeyini düşür ve bunu belirsizlikler arasında an.
- Analizlerde ve özetlerde geçmeyen hiçbir sayıyı yazma.
- Akademik fırsat: açık kalan soru, test edilebilir hipotez, düşük maliyetli ilk deney ve ölçülecek metrikler. "Yayınlanabilir/özgün" iddiasında bulunma.
- Sektörel fırsat: hangi ihtiyacı karşıladığı, küçük bir pilot, ölçülecek metrikler, engeller (maliyet, ölçek, regülasyon, veri, güvenlik) ve olgunluk (RESEARCH / EARLY_PROTOTYPE / FIELD_TESTED). "Kesin büyüyecek", "kesin kazandırır" gibi ifadeler yasak.
- Kanıt yetersizse fırsat uydurma: ilgili dizi boş kalsın ve insufficientEvidence alanında nedenini açıkla. Aksi halde bu alanlar null olsun.
- development: kanıtın gösterdiği yön, belirsizlikler ve bu yorumu çürütebilecek koşullar. nextStep: okurun bu hafta yapabileceği somut ve ölçülebilir ilk adım. teaser: e-posta için bölümün en güçlü önerisini anlatan 1–2 cümle.
- Aynı bulguyu bölümler arasında tekrar etme; makalede zaten anlatılan ayrıntıyı yeniden anlatma, yalnızca yorum için gereken kısmına atıf yap. Kısa ve yoğun yaz.

MOD: TEK_ÇALIŞMA (sayıda yalnızca bir çalışma varsa):
- Bu, tek bir çalışmanın eleştirel değerlendirmesidir. "Eğilim", "uzlaşı", "çalışmalar gösteriyor", "alan bu yöne gidiyor" gibi birden fazla kaynak gerektiren ifadeler kullanma.
- synthesis: çalışmanın neyi gösterdiği ve neyi göstermediği hakkında 1–2 cümlelik eleştirel değerlendirme.
- En fazla ${single.evidence} evidence, ${single.inferences} inferences, ${single.academic} akademik ve ${single.industry} sektörel fırsat, ${single.uncertainties} belirsizlik, ${single.falsifiers} çürütme koşulu; her listede en fazla ${single.listItems} madde. Çok sayıda spekülatif fikir yerine az sayıda, kanıta dayanan, test edilebilir fırsat seç. contrasts boş dizi olsun.

MOD: ÇOKLU_ÇALIŞMA (iki veya daha fazla çalışma):
- synthesis çalışmaları birlikte okur ve en az iki paperKey'e dayanır.
- contrasts: çalışmaların uyuştuğu ve ayrıştığı noktalar; her madde en az iki paperKey'e dayanır. Ortak bir sonuç yoksa bunu söyle; zorla eğilim kurma.
- Fırsatlarda mümkün olduğunca birden fazla kaynağın desteklediği fikirleri öne çıkar.
- En fazla ${cross.evidence} evidence, ${cross.inferences} inferences, ${cross.contrasts} contrasts, ${cross.academic} akademik ve ${cross.industry} sektörel fırsat; her listede en fazla ${cross.listItems} madde.`;

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
        system: OUTLOOK_SYSTEM_PROMPT,
        schema: OUTLOOK_SCHEMA,
        maxTokens: 10_000,
        prompt: buildOutlookPrompt(papers, level),
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

export function buildOutlookPrompt(papers: OutlookPaper[], level: KnowledgeLevel): string {
  const mode = outlookModeFor(papers.length);
  const items = papers.map(({ paperKey, view }) => ({
    paperKey,
    title: view.title,
    topic: view.topicKey,
    publicationStatus: view.publicationStatus,
    coverage: view.coverage === ContentCoverage.ABSTRACT_ONLY ? 'ABSTRACT_ONLY' : 'FULL_TEXT',
    abstract: view.abstract,
    summary: view.analysis.summary,
    contribution: view.analysis.contribution,
    findings: view.analysis.findings,
    limitations: view.analysis.limitations,
    openQuestions: view.analysis.openQuestions,
  }));
  return [
    `MOD: ${mode === 'SINGLE_STUDY' ? 'TEK_ÇALIŞMA' : 'ÇOKLU_ÇALIŞMA'} (${papers.length} çalışma)`,
    `Okurun bilgi düzeyi: ${level} (açıklama derinliğini buna göre ayarla; bilimsel gerçeklik değişmez).`,
    'Bu sayının çalışmaları (özet birincil kaynaktır; analiz özetten türetilmiştir):',
    JSON.stringify(items, null, 2),
  ].join('\n');
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  typeof value === 'object' && value !== null ? (value as Obj) : {};
const items = (value: unknown, max: number): Obj[] =>
  Array.isArray(value) ? value.slice(0, max).map(obj) : [];
const normalized = (statement: string) => statement.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
/** Drops claims that repeat an earlier one verbatim (modulo case and whitespace). */
const distinct = (claims: OutlookClaim[], seen = new Set<string>()): OutlookClaim[] =>
  claims.filter((c) => {
    const key = normalized(c.statement);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

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
  const mode = outlookModeFor(papers.length);
  const limits = OUTLOOK_LIMITS[mode];
  const validKeys = new Set(papers.map((p) => p.paperKey));
  const text = (value: unknown, field: string, max = 1500): string =>
    typeof value === 'string' && value.trim()
      ? value.trim().slice(0, max)
      : fail(`${field} is empty`);
  const optional = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 800) : null;
  const strings = (value: unknown, field: string, min = 0, max = limits.listItems): string[] => {
    const list = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      : [];
    if (list.length < min) fail(`${field} needs at least ${min} item(s)`);
    return list.slice(0, max).map((v) => v.trim().slice(0, 500));
  };
  const keys = (value: unknown, field: string): string[] => {
    const list = strings(value, `${field}.paperKeys`, 1, 12);
    const unknown = list.filter((k) => !validKeys.has(k));
    if (unknown.length > 0) fail(`${field} cites unknown papers ${unknown.join(', ')}`);
    return [...new Set(list)];
  };
  const claim = (value: Obj, field: string): OutlookClaim => ({
    statement: text(value.statement, `${field}.statement`),
    paperKeys: keys(value.paperKeys, field),
  });

  const academicOpportunities: AcademicOpportunity[] = items(
    d.academicOpportunities,
    limits.academic,
  ).map((o, i) => ({
    question: text(o.question, `academic[${i}].question`),
    hypothesis: text(o.hypothesis, `academic[${i}].hypothesis`),
    firstExperiment: text(o.firstExperiment, `academic[${i}].firstExperiment`),
    metrics: strings(o.metrics, `academic[${i}].metrics`, 1),
    risks: text(o.risks, `academic[${i}].risks`),
    paperKeys: keys(o.paperKeys, `academic[${i}]`),
  }));
  const industryOpportunities: IndustryOpportunity[] = items(
    d.industryOpportunities,
    limits.industry,
  ).map((o, i) => ({
    idea: text(o.idea, `industry[${i}].idea`),
    need: text(o.need, `industry[${i}].need`),
    pilot: text(o.pilot, `industry[${i}].pilot`),
    metrics: strings(o.metrics, `industry[${i}].metrics`, 1),
    barriers: strings(o.barriers, `industry[${i}].barriers`, 1),
    maturity: MATURITIES.includes(o.maturity as OutlookMaturity)
      ? (o.maturity as OutlookMaturity)
      : fail(`industry[${i}].maturity invalid`),
    paperKeys: keys(o.paperKeys, `industry[${i}]`),
  }));
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
  const synthesis = claim(obj(d.synthesis), 'synthesis');
  if (mode === 'CROSS_STUDY' && synthesis.paperKeys.length < 2) {
    fail('a cross-study synthesis must cite at least two papers');
  }
  const seen = new Set<string>();
  const evidence = distinct(
    items(d.evidence, limits.evidence).map((c, i) => claim(c, `evidence[${i}]`)),
    seen,
  );
  const inferences = distinct(
    items(d.inferences, limits.inferences).map((c, i) => claim(c, `inferences[${i}]`)),
    seen,
  );
  // Single study: nothing to contrast. Cross study: a "contrast" citing one paper is not one.
  const contrasts = distinct(
    items(d.contrasts, limits.contrasts)
      .map((c, i) => claim(c, `contrasts[${i}]`))
      .filter((c) => c.paperKeys.length >= 2),
    seen,
  );
  const report: OutlookReportModel = {
    fingerprint: meta.fingerprint,
    title: OUTLOOK_TITLE,
    mode,
    synthesis,
    evidence,
    inferences,
    contrasts,
    academicOpportunities,
    industryOpportunities,
    development: {
      direction: text(development.direction, 'development.direction'),
      uncertainties: strings(
        development.uncertainties,
        'development.uncertainties',
        1,
        limits.uncertainties,
      ),
      falsifiers: strings(development.falsifiers, 'development.falsifiers', 0, limits.falsifiers),
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
  // Statements about unreported cases: the abstract is the authority for abstract-only analyses.
  const statementSource = papers
    .map((p) =>
      p.view.coverage === ContentCoverage.ABSTRACT_ONLY
        ? `${p.view.title}\n${p.view.abstract ?? ''}`
        : `${p.view.title}\n${p.view.abstract ?? ''}\n${JSON.stringify(p.view.analysis)}`,
    )
    .join('\n');
  const absence = findAbsenceInferences(outlookTexts(report), statementSource);
  if (absence.length > 0) {
    fail(
      `conclusion drawn from data the sources do not report (${absence[0].partition} reported): "${absence[0].sentence.slice(0, 200)}"`,
    );
  }
  return report;
}

function outlookTexts(report: OutlookReportModel): string[] {
  return [
    report.synthesis.statement,
    ...report.evidence.map((c) => c.statement),
    ...report.inferences.map((c) => c.statement),
    ...(report.contrasts ?? []).map((c) => c.statement),
    ...report.academicOpportunities.flatMap((o) => [o.question, o.hypothesis, o.risks]),
    ...report.industryOpportunities.flatMap((o) => [o.idea, o.need, o.pilot]),
    report.development.direction,
    ...report.development.uncertainties,
    report.teaser,
  ];
}
