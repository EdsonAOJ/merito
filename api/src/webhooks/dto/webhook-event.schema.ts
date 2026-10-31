import { z } from 'zod';

const accountId = z.string().min(1).max(64);
const resourceKey = z.string().min(1).max(64);
const transactionId = z.string().min(1).max(128);

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,8})?$/, 'Invalid decimal format');

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const envelope = {
  event_id: z.uuidv4(),
  occurred_at: z.iso.datetime({ offset: true }),
};

const snapshot = z.strictObject({
  ...envelope,
  type: z.literal('BALANCE_SNAPSHOT'),
  payload: z.strictObject({
    account_id: accountId,
    resource_key: resourceKey,
    reference_date: dateOnly,
    amount: decimal,
  }),
});

const deltaApplied = z.strictObject({
  ...envelope,
  type: z.literal('DELTA_APPLIED'),
  payload: z.strictObject({
    account_id: accountId,
    resource_key: resourceKey,
    transaction_id: transactionId,
    amount_delta: decimal,
    effective_date: dateOnly,
  }),
});

const deltaReverted = z.strictObject({
  ...envelope,
  type: z.literal('DELTA_REVERTED'),
  payload: z.strictObject({
    account_id: accountId,
    resource_key: resourceKey,
    transaction_id: transactionId,
  }),
});

export const webhookEventSchema = z.discriminatedUnion('type', [
  snapshot,
  deltaApplied,
  deltaReverted,
]);

export type WebhookEventDto = z.infer<typeof webhookEventSchema>;
