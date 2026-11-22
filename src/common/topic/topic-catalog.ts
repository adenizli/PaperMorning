/**
 * Supported research topics. A stable, small catalog shared by Account (allowed preference keys)
 * and Research (deterministic discovery queries and rule screening). No topic management domain.
 */
export interface TopicDefinition {
  key: string;
  labelTr: string;
  /** arXiv subject categories used for preprint discovery and as a strong relevance signal. */
  arxivCategories: string[];
  /** Lower-case keywords/phrases used for OpenAlex search and deterministic rule screening. */
  keywords: string[];
}

export const TOPIC_CATALOG: readonly TopicDefinition[] = [
  {
    key: 'artificial-intelligence',
    labelTr: 'Yapay zekâ',
    arxivCategories: ['cs.AI', 'cs.LG', 'cs.CL'],
    keywords: [
      'machine learning',
      'neural network',
      'language model',
      'deep learning',
      'reinforcement learning',
      'artificial intelligence',
    ],
  },
  {
    key: 'computer-architecture',
    labelTr: 'Bilgisayar mimarisi',
    arxivCategories: ['cs.AR'],
    keywords: [
      'processor',
      'accelerator',
      'microarchitecture',
      'memory hierarchy',
      'hardware architecture',
      'cache coherence',
    ],
  },
  {
    key: 'quantum-physics',
    labelTr: 'Kuantum fiziği',
    arxivCategories: ['quant-ph'],
    keywords: ['quantum', 'qubit', 'entanglement', 'quantum error correction', 'quantum computing'],
  },
  {
    key: 'aerospace',
    labelTr: 'Havacılık ve uzay',
    arxivCategories: ['physics.space-ph', 'astro-ph.IM'],
    keywords: ['spacecraft', 'satellite', 'aerospace', 'aircraft', 'propulsion', 'orbital'],
  },
  {
    key: 'medicine',
    labelTr: 'Tıp',
    arxivCategories: ['q-bio.QM', 'physics.med-ph'],
    keywords: ['clinical', 'patients', 'medical', 'disease', 'diagnosis', 'therapy'],
  },
  {
    key: 'robotics',
    labelTr: 'Robotik',
    arxivCategories: ['cs.RO'],
    keywords: ['robot', 'robotic', 'manipulation', 'locomotion', 'autonomous navigation'],
  },
  {
    key: 'climate-science',
    labelTr: 'İklim bilimi',
    arxivCategories: ['physics.ao-ph'],
    keywords: ['climate', 'atmospheric', 'carbon', 'emissions', 'warming', 'precipitation'],
  },
];

const BY_KEY = new Map(TOPIC_CATALOG.map((topic) => [topic.key, topic]));

export const SUPPORTED_TOPIC_KEYS: readonly string[] = TOPIC_CATALOG.map((topic) => topic.key);

export function findTopic(key: string): TopicDefinition | undefined {
  return BY_KEY.get(key);
}

export function isSupportedTopicKey(key: string): boolean {
  return BY_KEY.has(key);
}
