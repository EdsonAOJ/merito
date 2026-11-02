import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ReconciliationRow = {
  account_id: string;
  resource_key: string;
  reference_date: string;
  amount: string;
};

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcile(rows: ReconciliationRow[]) {
    return this.prisma.$transaction(
      async (tx) => {
        const results = [];

        for (const row of rows) {
          const balance = await tx.accountBalance.findUnique({
            where: {
              accountId_resourceKey: {
                accountId: row.account_id,
                resourceKey: row.resource_key,
              },
            },
          });

          const expectedAmount = new Prisma.Decimal(row.amount);
          const actualAmount = balance?.amount ?? null;

          const status =
            actualAmount !== null && expectedAmount.equals(actualAmount)
              ? 'MATCH'
              : 'MISMATCH';

          const result = await tx.balanceReconciliation.create({
            data: {
              accountId: row.account_id,
              resourceKey: row.resource_key,
              referenceDate: new Date(`${row.reference_date}T00:00:00.000Z`),
              expectedAmount,
              actualAmount,
              status,
            },
          });

          results.push({
            account_id: result.accountId,
            resource_key: result.resourceKey,
            expected_amount: result.expectedAmount.toString(),
            actual_amount: result.actualAmount?.toString() ?? null,
            status: result.status,
          });
        }

        return results;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async getRecentReconciliations() {
    const records = await this.prisma.balanceReconciliation.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      select: {
        accountId: true,
        resourceKey: true,
        referenceDate: true,
        expectedAmount: true,
        actualAmount: true,
        status: true,
        createdAt: true,
      },
    });

    return records.map((record) => ({
      account_id: record.accountId,
      resource_key: record.resourceKey,
      reference_date: record.referenceDate.toISOString().slice(0, 10),
      expected_amount: record.expectedAmount.toString(),
      actual_amount: record.actualAmount?.toString() ?? null,
      status: record.status,
      created_at: record.createdAt.toISOString(),
    }));
  }
}
