import { BadRequestException } from '@nestjs/common';
import {
  reconciliationRowSchema,
  type ReconciliationRow,
} from './reconciliation.schema';

const HEADER = 'account_id,resource_key,reference_date,amount';

export function parseReconciliationCsv(csv: string): ReconciliationRow[] {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);

  if (lines[0] !== HEADER || lines.length < 2 || lines.length > 101) {
    throw new BadRequestException('Invalid format');
  }

  const rows = lines.slice(1).map((line) => {
    const columns = line.split(',');

    if (columns.length !== 4) {
      throw new BadRequestException('Invalid format');
    }

    return {
      account_id: columns[0],
      resource_key: columns[1],
      reference_date: columns[2],
      amount: columns[3],
    };
  });

  const result = reconciliationRowSchema.array().safeParse(rows);

  if (!result.success) {
    throw new BadRequestException('Invalid format');
  }

  return result.data;
}
