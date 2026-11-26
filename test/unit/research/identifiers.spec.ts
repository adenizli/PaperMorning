import {
  arxivIdFromDoi,
  normalizeDoi,
  normalizeOpenAlexId,
  parseArxivId,
} from '../../../src/service/academic-source/identifiers';

describe('identifier normalization', () => {
  it('normalizes DOIs from URLs and prefixes, rejecting garbage', () => {
    expect(normalizeDoi('https://doi.org/10.1038/S41586-026-01234-5')).toBe(
      '10.1038/s41586-026-01234-5',
    );
    expect(normalizeDoi('doi:10.1000/XYZ')).toBe('10.1000/xyz');
    expect(normalizeDoi('not-a-doi')).toBeNull();
    expect(normalizeDoi(null)).toBeNull();
  });

  it('separates arXiv id from version for new and old style ids', () => {
    expect(parseArxivId('http://arxiv.org/abs/2611.01234v2')).toEqual({
      id: '2611.01234',
      version: 'v2',
    });
    expect(parseArxivId('arXiv:2611.01234')).toEqual({ id: '2611.01234', version: null });
    expect(parseArxivId('hep-th/9901001v3')).toEqual({ id: 'hep-th/9901001', version: 'v3' });
    expect(parseArxivId('W123')).toBeNull();
  });

  it('recognizes arXiv DataCite DOIs as preprint identifiers, not journal DOIs', () => {
    expect(arxivIdFromDoi('10.48550/arxiv.2611.01234')).toBe('2611.01234');
    expect(arxivIdFromDoi('10.1038/s41586-026-01234-5')).toBeNull();
  });

  it('extracts OpenAlex work ids', () => {
    expect(normalizeOpenAlexId('https://openalex.org/W4400000001')).toBe('W4400000001');
    expect(normalizeOpenAlexId('https://openalex.org/A1')).toBeNull();
  });
});
