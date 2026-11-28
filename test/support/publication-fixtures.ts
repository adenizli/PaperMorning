import { INestApplication } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { findTopic } from '../../src/common/topic/topic-catalog';
import { KnowledgeLevel, TopicPriority } from '../../src/domain/account';
import { AccountService } from '../../src/domain/account/service/account.service';
import { PreferenceService } from '../../src/domain/account/service/preference.service';
import { PaperAnalysisService } from '../../src/domain/research/service/paper-analysis.service';
import { PaperScreeningService } from '../../src/domain/research/service/paper-screening.service';
import { ResearchDiscoveryService } from '../../src/domain/research/service/research-discovery.service';
import { cannedAnalysis, FakeResponse } from './fake-anthropic';
import { academicRecord } from './research-fixtures';

export type TaskName = 'ANALYSIS' | 'ARTICLE' | 'OUTLOOK' | 'SCREENING';

export function taskOf(params: Anthropic.MessageCreateParamsNonStreaming): TaskName {
  const system = typeof params.system === 'string' ? params.system : JSON.stringify(params.system);
  if (system.startsWith('You are a careful scientific analyst')) return 'ANALYSIS';
  if (system.includes('Ufuk Raporu')) return 'OUTLOOK';
  if (system.startsWith('Sen PaperMorning adlı')) return 'ARTICLE';
  return 'SCREENING';
}

export function cannedArticle(
  headline = 'Robotlar daha az hesapla öğreniyor',
): Record<string, unknown> {
  return {
    headline,
    dek: 'Yeni yöntem eğitim maliyetini düşürüyor; sonuç şimdilik ön baskı düzeyinde.',
    whyItMatters: 'Daha ucuz eğitim, robot öğrenimini daha fazla laboratuvara açabilir.',
    sections: [
      { key: 'problem', heading: 'Sorun', body: 'Robot eğitimi pahalı.' },
      {
        key: 'before',
        heading: 'Önceki durum',
        body: 'Özet önceki yaklaşımı ayrıntılı anlatmıyor.',
      },
      { key: 'new', heading: 'Yenilik', body: 'Yeni bir eğitim prosedürü.' },
      {
        key: 'evidence',
        heading: 'Kanıt',
        body: 'Özetteki karşılaştırma bir iyileşme bildiriyor.',
      },
      {
        key: 'limits',
        heading: 'Sınırlar',
        body: 'Analiz yalnızca özete dayanıyor; çalışma hakemsiz bir ön baskı.',
      },
    ],
    glossary: [{ term: 'pekiştirmeli öğrenme', explanation: 'Deneme-yanılma ile öğrenme.' }],
  };
}

export function cannedOutlook(
  paperKeys: string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const keys = paperKeys.length > 0 ? paperKeys : ['P1'];
  return {
    synthesis: { statement: 'Çalışmalar daha verimli öğrenmeye işaret ediyor.', paperKeys: keys },
    evidence: [
      { statement: 'Yazarlar daha düşük hesaplama maliyeti bildiriyor.', paperKeys: [keys[0]] },
    ],
    inferences: [
      { statement: 'Bu eğilim farklı görevlerde de geçerli olabilir.', paperKeys: keys },
    ],
    academicOpportunities: [
      {
        question: 'Kazanç farklı ortamlarda korunuyor mu?',
        hypothesis: 'Verimlilik kazancı görev çeşitliliğiyle azalır.',
        firstExperiment: 'Aynı bütçeyle tekrarlanabilir bir karşılaştırma kurmak.',
        metrics: ['başarı oranı', 'toplam hesaplama'],
        risks: 'Laboratuvar sonuçları sahaya taşınmayabilir.',
        paperKeys: [keys[0]],
      },
    ],
    industryOpportunities: [
      {
        idea: 'Depo robotlarında küçük bir pilot',
        need: 'Eğitim maliyetini azaltmak',
        pilot: 'Tek bir görevde kontrollü deneme',
        metrics: ['gecikme', 'hata oranı'],
        barriers: ['güvenlik', 'entegrasyon maliyeti'],
        maturity: 'RESEARCH',
        paperKeys: [keys[0]],
      },
    ],
    development: {
      direction: 'Verimlilik odaklı yöntemler güçleniyor.',
      uncertainties: ['Ölçek belirsiz.'],
      falsifiers: ['Bağımsız tekrar başarısız olursa.'],
    },
    nextStep: {
      action: 'Küçük bir iş yükünde karşılaştırma yapın.',
      measure: 'Görev başarı oranı',
    },
    insufficientEvidence: { academic: null, industry: null, synthesis: null },
    teaser: 'En güçlü fikir: aynı bütçeyle tekrarlanabilir bir verimlilik karşılaştırması.',
    ...overrides,
  };
}

/** Fake Claude that answers every PaperMorning task with schema-valid canned output. */
export function routingHandler(
  overrides: Partial<
    Record<TaskName, (params: Anthropic.MessageCreateParamsNonStreaming) => FakeResponse>
  > = {},
) {
  return (params: Anthropic.MessageCreateParamsNonStreaming): FakeResponse => {
    const task = taskOf(params);
    if (overrides[task]) return overrides[task](params);
    const prompt = JSON.stringify(params.messages);
    switch (task) {
      case 'ANALYSIS':
        return { data: cannedAnalysis() };
      case 'ARTICLE':
        return { data: cannedArticle() };
      case 'OUTLOOK':
        return {
          data: cannedOutlook([
            ...new Set([...prompt.matchAll(/\\"paperKey\\": \\"(P\d+)\\"/g)].map((m) => m[1])),
          ]),
        };
      default:
        return { data: { relevant: true, relevanceScore: 0.5, reason: 'relevant' } };
    }
  };
}

let counter = 0;

/** Real Research pipeline (discovery -> screening -> analysis) for one paper on one topic. */
export async function seedAnalyzedPaper(
  app: INestApplication,
  topicKey: string,
  overrides: { title?: string; publishedAt?: string; abstractSuffix?: string } = {},
): Promise<{ versionId: string; analysisId: string; paperId: string }> {
  counter++;
  const topic = findTopic(topicKey)!;
  const id = `2611.${String(10000 + counter)}`;
  const { version } = await app.get(ResearchDiscoveryService).storeRecord(
    academicRecord({
      sourceRecordId: `${id}v1`,
      arxivId: id,
      title: overrides.title ?? `${topic.keywords[0]} study ${counter}`,
      categories: topic.arxivCategories,
      publishedAt: overrides.publishedAt ?? '2026-11-20',
      landingUrl: `https://arxiv.org/abs/${id}v1`,
      abstract: `We study ${topic.keywords[0]} in setting ${counter}. On 12 tasks it reduces training compute by 35% compared with a strong baseline while matching success rates.${overrides.abstractSuffix ?? ''}`,
    }),
  );
  await app.get(PaperScreeningService).screen(topic, [version.id], 50);
  const outcome = await app.get(PaperAnalysisService).analyze(version.id);
  if (outcome.status !== 'COMPLETED')
    throw new Error(`seed analysis failed: ${JSON.stringify(outcome)}`);
  return { versionId: version.id, analysisId: outcome.analysis.id, paperId: version.paperId };
}

export async function createReader(
  app: INestApplication,
  username: string,
  topics: { topicKey: string; priority: TopicPriority; knowledgeLevel: KnowledgeLevel }[],
  options: { dailyEmailEnabled?: boolean; timezone?: string } = {},
): Promise<string> {
  const user = await app
    .get(AccountService)
    .register({ username, email: `${username}@example.org`, password: 'long-enough-password' });
  await app.get(PreferenceService).replaceForUser(user.id, {
    language: 'tr',
    timezone: options.timezone ?? 'Europe/Istanbul',
    dailyEmailEnabled: options.dailyEmailEnabled ?? false,
    topics,
  });
  return user.id;
}
