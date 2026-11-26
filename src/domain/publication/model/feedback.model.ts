export type FeedbackValue = 1 | -1;

/** One active vote per (user, issue, content key); changing it updates the same row. */
export interface FeedbackModel {
  id: string;
  userId: string;
  issueId: string;
  contentKey: string;
  value: FeedbackValue;
  createdAt: Date;
  updatedAt: Date;
}
