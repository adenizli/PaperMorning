import {
  describeUnsupportedClaims,
  findUnsupportedNumericClaims,
  findUnsupportedNumbers,
  numericMentions,
  textFields,
} from '../../../src/common/text/numeric-claims';
import type { NumberLocale } from '../../../src/common/text/numeric-claims';

const NBSP = ' ';
const NNBSP = ' ';

const valuesOf = (text: string, locale: 'en' | 'tr' = 'en') =>
  numericMentions(text, locale).map((m) => m.value);

describe('numeric mentions are read by value', () => {
  it.each([
    ['Thirty-two studies', 32],
    ['thirty two studies', 32],
    ['THIRTY-TWO studies', 32],
    ['Ninety-nine runs', 99],
    ['one hundred and five seeds', 105],
    ['two hundred and fifty thousand frames', 250_000],
    ['Seventeen tasks', 17],
    ['three million steps', 3_000_000],
  ])('English words: %s -> %d', (text, value) => {
    expect(valuesOf(text)).toEqual([value]);
  });

  it('does not invent numbers from words that only look numeric', () => {
    expect(valuesOf('a hundred times; hundreds of tasks; one-shot; someone; often')).toEqual([1]);
    expect(valuesOf('one, two')).toEqual([1, 2]); // separate numbers, not 3
    expect(valuesOf('twenty thirty')).toEqual([20, 30]);
  });

  it.each([
    ['470,000', 'en', 470_000],
    ['470.000', 'tr', 470_000],
    ['470 bin', 'tr', 470_000],
    ['470 binden fazla', 'tr', 470_000],
    ['470 thousand', 'en', 470_000],
    ['470K rollouts', 'en', 470_000],
    ['470k rollouts', 'en', 470_000],
    [`470${NBSP}000`, 'tr', 470_000],
    [`470${NNBSP}000`, 'en', 470_000],
    ['1,234,567', 'en', 1_234_567],
    ['1.234.567', 'tr', 1_234_567],
    ['1,234.5', 'en', 1234.5],
    ['1.234,5', 'tr', 1234.5],
    ['42.8', 'en', 42.8],
    ['42,8', 'tr', 42.8],
    ['42.8', 'tr', 42.8], // a copied English decimal is still a decimal
    ['1.2', 'en', 1.2],
    ['1,2', 'tr', 1.2],
    ['1.2 million', 'en', 1_200_000],
    ['1,2 milyon', 'tr', 1_200_000],
    ['2 milyonluk', 'tr', 2_000_000],
    ['7B parameters', 'en', 7e9],
    ['7 milyar parametre', 'tr', 7e9],
    ['0,500', 'en', 0.5],
  ] as const)('%s (%s) -> %d', (text, locale, value) => {
    expect(valuesOf(text, locale)).toEqual([value]);
  });

  it('keeps locale conventions apart: "1.200" is 1.2 in English, 1200 in Turkish', () => {
    expect(valuesOf('1.200', 'en')).toEqual([1.2]);
    expect(valuesOf('1.200', 'tr')).toEqual([1200]);
    expect(valuesOf('1,200', 'en')).toEqual([1200]);
    expect(valuesOf('1,200', 'tr')).toEqual([1.2]);
  });

  it('does not read ordinary words as scale words', () => {
    expect(valuesOf('3 bina', 'tr')).toEqual([3]); // "bina" = building, not "bin"
    expect(valuesOf('5 binlerce', 'tr')).toEqual([5]);
    expect(valuesOf('8 thousands', 'en')).toEqual([8]);
    expect(valuesOf('5MB file', 'en')).toEqual([5]);
  });

  it('reads separators that fit no number format as non-quantities', () => {
    expect(valuesOf('version 1.2.3')).toEqual([null]);
  });
});

describe('numeric claims against a source', () => {
  it.each([
    ['Thirty-two studies met the inclusion criteria.', '32 studies were included.', 'en'],
    ['Thirty-two studies met the inclusion criteria.', 'thirty-two studies', 'en'],
    ['we evaluate over 470,000 rollouts', '470.000 koşu', 'tr'],
    ['we evaluate over 470,000 rollouts', '470 binden fazla koşu', 'tr'],
    ['we evaluate over 470,000 rollouts', '470 bin koşu', 'tr'],
    ['we evaluate over 470,000 rollouts', `470${NBSP}000 koşu`, 'tr'],
    ['we evaluate over 470,000 rollouts', '470 000 koşu', 'tr'],
    ['we evaluate over 470,000 rollouts', '470,000 rollouts (verbatim)', 'tr'],
    ['we evaluate over 470,000 rollouts', 'over 470 thousand rollouts', 'en'],
    ['we evaluate over 470,000 rollouts', '470K rollouts', 'en'],
    ['an error of 42.8%', 'hata %42,8', 'tr'],
    ['an error of 42.8%', 'hata %42.8', 'tr'],
    ['a 1.2 million-step run', '1,2 milyon adım', 'tr'],
    ['a 1.2 million-step run', '1.200.000 adım', 'tr'],
    ['reduces RMSE by 15–60%', 'RMSE %15–60 azalıyor', 'tr'],
    [
      'On 12 tasks it reduces compute by 35% (p=0.01).',
      'Saved 35% on 12 tasks in 2026 with 3 seeds; p=0.01',
      'en',
    ],
  ] as const)('accepts %j -> %j', (source, generated, locale) => {
    expect(findUnsupportedNumbers(generated, source, locale)).toEqual([]);
  });

  it.each([
    ['we evaluate over 470,000 rollouts', '470 koşu üzerinde', 'tr', '470'],
    ['we evaluate over 470,000 rollouts', 'over 470 rollouts', 'en', '470'],
    ['Thirty-two studies met the inclusion criteria.', '33 studies', 'en', '33'],
    [
      'Thirty-two studies met the inclusion criteria.',
      'thirty-three studies',
      'en',
      'thirty-three',
    ],
    ['32 studies', '33 studies', 'en', '33'],
    ['a latency of 1.2 ms', '1200 ms', 'en', '1200'],
    ['a latency of 1.2 ms', '1.200 ms', 'tr', '1.200'],
    ['a latency of 1.2 ms', '1,200 ms', 'en', '1,200'],
    ['a latency of 1.2 ms', '1,2 bin ms', 'tr', '1,2 bin'],
    ['reduces RMSE by 15–60%', 'RMSE %75 azalıyor', 'tr', '75'],
    ['reduces RMSE by 15–60%', 'RMSE drops 75%', 'en', '75'],
    ['an error of 42.8%', 'hata %42,9', 'tr', '42,9'],
    ['On 12 tasks it reduces compute by 35%.', 'A 47% improvement', 'en', '47'],
    ['five tasks', '5 bin görev', 'tr', '5 bin'], // scaled small numbers are claims
    ['five tasks', '2.000 görev', 'tr', '2.000'], // Turkish 2000 is not a "small integer"
    ['release 1.2.3', 'release 1.2.4', 'en', '1.2.4'],
  ] as const)('rejects %j -> %j', (source, generated, locale, unsupported) => {
    expect(findUnsupportedNumbers(generated, source, locale)).toEqual([unsupported]);
  });

  it('tolerates plain small integers and plain years only', () => {
    expect(findUnsupportedNumbers('3 seeds in 2026, version 1.2.3? no', 'release 1.2.3')).toEqual(
      [],
    );
    expect(findUnsupportedNumbers('seven seeds, eleven tasks', 'nothing')).toEqual(['eleven']);
  });
});

describe('diagnostics name the field and show nearby text', () => {
  it('labels structured paths, using an item key when it has one', () => {
    expect(
      textFields(
        {
          headline: 'H',
          sections: [{ key: 'evidence', body: 'B' }],
          findings: [{ statement: 'S' }],
          paperKeys: ['P1'],
        },
        new Set(['paperKeys']),
      ).map((f) => f.field),
    ).toEqual([
      'headline',
      'sections[evidence].key',
      'sections[evidence].body',
      'findings[0].statement',
    ]);
  });

  it('reports field, value and a bounded, single-line context', () => {
    const body = `${'a'.repeat(100)} over 470 rollouts\n\u0007in total ${'b'.repeat(100)}`;
    const claims = findUnsupportedNumericClaims(
      [
        { field: 'headline', text: 'Nothing numeric here' },
        { field: 'sections[evidence].body', text: body },
      ],
      'we evaluate over 470,000 rollouts',
      'tr',
    );
    expect(claims).toHaveLength(1);
    const [claim] = claims;
    expect(claim).toMatchObject({ field: 'sections[evidence].body', raw: '470' });
    expect(claim.context).toContain('over 470 rollouts in total');
    expect(claim.context).not.toContain('\n');
    expect(claim.context).not.toContain('\u0007');
    expect(claim.context.length).toBeLessThanOrEqual(2 * 40 + '470'.length + 2);
    expect(describeUnsupportedClaims(claims)).toBe(
      `470 [sections[evidence].body: "${claim.context}"]`,
    );
  });

  it('caps the number of locations it lists', () => {
    const fields = ['91', '92', '93', '94'].map((n, i) => ({ field: `f${i}`, text: n }));
    const message = describeUnsupportedClaims(findUnsupportedNumericClaims(fields, '', 'en'));
    expect(message).toMatch(/^91, 92, 93, 94 \[f0: "91"; f1: "92"; f2: "93"; \+1 more\]$/);
  });
});

describe('letters glued to numbers: dimension vs scale vs unit (2026-11-28 "3B" retry)', () => {
  const readings = (text: string, locale: NumberLocale) =>
    numericMentions(text, locale).map((m) => ({ raw: m.raw, readings: m.readings }));
  const dim = (value: number) => ({ kind: 'dimension', value });
  const qty = (value: number) => ({ kind: 'quantity', value });
  const kel = (value: number) => ({ kind: 'kelvin', value });

  it.each([
    ['3B gripper pozlarını', 'tr', '3B', [dim(3)]], // second word "poz…" is spatial
    ['2B görüntüler', 'tr', '2B', [dim(2)]],
    ["3B'lik nokta bulutu", 'tr', '3B', [dim(3)]],
    ['7B parametre', 'tr', '7B', [qty(7e9)]],
    ['7B parametreli model', 'tr', '7B', [qty(7e9)]],
    ['$3B yatırım', 'tr', '3B', [qty(3e9)]],
    ['3B model', 'tr', '3B', [qty(3e9), dim(3)]], // neutral: either, each needs its own evidence
    ['3B parameters', 'en', '3B', [qty(3e9)]], // English "B" is billion
    ['3D gripper poses', 'en', '3D', [dim(3)]],
    ['3D pozlar', 'tr', '3D', [dim(3)]],
    ['3-D reconstruction', 'en', '3-D', [dim(3)]],
    ['2.5D maps', 'en', '2.5D', [dim(2.5)]],
    ['3 boyutlu pozlar', 'tr', '3 boyutlu', [dim(3)]],
    ['128-dimensional embeddings', 'en', '128-dimensional', [dim(128)]],
    ['three-dimensional poses', 'en', 'three-dimensional', [dim(3)]],
    ['cooled to 4 K', 'en', '4 K', [qty(4), kel(4)]],
    ["4K'de soğutuldu", 'tr', '4K', [qty(4000), kel(4)]],
    ['300 kelvin', 'en', '300 kelvin', [qty(300), kel(300)]],
    ['470K rollouts', 'en', '470K', [qty(470_000), kel(470)]],
  ] as const)('%s (%s)', (text, locale, raw, expected) => {
    expect(readings(text, locale)).toEqual([{ raw, readings: expected }]);
  });

  it.each([
    ['a 6-DoF arm', 'en', '6'], // "DoF" is a word, not a suffix
    ['a 7DOF arm', 'en', '7'],
    ['3d later', 'en', '3'], // lowercase d may be days
    ['5 Kasım', 'tr', '5'], // a month, not kelvin
    ['5G networks', 'en', '5'],
  ] as const)('%s (%s) stays a plain number', (text, locale, raw) => {
    expect(readings(text, locale)).toEqual([{ raw, readings: [qty(Number(raw))] }]);
  });

  it('reads Turkish scale words only in Turkish text', () => {
    expect(readings('a 64 bin histogram', 'en')).toEqual([{ raw: '64', readings: [qty(64)] }]);
    expect(readings('64 bin örnek', 'tr')).toEqual([{ raw: '64 bin', readings: [qty(64_000)] }]);
  });

  it.each([
    ['models predict 3D gripper poses', '3B gripper pozlarını', 'tr'],
    ['from 2D images', '2B görüntüler', 'tr'],
    ['from 2D images', '2D görüntüler', 'tr'],
    ['models predict 3D gripper poses', '3 boyutlu pozlar', 'tr'],
    ['three-dimensional poses', '3B pozlar', 'tr'],
    ['3-D reconstruction', '3D reconstruction', 'en'],
    ['a 7 billion parameter model', '7B parametre', 'tr'],
    ['a 7 billion parameter model', '7B parameters', 'en'],
    ['a 7B parameter model', '7 milyar parametre', 'tr'],
    ['models predict 3D gripper poses', '3B model', 'tr'], // neutral context, dimension grounded
    ['cooled to 4 K', "4K'de soğutuldu", 'tr'],
    ['over 300K rollouts', '300 bin deneme', 'tr'],
  ] as const)('accepts %j -> %j', (source, generated, locale) => {
    expect(findUnsupportedNumbers(generated, source, locale)).toEqual([]);
  });

  it.each([
    ['models predict 3D poses', '2B pozlar', 'tr', '2B'], // wrong dimension
    ['models predict gripper poses', '3B gripper pozlarını', 'tr', '3B'], // no 3D evidence
    ['models predict gripper poses', '3 boyutlu pozlar', 'tr', '3 boyutlu'],
    ['models predict 3D poses', '3B parametre', 'tr', '3B'], // billion context, no billion evidence
    ['models predict 3D poses', '3 milyar parametre', 'tr', '3 milyar'],
    ['a 7B parameter model', '7B pozlar', 'tr', '7B'], // billion evidence cannot vouch for 3D
    ['128-dimensional embeddings', '128 görev', 'tr', '128'], // dimension cannot vouch for a count
    ['128-dimensional embeddings', '128 bin örnek', 'tr', '128 bin'],
    ['on 300 tasks', '300K rollouts', 'en', '300K'], // neither 300 000 nor 300 kelvin
    ['cooled to 4 K', '4 bin deneme', 'tr', '4 bin'], // kelvin cannot vouch for a count
  ] as const)('rejects %j -> %j', (source, generated, locale, unsupported) => {
    expect(findUnsupportedNumbers(generated, source, locale)).toEqual([unsupported]);
  });
});
