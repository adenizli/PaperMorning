import { readFileSync } from 'fs';
import { join } from 'path';
import { PublicationStatus } from '../../../src/common/enum/research.enum';
import { ArxivClient, parseArxivFeed } from '../../../src/service/academic-source/arxiv.client';
import { getText } from '../../../src/service/academic-source/http';
import {
  mapOpenAlexWork,
  OpenAlexClient,
  rebuildAbstract,
} from '../../../src/service/academic-source/openalex.client';

const fixture = (name: string) => readFileSync(join(__dirname, '../../fixtures', name), 'utf8');
const http = { timeoutMs: 1000, retries: 2, backoffMs: 0 };
const query = {
  keywords: ['quantum', 'error correction'],
  arxivCategories: ['quant-ph'],
  from: '2026-11-15',
  until: '2026-11-22',
  limit: 10,
};

describe('OpenAlex adapter', () => {
  it('maps works deterministically, conservatively labelling publication status', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response(fixture('openalex-works.json')));
    const records = await new OpenAlexClient(fetchFn, http, 'ops@example.org').search(query);

    const url = new URL(fetchFn.mock.calls[0][0] as string);
    expect(url.searchParams.get('search')).toBe('quantum OR "error correction"');
    expect(url.searchParams.get('filter')).toContain('from_publication_date:2026-11-15');
    expect(url.searchParams.get('mailto')).toBe('ops@example.org');

    expect(records).toHaveLength(3); // the record without a title is dropped
    const [journal, preprint, conference] = records;
    expect(journal).toMatchObject({
      sourceRecordId: 'W4400000001',
      doi: '10.1038/s41586-026-01234-5',
      publicationStatus: PublicationStatus.PEER_REVIEWED,
      authors: ['Ayşe Yılmaz', 'Jon Doe'],
      abstract: 'We demonstrate logical qubits with error rates of 0.1%.',
    });
    expect(preprint).toMatchObject({
      doi: null,
      arxivId: '2611.01234',
      publicationStatus: PublicationStatus.PREPRINT,
    });
    expect(conference).toMatchObject({
      publicationStatus: PublicationStatus.UNKNOWN,
      abstract: null,
    });
  });

  it('rebuilds abstracts from inverted indexes', () => {
    expect(rebuildAbstract({ world: [1], hello: [0] })).toBe('hello world');
    expect(rebuildAbstract(null)).toBeNull();
  });

  it('returns null for unusable works', () => {
    expect(mapOpenAlexWork({ id: 'x' })).toBeNull();
  });
});

describe('arXiv adapter', () => {
  it('parses Atom entries into versioned preprint records with verified journal DOI links', () => {
    const [entry, short] = parseArxivFeed(fixture('arxiv-feed.xml'));
    expect(entry).toMatchObject({
      source: 'ARXIV',
      sourceRecordId: '2611.01234v2',
      versionLabel: 'v2',
      arxivId: '2611.01234',
      doi: '10.1038/s41586-026-01234-5',
      title: 'Robust quantum error correction',
      publicationStatus: PublicationStatus.PREPRINT,
      publishedAt: '2026-11-19',
      pdfUrl: 'http://arxiv.org/pdf/2611.01234v2',
      categories: ['quant-ph', 'cs.ET'],
      authors: ['Ayşe Yılmaz', 'Jon Doe'],
    });
    expect(short).toMatchObject({ doi: null, venue: 'arXiv', sourceRecordId: '2611.09999v1' });
  });

  it('builds a category + date-window query and skips topics without categories', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response(fixture('arxiv-feed.xml')));
    const client = new ArxivClient(fetchFn, http, 0);
    await client.search(query);
    const url = new URL(fetchFn.mock.calls[0][0] as string);
    expect(url.searchParams.get('search_query')).toBe(
      '(cat:quant-ph) AND submittedDate:[202611150000 TO 202611222359]',
    );
    expect(await client.search({ ...query, arxivCategories: [] })).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('HTTP helper', () => {
  it('retries 429/5xx with backoff and then succeeds', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok'));
    await expect(getText(fetchFn, 'https://api.example.org/x', http)).resolves.toBe('ok');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('does not retry client errors and reports a predictable error', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    await expect(getText(fetchFn, 'https://api.example.org/x', http)).rejects.toThrow(
      'HTTP 400 from api.example.org',
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('surfaces network failures after bounded retries', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(getText(fetchFn, 'https://api.example.org/x', http)).rejects.toThrow(/ECONNRESET/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
