import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

describe('Reconciliation (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let reconciliationService: ReconciliationService;
  let accountId: string;

  const adminKey = process.env.RECONCILIATION_ADMIN_KEY;
  const referenceDate = '2026-11-02';

  function createCsv(
    rows: string[],
    header = 'account_id,resource_key,reference_date,amount',
  ) {
    return [header, ...rows].join('\n');
  }

  function sendCsv(csv: string, key = adminKey) {
    const req = request(app.getHttpServer())
      .post('/reconciliations/import-csv')
      .set('Content-Type', 'text/csv');

    if (key !== undefined) {
      req.set('X-Admin-Key', key);
    }

    return req.send(csv);
  }

  async function createBalance(amount = '1000.00000000') {
    return prisma.accountBalance.create({
      data: {
        accountId,
        resourceKey: 'BRL',
        amount,
        referenceDate: new Date(`${referenceDate}T00:00:00.000Z`),
      },
    });
  }

  beforeAll(async () => {
    if (!adminKey) {
      throw new Error(
        'RECONCILIATION_ADMIN_KEY must be configured for E2E tests',
      );
    }

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });

    app.useBodyParser('text', {
      type: 'text/csv',
      limit: '64kb',
    });

    await app.init();
    prisma = app.get(PrismaService);
    reconciliationService = app.get(ReconciliationService);
  });

  beforeEach(() => {
    accountId = `REC-${randomUUID()}`;
  });

  afterEach(async () => {
    if (!prisma) return;

    await prisma.balanceReconciliation.deleteMany({
      where: { accountId },
    });

    await prisma.accountBalance.deleteMany({
      where: { accountId },
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('Authentication', () => {
    it('should reject CSV imports without an admin key', async () => {
      const csv = createCsv([
        `${accountId},BRL,${referenceDate},1000.00000000`,
      ]);

      await request(app.getHttpServer())
        .post('/reconciliations/import-csv')
        .set('Content-Type', 'text/csv')
        .send(csv)
        .expect(401);
    });

    it('should reject an invalid admin key', async () => {
      const csv = createCsv([
        `${accountId},BRL,${referenceDate},1000.00000000`,
      ]);

      await sendCsv(csv, 'invalid-admin-key').expect(401);
    });

    it('should protect JSON imports as well', async () => {
      await request(app.getHttpServer())
        .post('/reconciliations/import')
        .send({ rows: [] })
        .expect(401);
    });
  });

  describe('Balance reconciliation', () => {
    it('should return MATCH when amounts are equal', async () => {
      await createBalance();

      const csv = createCsv([
        `${accountId},BRL,${referenceDate},1000.00000000`,
      ]);

      const response = await sendCsv(csv).expect(201);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        account_id: accountId,
        resource_key: 'BRL',
        expected_amount: '1000',
        actual_amount: '1000',
        status: 'MATCH',
      });

      const records = await prisma.balanceReconciliation.count({
        where: { accountId },
      });

      expect(records).toBe(1);
    });

    it('should return MISMATCH when amounts differ', async () => {
      await createBalance();

      const csv = createCsv([
        `${accountId},BRL,${referenceDate},1200.00000000`,
      ]);

      const response = await sendCsv(csv).expect(201);

      expect(response.body[0]).toMatchObject({
        expected_amount: '1200',
        actual_amount: '1000',
        status: 'MISMATCH',
      });

      const saved = await prisma.balanceReconciliation.findFirst({
        where: { accountId },
      });

      expect(saved?.status).toBe('MISMATCH');
    });

    it('should return MISMATCH when the balance does not exist', async () => {
      const csv = createCsv([`${accountId},BRL,${referenceDate},500.00000000`]);

      const response = await sendCsv(csv).expect(201);

      expect(response.body[0]).toMatchObject({
        account_id: accountId,
        expected_amount: '500',
        actual_amount: null,
        status: 'MISMATCH',
      });
    });

    it('should reconcile multiple rows in a single import', async () => {
      await createBalance();

      const csv = createCsv([
        `${accountId},BRL,${referenceDate},1000.00000000`,
        `${accountId},BRL,${referenceDate},1200.00000000`,
      ]);

      const response = await sendCsv(csv).expect(201);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].status).toBe('MATCH');
      expect(response.body[1].status).toBe('MISMATCH');

      const records = await prisma.balanceReconciliation.count({
        where: { accountId },
      });

      expect(records).toBe(2);
    });

    it('should not modify the official balance after import', async () => {
      const originalBalance = await createBalance();

      const csv = createCsv([
        `${accountId},BRL,${referenceDate},1200.00000000`,
      ]);

      await sendCsv(csv).expect(201);

      const balance = await prisma.accountBalance.findUnique({
        where: { id: originalBalance.id },
      });

      expect(balance?.amount.toString()).toBe('1000');
      expect(balance?.snapshotVersion).toBe(originalBalance.snapshotVersion);
      expect(balance?.updatedAt.getTime()).toBe(
        originalBalance.updatedAt.getTime(),
      );
    });
  });

  describe('CSV validation', () => {
    it('should reject CSV without the required header', async () => {
      const csv = `${accountId},BRL,${referenceDate},1000.00000000`;

      await sendCsv(csv).expect(400);

      expect(
        await prisma.balanceReconciliation.count({
          where: { accountId },
        }),
      ).toBe(0);
    });

    it('should reject invalid decimal precision', async () => {
      const csv = createCsv([
        `${accountId},BRL,${referenceDate},1000.123456789`,
      ]);

      await sendCsv(csv).expect(400);

      expect(
        await prisma.balanceReconciliation.count({
          where: { accountId },
        }),
      ).toBe(0);
    });

    it('should reject negative amounts', async () => {
      const csv = createCsv([`${accountId},BRL,${referenceDate},-100.00`]);

      await sendCsv(csv).expect(400);
    });

    it('should reject invalid dates', async () => {
      const csv = createCsv([`${accountId},BRL,2026-02-30,1000.00`]);

      await sendCsv(csv).expect(400);
    });

    it('should reject additional columns', async () => {
      const csv = createCsv([
        `${accountId},BRL,${referenceDate},1000.00,extra`,
      ]);

      await sendCsv(csv).expect(400);
    });

    it('should reject empty CSV', async () => {
      await sendCsv('').expect(400);
    });

    it('should reject imports exceeding 100 rows', async () => {
      const rows = Array.from(
        { length: 101 },
        () => `${accountId},BRL,${referenceDate},1000.00`,
      );

      await sendCsv(createCsv(rows)).expect(400);

      expect(
        await prisma.balanceReconciliation.count({
          where: { accountId },
        }),
      ).toBe(0);
    });

    it('should not persist any rows when the CSV is invalid', async () => {
      await createBalance();

      const csv = createCsv([
        `${accountId},BRL,${referenceDate},1000.00`,
        `${accountId},BRL,${referenceDate},valor-invalido`,
      ]);

      await sendCsv(csv).expect(400);

      const records = await prisma.balanceReconciliation.count({
        where: { accountId },
      });

      expect(records).toBe(0);
    });
  });

  describe('Atomicity', () => {
    it('should roll back previous writes when a write fails', async () => {
      const validRow = {
        account_id: accountId,
        resource_key: 'BRL',
        reference_date: referenceDate,
        amount: '1000.00000000',
      };

      const invalidRow = {
        ...validRow,
        account_id: 'X'.repeat(65),
      };

      await expect(
        reconciliationService.reconcile([validRow, invalidRow]),
      ).rejects.toThrow();

      const records = await prisma.balanceReconciliation.count({
        where: { accountId },
      });

      expect(records).toBe(0);
    });
  });

  describe('JSON import', () => {
    it('should accept valid rows with an admin key', async () => {
      await createBalance();

      const response = await request(app.getHttpServer())
        .post('/reconciliations/import')
        .set('X-Admin-Key', adminKey!)
        .send({
          rows: [
            {
              account_id: accountId,
              resource_key: 'BRL',
              reference_date: referenceDate,
              amount: '1000.00000000',
            },
          ],
        })
        .expect(201);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].status).toBe('MATCH');
    });

    it('should reject invalid rows without persisting records', async () => {
      await request(app.getHttpServer())
        .post('/reconciliations/import')
        .set('X-Admin-Key', adminKey!)
        .send({
          rows: [
            {
              account_id: accountId,
              resource_key: 'BRL',
              reference_date: referenceDate,
              amount: 'invalid',
            },
          ],
        })
        .expect(400);

      expect(
        await prisma.balanceReconciliation.count({
          where: { accountId },
        }),
      ).toBe(0);
    });
  });

  describe('Reconciliation queries', () => {
    it('should reject requests without an admin key', async () => {
      await request(app.getHttpServer()).get('/reconciliations').expect(401);
    });

    it('should return reconciliations without exposing internal fields', async () => {
      await createBalance();

      const csv = createCsv([
        `${accountId},BRL,${referenceDate},1200.00000000`,
      ]);

      await sendCsv(csv).expect(201);

      const response = await request(app.getHttpServer())
        .get('/reconciliations')
        .set('X-Admin-Key', adminKey!)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeLessThanOrEqual(20);

      const record = response.body.find(
        (item: { account_id: string }) => item.account_id === accountId,
      );

      expect(record).toMatchObject({
        account_id: accountId,
        resource_key: 'BRL',
        expected_amount: '1200',
        actual_amount: '1000',
        status: 'MISMATCH',
      });

      expect(record).toHaveProperty('reference_date');
      expect(record).toHaveProperty('created_at');
      expect(record).not.toHaveProperty('id');
    });
  });
});
