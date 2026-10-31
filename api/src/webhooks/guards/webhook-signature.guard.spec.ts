import {
  ExecutionContext,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';

import { WebhookSignatureGuard } from './webhook-signature.guard';

describe('WebhookSignatureGuard', () => {
  const secret = 'fake-secret';

  let guard: WebhookSignatureGuard;
  let originalSecret: string | undefined;

  beforeAll(() => {
    originalSecret = process.env.WEBHOOK_SECRET;
  });

  beforeEach(() => {
    process.env.WEBHOOK_SECRET = secret;
    guard = new WebhookSignatureGuard();
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.WEBHOOK_SECRET;
    } else {
      process.env.WEBHOOK_SECRET = originalSecret;
    }
  });

  function createMockContext(
    rawBody: Buffer | undefined,
    signature?: string,
  ): ExecutionContext {
    const request = {
      rawBody,
      get: jest.fn((headerName: string) => {
        if (headerName.toLowerCase() === 'x-webhook-signature') {
          return signature;
        }

        return undefined;
      }),
    } as unknown as Request;

    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
      }),
    } as unknown as ExecutionContext;
  }

  function signBody(body: Buffer): string {
    const hash = createHmac('sha256', secret).update(body).digest('hex');

    return `sha256=${hash}`;
  }

  it('should accepts requests with a valid HMAC signature', () => {
    const rawBody = Buffer.from('{"event_id":"123"}');
    const signature = signBody(rawBody);
    const context = createMockContext(rawBody, signature);

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should reject requests without a signature', () => {
    const rawBody = Buffer.from('{"event_id":"123"}');
    const context = createMockContext(rawBody);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should reject requests with an invalid signature', () => {
    const rawBody = Buffer.from('{"event_id":"123"}');
    const invalidSignature = `sha256=${'0'.repeat(64)}`;
    const context = createMockContext(rawBody, invalidSignature);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should reject requests without a raw body', () => {
    const context = createMockContext(undefined, 'sha256=invalid');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should fail when WEBHOOK_SECRET is not configured', () => {
    delete process.env.WEBHOOK_SECRET;

    const rawBody = Buffer.from('{"event_id":"123"}');
    const context = createMockContext(rawBody, signBody(rawBody));

    expect(() => guard.canActivate(context)).toThrow(
      InternalServerErrorException,
    );
  });
});
