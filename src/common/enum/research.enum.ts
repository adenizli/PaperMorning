/** Publication status as supported by source metadata; never inferred by an LLM. */
export enum PublicationStatus {
  PREPRINT = 'PREPRINT',
  PEER_REVIEWED = 'PEER_REVIEWED',
  UNKNOWN = 'UNKNOWN',
}

/** What the analysis actually read. FULL_TEXT only when permitted full text was processed. */
export enum ContentCoverage {
  ABSTRACT_ONLY = 'ABSTRACT_ONLY',
  FULL_TEXT = 'FULL_TEXT',
}
