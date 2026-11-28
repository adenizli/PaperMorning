/**
 * Deterministic tripwire for one well-defined grounding error: drawing a conclusion about the
 * complement of a reported subset.
 *
 * When a source reports that k of n cases share an outcome ("a 15–60% RMSE reduction in nine out
 * of ten combinations"), it says nothing about the remaining n−k cases: they may have improved
 * less, not at all, or got worse. Generated text may mention those remaining cases only while
 * explicitly framing them as unreported ("the result of the remaining combination is not stated
 * in the abstract"), unless the source itself describes them.
 *
 * Scope is deliberately narrow so it cannot act as general keyword censorship: it only activates
 * when the source contains an explicit "k of n" partition, only looks at sentences that refer to
 * that partition's remainder, and only asks for explicit uncertainty framing. Everything else is
 * governed by the generation prompts.
 */

export interface AbsenceInference {
  /** "k/n" partition from the source that the sentence draws a conclusion about. */
  partition: string;
  sentence: string;
}

interface Partition {
  k: number;
  n: number;
}

const EN_NUMBERS: Record<string, number> = {
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
  twenty: 20,
};
const EN_ORDINALS = [
  '',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
  'twentieth',
];
const TR_NUMBERS: Record<string, number> = {
  bir: 1,
  iki: 2,
  üç: 3,
  dört: 4,
  beş: 5,
  altı: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
  yirmi: 20,
};
const TR_ORDINALS = [
  '',
  'birinci',
  'ikinci',
  'üçüncü',
  'dördüncü',
  'beşinci',
  'altıncı',
  'yedinci',
  'sekizinci',
  'dokuzuncu',
  'onuncu',
];

const EN_WORD = Object.keys(EN_NUMBERS).join('|');
// Longest first so "on" (10) never shadows a longer Turkish number word.
const TR_WORD = Object.keys(TR_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const L = '\\p{L}';

/** "nine out of ten", "9 of the 10", "in two of three settings". */
const EN_PARTITION = new RegExp(
  `(?<![\\p{L}\\d.,])(\\d{1,3}|${EN_WORD})\\s+(?:out\\s+)?of\\s+(?:the\\s+|all\\s+|its\\s+|their\\s+)?(\\d{1,3}|${EN_WORD})(?![\\p{L}\\d])`,
  'giu',
);
/** "on kombinasyonun dokuzunda", "10 kombinasyondan 9'unda". */
const TR_PARTITION = new RegExp(
  `(?<![\\p{L}\\d.,])(\\d{1,3}|${TR_WORD})\\s+${L}+?(?:nın|nin|nun|nün|ın|in|un|ün|dan|den|tan|ten)\\s+(\\d{1,3}|${TR_WORD})(?:['’]?${L}*)`,
  'giu',
);

/** Explicit "this is not reported / unknown" framing (Turkish and English). */
const UNCERTAINTY = new RegExp(
  [
    'belirtil',
    'belirtm',
    'bildirilm',
    'bildirm(?:iyor|emiş|emekte)',
    'raporlanm',
    'açıklanm',
    'açıklam(?:ıyor|amış|amakta)',
    'bilinm(?:iyor|emekte|emektedir)',
    'belirsiz',
    'net değil',
    'yer alm(?:ıyor|amakta|amış)',
    'yer verilm',
    'söylenm',
    'söylem(?:iyor|emiş)',
    'değinilm',
    'paylaşılm',
    'sunulm(?:uyor|amış|amakta)',
    '(?:bilgi|veri|ayrıntı|sonuç)\\s+(?:yok|verilm)',
    'not\\s+(?:reported|stated|specified|described|given|disclosed|provided)',
    'unreported',
    'unspecified',
    'unknown',
    'unclear',
    '(?:does|do|did)\\s+not\\s+(?:report|state|specify|say|describe|give|disclose)',
    'no\\s+(?:information|details?|data|results?)\\s+(?:is|are|was|were)\\s+(?:given|provided|reported)',
  ].join('|'),
  'iu',
);

function toNumber(token: string, words: Record<string, number>): number | null {
  const lower = token.toLocaleLowerCase('tr-TR');
  const digits = /^\d+/.exec(lower);
  if (digits) return Number(digits[0]);
  if (words[lower] !== undefined) return words[lower];
  // Suffixed Turkish forms ("dokuzunda"): longest matching number word wins.
  const prefix = Object.keys(words)
    .sort((a, b) => b.length - a.length)
    .find((word) => lower.startsWith(word));
  return prefix ? words[prefix] : null;
}

/** Every explicit "k of n" partition (0 < k < n ≤ 1000) stated in the text. */
export function extractPartitions(text: string): Partition[] {
  const found = new Map<string, Partition>();
  const add = (k: number | null, n: number | null) => {
    if (k === null || n === null || !(k > 0 && k < n && n <= 1000)) return;
    found.set(`${k}/${n}`, { k, n });
  };
  for (const m of text.matchAll(EN_PARTITION)) {
    add(toNumber(m[1], EN_NUMBERS), toNumber(m[2], EN_NUMBERS));
  }
  for (const m of text.matchAll(TR_PARTITION)) {
    // Turkish puts the whole first: "<n> <noun-GEN> <k>-LOC".
    const kToken = m[0].slice(m[0].lastIndexOf(m[2]));
    add(toNumber(kToken, TR_NUMBERS), toNumber(m[1], TR_NUMBERS));
  }
  return [...found.values()];
}

/** Patterns that refer to the n−k cases a partition leaves out. */
function remainderPatterns({ k, n }: Partition): RegExp[] {
  const r = n - k;
  const trR = Object.entries(TR_NUMBERS).find(([, v]) => v === r)?.[0];
  const enR = Object.entries(EN_NUMBERS).find(([, v]) => v === r)?.[0];
  const rTr = trR ? `${r}|${trR}|tek` : `${r}|tek`;
  const rEn = enR ? `${r}|${enR}` : `${r}`;
  const patterns = [
    'geri\\s+kalan',
    `(?<!(?:açık|belirsiz|yanıtsız|cevapsız)\\s)(?<![\\p{L}])kalan\\s+${L}+(?:da|de|ta|te)(?![\\p{L}])`,
    `(?:kalan|diğer)\\s+(?:${rTr})(?![\\p{L}\\d])(?!\\s+deyişle)`,
    `(?<![\\p{L}\\d])(?:${rTr})['’]?(?:inde|ında|unda|ünde|sinde|sında|sunda|sünde)\\s+(?:ise|da|de|ta|te)(?![\\p{L}])`,
    '(?<![\\p{L}])remaining(?![\\p{L}])',
    `(?<![\\p{L}])the\\s+other\\s+(?:one|${rEn})(?![\\p{L}\\d])`,
  ];
  if (r === 1) {
    const trOrdinal = TR_ORDINALS[n];
    const enOrdinal = EN_ORDINALS[n];
    patterns.push(
      `(?<![\\p{L}\\d%])${n}(?:\\.|['’]?(?:uncu|üncü|ıncı|inci|ncı|nci|ncu|ncü|th))(?=\\s|$)`,
    );
    if (trOrdinal) patterns.push(`(?<![\\p{L}])${trOrdinal}(?![\\p{L}])`);
    if (enOrdinal) patterns.push(`(?<![\\p{L}])${enOrdinal}(?![\\p{L}])`);
  }
  return patterns.map((p) => new RegExp(p, 'iu'));
}

function variants(text: string): string[] {
  return [text.toLocaleLowerCase('tr-TR'), text.toLowerCase()];
}

/** Sentences, without splitting after ordinals such as "10." or decimals. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[^\d\s][.!?…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sentences in `generated` that state something about the unreported remainder of a "k of n"
 * partition found in `source`, without framing it as unknown. Partitions whose remainder the
 * source itself describes are skipped.
 */
export function findAbsenceInferences(generated: string[], source: string): AbsenceInference[] {
  const partitions = extractPartitions(source).filter(
    (p) => !remainderPatterns(p).some((re) => variants(source).some((v) => re.test(v))),
  );
  if (partitions.length === 0) return [];
  const findings: AbsenceInference[] = [];
  for (const text of generated) {
    for (const sentence of splitSentences(text)) {
      const forms = variants(sentence);
      if (forms.some((v) => UNCERTAINTY.test(v))) continue;
      const hit = partitions.find((p) =>
        remainderPatterns(p).some((re) => forms.some((v) => re.test(v))),
      );
      if (hit) findings.push({ partition: `${hit.k}/${hit.n}`, sentence });
    }
  }
  return findings;
}

/**
 * Absence in the abstract is not absence in the paper. When only the abstract was read, a
 * sentence must not say that the STUDY does not do something ("Simülasyondan gerçek robota
 * aktarım bu çalışmada ele alınmıyor"); it may only say the ABSTRACT does not mention it
 * ("... özette ele alınmıyor").
 *
 * Deliberately narrow (Turkish output, lower-cased with Turkish rules):
 * - flagged: a negated research activity ("ele alınmıyor", "test edilmemiş", "incelenmiyor",
 *   "karşılaştırmıyor", "yer almıyor", ...), or a negated reporting / method verb ("bildirmiyor",
 *   "içermiyor", "ölçmüyor", ...) whose subject is the study itself ("bu çalışmada", "makale",
 *   "yazarlar"); "Sistem insan müdahalesi içermiyor" describes the method and is allowed;
 * - allowed: any sentence scoped to the abstract ("özet…"), about what PaperMorning read ("tam
 *   metin ... incelenmedi"), attributed to the authors ("yazarlar ... belirtiyor"), or explicitly
 *   uncertain ("bilinmiyor", "belirsiz").
 * Epistemic verbs about evidence ("göstermiyor", "doğrulamıyor") are not flagged.
 */
const TR_LETTER = 'a-zçğıöşüâîû';
const NEGATED =
  '(?:m(?:ıyor|iyor|uyor|üyor|amış|emiş|amıştır|emiştir|adığı|ediği|adı|edi|amakta|emekte))';
const ACTIVITY_STEMS = [
  'ele alın',
  'ele al',
  'yer al',
  'incelen',
  'incele',
  'irdelen',
  'irdele',
  'test edil',
  'test et',
  'sınan',
  'sına',
  'denen',
  'dene',
  'değerlendiril',
  'değerlendir',
  'karşılaştırıl',
  'karşılaştır',
  'tartışıl',
  'tartış',
  'araştırıl',
  'araştır',
  'doğrulan',
  'analiz edil',
  'analiz et',
  'simüle edil',
  'simüle et',
  'yapıl',
  'gerçekleştiril',
];
/**
 * Verbs that also describe the METHOD ("Sistem insan müdahalesi içermiyor", "Model kuvveti
 * ölçmüyor") or reporting: flagged only when the study itself is the subject.
 */
const SUBJECT_STEMS = [
  'bildiril',
  'bildir',
  'belirtil',
  'belirt',
  'raporlan',
  'raporla',
  'açıklan',
  'içer',
  'kapsan',
  'kapsa',
  'sunul',
  'sun',
  'uygulan',
  'uygula',
  'ölçül',
  'ölç',
];
const stems = (list: string[]) => list.map((s) => s.replace(/ /g, '\\s+')).join('|');
const STUDY_ACTIVITY_NEGATED = new RegExp(
  `(?<![${TR_LETTER}])(?:${stems(ACTIVITY_STEMS)})${NEGATED}`,
);
const SUBJECT_NEGATED = new RegExp(`(?<![${TR_LETTER}])(?:${stems(SUBJECT_STEMS)})${NEGATED}`);
const STUDY_SUBJECT = new RegExp(`(?<![${TR_LETTER}])(?:çalışma|makale|araştırma|yazar)`);
const ABSTRACT_SCOPE = /özet|abstract/;
/** About what PaperMorning read ("Tam metin ve tablolar incelenmedi"), not about the study. */
const READING_SCOPE = /tam\s+metin|tam\s+metn|papermorning/;
const ATTRIBUTION = new RegExp(
  `(?<![${TR_LETTER}])(?:belirt|bildir|vurgula|ifade\\s+ed|not\\s+ed|kabul\\s+ed|aktar|söyl)(?:iyor|ıyor|uyor|üyor|mekte|makta|ir|ır|ur|ür|di|dı|du|dü|miş|mış)`,
);
const EXPLICIT_UNCERTAINTY =
  /bilinmiyor|bilinmemektedir|belirsiz|net değil|açık değil|anlaşılmıyor/;

/** Sentences that turn "not in the abstract" into "not in the study" (abstract-only sources). */
export function findStudyScopeAbsenceClaims(generated: string[]): string[] {
  const claims: string[] = [];
  for (const text of generated) {
    for (const sentence of splitSentences(text)) {
      const s = sentence.toLocaleLowerCase('tr');
      if (
        ABSTRACT_SCOPE.test(s) ||
        READING_SCOPE.test(s) ||
        ATTRIBUTION.test(s) ||
        EXPLICIT_UNCERTAINTY.test(s)
      ) {
        continue;
      }
      if (STUDY_ACTIVITY_NEGATED.test(s) || (SUBJECT_NEGATED.test(s) && STUDY_SUBJECT.test(s))) {
        claims.push(sentence);
      }
    }
  }
  return claims;
}
