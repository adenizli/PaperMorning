import { ContentCoverage, PublicationStatus } from '../../src/common/enum/research.enum';
import { KnowledgeLevel, TopicPriority } from '../../src/domain/account';
import type {
  ArticleRole,
  IssueArticle,
  IssueContentModel,
} from '../../src/domain/publication/model/issue-content.model';
import type { OutlookReportModel } from '../../src/domain/publication/model/outlook-report.model';
import { NINE_OF_TEN_TITLE } from './nine-of-ten.fixture';

/**
 * Print-layout fixtures sized like real issues. `firstIssueLike()` approximates the volume of the
 * first published issue (2026-11-26: one robotics paper, a long v1 Ufuk Raporu) that rendered to
 * nine pages with issue-print-v1. Text is representative, not a copy of the published issue.
 */

const SECTIONS: Record<string, [string, string]> = {
  problem: [
    'Araştırmacılar hangi sorunu çözmeye çalıştı?',
    'Çevik dört rotorlu insansız hava araçları (quadrotor) yüksek hızda uçarken, fizik yasalarından türetilen klasik dinamik modeller aerodinamik etkileri — rotorların birbirini etkileyen hava akımı, gövde sürüklemesi, hızla değişen itki — yeterince yakalayamıyor. Model öngörülü kontrol (MPC) gibi yöntemler doğru bir modele dayandığı için bu eksiklik doğrudan izleme hatasına dönüşüyor.\nYazarlar, fizik modelini atmadan onun üzerine öğrenilmiş bir “artık” (residual) dinamik modeli ekleyerek bu boşluğu kapatmayı hedefliyor.',
  ],
  before: [
    'Önceki yaklaşımlar ne yapıyordu?',
    'Özet, önceki öğrenme tabanlı yaklaşımları ayrıntılı anlatmıyor. Genel çerçevede iki uç biliniyor: tamamen fizik tabanlı modeller yorumlanabilir ve veri gerektirmez ama yüksek hızda yanılır; tamamen öğrenilmiş modeller esnektir ama çok veri ister ve kontrol döngüsünde güvenilirliği zor kanıtlanır. Çalışmanın bu iki ucu nasıl karşılaştırdığı özette belirtilmiyor.',
  ],
  new: [
    'Bu çalışmanın katkısı ne?',
    'Katkı, öğrenilmiş artık modeli doğrudan MPC içinde, gerçek zamanlı olarak kullanmak. Böylece denetleyici, fizik modelinin öngördüğü hareket ile gerçekte gözlenen hareket arasındaki farkı her adımda hesaba katabiliyor. Yazarlar modelin araç üzerindeki bilgisayarda gerçek zamanlı çalıştığını bildiriyor.',
  ],
  evidence: [
    'Ne yaptılar, ne buldular?',
    'Yöntem iki farklı quadrotor platformunda ve beş referans yörüngede, yani toplam on kombinasyonda sınanmış. Yazarlar, nominal fizik modeline göre konum RMSE değerinin on kombinasyonun dokuzunda %15–60 arasında azaldığını bildiriyor. Kalan bir kombinasyonun sonucu özette belirtilmiyor.\nKarşılaştırma tabanı nominal model; tekrar sayısı, uçuş süresi ve ölçüm koşulları özette tanımlanmıyor. Bu nedenle %15–60 aralığı, özette belirtilen koşullar için geçerli bir bildirimdir.',
  ],
  limits: [
    'Sınırlar ve açık sorular',
    'Bu yazı yalnızca makalenin özetine dayanıyor; tam metin, şekiller ve tablolar incelenmedi. Çalışma bir ön baskı, yani henüz hakem değerlendirmesinden geçmedi. Öğrenilen modelin eğitim verisinin dışına çıkan manevralarda nasıl davrandığı ve kontrol döngüsünde kararlılık güvencesi özette ele alınmıyor. PaperMorning’in yorumu: sonuçlar umut verici olsa da farklı rüzgâr koşullarında ve daha fazla platformda tekrar edilmeden genelleme yapılmamalı.',
  ],
};

function robotics(key: string, paperKey: string, role: ArticleRole, n: number): IssueArticle {
  return {
    key,
    paperKey,
    role,
    topicKey: 'robotics',
    topicLabel: 'Robotik',
    priority: TopicPriority.HIGH,
    knowledgeLevel: KnowledgeLevel.INTERMEDIATE,
    headline:
      n === 1
        ? 'Fizik modeline öğrenilmiş bir “düzeltme” eklemek, çevik drone uçuşunda hatayı azaltabilir'
        : `Çalışma ${n}: Öğrenilmiş artık modeller farklı robot platformlarında sınanıyor`,
    dek: 'Yazarlar, iki platform ve beş yörüngeden oluşan on kombinasyonun dokuzunda konum hatasında %15–60 azalma bildiriyor; çalışma henüz hakemsiz bir ön baskı.',
    whyItMatters:
      'Hızlı ve hassas uçuş; arama-kurtarma, denetim ve teslimat gibi uygulamalarda güvenlik payını belirler. Fizik bilgisini koruyan bir öğrenme yaklaşımı, tamamen veri odaklı modellere göre daha az veriyle güvenilir sonuç verebilir — bu PaperMorning’in yorumudur.',
    sections: (['problem', 'before', 'new', 'evidence', 'limits'] as const).map((k) => ({
      key: k,
      heading: SECTIONS[k][0],
      body: SECTIONS[k][1],
    })),
    glossary: [
      {
        term: 'MPC (model öngörülü kontrol)',
        explanation:
          'Gelecekteki hareketi bir modelle tahmin edip her adımda en iyi komutu seçen kontrol yöntemi.',
      },
      {
        term: 'Artık (residual) model',
        explanation:
          'Fizik modelinin tahmini ile gerçek hareket arasındaki farkı öğrenen ek model.',
      },
      {
        term: 'RMSE',
        explanation:
          'Hataların karelerinin ortalamasının karekökü; büyük hataları daha çok cezalandırır.',
      },
      { term: 'Quadrotor', explanation: 'Dört rotorlu insansız hava aracı.' },
      {
        term: 'Ön baskı (preprint)',
        explanation: 'Hakem değerlendirmesinden önce paylaşılan makale sürümü.',
      },
    ],
    source: {
      title: n === 1 ? NINE_OF_TEN_TITLE : `${NINE_OF_TEN_TITLE} (companion study ${n})`,
      authors: [
        'Ayşe Yılmaz',
        'Çağrı Öztürk',
        'Jane Doe',
        'Şebnem İnce',
        'Ömer Güneş',
        'Li Wei',
        'R. Roe',
      ],
      publishedAt: '2026-11-20',
      venue: 'arXiv',
      publicationStatus: PublicationStatus.PREPRINT,
      coverage: ContentCoverage.ABSTRACT_ONLY,
      references: [
        {
          kind: 'LANDING',
          label: 'arXiv sayfası',
          url: `https://arxiv.org/abs/2611.1${String(n).padStart(4, '0')}v1`,
        },
        {
          kind: 'PDF',
          label: 'PDF',
          url: `https://arxiv.org/pdf/2611.1${String(n).padStart(4, '0')}v1`,
        },
        {
          kind: 'DOI',
          label: 'DOI',
          url: `https://doi.org/10.48550/arXiv.2611.1${String(n).padStart(4, '0')}`,
        },
      ],
    },
    provenance: {
      analysisId: `an-${n}`,
      variantId: `var-${n}`,
      paperId: `p-${n}`,
      paperVersionId: `v-${n}`,
    },
  };
}

const academic = (paperKeys: string[], i: number) => ({
  question: `Açık soru ${i}: Kazanım rüzgâr ve yük değişimlerinde korunuyor mu?`,
  hypothesis:
    'Artık model, eğitim dağılımı dışındaki rüzgâr koşullarında kazanımının bir kısmını kaybeder.',
  firstExperiment:
    'Aynı platformda kontrollü bir fan ile üç rüzgâr düzeyinde nominal ve artık modelli MPC’yi karşılaştırmak.',
  metrics: ['konum RMSE', 'en büyük sapma', 'hesaplama süresi'],
  risks: 'Rüzgâr tünelinden sahaya geçişte farklı etkiler ortaya çıkabilir.',
  paperKeys,
});
const industry = (paperKeys: string[], i: number) => ({
  idea: `Pilot ${i}: Depo envanter dronlarında hassas konumlandırma`,
  need: 'Raf aralarında dar koridorlarda çarpışma riskini azaltmak.',
  pilot: 'Tek bir koridorda, sabit rotada, nominal model ile artık model karşılaştırması.',
  metrics: ['yol sapması', 'görev süresi', 'iniş hassasiyeti'],
  barriers: ['güvenlik onayı', 'veri toplama maliyeti', 'farklı drone modellerine uyarlama'],
  maturity: 'RESEARCH' as const,
  paperKeys,
});

function outlookV1Long(): OutlookReportModel {
  const p = ['P1'];
  return {
    fingerprint: 'a'.repeat(64),
    title: 'Ufuk Raporu — Araştırma ve Uygulama Fırsatları',
    synthesis: {
      statement:
        'Tek bir çalışma, fizik modeline öğrenilmiş bir düzeltme eklemenin çevik uçuşta izleme hatasını azaltabileceğini bildiriyor; genelleme için bağımsız tekrarlar gerekiyor.',
      paperKeys: p,
    },
    evidence: [1, 2, 3, 4].map((i) => ({
      statement: `Kaynak bulgusu ${i}: Yazarlar on kombinasyonun dokuzunda konum RMSE değerinde %15–60 azalma bildiriyor; model araç üzerindeki bilgisayarda gerçek zamanlı çalışıyor.`,
      paperKeys: p,
    })),
    inferences: [1, 2, 3].map((i) => ({
      statement: `Yorum ${i}: Fizik bilgisini koruyan hibrit modeller, tamamen öğrenilmiş modellere göre daha az veriyle güvenilir olabilir; bu bir hipotezdir.`,
      paperKeys: p,
    })),
    academicOpportunities: [1, 2, 3].map((i) => academic(p, i)),
    industryOpportunities: [1, 2, 3].map((i) => industry(p, i)),
    development: {
      direction:
        'Hibrit (fizik + öğrenme) modeller çevik robotik kontrolde güçlenen bir seçenek olabilir; bu, tek çalışmaya dayanan bir yorumdur.',
      uncertainties: [
        'Sonuçlar yalnızca özete dayanıyor.',
        'Çalışma hakemsiz bir ön baskı.',
        'Kalan bir kombinasyonun sonucu bilinmiyor.',
        'Deney tekrar sayısı belirtilmemiş.',
        'Dış ortam koşulları belirtilmemiş.',
      ],
      falsifiers: [
        'Bağımsız tekrarlar kazanımı doğrulamazsa.',
        'Rüzgârlı ortamda kazanım kaybolursa.',
        'Hesaplama yükü gerçek zamanlılığı bozarsa.',
      ],
    },
    nextStep: {
      action: 'Kendi platformunuzda nominal modelin izleme hatasını beş referans yörüngede ölçün.',
      measure: 'Konum RMSE ve en büyük sapma',
    },
    insufficientEvidence: {
      academic: null,
      industry: null,
      synthesis:
        'Bu sayıda yalnızca tek bir çalışma bulunduğundan makaleler arası sentez kurulamadı; aşağıdaki değerlendirme tek kaynağa dayanır.',
    },
    teaser:
      'Fizik modeline öğrenilmiş bir düzeltme eklemek çevik drone uçuşunda hatayı azaltabilir.',
    model: 'claude-sonnet-5-5',
    promptVersion: 'outlook-v1',
  };
}

function outlookV2Single(): OutlookReportModel {
  const long = outlookV1Long();
  return {
    ...long,
    mode: 'SINGLE_STUDY',
    evidence: long.evidence.slice(0, 2),
    inferences: long.inferences.slice(0, 1),
    contrasts: [],
    academicOpportunities: long.academicOpportunities.slice(0, 2),
    industryOpportunities: long.industryOpportunities.slice(0, 1),
    development: {
      ...long.development,
      uncertainties: long.development.uncertainties.slice(0, 3),
      falsifiers: long.development.falsifiers.slice(0, 2),
    },
    promptVersion: 'outlook-v2',
  };
}

function base(
  articles: IssueArticle[],
  outlook: OutlookReportModel,
  schemaVersion: number,
): IssueContentModel {
  return {
    schemaVersion,
    publicationName: 'PaperMorning',
    issueDate: '2026-11-26',
    issueNumber: 1,
    language: 'tr',
    generatedAt: '2026-11-26T03:00:00.000Z',
    cover: { headline: articles[0].headline, dek: articles[0].dek, articleKey: articles[0].key },
    intro:
      articles.length === 1
        ? `Bu sayıda tek bir araştırma var (Robotik): “${articles[0].headline}”.`
        : `Bu sayıda ${articles.length} araştırma var (Robotik, Kuantum fiziği).`,
    toc: [
      ...articles.map((a) => ({ key: a.key, title: a.headline, kind: 'ARTICLE' as const })),
      { key: 'outlook', title: outlook.title, kind: 'OUTLOOK' as const },
    ],
    articles,
    outlook,
    editorialNotes: [
      'Ön baskı (preprint) olarak işaretlenen çalışmalar henüz hakem değerlendirmesinden geçmemiştir.',
      'Bu sayıdaki analizler yalnızca makale özetlerine ve yayın bilgilerine dayanır; tam metinler incelenmedi.',
      "Ufuk Raporu'ndaki yorum ve öneriler PaperMorning'in çıkarımıdır; kaynakların gösterdiği bulgulardan ayrı etiketlenmiştir.",
    ],
  };
}

/** Volume of the first published issue, schema v1 (as frozen on 2026-11-26). */
export function firstIssueLike(): IssueContentModel {
  return base([robotics('a1', 'P1', 'COVER', 1)], outlookV1Long(), 1);
}

/** The same paper as a new v2 issue: "not reported" list and a compact single-study report. */
export function singlePaperV2(): IssueContentModel {
  const article = robotics('a1', 'P1', 'COVER', 1);
  article.notReported = [
    'Kalan bir kombinasyonun sonucu özette belirtilmiyor.',
    'Deney tekrar sayısı ve uçuş süresi özette belirtilmiyor.',
    'Karşılaştırma tabanının ayarları özette tanımlanmıyor.',
  ];
  return base([article], outlookV2Single(), 2);
}

/** n papers: one cover story, up to two features, the rest briefs; cross-study report. */
export function multiPaperV2(n: number): IssueContentModel {
  const articles = Array.from({ length: n }, (_, i) => {
    const role: ArticleRole = i === 0 ? 'COVER' : i <= 2 ? 'FEATURE' : 'BRIEF';
    const a = robotics(`a${i + 1}`, `P${i + 1}`, role, i + 1);
    a.notReported = ['Deney tekrar sayısı özette belirtilmiyor.'];
    return a;
  });
  const keys = articles.map((a) => a.paperKey);
  const long = outlookV1Long();
  const outlook: OutlookReportModel = {
    ...long,
    mode: 'CROSS_STUDY',
    synthesis: {
      statement:
        'Çalışmalar, fizik bilgisini koruyan öğrenilmiş düzeltmelerin farklı platformlarda izleme hatasını azaltabildiğini bildiriyor; deney koşulları ise karşılaştırılabilir değil.',
      paperKeys: keys.slice(0, 2),
    },
    evidence: keys.slice(0, 4).map((k) => ({
      statement: `${k}: yazarlar nominal modele göre daha düşük izleme hatası bildiriyor.`,
      paperKeys: [k],
    })),
    inferences: long.inferences.slice(0, 2).map((c) => ({ ...c, paperKeys: keys.slice(0, 2) })),
    contrasts: [
      {
        statement:
          'P1 ve P2 aynı yönde sonuç bildiriyor, ancak farklı karşılaştırma tabanları kullanıyor.',
        paperKeys: keys.slice(0, 2),
      },
      {
        statement: 'Gerçek zamanlılık iddiası yalnızca bazı çalışmalarda ölçülmüş.',
        paperKeys: keys.slice(0, 2),
      },
    ],
    academicOpportunities: [academic(keys.slice(0, 2), 1), academic(keys.slice(0, 2), 2)],
    industryOpportunities: [industry(keys.slice(0, 2), 1)],
    insufficientEvidence: { academic: null, industry: null, synthesis: null },
    promptVersion: 'outlook-v2',
  };
  return base(articles, outlook, 2);
}
