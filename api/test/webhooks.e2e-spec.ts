import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BalanceReasonCode } from '../src/balance/errors/balance-reason-code';
import { WebhookEventStatus } from '../src/generated/prisma/enums';

describe('Webhooks E2E', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  const createdBalanceIds: string[] = [];
  const createdEventIds: string[] = [];

  const validEvent = {
    event_id: '550e8400-e29b-41d4-a716-446655440000',
    type: 'DELTA_APPLIED',
    occurred_at: new Date().toISOString(),
    payload: {
      account_id: 'ACC-1001',
      resource_key: 'BRL',
      transaction_id: 'TX-001',
      amount_delta: '-250.5',
      effective_date: '2026-10-31',
    },
  };

  beforeAll(async () => {
    process.env.WEBHOOK_SECRET = 'fake-secret';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({
      rawBody: true,
    });

    prismaService = app.get(PrismaService);

    await app.init();
  });

  afterEach(async () => {
    if (createdBalanceIds.length > 0) {
      await prismaService.balanceTransaction.deleteMany({
        where: {
          balanceId: { in: createdBalanceIds },
        },
      });
    }

    if (createdEventIds.length > 0) {
      await prismaService.webhookEvent.deleteMany({
        where: {
          eventId: { in: createdEventIds },
        },
      });
    }

    if (createdBalanceIds.length > 0) {
      await prismaService.accountBalance.deleteMany({
        where: {
          id: { in: createdBalanceIds },
        },
      });
    }

    createdBalanceIds.length = 0;
    createdEventIds.length = 0;
  });

  afterAll(async () => {
    await app?.close();
  });

  function signBody(rawBody: string): string {
    const hash = createHmac('sha256', 'fake-secret')
      .update(rawBody)
      .digest('hex');

    return `sha256=${hash}`;
  }
  function sendWebhook(rawBody: string, signature = signBody(rawBody)) {
    return request(app.getHttpServer())
      .post('/webhooks/events')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signature)
      .send(rawBody);
  }

  describe('Assinatura e validação', () => {
    it('should reject a valid HMAC with an invalid webhook payload', async () => {
      const invalidEvent = { ...validEvent, event_id: 'uuid-invalid' };

      const rawBody = JSON.stringify(invalidEvent);

      const signature = signBody(rawBody);

      const response = await sendWebhook(rawBody, signature);

      expect(response.status).toBe(400);
    });

    it('should reject requests with an invalid HMAC signature', async () => {
      const event = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: `E2E-MISSING-${randomUUID()}`,
        },
      };

      const rawBody = JSON.stringify(event);

      const signature = `sha256=${'0'.repeat(64)}`;

      const response = await sendWebhook(rawBody, signature);

      expect(response.status).toBe(401);
    });

    it('should reject an event outside the replay window', async () => {
      const event = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: `E2E-${randomUUID()}`,
        },
      };

      const rawBody = JSON.stringify(event);

      const response = await request(app.getHttpServer())
        .post('/webhooks/events')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', signBody(rawBody))
        .send(rawBody);

      expect(response.status).toBe(401);

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: { eventId: event.event_id },
      });

      expect(savedEvent).toBeNull();
    });

    it('should reject a duplicate event outside the replay window', async () => {
      const event = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: `E2E-${randomUUID()}`,
        },
      };

      createdEventIds.push(event.event_id);

      await prismaService.webhookEvent.create({
        data: {
          eventId: event.event_id,
          type: 'DELTA_APPLIED',
          status: WebhookEventStatus.REJECTED,
          occurredAt: new Date(event.occurred_at),
          payload: event.payload,
          reasonCode: BalanceReasonCode.BALANCE_NOT_FOUND,
        },
      });

      const rawBody = JSON.stringify(event);

      const response = await request(app.getHttpServer())
        .post('/webhooks/events')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', signBody(rawBody))
        .send(rawBody);

      expect(response.status).toBe(401);

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: { eventId: event.event_id },
      });

      expect(savedEvent?.status).toBe(WebhookEventStatus.REJECTED);
      expect(savedEvent?.reasonCode).toBe(BalanceReasonCode.BALANCE_NOT_FOUND);
    });
  });

  describe('Aplicação de deltas', () => {
    it('should reject a delta when the balance does not exist', async () => {
      const event = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: `E2E-MISSING-${randomUUID()}`,
        },
      };
      createdEventIds.push(event.event_id);

      const rawBody = JSON.stringify(event);

      const signature = signBody(rawBody);

      const response = await sendWebhook(rawBody, signature);

      expect(response.status).toBe(202);
      expect(response.body.status).toBe('rejected');
      expect(response.body.reason_code).toBe('BALANCE_NOT_FOUND');
    });

    it('should apply a delta and persist the resulting balance', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });
      createdBalanceIds.push(balance.id);

      const event = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-30.00',
        },
      };
      createdEventIds.push(event.event_id);

      const rawBody = JSON.stringify(event);

      const response = await sendWebhook(rawBody);

      expect(response.status).toBe(202);
      expect(response.body.status).toBe('applied');

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].transactionId).toBe(event.payload.transaction_id);
      expect(transactions[0].amountDelta.toString()).toBe('-30');
      expect(updatedBalance?.amount.toString()).toBe('70');
    });

    it('should reject a delta that would result in a negative balance', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const event = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-150.00',
        },
      };

      createdEventIds.push(event.event_id);

      const rawBody = JSON.stringify(event);

      const response = await sendWebhook(rawBody);

      expect(response.status).toBe(202);
      expect(response.body.status).toBe('rejected');
      expect(response.body.reason_code).toBe(
        BalanceReasonCode.INSUFFICIENT_BALANCE,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe(balance.amount.toString());

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(0);

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: {
          eventId: event.event_id,
        },
      });

      expect(savedEvent?.status).toBe(WebhookEventStatus.REJECTED);
      expect(savedEvent?.reasonCode).toBe(
        BalanceReasonCode.INSUFFICIENT_BALANCE,
      );
    });

    it('should prevent a negative balance with concurrent deltas', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-80.00',
        },
      };

      const eventB = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-70.00',
        },
      };

      createdEventIds.push(eventA.event_id, eventB.event_id);

      const rawBodyA = JSON.stringify(eventA);
      const rawBodyB = JSON.stringify(eventB);

      const responses = await Promise.all([
        sendWebhook(rawBodyA),
        sendWebhook(rawBodyB),
      ]);

      const statuses = responses.map((response) => response.body.status);

      expect(responses[0].status).toBe(202);
      expect(responses[1].status).toBe(202);

      expect(statuses.filter((status) => status === 'applied')).toHaveLength(1);
      expect(statuses.filter((status) => status === 'rejected')).toHaveLength(
        1,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(['20', '30']).toContain(updatedBalance?.amount.toString());

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);

      const expectedBalance = balance.amount.plus(transactions[0].amountDelta);

      expect(updatedBalance?.amount.toString()).toBe(
        expectedBalance.toString(),
      );

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id],
          },
        },
      });

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.REJECTED,
        ),
      ).toHaveLength(1);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(1);

      expect(
        savedEvents.filter(
          (event) =>
            event.reasonCode === BalanceReasonCode.INSUFFICIENT_BALANCE,
        ),
      ).toHaveLength(1);
    });
  });

  describe('Idempotência', () => {
    it('should not apply the same event twice', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-80.00',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responses = await Promise.all([
        sendWebhook(rawBodyA),
        sendWebhook(rawBodyA),
      ]);

      const statuses = responses.map((response) => response.body.status);

      expect(responses[0].status).toBe(202);
      expect(responses[1].status).toBe(202);

      expect(statuses.filter((status) => status === 'applied')).toHaveLength(1);
      expect(statuses.filter((status) => status === 'duplicate')).toHaveLength(
        1,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('20');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);

      const expectedBalance = balance.amount.plus(transactions[0].amountDelta);

      expect(updatedBalance?.amount.toString()).toBe(
        expectedBalance.toString(),
      );

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvents).toHaveLength(1);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(1);
    });

    it('should reject the same event id with a different payload', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-80.00',
        },
      };

      const eventB = {
        ...eventA,
        payload: {
          ...eventA.payload,
          amount_delta: '-70.00',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);
      const rawBodyB = JSON.stringify(eventB);

      const firstResponse = await sendWebhook(rawBodyA);

      const secondResponse = await sendWebhook(rawBodyB);

      expect(firstResponse.status).toBe(202);
      expect(firstResponse.body.status).toBe('applied');

      expect(secondResponse.status).toBe(409);

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('20');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);

      const expectedBalance = balance.amount.plus(transactions[0].amountDelta);

      expect(updatedBalance?.amount.toString()).toBe(
        expectedBalance.toString(),
      );

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvents).toHaveLength(1);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(1);
    });

    it('should reject a duplicate transaction with a different event id', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-80.00',
        },
      };

      const eventB = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...eventA.payload,
          account_id: accountId,
          resource_key: resourceKey,
          amount_delta: '-80.00',
        },
      };

      createdEventIds.push(eventA.event_id, eventB.event_id);

      const rawBodyA = JSON.stringify(eventA);
      const rawBodyB = JSON.stringify(eventB);

      const firstResponse = await sendWebhook(rawBodyA);

      const secondResponse = await sendWebhook(rawBodyB);

      expect(firstResponse.status).toBe(202);
      expect(firstResponse.body.status).toBe('applied');

      expect(secondResponse.status).toBe(202);
      expect(secondResponse.body.status).toBe('rejected');
      expect(secondResponse.body.reason_code).toBe(
        BalanceReasonCode.DUPLICATE_TRANSACTION,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('20');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);

      const expectedBalance = balance.amount.plus(transactions[0].amountDelta);

      expect(updatedBalance?.amount.toString()).toBe(
        expectedBalance.toString(),
      );

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(2);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(1);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.REJECTED,
        ),
      ).toHaveLength(1);

      expect(
        savedEvents.filter(
          (event) =>
            event.reasonCode === BalanceReasonCode.DUPLICATE_TRANSACTION,
        ),
      ).toHaveLength(1);
    });
  });

  describe('Reversões', () => {
    it('should revert an applied delta and restore the balance', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-80.00',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const response = await sendWebhook(rawBodyA);

      expect(response.status).toBe(202);
      expect(response.body.status).toBe('applied');

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('20');

      const eventB = {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'DELTA_REVERTED',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: eventA.payload.transaction_id,
        },
      };

      createdEventIds.push(eventB.event_id);

      const rawBodyB = JSON.stringify(eventB);

      const responseReverted = await sendWebhook(rawBodyB);

      expect(responseReverted.status).toBe(202);
      expect(responseReverted.body.status).toBe('applied');

      const updatedBalanceReverted =
        await prismaService.accountBalance.findUnique({
          where: {
            id: balance.id,
          },
        });

      expect(updatedBalanceReverted?.amount.toString()).toBe('100');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);

      const expectedBalance = updatedBalance!.amount.plus(
        transactions[0].amountDelta.negated(),
      );

      expect(updatedBalanceReverted?.amount.toString()).toBe(
        expectedBalance.toString(),
      );

      expect(transactions[0].reversedAt).not.toBeNull();
      expect(transactions[0].reversedEventId).toBe(eventB.event_id);

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(2);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(2);
    });

    it('should reject a transaction that has already been reverted', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-80.00',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('applied');

      const eventB = {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'DELTA_REVERTED',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: eventA.payload.transaction_id,
        },
      };

      createdEventIds.push(eventB.event_id);

      const rawBodyB = JSON.stringify(eventB);

      const responseB = await sendWebhook(rawBodyB);

      expect(responseB.status).toBe(202);
      expect(responseB.body.status).toBe('applied');

      const eventC = {
        ...eventB,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
      };

      createdEventIds.push(eventC.event_id);

      const rawBodyC = JSON.stringify(eventC);

      const responseC = await sendWebhook(rawBodyC);

      expect(responseC.status).toBe(202);
      expect(responseC.body.status).toBe('rejected');
      expect(responseC.body.reason_code).toBe(
        BalanceReasonCode.TRANSACTION_ALREADY_REVERSED,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('100');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].amountDelta.toString()).toBe('-80');
      expect(transactions[0].reversedEventId).toBe(eventB.event_id);
      expect(transactions[0].reversedAt).not.toBeNull();

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id, eventC.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(3);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(2);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.REJECTED,
        ),
      ).toHaveLength(1);

      const rejectedEvent = savedEvents.find(
        (event) => event.status === WebhookEventStatus.REJECTED,
      );

      expect(rejectedEvent?.eventId).toBe(eventC.event_id);
      expect(rejectedEvent?.reasonCode).toBe(
        BalanceReasonCode.TRANSACTION_ALREADY_REVERSED,
      );
    });

    it('should revert a positive delta and restore the balance', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '50.00',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('applied');

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('150');

      const eventB = {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'DELTA_REVERTED',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: eventA.payload.transaction_id,
        },
      };

      createdEventIds.push(eventB.event_id);

      const rawBodyB = JSON.stringify(eventB);

      const responseB = await sendWebhook(rawBodyB);

      expect(responseB.status).toBe(202);
      expect(responseB.body.status).toBe('applied');

      const updatedBalanceReverted =
        await prismaService.accountBalance.findUnique({
          where: {
            id: balance.id,
          },
        });

      expect(updatedBalanceReverted?.amount.toString()).toBe('100');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].amountDelta.toString()).toBe('50');
      expect(transactions[0].reversedEventId).toBe(eventB.event_id);
      expect(transactions[0].reversedAt).not.toBeNull();

      const expectedBalance = updatedBalance!.amount.plus(
        transactions[0].amountDelta.negated(),
      );

      expect(updatedBalanceReverted?.amount.toString()).toBe(
        expectedBalance.toString(),
      );

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(2);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(2);
    });

    it('should reject a reversal when the balance is insufficient', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '50.00',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('applied');

      const balanceAfterCredit = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(balanceAfterCredit?.amount.toString()).toBe('150');

      const eventB = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-130.00',
        },
      };

      createdEventIds.push(eventB.event_id);

      const rawBodyB = JSON.stringify(eventB);

      const responseB = await sendWebhook(rawBodyB);

      expect(responseB.status).toBe(202);
      expect(responseB.body.status).toBe('applied');

      const balanceAfterWithdrawal =
        await prismaService.accountBalance.findUnique({
          where: {
            id: balance.id,
          },
        });

      expect(balanceAfterWithdrawal?.amount.toString()).toBe('20');

      const eventC = {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'DELTA_REVERTED',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: eventA.payload.transaction_id,
        },
      };

      createdEventIds.push(eventC.event_id);

      const rawBodyC = JSON.stringify(eventC);

      const responseC = await sendWebhook(rawBodyC);

      expect(responseC.status).toBe(202);
      expect(responseC.body.status).toBe('rejected');
      expect(responseC.body.reason_code).toBe(
        BalanceReasonCode.INSUFFICIENT_BALANCE,
      );

      const finalBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(finalBalance?.amount.toString()).toBe('20');

      const creditTransaction =
        await prismaService.balanceTransaction.findUnique({
          where: {
            balanceId_transactionId: {
              balanceId: balance.id,
              transactionId: eventA.payload.transaction_id,
            },
          },
        });

      expect(creditTransaction).not.toBeNull();
      expect(creditTransaction?.amountDelta.toString()).toBe('50');
      expect(creditTransaction?.reversedAt).toBeNull();
      expect(creditTransaction?.reversedEventId).toBeNull();

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(2);

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id, eventC.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(3);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(2);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.REJECTED,
        ),
      ).toHaveLength(1);

      const rejectedEvent = savedEvents.find(
        (event) => event.eventId === eventC.event_id,
      );

      expect(rejectedEvent?.status).toBe(WebhookEventStatus.REJECTED);
      expect(rejectedEvent?.reasonCode).toBe(
        BalanceReasonCode.INSUFFICIENT_BALANCE,
      );
    });

    it('should reject a reversal when the transaction does not exist', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'DELTA_REVERTED',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('rejected');
      expect(responseA.body.reason_code).toBe(
        BalanceReasonCode.TRANSACTION_NOT_FOUND,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('100');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(0);

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvent).not.toBeNull();
      expect(savedEvent?.status).toBe(WebhookEventStatus.REJECTED);
      expect(savedEvent?.reasonCode).toBe(
        BalanceReasonCode.TRANSACTION_NOT_FOUND,
      );
    });

    it('should reject a reversal from a previous snapshot version', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-30T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-30.00',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('applied');

      const balanceAfterDelta = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(balanceAfterDelta?.amount.toString()).toBe('70');

      const eventB = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'BALANCE_SNAPSHOT',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          amount: '200.00',
          reference_date: '2026-10-31',
        },
      };

      createdEventIds.push(eventB.event_id);

      const rawBodyB = JSON.stringify(eventB);

      const responseB = await sendWebhook(rawBodyB);

      expect(responseB.status).toBe(202);
      expect(responseB.body.status).toBe('applied');

      const balanceAfterSnapshot =
        await prismaService.accountBalance.findUnique({
          where: {
            id: balance.id,
          },
        });

      expect(balanceAfterSnapshot?.amount.toString()).toBe('200');
      expect(balanceAfterSnapshot?.snapshotVersion).toBe(2);

      const eventC = {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'DELTA_REVERTED',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: eventA.payload.transaction_id,
        },
      };

      createdEventIds.push(eventC.event_id);

      const rawBodyC = JSON.stringify(eventC);

      const responseC = await sendWebhook(rawBodyC);

      expect(responseC.status).toBe(202);
      expect(responseC.body.status).toBe('rejected');
      expect(responseC.body.reason_code).toBe(
        BalanceReasonCode.SNAPSHOT_VERSION_MISMATCH,
      );

      const finalBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(finalBalance?.amount.toString()).toBe('200');
      expect(finalBalance?.snapshotVersion).toBe(2);

      const originalTransaction =
        await prismaService.balanceTransaction.findUnique({
          where: {
            balanceId_transactionId: {
              balanceId: balance.id,
              transactionId: eventA.payload.transaction_id,
            },
          },
        });

      expect(originalTransaction?.snapshotVersion).toBe(1);
      expect(originalTransaction?.amountDelta.toString()).toBe('-30');
      expect(originalTransaction?.reversedAt).toBeNull();
      expect(originalTransaction?.reversedEventId).toBeNull();

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id, eventC.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(3);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(2);

      const rejectedEvent = savedEvents.find(
        (event) => event.eventId === eventC.event_id,
      );

      expect(rejectedEvent?.status).toBe(WebhookEventStatus.REJECTED);
      expect(rejectedEvent?.reasonCode).toBe(
        BalanceReasonCode.SNAPSHOT_VERSION_MISMATCH,
      );
    });

    it('should prevent double reversal with concurrent events', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-80.00',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('applied');

      const eventB = {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'DELTA_REVERTED',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: eventA.payload.transaction_id,
        },
      };

      const eventC = {
        ...eventB,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
      };

      createdEventIds.push(eventB.event_id, eventC.event_id);

      const rawBodyB = JSON.stringify(eventB);
      const rawBodyC = JSON.stringify(eventC);

      const [responseB, responseC] = await Promise.all([
        sendWebhook(rawBodyB),

        sendWebhook(rawBodyC),
      ]);

      expect(responseB.status).toBe(202);
      expect(responseC.status).toBe(202);

      const responses = [responseB.body, responseC.body];

      expect(
        responses.filter((response) => response.status === 'applied'),
      ).toHaveLength(1);

      expect(
        responses.filter((response) => response.status === 'rejected'),
      ).toHaveLength(1);

      const rejectedResponse = responses.find(
        (response) => response.status === 'rejected',
      );

      expect(rejectedResponse?.reason_code).toBe(
        BalanceReasonCode.TRANSACTION_ALREADY_REVERSED,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('100');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].reversedAt).not.toBeNull();

      const appliedReversalEventId =
        responseB.body.status === 'applied' ? eventB.event_id : eventC.event_id;

      expect(transactions[0].reversedEventId).toBe(appliedReversalEventId);

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id, eventC.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(3);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(2);

      const rejectedEvent = savedEvents.find(
        (event) => event.status === WebhookEventStatus.REJECTED,
      );

      expect(rejectedEvent?.reasonCode).toBe(
        BalanceReasonCode.TRANSACTION_ALREADY_REVERSED,
      );
    });
  });

  describe('Snapshots', () => {
    it('should create a balance from a snapshot event', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'BALANCE_SNAPSHOT',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          amount: '250.00',
          reference_date: '2026-10-31',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('applied');

      const savedBalance = await prismaService.accountBalance.findUnique({
        where: {
          accountId_resourceKey: {
            accountId,
            resourceKey,
          },
        },
      });

      if (savedBalance) {
        createdBalanceIds.push(savedBalance.id);
      }

      expect(savedBalance).not.toBeNull();
      expect(savedBalance?.amount.toString()).toBe('250');
      expect(savedBalance?.snapshotVersion).toBe(1);
      expect(savedBalance?.referenceDate?.toISOString()).toBe(
        '2026-10-31T00:00:00.000Z',
      );

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: savedBalance!.id,
        },
      });

      expect(transactions).toHaveLength(0);

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvent?.status).toBe(WebhookEventStatus.APPLIED);
    });

    it('should update an existing balance from a snapshot', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-30T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'BALANCE_SNAPSHOT',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          amount: '250.00',
          reference_date: '2026-10-31',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('applied');

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('250');
      expect(updatedBalance?.snapshotVersion).toBe(2);
      expect(updatedBalance?.referenceDate?.toISOString()).toBe(
        '2026-10-31T00:00:00.000Z',
      );

      const balances = await prismaService.accountBalance.findMany({
        where: {
          accountId,
          resourceKey,
        },
      });

      expect(balances).toHaveLength(1);

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvent?.status).toBe(WebhookEventStatus.APPLIED);
    });

    it('should reject an out-of-order snapshot', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 2,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'BALANCE_SNAPSHOT',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          amount: '200.00',
          reference_date: '2026-10-30',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('rejected');
      expect(responseA.body.reason_code).toBe(
        BalanceReasonCode.SNAPSHOT_OUT_OF_ORDER,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('100');
      expect(updatedBalance?.snapshotVersion).toBe(2);
      expect(updatedBalance?.referenceDate?.toISOString()).toBe(
        '2026-10-31T00:00:00.000Z',
      );

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvent?.status).toBe(WebhookEventStatus.REJECTED);
      expect(savedEvent?.reasonCode).toBe(
        BalanceReasonCode.SNAPSHOT_OUT_OF_ORDER,
      );
    });

    it('should reject a snapshot with a negative amount', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-30T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'BALANCE_SNAPSHOT',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          amount: '-50.00',
          reference_date: '2026-10-31',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('rejected');
      expect(responseA.body.reason_code).toBe(
        BalanceReasonCode.NEGATIVE_SNAPSHOT,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('100');
      expect(updatedBalance?.snapshotVersion).toBe(1);

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(0);

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvent?.status).toBe(WebhookEventStatus.REJECTED);
      expect(savedEvent?.reasonCode).toBe(BalanceReasonCode.NEGATIVE_SNAPSHOT);
    });

    it('should update a snapshot with the same reference date', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'BALANCE_SNAPSHOT',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          amount: '125.00',
          reference_date: '2026-10-31',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('applied');

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('125');
      expect(updatedBalance?.snapshotVersion).toBe(2);
      expect(updatedBalance?.referenceDate?.toISOString()).toBe(
        '2026-10-31T00:00:00.000Z',
      );

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvent?.status).toBe(WebhookEventStatus.APPLIED);
    });

    it('should replace the current balance with a newer snapshot', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-30T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-30.00',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('applied');

      const balanceAfterDelta = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(balanceAfterDelta?.amount.toString()).toBe('70');
      expect(balanceAfterDelta?.snapshotVersion).toBe(1);

      const eventB = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'BALANCE_SNAPSHOT',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          amount: '150.00',
          reference_date: '2026-10-31',
        },
      };

      createdEventIds.push(eventB.event_id);

      const rawBodyB = JSON.stringify(eventB);

      const responseB = await sendWebhook(rawBodyB);

      expect(responseB.status).toBe(202);
      expect(responseB.body.status).toBe('applied');

      const finalBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(finalBalance?.amount.toString()).toBe('150');
      expect(finalBalance?.snapshotVersion).toBe(2);

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].transactionId).toBe(eventA.payload.transaction_id);
      expect(transactions[0].amountDelta.toString()).toBe('-30');
      expect(transactions[0].snapshotVersion).toBe(1);
      expect(transactions[0].reversedAt).toBeNull();

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(2);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(2);
    });
  });

  describe('Consulta de saldo', () => {
    it('should return an existing account balance', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '150.00',
          snapshotVersion: 2,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const response = await request(app.getHttpServer())
        .get('/balances')
        .query({
          account_id: accountId,
          resource_key: resourceKey,
        });

      expect(response.status).toBe(200);
      expect(response.body.accountId).toBe(accountId);
      expect(response.body.resourceKey).toBe(resourceKey);
      expect(response.body.snapshotVersion).toBe(2);
      expect(response.body.amount).toBe('150');
    });

    it('should reject a balance query when the account does not exist', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const response = await request(app.getHttpServer())
        .get('/balances')
        .query({
          account_id: accountId,
          resource_key: resourceKey,
        });

      expect(response.status).toBe(422);
      expect(response.body.message).toBe('Balance not found');

      const balance = await prismaService.accountBalance.findUnique({
        where: {
          accountId_resourceKey: {
            accountId,
            resourceKey,
          },
        },
      });

      expect(balance).toBeNull();
    });

    it('should reject a balance query with missing parameters', async () => {
      const accountId = `E2E-${randomUUID()}`;

      const responseA = await request(app.getHttpServer())
        .get('/balances')
        .query({
          account_id: accountId,
        });

      expect(responseA.status).toBe(400);
      expect(responseA.body.message).toBe('Invalid format');

      const responseB = await request(app.getHttpServer())
        .get('/balances')
        .query({
          resource_key: 'BRL',
        });

      expect(responseB.status).toBe(400);

      const responseC = await request(app.getHttpServer())
        .get('/balances')
        .query({
          account_id: '',
          resource_key: 'BRL',
        });

      expect(responseC.status).toBe(400);

      const responseD = await request(app.getHttpServer())
        .get('/balances')
        .query({
          account_id: '   ',
          resource_key: 'BRL',
        });

      expect(responseD.status).toBe(400);
    });

    it('should return all balances for an account', async () => {
      const accountId = `E2E-${randomUUID()}`;

      const balanceA = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey: 'BRL',
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      const balanceB = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey: 'USD',
          amount: '50.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balanceA.id, balanceB.id);

      const response = await request(app.getHttpServer()).get(
        `/accounts/${accountId}/balances`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);

      expect(response.body[0].resource_key).toBe('BRL');
      expect(response.body[0].amount).toBe('100');
      expect(response.body[0].updated_at).toBe(
        balanceA.updatedAt.toISOString(),
      );

      expect(response.body[1].resource_key).toBe('USD');
      expect(response.body[1].amount).toBe('50');
      expect(response.body[1].updated_at).toBe(
        balanceB.updatedAt.toISOString(),
      );
    });
  });

  describe('Precisão decimal e limites', () => {
    it('should preserve decimal precision when applying deltas', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '0.10',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '0.20',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('applied');

      const balanceAfterCredit = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(balanceAfterCredit?.amount.toString()).toBe('0.3');

      const eventB = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-0.10',
        },
      };

      createdEventIds.push(eventB.event_id);

      const rawBodyB = JSON.stringify(eventB);

      const responseB = await sendWebhook(rawBodyB);

      expect(responseB.status).toBe(202);
      expect(responseB.body.status).toBe('applied');

      const finalBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(finalBalance?.amount.toString()).toBe('0.2');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(2);

      const creditTransaction = transactions.find(
        (transaction) =>
          transaction.transactionId === eventA.payload.transaction_id,
      );

      const debitTransaction = transactions.find(
        (transaction) =>
          transaction.transactionId === eventB.payload.transaction_id,
      );

      expect(creditTransaction?.amountDelta.toString()).toBe('0.2');
      expect(debitTransaction?.amountDelta.toString()).toBe('-0.1');

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(2);

      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(2);
    });

    it('should reject a delta exceeding decimal precision', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '0.123456789',
        },
      };

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(400);

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('100');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(0);

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvent).toBeNull();
    });

    it('should reject a delta exceeding decimal integer limits', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '123456789012345678901.00',
        },
      };

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(400);

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('100');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(0);

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvent).toBeNull();
    });

    it('should reject a delta when the resulting balance exceeds the database limit', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '99999999999999999999.00000000',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '1.00',
        },
      };

      createdEventIds.push(eventA.event_id);

      const rawBodyA = JSON.stringify(eventA);

      const responseA = await sendWebhook(rawBodyA);

      expect(responseA.status).toBe(202);
      expect(responseA.body.status).toBe('rejected');
      expect(responseA.body.reason_code).toBe(
        BalanceReasonCode.BALANCE_LIMIT_EXCEEDED,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('99999999999999999999');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(0);

      const savedEvent = await prismaService.webhookEvent.findUnique({
        where: {
          eventId: eventA.event_id,
        },
      });

      expect(savedEvent?.status).toBe(WebhookEventStatus.REJECTED);
      expect(savedEvent?.reasonCode).toBe(
        BalanceReasonCode.BALANCE_LIMIT_EXCEEDED,
      );
    });
  });

  describe('Concorrência entre eventos', () => {
    it('should maintain consistency with concurrent snapshot and delta', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-30T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        type: 'BALANCE_SNAPSHOT',
        payload: {
          account_id: accountId,
          resource_key: resourceKey,
          amount: '200.00',
          reference_date: '2026-10-31',
        },
      };

      const eventB = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-30.00',
        },
      };

      createdEventIds.push(eventA.event_id, eventB.event_id);

      const rawBodyA = JSON.stringify(eventA);
      const rawBodyB = JSON.stringify(eventB);

      const [responseA, responseB] = await Promise.all([
        sendWebhook(rawBodyA),

        sendWebhook(rawBodyB),
      ]);

      expect(responseA.status).toBe(202);
      expect(responseB.status).toBe(202);
      expect(responseA.body.status).toBe('applied');
      expect(responseB.body.status).toBe('applied');

      const finalBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(['170', '200']).toContain(finalBalance?.amount.toString());
      expect(finalBalance?.snapshotVersion).toBe(2);

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].amountDelta.toString()).toBe('-30');

      if (finalBalance?.amount.toString() === '170') {
        expect(transactions[0].snapshotVersion).toBe(2);
      } else {
        expect(transactions[0].snapshotVersion).toBe(1);
      }

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(2);
      expect(
        savedEvents.filter(
          (event) => event.status === WebhookEventStatus.APPLIED,
        ),
      ).toHaveLength(2);
    });

    it('should reject concurrent deltas with the same transaction id', async () => {
      const accountId = `E2E-${randomUUID()}`;
      const resourceKey = 'BRL';

      const balance = await prismaService.accountBalance.create({
        data: {
          accountId,
          resourceKey,
          amount: '100.00',
          snapshotVersion: 1,
          referenceDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });

      createdBalanceIds.push(balance.id);

      const eventA = {
        ...validEvent,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: {
          ...validEvent.payload,
          account_id: accountId,
          resource_key: resourceKey,
          transaction_id: `TX-${randomUUID()}`,
          amount_delta: '-30.00',
        },
      };

      const eventB = {
        ...eventA,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
      };

      createdEventIds.push(eventA.event_id, eventB.event_id);

      const rawBodyA = JSON.stringify(eventA);
      const rawBodyB = JSON.stringify(eventB);

      const [responseA, responseB] = await Promise.all([
        sendWebhook(rawBodyA),

        sendWebhook(rawBodyB),
      ]);

      expect(responseA.status).toBe(202);
      expect(responseB.status).toBe(202);

      const responses = [responseA.body, responseB.body];

      expect(
        responses.filter((response) => response.status === 'applied'),
      ).toHaveLength(1);

      expect(
        responses.filter((response) => response.status === 'rejected'),
      ).toHaveLength(1);

      const rejectedResponse = responses.find(
        (response) => response.status === 'rejected',
      );

      expect(rejectedResponse?.reason_code).toBe(
        BalanceReasonCode.DUPLICATE_TRANSACTION,
      );

      const updatedBalance = await prismaService.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(updatedBalance?.amount.toString()).toBe('70');

      const transactions = await prismaService.balanceTransaction.findMany({
        where: {
          balanceId: balance.id,
        },
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].transactionId).toBe(eventA.payload.transaction_id);
      expect(transactions[0].amountDelta.toString()).toBe('-30');

      const appliedEventId =
        responseA.body.status === 'applied' ? eventA.event_id : eventB.event_id;

      expect(transactions[0].appliedEventId).toBe(appliedEventId);

      const savedEvents = await prismaService.webhookEvent.findMany({
        where: {
          eventId: {
            in: [eventA.event_id, eventB.event_id],
          },
        },
      });

      expect(savedEvents).toHaveLength(2);

      const appliedEvent = savedEvents.find(
        (event) => event.status === WebhookEventStatus.APPLIED,
      );

      const rejectedEvent = savedEvents.find(
        (event) => event.status === WebhookEventStatus.REJECTED,
      );

      expect(appliedEvent?.eventId).toBe(appliedEventId);

      expect(rejectedEvent?.eventId).toBe(
        appliedEventId === eventA.event_id ? eventB.event_id : eventA.event_id,
      );

      expect(rejectedEvent?.reasonCode).toBe(
        BalanceReasonCode.DUPLICATE_TRANSACTION,
      );
    });
  });
});
