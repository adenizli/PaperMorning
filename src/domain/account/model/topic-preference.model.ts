/** How much space a topic gets in the issue. Independent of knowledge level. */
export enum TopicPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/** What the reader already knows about the topic; shapes narration, never the science. */
export enum KnowledgeLevel {
  BEGINNER = 'BEGINNER',
  INTERMEDIATE = 'INTERMEDIATE',
  ADVANCED = 'ADVANCED',
}

export interface TopicPreferenceModel {
  userId: string;
  topicKey: string;
  priority: TopicPriority;
  knowledgeLevel: KnowledgeLevel;
}
