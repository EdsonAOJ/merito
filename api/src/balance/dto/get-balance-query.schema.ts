import { z } from 'zod';

export const getBalanceQuerySchema = z.object({
  account_id: z.string().trim().min(1),
  resource_key: z.string().trim().min(1),
});

export type GetBalanceQueryDto = z.infer<typeof getBalanceQuerySchema>;
