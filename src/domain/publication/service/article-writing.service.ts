import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../../config/app.config';
import { ContentCoverage, PublicationStatus } from '../../../common/enum/research.enum';
import { fingerprint } from '../../../common/text/fingerprint';
import { findUnsupportedNumbers } from '../../../common/text/numeric-claims';
import { LlmService } from '../../../service/llm/llm.service';
import { LlmTask } from '../../../service/llm/llm.types';
import { KnowledgeLevel } from '../../account';
import type { ResearchPaperView } from '../../research';
import {
  ARTICLE_SECTION_KEYS,
  ArticleContent,
  ArticleVariantModel,
  GenerationStatus,
} from '../model/article-variant.model';
import { ArticleVariantRepositoryService } from '../repository/article-variant-repository.service';
import { PublicationError } from './publication-error';

export const ARTICLE_PROMPT_VERSION = 'article-v1';
export const ARTICLE_SCHEMA_VERSION = 1;

const LEVEL_GUIDANCE: Record<KnowledgeLevel, string> = {
  [KnowledgeLevel.BEGINNER]:
    'Okur bu alana yeni. Her teknik terimi ilk geçtiği yerde sade bir dille açıkla, gündelik bir benzetme kullanabilirsin, ön bilgi varsayma. Basitleştirirken önemli teknik farkları silme.',
  [KnowledgeLevel.INTERMEDIATE]:
    'Okur alanın temel kavramlarını biliyor. Yalnızca uzmanlık gerektiren terimleri açıkla; yöntemin ana fikrine ve önceki yaklaşımlarla farkına odaklan.',
  [KnowledgeLevel.ADVANCED]:
    'Okur alanı iyi biliyor. Teknik terimleri olduğu gibi kullan; asıl yeniliğe, karşılaştırma tabanına, deney düzeneğine ve sınırlara kesinlikle odaklan.',
};

const SYSTEM_PROMPT = `Sen PaperMorning adlı kişisel bilim dergisinin editörüsün ve Türkçe yazıyorsun.
Kurallar:
- YALNIZCA verilen yapılandırılmış analizdeki ve özetteki bilgileri kullan. Yeni bulgu, sayı, deney, karşılaştırma, alıntı veya kaynak ekleme.
- Analizde ve özette geçmeyen hiçbir sayıyı yazma.
- Kesinlik düzeyi kanıt düzeyini aşamaz; "çığır açtı", "devrim" gibi abartılı ifadeler kullanma.
- Çalışma ön baskı (preprint) ise hakem değerlendirmesinden geçmediğini açıkça belirt.
- Analiz yalnızca özete dayanıyorsa bunu "Sınırlar" bölümünde açıkça söyle; tam metni okuduğunu ima etme.
- Beş bölümü sırasıyla yaz: problem (Araştırmacılar hangi sorunu çözmeye çalıştı?), before (Önceki yaklaşımların güçlü ve zayıf yanları), new (Bu çalışmanın özgün katkısı), evidence (Ne yaptılar, neyi neyle karşılaştırdılar, ne buldular?), limits (Hangi koşullarda geçerli, neler açık kaldı?).
- Başlık ilgi çekici ama bilimsel olarak savunulabilir olsun.`;

const ARTICLE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    dek: { type: 'string' },
    whyItMatters: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: [...ARTICLE_SECTION_KEYS] },
          heading: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['key', 'heading', 'body'],
        additionalProperties: false,
      },
    },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        properties: { term: { type: 'string' }, explanation: { type: 'string' } },
        required: ['term', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'dek', 'whyItMatters', 'sections', 'glossary'],
  additionalProperties: false,
};

/**
 * Writes or reuses the reader-level narration of a shared analysis. Reuse key: analysis
 * fingerprint + language + knowledge level + model/prompt/schema. Two readers with the same
 * language and level share one variant; Sonnet is called only for a missing variant.
 */
@Injectable()
export class ArticleWritingService {
  private readonly logger = new Logger(ArticleWritingService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly llm: LlmService,
    private readonly variants: ArticleVariantRepositoryService,
  ) {}

  fingerprintFor(view: ResearchPaperView, language: string, level: KnowledgeLevel): string {
    return fingerprint({
      analysisId: view.analysisId,
      analysisFingerprint: view.analysisFingerprint,
      language,
      knowledgeLevel: level,
      model: this.llm.modelFor(LlmTask.ARTICLE_WRITING),
      promptVersion: ARTICLE_PROMPT_VERSION,
      schemaVersion: ARTICLE_SCHEMA_VERSION,
    });
  }

  async getOrWrite(
    view: ResearchPaperView,
    language: string,
    level: KnowledgeLevel,
    options: { waitMs?: number; pollMs?: number } = {},
  ): Promise<ArticleVariantModel> {
    const generationFingerprint = this.fingerprintFor(view, language, level);
    const existing = await this.variants.findByFingerprint(generationFingerprint);
    if (existing?.status === GenerationStatus.COMPLETED) return existing;
    if (!this.llm.isAvailable()) {
      throw new PublicationError(
        'NOT_CONFIGURED',
        'ANTHROPIC_API_KEY is not configured; article not written',
        true,
      );
    }

    const claim = await this.variants.claim({
      analysisId: view.analysisId,
      analysisFingerprint: view.analysisFingerprint,
      language,
      knowledgeLevel: level,
      generationFingerprint,
      sourceReferences: view.sourceReferences,
      coverage: view.coverage,
      publicationStatus: view.publicationStatus,
      model: this.llm.modelFor(LlmTask.ARTICLE_WRITING),
      promptVersion: ARTICLE_PROMPT_VERSION,
      schemaVersion: ARTICLE_SCHEMA_VERSION,
      leaseSeconds: this.config.publication.leaseSeconds,
    });
    if (claim.outcome === 'COMPLETED') return claim.variant;
    if (claim.outcome === 'BUSY') return this.waitForOther(claim.variant, options);

    try {
      const result = await this.llm.generateJson({
        task: LlmTask.ARTICLE_WRITING,
        system: SYSTEM_PROMPT,
        schema: ARTICLE_SCHEMA,
        maxTokens: 8000,
        prompt: buildPrompt(view, level),
      });
      const content = validateArticle(result.data, sourceTextOf(view));
      return await this.variants.complete(claim.variant.id, {
        content,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      });
    } catch (error) {
      const failure = PublicationError.from(error);
      this.logger.warn(
        `Article variant ${generationFingerprint.slice(0, 12)} failed: ${failure.kind}: ${failure.message}`,
      );
      await this.variants.fail(claim.variant.id, failure.kind, failure.message, failure.retryable);
      throw failure;
    }
  }

  private async waitForOther(
    busy: ArticleVariantModel,
    { waitMs = 120_000, pollMs = 1_000 }: { waitMs?: number; pollMs?: number },
  ): Promise<ArticleVariantModel> {
    const deadline = Date.now() + waitMs;
    let current = busy;
    for (let first = true; first || Date.now() < deadline; first = false) {
      if (!first) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        current = (await this.variants.findById(busy.id)) ?? current;
      }
      if (current.status === GenerationStatus.COMPLETED) return current;
      if (current.status === GenerationStatus.FAILED) {
        throw new PublicationError(
          current.errorKind ?? 'WRITING_FAILED',
          current.errorMessage ?? 'Article writing failed',
          current.retryable,
        );
      }
    }
    throw new PublicationError(
      'IN_PROGRESS',
      'Article variant is being written by another worker',
      true,
    );
  }
}

function sourceTextOf(view: ResearchPaperView): string {
  return `${view.title}\n${view.abstract ?? ''}\n${JSON.stringify(view.analysis)}`;
}

function buildPrompt(view: ResearchPaperView, level: KnowledgeLevel): string {
  const status =
    view.publicationStatus === PublicationStatus.PREPRINT
      ? 'Ön baskı (preprint), hakem değerlendirmesinden geçmemiş'
      : view.publicationStatus === PublicationStatus.PEER_REVIEWED
        ? 'Hakemli dergide yayımlanmış'
        : 'Yayın durumu bilinmiyor';
  return [
    `Okur düzeyi: ${level}. ${LEVEL_GUIDANCE[level]}`,
    '',
    `Makale başlığı: ${view.title}`,
    `Yayın durumu: ${status}`,
    `Analizin kapsamı: ${view.coverage === ContentCoverage.ABSTRACT_ONLY ? 'YALNIZCA ÖZET (tam metin okunmadı)' : 'Tam metin'}`,
    '',
    'Yapılandırılmış bilimsel analiz (tek doğruluk kaynağın):',
    JSON.stringify(view.analysis, null, 2),
    '',
    'Özgün özet:',
    view.abstract ?? '(özet yok)',
  ].join('\n');
}

export function validateArticle(data: unknown, sourceText: string): ArticleContent {
  const fail = (message: string): never => {
    throw new PublicationError('VALIDATION_FAILED', `Article output invalid: ${message}`, true);
  };
  if (typeof data !== 'object' || data === null) fail('not an object');
  const d = data as Record<string, unknown>;
  const text = (value: unknown, field: string, max = 3000): string =>
    typeof value === 'string' && value.trim()
      ? value.trim().slice(0, max)
      : fail(`${field} is empty`);

  const rawSections = Array.isArray(d.sections)
    ? (d.sections as Record<string, unknown>[])
    : fail('sections missing');
  const sections = ARTICLE_SECTION_KEYS.map((key) => {
    const matches = rawSections.filter((s) => s?.key === key);
    if (matches.length !== 1) fail(`section "${key}" must appear exactly once`);
    return {
      key,
      heading: text(matches[0].heading, `${key}.heading`, 200),
      body: text(matches[0].body, `${key}.body`),
    };
  });
  const content: ArticleContent = {
    headline: text(d.headline, 'headline', 200),
    dek: text(d.dek, 'dek', 600),
    whyItMatters: text(d.whyItMatters, 'whyItMatters', 800),
    sections,
    glossary: (Array.isArray(d.glossary) ? (d.glossary as Record<string, unknown>[]) : [])
      .slice(0, 8)
      .map((g, i) => ({
        term: text(g?.term, `glossary[${i}].term`, 100),
        explanation: text(g?.explanation, `glossary[${i}].explanation`, 500),
      })),
  };
  const unsupported = findUnsupportedNumbers(JSON.stringify(content), sourceText);
  if (unsupported.length > 0)
    fail(`numbers not present in the analysis/abstract: ${unsupported.slice(0, 5).join(', ')}`);
  return content;
}
