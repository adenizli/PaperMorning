export const EMAIL_CHANNEL = 'EMAIL';

/**
 * SENT means the SMTP server accepted the message, not that it reached the inbox.
 * UNKNOWN means the outcome cannot be known and requires operator resolution; it is never
 * retried automatically. DISABLED means mail transport is not configured.
 */
export enum DeliveryStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
  DISABLED = 'DISABLED',
}

export interface EmailDeliveryModel {
  id: string;
  issueId: string;
  userId: string;
  channel: string;
  status: DeliveryStatus;
  recipient: string;
  attemptCount: number;
  retryable: boolean;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
