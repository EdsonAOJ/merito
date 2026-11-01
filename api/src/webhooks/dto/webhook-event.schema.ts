import { z } from 'zod';

const accountId = z.string().min(1).max(64);
const resourceKey = z.string().min(1).max(64);
const transactionId = z.string().min(1).max(128);

const decimalSchema = z
  .string()
  .regex(/^-?\d{1,20}(\.\d{1,8})?$/, 'Invalid decimal precision');

const dateOnly = z.iso.date();

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
    amount: decimalSchema,
  }),
});

const deltaApplied = z.strictObject({
  ...envelope,
  type: z.literal('DELTA_APPLIED'),
  payload: z.strictObject({
    account_id: accountId,
    resource_key: resourceKey,
    transaction_id: transactionId,
    amount_delta: decimalSchema,
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
