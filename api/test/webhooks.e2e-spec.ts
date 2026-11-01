import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'node:crypto';

import { WebhooksModule } from '../src/webhooks/webhooks.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Webhooks E2E', () => {
  let app: INestApplication;
  let prismaService: PrismaService;

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
      imports: [WebhooksModule],
    }).compile();

    app = moduleRef.createNestApplication({
      rawBody: true,
    });

    prismaService = app.get(PrismaService);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function signBody(rawBody: string): string {
    const hash = createHmac('sha256', 'fake-secret')
      .update(rawBody)
      .digest('hex');

    return `sha256=${hash}`;
  }
  it('should reject a valid HMAC with an invalid webhook payload', async () => {
    const invalidEvent = { ...validEvent, event_id: 'uuid-invalid' };

    const rawBody = JSON.stringify(invalidEvent);

    const signature = signBody(rawBody);

    const response = await request(app.getHttpServer())
      .post('/webhooks/events')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signature)
      .send(rawBody);

    expect(response.status).toBe(400);
  });

  it('should reject requests with an invalid HMAC signature', async () => {
    const rawBody = JSON.stringify(validEvent);

    const signature = `sha256=${'0'.repeat(64)}`;

    const response = await request(app.getHttpServer())
      .post('/webhooks/events')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signature)
      .send(rawBody);

    expect(response.status).toBe(401);
  });

  it('should accept requests with a valid HMAC and webhook payload', async () => {
    const rawBody = JSON.stringify(validEvent);

    const signature = signBody(rawBody);

    const response = await request(app.getHttpServer())
      .post('/webhooks/events')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signature)
      .send(rawBody);

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('rejected');
    expect(response.body.reason_code).toBe('BALANCE_NOT_FOUND');
  });
});
