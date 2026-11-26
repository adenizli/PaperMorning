import { findTopic } from '../../../src/common/topic/topic-catalog';
import { findUnsupportedNumbers } from '../../../src/common/text/numeric-claims';
import { canonicalJson, fingerprint } from '../../../src/common/text/fingerprint';
import {
  ABSTRACT_ONLY_LIMITATION,
  AnalysisValidationError,
  validateAnalysisOutput,
} from '../../../src/domain/research/service/analysis-output.validator';
import { analysisFingerprint } from '../../../src/domain/research/service/paper-analysis.service';
import { scoreByRules } from '../../../src/domain/research/service/paper-screening.service';
import { contentFingerprintOf } from '../../../src/domain/research/service/research-discovery.service';
import { cannedAnalysis } from '../../support/fake-anthropic';

const robotics = findTopic('robotics')!;
const longAbstract = (text: string) => `${text} ${'Additional context sentence. '.repeat(5)}`;

describe('rule screening', () => {
  it('accepts on category or title signals', () => {
    const result = scoreByRules(robotics, {
      title: 'A robot that folds laundry',
      abstract: longAbstract('We study folding.'),
      categories: [],
    });
    expect(result.verdict).toBe('ACCEPT');
    expect(
      scoreByRules(robotics, { title: 'X', abstract: longAbstract('Y'), categories: ['cs.RO'] })
        .verdict,
    ).toBe('ACCEPT');
  });

  it('marks a single weak abstract mention as ambiguous rather than discarding it', () => {
    const result = scoreByRules(robotics, {
      title: 'Materials study',
      abstract: longAbstract('Useful for manipulation of soft objects.'),
      categories: [],
    });
    expect(result.verdict).toBe('AMBIGUOUS');
  });

  it('rejects papers without a usable abstract and without signals', () => {
    expect(
      scoreByRules(robotics, { title: 'robot', abstract: null, categories: ['cs.RO'] }).verdict,
    ).toBe('REJECT');
    expect(
      scoreByRules(robotics, {
        title: 'Cell biology',
        abstract: longAbstract('Proteins.'),
        categories: [],
      }).verdict,
    ).toBe('REJECT');
  });
});

describe('numeric claim guard', () => {
  it('flags numbers absent from the source, tolerating small integers and years', () => {
    const source = 'On 12 tasks it reduces compute by 35% (p=0.01).';
    expect(
      findUnsupportedNumbers('Saved 35% on 12 tasks in 2026 with 3 seeds; p=0.01', source),
    ).toEqual([]);
    expect(findUnsupportedNumbers('A 47% improvement', source)).toEqual(['47']);
  });
});

describe('fingerprints', () => {
  it('are stable under key order and differ on content change', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(contentFingerprintOf('Title', 'Some  abstract.')).toBe(
      contentFingerprintOf('title', 'some abstract'),
    );
    expect(contentFingerprintOf('Title', 'abstract v2')).not.toBe(
      contentFingerprintOf('Title', 'abstract v1'),
    );
  });
});

describe('analysis output validation', () => {
  const source = 'Scalable robot learning. On 12 tasks it reduces compute by 35%.';

  it('accepts schema-valid output and marks abstract-only coverage as a limitation', () => {
    const content = validateAnalysisOutput(cannedAnalysis(), source, true);
    expect(content.limitations[0]).toBe(ABSTRACT_ONLY_LIMITATION);
    expect(content.findings).toHaveLength(1);
  });

  it('rejects invented numbers', () => {
    const data = cannedAnalysis({
      findings: [{ statement: 'Improves by 48%', evidence: 'abstract' }],
    });
    expect(() => validateAnalysisOutput(data, source, true)).toThrow(/Numbers not present.*48/);
  });

  it('rejects structurally incomplete output', () => {
    expect(() =>
      validateAnalysisOutput({ ...cannedAnalysis(), problem: ' ' }, source, true),
    ).toThrow(AnalysisValidationError);
    expect(() =>
      validateAnalysisOutput({ ...cannedAnalysis(), findings: [] }, source, true),
    ).toThrow(/findings/);
    expect(() => validateAnalysisOutput('text', source, true)).toThrow(/not an object/);
  });
});

describe('analysis fingerprint invalidation', () => {
  const version = {
    id: 'v1',
    contentFingerprint: 'c1',
    publicationStatus: 'PREPRINT',
    contentCoverage: 'ABSTRACT_ONLY',
  } as const;
  const config = { model: 'claude-sonnet-5-5', promptVersion: 'analysis-v1', schemaVersion: 1 };
  const base = analysisFingerprint(version as never, config);

  it.each([
    ['new version', { ...version, id: 'v2' }, config],
    ['new content', { ...version, contentFingerprint: 'c2' }, config],
    ['new coverage', { ...version, contentCoverage: 'FULL_TEXT' }, config],
    ['model change', version, { ...config, model: 'other' }],
    ['prompt change', version, { ...config, promptVersion: 'analysis-v2' }],
    ['schema change', version, { ...config, schemaVersion: 2 }],
  ])('changes on %s', (_label, v, c) => {
    expect(analysisFingerprint(v as never, c)).not.toBe(base);
  });

  it('is stable for identical input', () => {
    expect(analysisFingerprint({ ...version } as never, { ...config })).toBe(base);
  });
});
