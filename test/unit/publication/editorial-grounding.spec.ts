import { ContentCoverage, PublicationStatus } from '../../../src/common/enum/research.enum';
import { KnowledgeLevel } from '../../../src/domain/account';
import {
  ARTICLE_PROMPT_VERSION,
  ARTICLE_SCHEMA_VERSION,
  ARTICLE_SYSTEM_PROMPT,
  buildArticlePrompt,
  groundingSourcesOf,
  validateArticle,
} from '../../../src/domain/publication/service/article-writing.service';
import {
  buildOutlookPrompt,
  OUTLOOK_PROMPT_VERSION,
  OUTLOOK_SCHEMA_VERSION,
  OUTLOOK_SYSTEM_PROMPT,
  OutlookPaper,
  validateOutlook,
} from '../../../src/domain/publication/service/outlook.service';
import { PublicationError } from '../../../src/domain/publication/service/publication-error';
import type { ResearchPaperView } from '../../../src/domain/research';
import { validateAnalysisOutput } from '../../../src/domain/research/service/analysis-output.validator';
import { cannedArticle, cannedOutlook } from '../../support/publication-fixtures';
import {
  NINE_OF_TEN_ABSTRACT,
  NINE_OF_TEN_TITLE,
  NINE_OF_TEN_UNSUPPORTED_TR,
} from '../../fixtures/nine-of-ten.fixture';
import {
  GRIPPER_ABSTRACT,
  GRIPPER_PROBLEM_TR,
  GRIPPER_TITLE,
  ROLLOUTS_ABSTRACT,
  ROLLOUTS_ARTICLE_TR,
  ROLLOUTS_TITLE,
  THIRTY_TWO_ABSTRACT,
  THIRTY_TWO_TITLE,
} from '../../fixtures/numeric-grounding.fixture';

function view(overrides: Partial<ResearchPaperView> = {}): ResearchPaperView {
  return {
    analysisId: 'an-1',
    analysisFingerprint: 'fp-1',
    paperId: 'p-1',
    paperVersionId: 'v-1',
    topicKey: 'robotics',
    topicKeys: ['robotics'],
    relevanceScore: 0.9,
    title: NINE_OF_TEN_TITLE,
    authors: ['A. Author'],
    doi: null,
    arxivId: '2611.00001',
    publicationStatus: PublicationStatus.PREPRINT,
    publishedAt: '2026-11-20',
    venue: 'arXiv',
    abstract: NINE_OF_TEN_ABSTRACT,
    coverage: ContentCoverage.ABSTRACT_ONLY,
    analysis: {
      summary: 'A learned residual model reduces position RMSE in nine out of ten combinations.',
      problem: 'Nominal models miss aerodynamic effects.',
      priorApproach: 'The abstract does not describe prior learned approaches in detail.',
      contribution: 'Residual dynamics learned on top of a physics model, used in MPC.',
      methods: 'Two platforms, five reference trajectories.',
      findings: [
        {
          statement: 'Position RMSE is reduced by 15–60% in nine out of ten combinations.',
          evidence: 'Comparison against the nominal model, as stated in the abstract.',
        },
      ],
      limitations: ['Abstract only.'],
      keyTerms: [],
      openQuestions: ['What happened in the remaining combination is not reported.'],
    },
    sourceReferences: [
      { kind: 'LANDING', label: 'arXiv', url: 'https://arxiv.org/abs/2611.00001' },
    ],
    analyzedAt: new Date('2026-11-25T00:00:00Z'),
    ...overrides,
  };
}

function articleWith(evidenceBody: string, extra: Record<string, unknown> = {}) {
  const data = cannedArticle('Öğrenilen artık model drone uçuşunu iyileştiriyor');
  (data.sections as { key: string; body: string }[]).find((s) => s.key === 'evidence')!.body =
    evidenceBody;
  return { ...data, ...extra };
}

const REPORTED =
  'Yazarlar, iki platform ve beş referans yörüngeden oluşan on kombinasyonun dokuzunda konum RMSE değerinin %15–60 azaldığını bildiriyor.';

describe('article-v2 evidence grounding (first issue regression: 9 of 10 combinations)', () => {
  it('is a new prompt/schema version, so article-v1 variants are never reused', () => {
    expect(ARTICLE_PROMPT_VERSION).toBe('article-v2');
    expect(ARTICLE_SCHEMA_VERSION).toBe(2);
  });

  it('instructs reported / unknown / interpretation separation with the actual example', () => {
    expect(ARTICLE_SYSTEM_PROMPT).toContain('Makalenin bildirdiği');
    expect(ARTICLE_SYSTEM_PROMPT).toContain('Bilinmeyen');
    expect(ARTICLE_SYSTEM_PROMPT).toContain("PaperMorning'in yorumu");
    expect(ARTICLE_SYSTEM_PROMPT).toContain('onuncu kombinasyonda iyileşme olmadı');
    expect(ARTICLE_SYSTEM_PROMPT).toContain('Kalan bir kombinasyonun sonucu özette belirtilmiyor');
    const prompt = buildArticlePrompt(view(), KnowledgeLevel.BEGINNER);
    expect(prompt).toContain('YALNIZCA ÖZET');
    expect(prompt).toContain('Ön baskı');
    expect(prompt.indexOf('Özgün özet (birincil kaynak)')).toBeLessThan(
      prompt.indexOf('Yapılandırılmış bilimsel analiz'),
    );
  });

  it('rejects the sentence that was published on 2026-11-26', () => {
    const data = articleWith(`${REPORTED} ${NINE_OF_TEN_UNSUPPORTED_TR}`);
    expect(() => validateArticle(data, groundingSourcesOf(view()))).toThrow(
      /conclusion drawn from data the source does not report \(9\/10 reported\)/,
    );
    try {
      validateArticle(data, groundingSourcesOf(view()));
    } catch (error) {
      expect(error).toBeInstanceOf(PublicationError);
      expect((error as PublicationError).kind).toBe('VALIDATION_FAILED');
      expect((error as PublicationError).retryable).toBe(true);
    }
  });

  it('accepts the grounded wording and keeps the "not reported" list', () => {
    const content = validateArticle(
      articleWith(`${REPORTED} Kalan bir kombinasyonun sonucu özette belirtilmiyor.`, {
        notReported: [
          'Kalan bir kombinasyonun sonucu özette belirtilmiyor.',
          'Deney tekrar sayısı özette belirtilmiyor.',
          '  ',
          'Gerçek uçuş süresi belirtilmiyor.',
          'Karşılaştırma tabanının ayarları belirtilmiyor.',
          'Fazladan beşinci madde belirtilmiyor.',
        ],
      }),
      groundingSourcesOf(view()),
    );
    expect(content.notReported).toHaveLength(4);
    expect(content.notReported![0]).toBe('Kalan bir kombinasyonun sonucu özette belirtilmiyor.');
  });

  it('also catches the inference inside the "not reported" list itself', () => {
    expect(() =>
      validateArticle(
        articleWith(REPORTED, { notReported: ['Onuncu kombinasyon başarısız oldu.'] }),
        groundingSourcesOf(view()),
      ),
    ).toThrow(/9\/10 reported/);
  });

  it('an abstract-only analysis cannot license a claim the abstract does not make', () => {
    const tainted = view();
    tainted.analysis.openQuestions = ['The tenth combination showed no improvement.'];
    expect(groundingSourcesOf(tainted).statements).not.toContain('tenth');
    expect(() =>
      validateArticle(
        articleWith(`${REPORTED} ${NINE_OF_TEN_UNSUPPORTED_TR}`),
        groundingSourcesOf(tainted),
      ),
    ).toThrow(/9\/10 reported/);
  });

  it('still rejects numbers that appear nowhere in the sources', () => {
    expect(() =>
      validateArticle(articleWith('Hata %73 azaldı.'), groundingSourcesOf(view())),
    ).toThrow(/numbers not present/);
  });
});

describe('analysis validation catches the same error for newly written analyses', () => {
  const analysis = (statement: string) => ({
    summary: 'Residual model for quadrotors.',
    problem: 'p',
    priorApproach: 'The abstract does not state it.',
    contribution: 'c',
    methods: 'm',
    findings: [{ statement, evidence: 'Stated in the abstract.' }],
    limitations: ['l'],
    keyTerms: [],
    openQuestions: [],
  });
  const source = `${NINE_OF_TEN_TITLE}\n${NINE_OF_TEN_ABSTRACT}`;

  it('rejects "the tenth combination showed no improvement"', () => {
    expect(() =>
      validateAnalysisOutput(
        analysis(
          'RMSE drops by 15–60% in nine of ten; the tenth combination showed no improvement.',
        ),
        source,
        true,
      ),
    ).toThrow(/unreported cases \(9\/10 reported\)/);
  });

  it('accepts an explicit "not reported"', () => {
    expect(() =>
      validateAnalysisOutput(
        analysis('RMSE drops by 15–60% in nine of ten; the remaining one is not reported.'),
        source,
        true,
      ),
    ).not.toThrow();
  });
});

describe('numeric grounding by value (Geveze 2026-11-28 false positives)', () => {
  const analysisOf = (statement: string) => ({
    summary: 'A systematic review of learned manipulation policies in clinical robotics.',
    problem: 'Evidence on learned manipulation in clinical robotics is scattered.',
    priorApproach: 'The abstract does not describe earlier reviews.',
    contribution: 'A systematic review of the literature.',
    methods: 'Systematic search of five databases.',
    findings: [{ statement, evidence: 'Stated in the abstract.' }],
    limitations: ['Abstract only.'],
    keyTerms: [],
    openQuestions: [],
  });
  const reviewSource = `${THIRTY_TWO_TITLE}\n${THIRTY_TWO_ABSTRACT}`;

  it('analysis: "32" is grounded by "Thirty-two studies met the inclusion criteria"', () => {
    const content = validateAnalysisOutput(
      analysisOf('32 studies met the inclusion criteria.'),
      reviewSource,
      true,
    );
    expect(content.findings[0].statement).toBe('32 studies met the inclusion criteria.');
  });

  it('analysis: a different count is still rejected, naming the field and nearby text', () => {
    expect(() =>
      validateAnalysisOutput(
        analysisOf('33 studies met the inclusion criteria.'),
        reviewSource,
        true,
      ),
    ).toThrow(
      'Numbers not present in the source text: 33 [findings[0].statement: "33 studies met the inclusion criteria."]',
    );
  });

  const rollouts = (): ResearchPaperView =>
    view({
      title: ROLLOUTS_TITLE,
      abstract: ROLLOUTS_ABSTRACT,
      analysis: {
        summary: 'A simulation benchmark evaluated over 470,000 rollouts of generalist policies.',
        problem: 'Real-world evaluation of robot policies is slow and costly.',
        priorApproach: 'The abstract does not describe earlier benchmarks in detail.',
        contribution: 'A simulation benchmark built from real-world scenes.',
        methods: 'Large-scale simulated rollouts across policies and tasks.',
        findings: [
          {
            statement: 'Simulated and real success rates correlate, mean error 4.2 points.',
            evidence: 'Stated in the abstract.',
          },
        ],
        limitations: ['Abstract only.'],
        keyTerms: [],
        openQuestions: [],
      },
    });

  it('article: Turkish "470.000" and "470 binden fazla" are grounded by "over 470,000 rollouts"', () => {
    const content = validateArticle(
      articleWith(ROLLOUTS_ARTICLE_TR),
      groundingSourcesOf(rollouts()),
    );
    expect(content.sections.find((s) => s.key === 'evidence')!.body).toBe(ROLLOUTS_ARTICLE_TR);
  });

  it('article: a standalone "470" is a different quantity and is rejected with its location', () => {
    let message = '';
    try {
      validateArticle(
        articleWith('Yazarlar 470 deneme koşusunu değerlendiriyor.'),
        groundingSourcesOf(rollouts()),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(PublicationError);
      expect((error as PublicationError).kind).toBe('VALIDATION_FAILED');
      message = (error as Error).message;
    }
    expect(message).toBe(
      'Article output invalid: numbers not present in the analysis/abstract: 470 ' +
        '[sections[evidence].body: "Yazarlar 470 deneme koşusunu değerlendiriyor."]',
    );
  });

  it('article: decimal and range equivalence, but no invented values', () => {
    const sources = groundingSourcesOf(rollouts());
    expect(() => validateArticle(articleWith('Ortalama hata 4,2 puan.'), sources)).not.toThrow();
    expect(() => validateArticle(articleWith('Ortalama hata 4.200 puan.'), sources)).toThrow(
      /numbers not present in the analysis\/abstract: 4\.200 /,
    );
    expect(() =>
      validateArticle(articleWith('Konum hatası %75 azaldı.'), groundingSourcesOf(view())),
    ).toThrow(/numbers not present.*: 75 \[sections\[evidence\]\.body/);
    expect(() =>
      validateArticle(articleWith('Konum hatası %15–60 azaldı.'), groundingSourcesOf(view())),
    ).not.toThrow();
  });

  it('numeric equivalence does not bypass the unreported-combination check', () => {
    // "on kombinasyonun dokuzunda" is grounded by value; the conclusion about the tenth is not.
    expect(() =>
      validateArticle(
        articleWith(`${REPORTED} ${NINE_OF_TEN_UNSUPPORTED_TR}`),
        groundingSourcesOf(view()),
      ),
    ).toThrow(/9\/10 reported/);
  });

  it('outlook: Turkish forms are compared by value; citation keys are not numbers', () => {
    const base = cannedOutlook(['P1']);
    const report = validateOutlook(
      {
        ...base,
        evidence: [
          { statement: 'Yazarlar 470 binden fazla koşu değerlendiriyor.', paperKeys: ['P1'] },
        ],
      },
      [{ paperKey: 'P1', view: rollouts() }],
      { fingerprint: 'f'.repeat(64), model: 'claude-sonnet-5-5' },
    );
    expect(report.evidence[0].statement).toContain('470 binden');
    expect(() =>
      validateOutlook(
        {
          ...base,
          evidence: [{ statement: 'Yazarlar 470 koşu değerlendiriyor.', paperKeys: ['P1'] }],
        },
        [{ paperKey: 'P1', view: rollouts() }],
        { fingerprint: 'f'.repeat(64), model: 'claude-sonnet-5-5' },
      ),
    ).toThrow(/numbers not present in the analyses: 470 \[evidence\[0\]\.statement:/);
  });
});

describe('dimension vs billion: the 2026-11-28 retry failure ("3B" = üç boyutlu)', () => {
  const gripper = (abstract: string): ResearchPaperView =>
    view({
      title: GRIPPER_TITLE,
      abstract,
      analysis: {
        summary: 'Language models predict 3D gripper poses poorly, even with extended reasoning.',
        problem: 'Spatial grasp reasoning by language models is weak.',
        priorApproach: 'The abstract compares against geometric baselines.',
        contribution: 'An evaluation of grasp-pose prediction by language models.',
        methods: 'Models predict gripper poses from scene descriptions.',
        findings: [
          {
            statement: 'Extended reasoning does not make the predicted poses accurate.',
            evidence: 'Stated in the abstract.',
          },
        ],
        limitations: ['Abstract only.'],
        keyTerms: [],
        openQuestions: [],
      },
    });
  const withProblem = (body: string) => {
    const data = cannedArticle('Dil modelleri kavramada zorlanıyor');
    (data.sections as { key: string; body: string }[]).find((s) => s.key === 'problem')!.body =
      body;
    return data;
  };

  it('accepts the exact production sentence when the source says "3D gripper poses"', () => {
    const content = validateArticle(
      withProblem(GRIPPER_PROBLEM_TR),
      groundingSourcesOf(gripper(GRIPPER_ABSTRACT)),
    );
    expect(content.sections.find((s) => s.key === 'problem')!.body).toBe(GRIPPER_PROBLEM_TR);
  });

  it('still rejects "3B" when the source has no 3D evidence, with field and context', () => {
    const noDimension = GRIPPER_ABSTRACT.replace(/3D /g, '');
    const sources = groundingSourcesOf(gripper(noDimension));
    sources.numbers = sources.numbers.replace(/3D /g, ''); // the analysis says 3D as well
    expect(() => validateArticle(withProblem(GRIPPER_PROBLEM_TR), sources)).toThrow(
      'Article output invalid: numbers not present in the analysis/abstract: 3B ' +
        '[sections[problem].body: "…eri, genişletilmiş akıl yürütmeyle bile 3B gripper pozlarını zayıf tahmin ediyor."]',
    );
  });

  it('a 3D source does not license "3B parametre" (three billion parameters)', () => {
    expect(() =>
      validateArticle(
        withProblem('Model 3B parametreye sahip.'),
        groundingSourcesOf(gripper(GRIPPER_ABSTRACT)),
      ),
    ).toThrow(/numbers not present in the analysis\/abstract: 3B \[sections\[problem\]\.body/);
  });
});

describe('outlook-v2: single-study vs cross-study', () => {
  const meta = { fingerprint: 'f'.repeat(64), model: 'claude-sonnet-5-5' };
  const papers = (n: number): OutlookPaper[] =>
    Array.from({ length: n }, (_, i) => ({
      paperKey: `P${i + 1}`,
      view: view({ analysisId: `an-${i + 1}` }),
    }));
  const claim = (statement: string, paperKeys: string[]) => ({ statement, paperKeys });

  it('is a new prompt/schema version with explicit single and multi-paper instructions', () => {
    expect(OUTLOOK_PROMPT_VERSION).toBe('outlook-v2');
    expect(OUTLOOK_SCHEMA_VERSION).toBe(2);
    expect(OUTLOOK_SYSTEM_PROMPT).toContain('MOD: TEK_ÇALIŞMA');
    expect(OUTLOOK_SYSTEM_PROMPT).toContain('MOD: ÇOKLU_ÇALIŞMA');
    expect(OUTLOOK_SYSTEM_PROMPT).toMatch(/"Eğilim", "uzlaşı"/);
    expect(buildOutlookPrompt(papers(1), KnowledgeLevel.BEGINNER)).toMatch(/^MOD: TEK_ÇALIŞMA/);
    expect(buildOutlookPrompt(papers(3), KnowledgeLevel.BEGINNER)).toMatch(/^MOD: ÇOKLU_ÇALIŞMA/);
  });

  it('keeps a single-paper report compact and never shows cross-paper contrasts', () => {
    const many = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => claim(`${prefix} ${i + 1}.`, ['P1']));
    const base = cannedOutlook(['P1']);
    const academic = (base.academicOpportunities as Record<string, unknown>[])[0];
    const industry = (base.industryOpportunities as Record<string, unknown>[])[0];
    const report = validateOutlook(
      {
        ...base,
        evidence: [...many('Kaynak bulgusu', 5), claim('Kaynak bulgusu 1.', ['P1'])],
        inferences: many('Yorum', 4),
        contrasts: [claim('Uyuşma.', ['P1'])],
        academicOpportunities: [academic, academic, academic, academic],
        industryOpportunities: [industry, industry, industry],
        development: {
          direction: 'Yön.',
          uncertainties: ['b1', 'b2', 'b3', 'b4', 'b5'],
          falsifiers: ['f1', 'f2', 'f3'],
        },
      },
      papers(1),
      meta,
    );
    expect(report.mode).toBe('SINGLE_STUDY');
    expect(report.evidence).toHaveLength(3);
    expect(report.inferences).toHaveLength(2);
    expect(report.contrasts).toEqual([]);
    expect(report.academicOpportunities).toHaveLength(2);
    expect(report.industryOpportunities).toHaveLength(1);
    expect(report.development.uncertainties).toHaveLength(3);
    expect(report.development.falsifiers).toHaveLength(2);
    expect(report.insufficientEvidence.synthesis).toMatch(/tek bir çalışma/);
  });

  it('drops verbatim repeats across evidence and inferences', () => {
    const report = validateOutlook(
      {
        ...cannedOutlook(['P1', 'P2']),
        evidence: [claim('Aynı  cümle.', ['P1']), claim('aynı cümle.', ['P2'])],
        inferences: [claim('AYNI cümle.', ['P1', 'P2']), claim('Farklı yorum.', ['P1', 'P2'])],
      },
      papers(2),
      meta,
    );
    expect(report.evidence.map((c) => c.statement)).toEqual(['Aynı  cümle.']);
    expect(report.inferences.map((c) => c.statement)).toEqual(['Farklı yorum.']);
  });

  it('requires a real cross-study synthesis and two-paper contrasts for multi-paper issues', () => {
    expect(() =>
      validateOutlook(
        { ...cannedOutlook(['P1', 'P2']), synthesis: claim('Tek kaynak.', ['P1']) },
        papers(2),
        meta,
      ),
    ).toThrow(/cross-study synthesis must cite at least two papers/);
    const report = validateOutlook(
      {
        ...cannedOutlook(['P1', 'P2']),
        contrasts: [claim('İkisi de bildiriyor.', ['P1', 'P2']), claim('Tek.', ['P2'])],
      },
      papers(2),
      meta,
    );
    expect(report.mode).toBe('CROSS_STUDY');
    expect(report.contrasts).toEqual([claim('İkisi de bildiriyor.', ['P1', 'P2'])]);
  });

  it('rejects the nine-of-ten absence inference in the Ufuk Raporu too', () => {
    expect(() =>
      validateOutlook(
        {
          ...cannedOutlook(['P1']),
          evidence: [claim(`${REPORTED} ${NINE_OF_TEN_UNSUPPORTED_TR}`, ['P1'])],
        },
        papers(1),
        meta,
      ),
    ).toThrow(/sources do not report \(9\/10 reported\)/);
  });
});
