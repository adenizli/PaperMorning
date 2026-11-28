import { Injectable, Logger } from '@nestjs/common';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import { AppConfig } from '../../../config/app.config';
import { ContentCoverage, PublicationStatus } from '../../../common/enum/research.enum';
import { fingerprint } from '../../../common/text/fingerprint';
import {
  findAbsenceInferences,
  findStudyScopeAbsenceClaims,
} from '../../../common/text/evidence-grounding';
import {
  describeUnsupportedClaims,
  findUnsupportedNumericClaims,
  textFields,
} from '../../../common/text/numeric-claims';
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

/**
 * article-v2 (2026-11-27): evidence-grounding rules (reported / unknown / PaperMorning's
 * interpretation; no conclusions from unreported data; qualified comparisons) and the
 * `notReported` field. Bumping these changes every variant fingerprint, so variants written by
 * article-v1 are never reused for new issues; already published issues keep their frozen text.
 *
 * article-v3 (2026-11-28): scope of absence. With abstract-only coverage, something missing from
 * the abstract is written as "özette ele alınmıyor", never "bu çalışmada ele alınmıyor"; hypotheses
 * are marked as such. New fingerprints: v2 variants are not reused for new issues (papers are not
 * repeated across a reader's issues, so this costs no extra writing in practice).
 */
export const ARTICLE_PROMPT_VERSION = 'article-v3';
export const ARTICLE_SCHEMA_VERSION = 2;
export const MAX_NOT_REPORTED = 4;

const LEVEL_GUIDANCE: Record<KnowledgeLevel, string> = {
  [KnowledgeLevel.BEGINNER]:
    'Okur bu alana yeni. Her teknik terimi ilk geçtiği yerde sade bir dille açıkla, gündelik bir benzetme kullanabilirsin, ön bilgi varsayma. Basitleştirirken önemli teknik farkları ve belirsizlikleri silme.',
  [KnowledgeLevel.INTERMEDIATE]:
    'Okur alanın temel kavramlarını biliyor. Yalnızca uzmanlık gerektiren terimleri açıkla; yöntemin ana fikrine ve önceki yaklaşımlarla farkına odaklan.',
  [KnowledgeLevel.ADVANCED]:
    'Okur alanı iyi biliyor. Teknik terimleri olduğu gibi kullan; asıl yeniliğe, karşılaştırma tabanına, deney düzeneğine ve sınırlara kesinlikle odaklan.',
};

export const ARTICLE_SYSTEM_PROMPT = `Sen PaperMorning adlı kişisel bilim dergisinin editörüsün ve Türkçe yazıyorsun.

Kanıt kuralları (her şeyden önce gelir):
- Tek bilgi kaynağın verilen özgün özet ve yapılandırılmış analizdir. Analiz yalnızca özete dayanıyorsa ve bir noktada özetin ötesine geçiyor ya da özetle çelişiyorsa özete uy.
- Okur her cümlenin hangi türden olduğunu anlayabilmelidir:
  1. Makalenin bildirdiği: kaynağa bağlanan ifadeler ("yazarlar ... bildiriyor", "çalışmaya göre ..."). Yazarların iddiasını "kanıtladı" diye değil "bildiriyor/gösterdiklerini belirtiyor" diye aktar.
  2. Bilinmeyen: kaynakta yer almayan bilgi. Tahmin etme; "özette belirtilmiyor" ya da "bilinmiyor" diye açıkça yaz.
  3. Hipotez: test edilmemiş bir olasılık. "hipotez", "test edilmesi gereken bir olasılık" diye işaretle; sonuç gibi yazma.
  4. PaperMorning'in yorumu: kaynakta olmayan çıkarım. Yalnızca "whyItMatters" ve "limits" içinde, "olabilir", "PaperMorning'in yorumu" gibi açık bir işaretle yaz; asla bulgu gibi sunma.
- Kapsam: "Analizin kapsamı: YALNIZCA ÖZET" ise yalnızca özeti biliyorsun. Özette geçmeyen bir konu, makalede de olmadığı anlamına gelmez. "Bu çalışmada ele alınmıyor", "makale ... içermiyor", "yazarlar ... test etmiyor" YAZMA; doğrusu "özette ele alınmıyor", "özette belirtilmiyor", "özette yer almıyor". Örnek: "Simülasyondan gerçek robota aktarım bu çalışmada ele alınmıyor." yanlış; "Simülasyondan gerçek robota aktarım özette ele alınmıyor." doğru. Yalnızca tam metin okunduysa "makalede" diyebilirsin.
- Bildirilmeyen veriden sonuç çıkarma. Kaynak bir alt küme için sonuç veriyorsa geri kalan durumlar hakkında hiçbir şey söylemez. Örnek: Özet "on kombinasyonun dokuzunda konum RMSE'si %15–60 azaldı" diyorsa "onuncu kombinasyonda iyileşme olmadı", "biri başarısız oldu" ya da "yöntem bir durumda işe yaramadı" YAZMA. Doğrusu: "Kalan bir kombinasyonun sonucu özette belirtilmiyor."
- Karşılaştırma tabanı, örneklem veya deney sayısı, veri kümesi ya da deney koşulları kaynakta tanımlanmamışsa karşılaştırmayı niteleyerek yaz ("özette belirtilen koşullarda", "neyle karşılaştırıldığı özette tanımlanmıyor") ve genelleme yapma.
- Sayı aralıklarını olduğu gibi aktar (ör. %15–60). Aralığı en iyi değere indirgeme ("%60'a varan iyileşme" gibi seçici ifadeler kullanma).
- Verilen metinlerde geçmeyen hiçbir sayıyı, deneyi, veri kümesini, karşılaştırmayı, alıntıyı veya kaynağı ekleme.
- Kesinlik düzeyi kanıt düzeyini aşamaz; "çığır açtı", "devrim", "kesin olarak gösterdi" gibi ifadeler kullanma.
- Çalışma ön baskı (preprint) ise hakem değerlendirmesinden geçmediğini belirt. Analiz yalnızca özete dayanıyorsa bunu "limits" bölümünde açıkça söyle; tam metni, şekilleri veya tabloları okuduğunu ima etme.

Yazım:
- Beş bölümü sırasıyla yaz: problem (Araştırmacılar hangi sorunu çözmeye çalıştı?), before (Önceki yaklaşımların güçlü ve zayıf yanları; kaynak anlatmıyorsa bunu söyle), new (Bu çalışmanın özgün katkısı), evidence (Ne yaptılar, neyi neyle karşılaştırdılar, ne bildirdiler?), limits (Hangi koşullarda geçerli, neler bilinmiyor?).
- notReported: okurun doğal olarak soracağı ama kaynakta yanıtı olmayan en fazla ${MAX_NOT_REPORTED} kısa madde (ör. karşılaştırma tabanının ayrıntısı, deney sayısı, kalan durumların sonucu). Her madde bilinmeyeni adlandırsın ("... özette belirtilmiyor"; tam metin okunduysa "... makalede belirtilmiyor"); yanıt veya tahmin içermesin. Böyle bir nokta yoksa boş dizi ver.
- Aynı bulguyu bölümler arasında tekrar etme. Kısa ve yoğun paragraflar yaz; uzunluğu kaynağın içeriğiyle orantılı tut.
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
    notReported: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'dek', 'whyItMatters', 'sections', 'glossary', 'notReported'],
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

  /** A variant claim outlives the longest bounded Claude call, so a healthy writer keeps it. */
  leaseSeconds(): number {
    const callBoundSeconds = Math.ceil(this.llm.maxCallDurationMs() / 1000);
    return Math.max(this.config.publication.leaseSeconds, callBoundSeconds + 60);
  }

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
      leaseSeconds: this.leaseSeconds(),
    });
    if (claim.outcome !== 'CLAIMED') {
      return claim.outcome === 'COMPLETED'
        ? claim.variant
        : this.waitForOther(claim.variant, options);
    }

    try {
      const result = await this.llm.generateJson({
        task: LlmTask.ARTICLE_WRITING,
        system: ARTICLE_SYSTEM_PROMPT,
        schema: ARTICLE_SCHEMA,
        maxTokens: 8000,
        prompt: buildArticlePrompt(view, level),
      });
      const content = validateArticle(result.data, groundingSourcesOf(view), language);
      return await this.variants.complete(claim.variant.id, claim.claimToken, {
        content,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      });
    } catch (error) {
      if (error instanceof ClaimLostError)
        return this.afterLostClaim(claim.variant, error, options);
      const failure = PublicationError.from(error);
      this.logger.warn(
        `Article variant ${generationFingerprint.slice(0, 12)} failed: ${failure.kind}: ${failure.message}`,
      );
      const recorded = await this.variants.fail(
        claim.variant.id,
        claim.claimToken,
        failure.kind,
        failure.message,
        failure.retryable,
      );
      if (!recorded) {
        return this.afterLostClaim(
          claim.variant,
          new ClaimLostError(`Article variant ${claim.variant.id}`),
          options,
        );
      }
      throw failure;
    }
  }

  /** A newer writer owns the variant: use its result instead of our discarded one. */
  private async afterLostClaim(
    claimed: ArticleVariantModel,
    error: ClaimLostError,
    options: { waitMs?: number; pollMs?: number },
  ): Promise<ArticleVariantModel> {
    this.logger.warn(error.message);
    return this.waitForOther((await this.variants.findById(claimed.id)) ?? claimed, options);
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

/**
 * Source material for the deterministic checks. Numbers may come from the title, abstract or
 * analysis. For "what does the source say about the unreported cases" the authority is the
 * abstract when the analysis itself was written from the abstract only (the analysis is derived
 * text and must not license claims the abstract does not make).
 */
export function groundingSourcesOf(view: ResearchPaperView): GroundingSources {
  const primary = `${view.title}\n${view.abstract ?? ''}`;
  const numbers = `${primary}\n${JSON.stringify(view.analysis)}`;
  const abstractOnly = view.coverage === ContentCoverage.ABSTRACT_ONLY;
  return { numbers, statements: abstractOnly ? primary : numbers, abstractOnly };
}

export interface GroundingSources {
  numbers: string;
  statements: string;
  /** Only the abstract was read: "not in the abstract" must never become "not in the study". */
  abstractOnly?: boolean;
}

export function buildArticlePrompt(view: ResearchPaperView, level: KnowledgeLevel): string {
  const status =
    view.publicationStatus === PublicationStatus.PREPRINT
      ? 'Ön baskı (preprint), hakem değerlendirmesinden geçmemiş'
      : view.publicationStatus === PublicationStatus.PEER_REVIEWED
        ? 'Hakemli dergide yayımlanmış'
        : 'Yayın durumu bilinmiyor';
  const abstractOnly = view.coverage === ContentCoverage.ABSTRACT_ONLY;
  return [
    `Okur düzeyi: ${level}. ${LEVEL_GUIDANCE[level]}`,
    '',
    `Makale başlığı: ${view.title}`,
    `Yayın durumu: ${status}`,
    `Analizin kapsamı: ${abstractOnly ? 'YALNIZCA ÖZET (tam metin okunmadı; özet birincil kaynaktır)' : 'Tam metin'}`,
    '',
    'Özgün özet (birincil kaynak):',
    view.abstract ?? '(özet yok)',
    '',
    'Yapılandırılmış bilimsel analiz (özetten türetilmiştir; özetle çelişirse özete uy):',
    JSON.stringify(view.analysis, null, 2),
  ].join('\n');
}

export function validateArticle(
  data: unknown,
  sources: GroundingSources,
  language = 'tr',
): ArticleContent {
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
    notReported: (Array.isArray(d.notReported) ? d.notReported : [])
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      .slice(0, MAX_NOT_REPORTED)
      .map((item) => item.trim().slice(0, 300)),
  };
  // Turkish output ("470.000", "470 bin", "42,8") is compared by value with the English source.
  const unsupported = findUnsupportedNumericClaims(
    textFields(content),
    sources.numbers,
    language === 'tr' ? 'tr' : 'en',
  );
  if (unsupported.length > 0)
    fail(`numbers not present in the analysis/abstract: ${describeUnsupportedClaims(unsupported)}`);
  const absence = findAbsenceInferences(articleTexts(content), sources.statements);
  if (absence.length > 0) {
    fail(
      `conclusion drawn from data the source does not report (${absence[0].partition} reported): "${absence[0].sentence.slice(0, 200)}"`,
    );
  }
  if (sources.abstractOnly) {
    const [overreach] = findStudyScopeAbsenceClaims(articleTexts(content));
    if (overreach) {
      fail(
        `absence in the abstract stated as absence in the study (write "özette ..."): "${overreach.slice(0, 200)}"`,
      );
    }
  }
  return content;
}

function articleTexts(content: ArticleContent): string[] {
  return [
    content.headline,
    content.dek,
    content.whyItMatters,
    ...content.sections.map((s) => s.body),
    ...content.glossary.map((g) => g.explanation),
    ...(content.notReported ?? []),
  ];
}
