import { headingTexts, repairOutlineTitles } from '../../../src/service/pdf/pdf-outline';

const hex = (text: string) =>
  'FEFF' +
  [...text].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join('');

/** A minimal PDF-like byte layout with an xref offset after the outline object. */
function fakePdf(titles: string[]): Buffer {
  const objects = titles.map(
    (t, i) => `${10 + i} 0 obj\n<</Title <${hex(t)}>/Parent 9 0 R>>\nendobj\n`,
  );
  const body = `%PDF-1.7\n${objects.join('')}`;
  return Buffer.from(`${body}xref\n${body.length}\n%%EOF\n`, 'latin1');
}

describe('PDF bookmark title repair (Chromium on Linux duplicates moved headings)', () => {
  const heading = 'Ne yaptılar, ne buldular?';

  it('restores a doubled or tripled title in place, keeping every byte offset', () => {
    const pdf = fakePdf([heading.repeat(2), 'Sınırlar', heading.repeat(3)]);
    const { pdf: fixed, repaired } = repairOutlineTitles(pdf, [heading, 'Sınırlar']);
    expect(repaired).toBe(2);
    expect(fixed.length).toBe(pdf.length);
    // Every object still starts at the same offset.
    for (const id of [10, 11, 12]) {
      expect(fixed.indexOf(`${id} 0 obj`)).toBe(pdf.indexOf(`${id} 0 obj`));
    }
    const titles = [...fixed.toString('latin1').matchAll(/\/Title <([^>]*)>/g)].map((m) =>
      m[1].replace(/\s+/g, ''),
    );
    expect(titles).toEqual([hex(heading), hex('Sınırlar'), hex(heading)]);
  });

  it('never touches titles that are not an exact repetition of a document heading', () => {
    const pdf = fakePdf(['NoNo', `${heading} ${heading}`, 'Başka başlık']);
    const { pdf: fixed, repaired } = repairOutlineTitles(pdf, [heading, 'Başka']);
    expect(repaired).toBe(0);
    expect(fixed.equals(pdf)).toBe(true);
  });

  it('extracts heading text as rendered (tags stripped, entities decoded)', () => {
    expect(
      headingTexts(
        '<h1>A &amp; B</h1><p>x</p><h3 class="headline">“Q” &lt;1&gt;</h3><h2><span>S</span></h2>',
      ),
    ).toEqual(['A & B', '“Q” <1>', 'S']);
  });
});
