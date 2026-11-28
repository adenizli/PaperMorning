/**
 * Deterministic guard against invented numbers: every quantity in generated text must also be a
 * quantity of the source material it was written from.
 *
 * Numbers are compared by VALUE, not by spelling, so the same quantity written differently is
 * accepted while a different quantity is not:
 *
 *   - "Thirty-two" = "32"; "470,000" (English) = "470.000" (Turkish) = "470 bin" = "470 thousand"
 *     = "470K" = "470 000" (space / no-break space grouping); "42.8" = "42,8" (Turkish decimal).
 *   - Still rejected: "470" for a source "470,000" (a different value), "33" for "32", "1200" or
 *     Turkish "1.200" for a source "1.2", "75%" for a source "15–60%".
 *
 * Separators are read with the conventions of the text's language: the source (English abstracts
 * and analyses) with "," for thousands and "." for decimals, Turkish output with "." for thousands
 * and "," for decimals. A number copied verbatim from the source (same digits and separators) is
 * always accepted: its ambiguity, if any, is the source's own. Small integers (0-10) and years
 * written as plain digits are tolerated because they are not quantitative research claims.
 * Number words are recognised in English only; Turkish number words are not checked.
 *
 * Every mention has typed READINGS, and the source supplies separate evidence per kind, so a
 * match of one kind never vouches for another kind with the same number:
 *
 *   - quantity:  "470", "470 bin", "7B" (7 billion), "4K" (4 thousand)
 *   - dimension: "3D", "3-D", "2.5D", "3 boyutlu", "three-dimensional", Turkish "3B" (üç boyutlu)
 *   - kelvin:    "4 K", "4K", "300 kelvin"
 *
 * Letters glued to a number are a known collision point. How each is read:
 *
 *   - D  -> dimension only. Uppercase only ("3d" may be "3 days"); "6-DoF"/"6DOF" is not a suffix.
 *   - B  -> English text: billion. Turkish text: "3B" is ALSO the standard abbreviation of "üç
 *           boyutlu" (3D), so it has both readings. The next words decide when they can:
 *           "parametre", "token", "$", ... -> billion only; "poz", "görüntü", "nokta bulutu",
 *           ... -> dimension only; otherwise either reading, each needing its OWN source evidence
 *           (source "3D" supports "3B" as a dimension, never "3 milyar").
 *   - K  -> thousand, or kelvin (quantum-physics abstracts write "4 K"/"4K"); kelvin needs a
 *           kelvin mention in the source.
 *   - k, M, bn -> thousand / million / billion only.
 *   - Turkish scale words (bin, milyon, milyar, trilyon) are read only in Turkish text: in an
 *     English source "10 bin histogram" is ten bins, not ten thousand.
 *
 * Remaining, deliberately strict ambiguities (rejected unless the source uses the same form):
 * "M" as molar ("5M NaCl"), "T" as tesla or trillion ("9T", "15T tokens" are read as 9 and 15),
 * "K" as a resolution ("4K video"), and a neutral-context Turkish "3B" when the source supports
 * both 3D and 3 billion (accepted: either reading is grounded).
 */

export type NumberLocale = 'en' | 'tr';

export type ReadingKind = 'quantity' | 'dimension' | 'kelvin';

export interface NumericReading {
  kind: ReadingKind;
  value: number;
}

export interface NumericMention {
  /** As written, including any scale word or unit: "470 bin", "Thirty-two", "1.2M", "3B". */
  raw: string;
  index: number;
  /** Digits and separators exactly as written ('' for number words). */
  literal: string;
  /** The first reading's value; null when the separators fit no format ("1.2.3"). */
  value: number | null;
  /** Every plausible meaning; supported when ANY reading has source evidence of its own kind. */
  readings: NumericReading[];
  /** Reads as the bare number (no scale, no dimension): verbatim-literal and tolerance rules apply. */
  plain: boolean;
  /** Small integer or plain-digit year: never a research claim on its own. */
  tolerated: boolean;
  /** "12 300" with an ordinary space may be two numbers: these are the separate readings. */
  parts?: NumericMention[];
}

export interface TextField {
  field: string;
  text: string;
}

export interface UnsupportedNumericClaim {
  field: string;
  raw: string;
  /** Up to ~40 characters either side, whitespace collapsed, control characters removed. */
  context: string;
}

const GROUP_SPACE = '[ \\u00A0\\u202F\\u2009]';
/** Space-grouped thousands ("470 000", "1 234,5") or digits with "." / "," separators. */
const NUMBER = new RegExp(
  `(?<!\\d)(?:\\d{1,3}(?:${GROUP_SPACE}\\d{3})+(?:[.,]\\d+)?(?!\\d)|\\d+(?:[.,]\\d+)*)`,
  'g',
);
/** Letters glued to the number. Uppercase D only; a following letter or digit cancels it. */
const LETTER_SUFFIX = /^(?:(-?D)|(k|K|M|B|bn))(?![\p{L}\d])/u;
const DIMENSION_WORD =
  /^(?:[ \u00A0\u202F]|[ \u00A0\u202F]?-)?(?:boyut\p{L}*|dimension(?:al|s)?(?!\p{L}))/iu;
const KELVIN_SPACED = /^[ \u00A0\u202F](?:K(?![\p{L}\d])|[Kk]elvin\p{L}*)/u;
const SCALE_WORD = /^[ \u00A0\u202F]+(\p{L}+)/u;
const SCALES: Record<string, number> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
  bin: 1e3,
  milyon: 1e6,
  milyar: 1e9,
  trilyon: 1e12,
};
const SUFFIX_SCALES: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, B: 1e9, bn: 1e9 };
/**
 * Turkish case endings a scale word may carry, following its vowel harmony: "470 binden",
 * "2 milyonluk", "5 milyara". Anything else ("3 bina", a building) is not a scale word.
 */
const trCase = (a: string, i: string) =>
  new RegExp(
    `^(?:'?(?:${a}|${i}|${i}n|[dt]${a}n?|l${a}|l${i}k|${i}n${a}|${i}n[dt]${a}n?|${i}n${i}n))?$`,
  );
const TR_CASE: Record<string, RegExp> = {
  bin: trCase('e', 'i'),
  milyon: trCase('a', 'u'),
  milyar: trCase('a', 'ı'),
  trilyon: trCase('a', 'u'),
};
const ENGLISH_SCALES = new Set(['thousand', 'million', 'billion', 'trillion']);

/** Word stems after a Turkish "nB" that make it a count of billions ("7B parametre"). */
const BILLION_CONTEXT = [
  'parametre',
  'param',
  'token',
  'dolar',
  'dollar',
  'usd',
  'euro',
  'avro',
  'lira',
  'kullanıcı',
  'user',
];
/** Word stems after a Turkish "nB" that make it spatial ("3B poz", "2B görüntü"). */
const DIMENSION_CONTEXT = [
  'poz',
  'pose',
  'görüntü',
  'imge',
  'image',
  'nokta',
  'point',
  'bulut',
  'cloud',
  'sahne',
  'scene',
  'uzay',
  'space',
  'konum',
  'position',
  'geometr',
  'şekil',
  'shape',
  'harita',
  'map',
  'algı',
  'percept',
  'baskı',
  'yazıcı',
  'print',
  'yüzey',
  'surface',
  'derinlik',
  'depth',
  'rekonstr',
  'reconstr',
  'nesne',
  'object',
  'mesh',
  'ortam',
  'environment',
  'çevre',
  'dünya',
  'world',
  'görsel',
  'visual',
  'tarama',
  'scan',
  'koordinat',
  'coordinat',
  'rotasyon',
  'rotation',
  'yönelim',
  'orientation',
  'hareket',
  'motion',
  'sınırlayıcı',
  'bounding',
  'kutu',
  'box',
  'gauss',
];

const SMALL: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const valueKey = (value: number): string => String(Number(value.toPrecision(12)));

/**
 * What the words right after a Turkish "nB" say it is: up to two words, within the sentence,
 * after any apostrophe suffix ("3B'lik"); "$3B" is money.
 */
function bContext(text: string, start: number, end: number): 'billion' | 'dimension' | null {
  if (/\$\s*$/.test(text.slice(Math.max(0, start - 2), start))) return 'billion';
  const rest = text
    .slice(end, end + 80)
    .replace(/^['’]\p{L}*/u, '')
    .split(/[.;:!?]/)[0];
  const words = [...rest.matchAll(/\p{L}+/gu)].slice(0, 2).map((m) => m[0].toLocaleLowerCase('tr'));
  const has = (stems: string[]) => words.some((w) => stems.some((stem) => w.startsWith(stem)));
  const billion = has(BILLION_CONTEXT);
  const dimension = has(DIMENSION_CONTEXT);
  if (billion === dimension) return null;
  return billion ? 'billion' : 'dimension';
}

interface Affix {
  length: number;
  readings: (base: number) => NumericReading[];
  /** The bare number is one of the readings (a unit, not a scale or a dimension). */
  plain: boolean;
}

const quantity = (value: number): NumericReading => ({ kind: 'quantity', value });

/** The scale word, suffix or unit right after a number, and the readings it allows. */
function affixAt(text: string, start: number, end: number, locale: NumberLocale): Affix | null {
  const rest = text.slice(end, end + 24);
  const letter = LETTER_SUFFIX.exec(rest);
  if (letter) {
    const length = letter[0].length;
    if (letter[1])
      return { length, plain: false, readings: (n) => [{ kind: 'dimension', value: n }] };
    const suffix = letter[2];
    const scaled = (n: number) => quantity(n * SUFFIX_SCALES[suffix]);
    if (suffix === 'K') {
      return { length, plain: false, readings: (n) => [scaled(n), { kind: 'kelvin', value: n }] };
    }
    if (suffix === 'B' && locale === 'tr') {
      const context = bContext(text, start, end + length);
      return {
        length,
        plain: false,
        readings: (n) =>
          context === 'billion'
            ? [scaled(n)]
            : context === 'dimension'
              ? [{ kind: 'dimension', value: n }]
              : [scaled(n), { kind: 'dimension', value: n }],
      };
    }
    return { length, plain: false, readings: (n) => [scaled(n)] };
  }
  const dimension = DIMENSION_WORD.exec(rest);
  if (dimension) {
    return {
      length: dimension[0].length,
      plain: false,
      readings: (n) => [{ kind: 'dimension', value: n }],
    };
  }
  const kelvin = KELVIN_SPACED.exec(rest);
  if (kelvin) {
    return {
      length: kelvin[0].length,
      plain: true,
      readings: (n) => [quantity(n), { kind: 'kelvin', value: n }],
    };
  }
  const word = SCALE_WORD.exec(rest);
  if (!word) return null;
  const english = word[1].toLowerCase();
  if (ENGLISH_SCALES.has(english)) {
    const multiplier = SCALES[english];
    return { length: word[0].length, plain: false, readings: (n) => [quantity(n * multiplier)] };
  }
  if (locale !== 'tr') return null;
  const turkish = word[1].toLocaleLowerCase('tr');
  for (const [stem, ending] of Object.entries(TR_CASE)) {
    if (turkish.startsWith(stem) && ending.test(turkish.slice(stem.length))) {
      const multiplier = SCALES[stem];
      return { length: word[0].length, plain: false, readings: (n) => [quantity(n * multiplier)] };
    }
  }
  return null;
}

/** Reads digits with "." / "," separators under the locale's conventions. */
function readSeparated(
  literal: string,
  locale: NumberLocale,
): { value: number | null; grouped: boolean } {
  const separators = literal.match(/[.,]/g) ?? [];
  if (separators.length === 0) return { value: Number(literal), grouped: false };
  const groups = literal.split(/[.,]/);
  const kinds = new Set(separators);
  const thousandsGroups = (gs: string[]) =>
    gs[0].length >= 1 && gs[0].length <= 3 && gs.slice(1).every((g) => g.length === 3);

  if (kinds.size === 2) {
    // "1,234.5" / "1.234,5": the last separator is the decimal mark, the others group thousands.
    const decimalMark = separators[separators.length - 1];
    const ok =
      separators.slice(0, -1).every((s) => s !== decimalMark) &&
      thousandsGroups(groups.slice(0, -1));
    if (!ok) return { value: null, grouped: true };
    return {
      value: Number(`${groups.slice(0, -1).join('')}.${groups[groups.length - 1]}`),
      grouped: true,
    };
  }
  if (separators.length > 1) {
    // "1,234,567" / "1.234.567" group thousands; anything else ("1.2.3") is not a quantity.
    return thousandsGroups(groups)
      ? { value: Number(groups.join('')), grouped: true }
      : { value: null, grouped: true };
  }
  const [whole, fraction] = groups;
  const decimalMark = locale === 'tr' ? ',' : '.';
  const couldGroup = fraction.length === 3 && whole.length <= 3 && whole !== '0';
  if (separators[0] !== decimalMark && couldGroup) {
    return { value: Number(`${whole}${fraction}`), grouped: true };
  }
  return { value: Number(`${whole}.${fraction}`), grouped: false };
}

function digitMentions(text: string, locale: NumberLocale): NumericMention[] {
  const mentions: NumericMention[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const literal = match[0];
    const index = match.index;
    let base: { value: number | null; grouped: boolean };
    let parts: NumericMention[] | undefined;
    if (/[ \u00A0\u202F\u2009]/.test(literal)) {
      // Space-grouped thousands; whatever "." / "," follows the groups is the decimal mark.
      const [integer, fraction] = literal.split(/[.,]/);
      const digits = integer.replace(/[ \u00A0\u202F\u2009]/g, '');
      base = { value: Number(fraction ? `${digits}.${fraction}` : digits), grouped: true };
      if (literal.includes(' ')) {
        // An ordinary space may also separate two numbers ("12 300-step runs").
        parts = digitMentions(literal.replace(/[ \u00A0\u202F\u2009]/g, '\n'), locale).map((p) => ({
          ...p,
          index: index + p.index,
        }));
      }
    } else {
      base = readSeparated(literal, locale);
    }
    const affix = affixAt(text, index, index + literal.length, locale);
    const readings =
      base.value === null ? [] : affix ? affix.readings(base.value) : [quantity(base.value)];
    const plain = !affix || affix.plain;
    const tolerated =
      plain &&
      !base.grouped &&
      base.value !== null &&
      Number.isInteger(base.value) &&
      ((base.value >= 0 && base.value <= 10) ||
        (/^\d{4}$/.test(literal) && base.value >= 1900 && base.value <= 2100));
    mentions.push({
      raw: text.slice(index, index + literal.length + (affix?.length ?? 0)),
      index,
      literal,
      value: readings[0]?.value ?? null,
      readings,
      plain,
      tolerated,
      parts,
    });
  }
  return mentions;
}

type WordKind = 'small' | 'tens' | 'hundred' | 'scale';

function wordKind(word: string): WordKind | null {
  if (word in SMALL) return 'small';
  if (word in TENS) return 'tens';
  if (word === 'hundred') return 'hundred';
  if (ENGLISH_SCALES.has(word)) return 'scale';
  return null;
}

/** Which word kinds may follow which in an English number ("two hundred and fifty thousand"). */
function canFollow(previous: WordKind, previousWord: string, next: WordKind, nextWord: string) {
  if (next === 'scale') return previous !== 'scale';
  if (next === 'hundred') return previous === 'small' && SMALL[previousWord] < 10;
  if (previous === 'tens') return next === 'small' && SMALL[nextWord] >= 1 && SMALL[nextWord] <= 9;
  return previous === 'hundred' || previous === 'scale';
}

/** English number words: "Thirty-two" -> 32, "two hundred and fifty thousand" -> 250000. */
function wordMentions(text: string): NumericMention[] {
  const words = [...text.matchAll(/\p{L}+/gu)].map((m) => ({
    word: m[0].toLowerCase(),
    start: m.index,
    end: m.index + m[0].length,
  }));
  const mentions: NumericMention[] = [];
  let i = 0;
  while (i < words.length) {
    const first = wordKind(words[i].word);
    if (first !== 'small' && first !== 'tens') {
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    let end = i;
    let previous: WordKind = first;
    const add = (kind: WordKind, word: string) => {
      if (kind === 'small') current += SMALL[word];
      else if (kind === 'tens') current += TENS[word];
      else if (kind === 'hundred') current *= 100;
      else {
        total += current * SCALES[word];
        current = 0;
      }
    };
    add(first, words[i].word);
    for (let j = i + 1; j < words.length; j++) {
      const gap = text.slice(words[j - 1].end, words[j].start);
      let candidate = j;
      if (
        words[j].word === 'and' &&
        /^\s+$/.test(gap) &&
        (previous === 'hundred' || previous === 'scale') &&
        j + 1 < words.length &&
        /^\s+$/.test(text.slice(words[j].end, words[j + 1].start))
      ) {
        candidate = j + 1;
      } else if (!/^(?:\s+|-)$/.test(gap)) {
        break;
      }
      const kind = wordKind(words[candidate].word);
      if (!kind || !canFollow(previous, words[end].word, kind, words[candidate].word)) break;
      add(kind, words[candidate].word);
      previous = kind;
      end = candidate;
      j = candidate;
    }
    const value = total + current;
    const single = end === i;
    // "three-dimensional", "three dimensions": a dimension, not a count.
    const dimension = /^[\s-]+dimension(?:al|s)?(?!\p{L})/iu.exec(
      text.slice(words[end].end, words[end].end + 16),
    );
    mentions.push({
      raw: text.slice(words[i].start, words[end].end + (dimension?.[0].length ?? 0)),
      index: words[i].start,
      literal: '',
      value,
      readings: [{ kind: dimension ? 'dimension' : 'quantity', value }],
      plain: !dimension,
      tolerated: !dimension && single && value <= 10,
    });
    i = end + 1;
  }
  return mentions;
}

/** Every number in the text, by value, in reading order. */
export function numericMentions(text: string, locale: NumberLocale = 'en'): NumericMention[] {
  return [...digitMentions(text, locale), ...wordMentions(text)].sort((a, b) => a.index - b.index);
}

/** Source evidence, one pool per reading kind: a dimension never vouches for a quantity. */
interface SourceNumbers {
  values: Record<ReadingKind, Set<string>>;
  literals: Set<string>;
}

function sourceNumbers(source: string): SourceNumbers {
  const values: SourceNumbers['values'] = {
    quantity: new Set(),
    dimension: new Set(),
    kelvin: new Set(),
  };
  const literals = new Set<string>();
  const add = (m: NumericMention) => {
    for (const reading of m.readings) values[reading.kind].add(valueKey(reading.value));
    if (m.literal && m.plain) literals.add(m.literal);
    m.parts?.forEach(add);
  };
  numericMentions(source, 'en').forEach(add);
  return { values, literals };
}

function isSupported(m: NumericMention, source: SourceNumbers): boolean {
  if (m.tolerated) return true;
  if (m.literal && m.plain && source.literals.has(m.literal)) return true;
  if (m.readings.some((r) => source.values[r.kind].has(valueKey(r.value)))) return true;
  return m.parts?.every((p) => isSupported(p, source)) ?? false;
}

function contextOf(text: string, index: number, length: number, radius = 40): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const clean = (s: string) =>
    [...s]
      .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
      .join('')
      .replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${clean(text.slice(start, end)).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Leaf strings of structured output with readable paths: `findings[0].statement`,
 * `sections[evidence].body` (array items with a string `key` are labelled by it).
 */
export function textFields(
  value: unknown,
  skipKeys: ReadonlySet<string> = new Set(),
  path = '',
): TextField[] {
  if (typeof value === 'string') return [{ field: path || '(text)', text: value }];
  if (typeof value === 'number') return [{ field: path || '(text)', text: String(value) }];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => {
      const key = (item as { key?: unknown } | null)?.key;
      return textFields(item, skipKeys, `${path}[${typeof key === 'string' ? key : i}]`);
    });
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !skipKeys.has(key))
      .flatMap(([key, item]) => textFields(item, skipKeys, path ? `${path}.${key}` : key));
  }
  return [];
}

/** Numbers in the generated fields whose value the source never states, with where they are. */
export function findUnsupportedNumericClaims(
  fields: TextField[],
  source: string,
  locale: NumberLocale,
): UnsupportedNumericClaim[] {
  const allowed = sourceNumbers(source);
  const claims: UnsupportedNumericClaim[] = [];
  for (const { field, text } of fields) {
    const seen = new Set<string>();
    for (const mention of numericMentions(text, locale)) {
      if (isSupported(mention, allowed) || seen.has(mention.raw)) continue;
      seen.add(mention.raw);
      claims.push({
        field,
        raw: mention.raw,
        context: contextOf(text, mention.index, mention.raw.length),
      });
    }
  }
  return claims;
}

/** "470, 33 [sections[evidence].body: "…over 470 rollouts…"; …]" for error messages and logs. */
export function describeUnsupportedClaims(claims: UnsupportedNumericClaim[], max = 3): string {
  const values = [...new Set(claims.map((c) => c.raw))].slice(0, 5).join(', ');
  const where = claims
    .slice(0, max)
    .map((c) => `${c.field}: "${c.context}"`)
    .join('; ');
  const more = claims.length > max ? `; +${claims.length - max} more` : '';
  return `${values} [${where}${more}]`;
}

/** Unsupported numbers in a single generated text, as written (kept for simple callers). */
export function findUnsupportedNumbers(
  generated: string,
  source: string,
  locale: NumberLocale = 'en',
): string[] {
  return [
    ...new Set(
      findUnsupportedNumericClaims([{ field: '(text)', text: generated }], source, locale).map(
        (c) => c.raw,
      ),
    ),
  ];
}
