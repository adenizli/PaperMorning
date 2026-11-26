/**
 * Deterministic guard against invented numbers: every numeric token in generated text must
 * also appear in the source material it was written from. Years, list ordinals and other small
 * integers (0-10) are tolerated because they are not quantitative research claims.
 */
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

function normalize(token: string): string {
  return token.replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
}

export function extractNumbers(text: string): Set<string> {
  const result = new Set<string>();
  for (const match of text.matchAll(NUMBER_PATTERN)) result.add(normalize(match[0]));
  return result;
}

export function findUnsupportedNumbers(generated: string, source: string): string[] {
  const allowed = extractNumbers(source);
  const unsupported: string[] = [];
  for (const value of extractNumbers(generated)) {
    if (allowed.has(value)) continue;
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 10) continue;
    if (Number.isInteger(numeric) && numeric >= 1900 && numeric <= 2100) continue;
    unsupported.push(value);
  }
  return unsupported;
}
