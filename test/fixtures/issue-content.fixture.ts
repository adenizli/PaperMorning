import { ContentCoverage, PublicationStatus } from '../../src/common/enum/research.enum';
import { KnowledgeLevel, TopicPriority } from '../../src/domain/account';
import type {
  IssueArticle,
  IssueContentModel,
} from '../../src/domain/publication/model/issue-content.model';

const LONG_URL = `https://example.org/${'çok-uzun-bir-yol/'.repeat(12)}makale?doi=10.1000/${'x'.repeat(80)}`;
const TURKISH = 'Çalışmanın ışığında: ğüşıöç ĞÜŞİÖÇ — şimdiye kadar ölçülen en düşük gürültü.';

function article(index: number, overrides: Partial<IssueArticle> = {}): IssueArticle {
  const key = `a${index}`;
  return {
    key,
    paperKey: `P${index}`,
    role: index === 1 ? 'COVER' : index <= 3 ? 'FEATURE' : 'BRIEF',
    topicKey: index % 2 ? 'robotics' : 'quantum-physics',
    topicLabel: index % 2 ? 'Robotik' : 'Kuantum fiziği',
    priority: TopicPriority.HIGH,
    knowledgeLevel: KnowledgeLevel.BEGINNER,
    headline: `Başlık ${index}: Robotlar ışığı nasıl görüyor?`,
    dek: `${TURKISH} (yazı ${index})`,
    whyItMatters:
      'Daha az enerjiyle öğrenen robotlar, laboratuvar dışına çıkmayı kolaylaştırabilir.',
    sections: (['problem', 'before', 'new', 'evidence', 'limits'] as const).map((sectionKey) => ({
      key: sectionKey,
      heading: `${sectionKey} başlığı`,
      body: `${TURKISH} ${'Bu bölüm uzun bir paragraf içerir ve sayfa kırılmalarını sınar. '.repeat(index === 1 ? 25 : 4)}`,
    })),
    glossary: [{ term: 'pekiştirmeli öğrenme', explanation: 'Deneme-yanılma ile öğrenme.' }],
    source: {
      title: `Kaynak makale ${index}`,
      authors: ['Ayşe Yılmaz', 'Çağrı Öztürk', 'J. Doe'],
      publishedAt: '2026-11-20',
      venue: 'arXiv',
      publicationStatus: index === 2 ? PublicationStatus.PEER_REVIEWED : PublicationStatus.PREPRINT,
      coverage: ContentCoverage.ABSTRACT_ONLY,
      references: [
        {
          kind: 'LANDING',
          label: 'Kaynak sayfa',
          url: `https://arxiv.org/abs/2611.0000${index}v1`,
        },
        { kind: 'DOI', label: 'DOI', url: `https://doi.org/10.1000/test.${index}` },
        ...(index === 1 ? [{ kind: 'PDF' as const, label: 'Uzun bağlantı', url: LONG_URL }] : []),
      ],
    },
    provenance: {
      analysisId: `an-${index}`,
      variantId: `var-${index}`,
      paperId: `p-${index}`,
      paperVersionId: `v-${index}`,
    },
    ...overrides,
  };
}

export function issueContentFixture(overrides: Partial<IssueContentModel> = {}): IssueContentModel {
  const articles = [1, 2, 3, 4].map((i) => article(i));
  return {
    schemaVersion: 1,
    publicationName: 'PaperMorning',
    issueDate: '2026-11-24',
    issueNumber: 7,
    language: 'tr',
    generatedAt: '2026-11-24T03:00:00.000Z',
    cover: { headline: articles[0].headline, dek: articles[0].dek, articleKey: 'a1' },
    intro: 'Bu sayıda 4 araştırma var (Robotik, Kuantum fiziği).',
    toc: [
      ...articles.map((a) => ({ key: a.key, title: a.headline, kind: 'ARTICLE' as const })),
      {
        key: 'outlook',
        title: 'Ufuk Raporu — Araştırma ve Uygulama Fırsatları',
        kind: 'OUTLOOK' as const,
      },
    ],
    articles,
    outlook: {
      fingerprint: 'f'.repeat(64),
      title: 'Ufuk Raporu — Araştırma ve Uygulama Fırsatları',
      synthesis: {
        statement: 'İki çalışma verimli öğrenmeye işaret ediyor.',
        paperKeys: ['P1', 'P2'],
      },
      evidence: [{ statement: 'P1 daha düşük hesaplama maliyeti bildiriyor.', paperKeys: ['P1'] }],
      inferences: [
        { statement: 'Eğilim farklı görevlere genellenebilir.', paperKeys: ['P1', 'P2'] },
      ],
      academicOpportunities: [
        {
          question: 'Kazanç korunuyor mu?',
          hypothesis: 'Görev çeşitliliği kazancı azaltır.',
          firstExperiment: 'Eşit bütçeli karşılaştırma.',
          metrics: ['başarı oranı'],
          risks: 'Tek veri kümesi.',
          paperKeys: ['P1'],
        },
      ],
      industryOpportunities: [
        {
          idea: 'Depo pilotu',
          need: 'Maliyet',
          pilot: 'Tek görev',
          metrics: ['hata oranı'],
          barriers: ['güvenlik'],
          maturity: 'RESEARCH',
          paperKeys: ['P2'],
        },
      ],
      development: {
        direction: 'Verimlilik odaklı yöntemler güçleniyor.',
        uncertainties: ['Ölçek belirsiz.'],
        falsifiers: ['Bağımsız tekrar başarısız olursa.'],
      },
      nextStep: { action: 'Küçük bir karşılaştırma yapın.', measure: 'Görev başarı oranı' },
      insufficientEvidence: { academic: null, industry: null, synthesis: null },
      teaser: 'Aynı bütçeyle tekrarlanabilir bir verimlilik karşılaştırması.',
      model: 'claude-sonnet-5-5',
      promptVersion: 'outlook-v1',
    },
    editorialNotes: ['Bu sayıdaki analizler yalnızca makale özetlerine dayanır.'],
    ...overrides,
  };
}

export { LONG_URL, TURKISH };
