import { z } from 'zod';

export const reconciliationRowSchema = z.strictObject({
  account_id: z.string().min(1).max(64),
  resource_key: z.string().min(1).max(64),
  reference_date: z.iso.date(),
  amount: z.string().regex(/^\d{1,20}(\.\d{1,8})?$/),
});

export type ReconciliationRow = z.infer<typeof reconciliationRowSchema>;
