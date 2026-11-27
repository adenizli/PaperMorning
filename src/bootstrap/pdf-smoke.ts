import { ContentCoverage, PublicationStatus } from '../common/enum/research.enum';
import { AppConfig } from '../config/app.config';
import { KnowledgeLevel, TopicPriority } from '../domain/account';
import type { IssueContentModel } from '../domain/publication/model/issue-content.model';
import { validateIssueContent } from '../domain/publication/service/issue.service';
import { ISSUE_TEMPLATE_VERSION } from '../service/pdf/issue-html.template';
import { describeSandbox, PdfService } from '../service/pdf/pdf.service';

/** Text the smoke test expects to survive into the PDF (Turkish letters included). */
export const SMOKE_MARKER = 'PaperMorning PDF duman testi: çğıöşü ÇĞİÖŞÜ';
export const SMOKE_LINK = 'https://example.org/papermorning-smoke';

/**
 * Synthetic, clearly labelled snapshot for `pdf:smoke`: exercises the real renderer (Chromium,
 * fonts, links, both layout branches' shared parts) without a database, Claude or storage.
 */
export function smokeSnapshot(): IssueContentModel {
  const body = `${SMOKE_MARKER}. Bu içerik yapay bir test metnidir; gerçek bir araştırmayı anlatmaz.`;
  return {
    schemaVersion: 2,
    publicationName: 'PaperMorning',
    issueDate: '2000-01-01',
    issueNumber: 0,
    language: 'tr',
    generatedAt: '2000-01-01T00:00:00.000Z',
    cover: { headline: 'Duman testi', dek: body, articleKey: 'a1' },
    intro: body,
    toc: [
      { key: 'a1', title: 'Duman testi', kind: 'ARTICLE' },
      { key: 'outlook', title: 'Ufuk Raporu', kind: 'OUTLOOK' },
    ],
    articles: [
      {
        key: 'a1',
        paperKey: 'P1',
        role: 'COVER',
        topicKey: 'smoke',
        topicLabel: 'Test',
        priority: TopicPriority.HIGH,
        knowledgeLevel: KnowledgeLevel.BEGINNER,
        headline: 'Duman testi',
        dek: body,
        whyItMatters: body,
        sections: (['problem', 'before', 'new', 'evidence', 'limits'] as const).map((key) => ({
          key,
          heading: key,
          body,
        })),
        glossary: [],
        notReported: ['Bu bir test metnidir.'],
        source: {
          title: 'Synthetic smoke-test source',
          authors: ['PaperMorning'],
          publishedAt: '2000-01-01',
          venue: null,
          publicationStatus: PublicationStatus.UNKNOWN,
          coverage: ContentCoverage.ABSTRACT_ONLY,
          references: [{ kind: 'LANDING', label: 'Test bağlantısı', url: SMOKE_LINK }],
        },
        provenance: {
          analysisId: 'smoke',
          variantId: 'smoke',
          paperId: 'smoke',
          paperVersionId: 'smoke',
        },
      },
    ],
    outlook: {
      fingerprint: '0'.repeat(64),
      title: 'Ufuk Raporu',
      mode: 'SINGLE_STUDY',
      synthesis: { statement: body, paperKeys: ['P1'] },
      evidence: [{ statement: body, paperKeys: ['P1'] }],
      inferences: [],
      contrasts: [],
      academicOpportunities: [],
      industryOpportunities: [],
      development: { direction: body, uncertainties: ['Test.'], falsifiers: [] },
      nextStep: { action: 'Test.', measure: 'Test.' },
      insufficientEvidence: { academic: 'Test.', industry: 'Test.', synthesis: null },
      teaser: body,
      model: 'none',
      promptVersion: 'none',
    },
    editorialNotes: ['Yapay test içeriği; yayımlanmış bir sayı değildir.'],
  };
}

export interface PdfSmokeResult {
  outcome: 'OK' | 'FAILED';
  template: string;
  sandbox: string;
  durationMs: number;
  bytes?: number;
  pages?: number;
  error?: string;
}

/**
 * Container-compatible smoke test of the real PDF path: launches Chromium exactly as production
 * does (same sandbox setting, JavaScript off, network blocked), renders the synthetic snapshot and
 * checks the result is a complete PDF. Needs no database, no Claude and no storage.
 */
export async function runPdfSmoke(
  config: AppConfig,
  snapshot?: IssueContentModel,
): Promise<{ result: PdfSmokeResult; pdf?: Buffer }> {
  const started = Date.now();
  const base = { template: ISSUE_TEMPLATE_VERSION, sandbox: describeSandbox(config) };
  try {
    if (snapshot) validateIssueContent(snapshot);
    const pdf = await new PdfService(config).render(snapshot ?? smokeSnapshot(), {
      preview: {
        note: snapshot
          ? 'QA ÖNİZLEMESİ — dosyadan dizilmiş anlık görüntü; yayımlanmış sayı değildir.'
          : 'PDF duman testi — yapay içerik, yayımlanmış bir sayı değildir.',
      },
    });
    const raw = pdf.toString('latin1');
    if (!raw.startsWith('%PDF-') || !raw.slice(-1024).includes('%%EOF')) {
      throw new Error('renderer output is not a complete PDF');
    }
    const pages = raw.match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
    if (pages < 1) throw new Error('PDF has no pages');
    if (!snapshot && !raw.includes(SMOKE_LINK)) throw new Error('source link annotation missing');
    return {
      result: {
        outcome: 'OK',
        ...base,
        durationMs: Date.now() - started,
        bytes: pdf.length,
        pages,
      },
      pdf,
    };
  } catch (error) {
    return {
      result: {
        outcome: 'FAILED',
        ...base,
        durationMs: Date.now() - started,
        error: (error as Error).message,
      },
    };
  }
}
