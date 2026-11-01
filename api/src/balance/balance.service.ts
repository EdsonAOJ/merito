import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { WebhookEventDto } from '../webhooks/dto/webhook-event.schema';
import { BalanceBusinessException } from './errors/balance-business.exception';
import { BalanceReasonCode } from './errors/balance-reason-code';
import { PrismaService } from '../prisma/prisma.service';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class BalanceService {
  private readonly maxBalance = new Prisma.Decimal(
    '99999999999999999999.99999999',
  );

  constructor(private readonly prisma: PrismaService) {}

  async getBalance(accountId: string, resourceKey: string) {
    const balance = await this.prisma.accountBalance.findUnique({
      where: {
        accountId_resourceKey: {
          accountId,
          resourceKey,
        },
      },
    });

    if (!balance)
      throw new BalanceBusinessException(
        BalanceReasonCode.BALANCE_NOT_FOUND,
        'Balance not found',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    return balance;
  }

  async apply(tx: TransactionClient, event: WebhookEventDto): Promise<void> {
    switch (event.type) {
      case 'BALANCE_SNAPSHOT':
        await this.applySnapshot(tx, event);
        return;

      case 'DELTA_APPLIED':
        await this.applyDelta(tx, event);
        return;

      case 'DELTA_REVERTED':
        await this.revertDelta(tx, event);
        return;

      default:
        throw new Error('Tipo não implementado');
    }
  }

  private async applyDelta(
    tx: TransactionClient,
    event: Extract<WebhookEventDto, { type: 'DELTA_APPLIED' }>,
  ) {
    const existingBalance = await tx.accountBalance.findUnique({
      where: {
        accountId_resourceKey: {
          accountId: event.payload.account_id,
          resourceKey: event.payload.resource_key,
        },
      },
    });

    if (!existingBalance)
      throw new BalanceBusinessException(
        BalanceReasonCode.BALANCE_NOT_FOUND,
        'Balance not found',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const existingTransaction = await tx.balanceTransaction.findUnique({
      where: {
        balanceId_transactionId: {
          balanceId: existingBalance.id,
          transactionId: event.payload.transaction_id,
        },
      },
    });

    if (existingTransaction)
      throw new BalanceBusinessException(
        BalanceReasonCode.DUPLICATE_TRANSACTION,
        'Transaction already exists',
        HttpStatus.CONFLICT,
      );

    const currentAmount = existingBalance.amount;
    const delta = new Prisma.Decimal(event.payload.amount_delta);

    const newAmount = currentAmount.plus(delta);

    if (newAmount.greaterThan(this.maxBalance)) {
      throw new BalanceBusinessException(
        BalanceReasonCode.BALANCE_LIMIT_EXCEEDED,
        'Balance exceeds database limit',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (newAmount.isNegative())
      throw new BalanceBusinessException(
        BalanceReasonCode.INSUFFICIENT_BALANCE,
        'Insufficient balance',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    await tx.balanceTransaction.create({
      data: {
        amountDelta: delta,
        effectiveDate: new Date(
          `${event.payload.effective_date}T00:00:00.000Z`,
        ),
        snapshotVersion: existingBalance.snapshotVersion,
        transactionId: event.payload.transaction_id,
        balanceId: existingBalance.id,
        appliedEventId: event.event_id,
      },
    });

    await tx.accountBalance.update({
      where: {
        id: existingBalance.id,
      },
      data: {
        amount: {
          increment: delta,
        },
      },
    });
  }

  private async applySnapshot(
    tx: TransactionClient,
    event: Extract<WebhookEventDto, { type: 'BALANCE_SNAPSHOT' }>,
  ) {
    const referenceDate = new Date(
      `${event.payload.reference_date}T00:00:00.000Z`,
    );

    const existingBalance = await tx.accountBalance.findUnique({
      where: {
        accountId_resourceKey: {
          accountId: event.payload.account_id,
          resourceKey: event.payload.resource_key,
        },
      },
    });

    if (
      existingBalance?.referenceDate &&
      existingBalance.referenceDate > referenceDate
    )
      throw new BalanceBusinessException(
        BalanceReasonCode.SNAPSHOT_OUT_OF_ORDER,
        'Snapshot reference date is older than current',
        HttpStatus.CONFLICT,
      );

    const amount = new Prisma.Decimal(event.payload.amount);

    if (amount.isNegative())
      throw new BalanceBusinessException(
        BalanceReasonCode.NEGATIVE_SNAPSHOT,
        'Negative snapshot amount',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    await tx.accountBalance.upsert({
      where: {
        accountId_resourceKey: {
          resourceKey: event.payload.resource_key,
          accountId: event.payload.account_id,
        },
      },
      create: {
        accountId: event.payload.account_id,
        resourceKey: event.payload.resource_key,
        amount,
        snapshotVersion: 1,
        referenceDate,
      },
      update: {
        amount,
        snapshotVersion: { increment: 1 },
        referenceDate,
      },
    });
  }

  private async revertDelta(
    tx: TransactionClient,
    event: Extract<WebhookEventDto, { type: 'DELTA_REVERTED' }>,
  ) {
    const existingBalance = await tx.accountBalance.findUnique({
      where: {
        accountId_resourceKey: {
          accountId: event.payload.account_id,
          resourceKey: event.payload.resource_key,
        },
      },
    });

    if (!existingBalance)
      throw new BalanceBusinessException(
        BalanceReasonCode.BALANCE_NOT_FOUND,
        'Balance not found',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const existingTransaction = await tx.balanceTransaction.findUnique({
      where: {
        balanceId_transactionId: {
          balanceId: existingBalance.id,
          transactionId: event.payload.transaction_id,
        },
      },
    });

    if (!existingTransaction)
      throw new BalanceBusinessException(
        BalanceReasonCode.TRANSACTION_NOT_FOUND,
        'Transaction not found',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    if (existingTransaction.reversedAt)
      throw new BalanceBusinessException(
        BalanceReasonCode.TRANSACTION_ALREADY_REVERSED,
        'Transaction already done',
        HttpStatus.CONFLICT,
      );

    if (existingTransaction.snapshotVersion !== existingBalance.snapshotVersion)
      throw new BalanceBusinessException(
        BalanceReasonCode.SNAPSHOT_VERSION_MISMATCH,
        'Transaction belongs to a different snapshot version',
        HttpStatus.CONFLICT,
      );

    const currentAmount = existingBalance.amount;
    const delta = existingTransaction.amountDelta.negated();

    const newAmount = currentAmount.plus(delta);

    if (newAmount.greaterThan(this.maxBalance)) {
      throw new BalanceBusinessException(
        BalanceReasonCode.BALANCE_LIMIT_EXCEEDED,
        'Balance exceeds database limit',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (newAmount.isNegative())
      throw new BalanceBusinessException(
        BalanceReasonCode.INSUFFICIENT_BALANCE,
        'Insufficient balance',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    await tx.balanceTransaction.update({
      where: {
        balanceId_transactionId: {
          balanceId: existingBalance.id,
          transactionId: event.payload.transaction_id,
        },
      },
      data: {
        reversedEventId: event.event_id,
        reversedAt: new Date(),
      },
    });

    await tx.accountBalance.update({
      where: {
        id: existingBalance.id,
      },
      data: {
        amount: {
          increment: delta,
        },
      },
    });
  }
}
