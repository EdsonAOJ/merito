import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from './webhook-signature';

describe('verifyWebhookSignature', () => {
  const secret = 'fake-secret';
  const rawBody = Buffer.from('{"event_id":"123"}');

  const validSignature =
    'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

  it('should accepts a valid signature', () => {
    expect(verifyWebhookSignature(rawBody, validSignature, secret)).toBe(true);
  });

  it('should rejects an invalid signature', () => {
    const invalidSignature = `sha256=${'0'.repeat(64)}`;

    expect(verifyWebhookSignature(rawBody, invalidSignature, secret)).toBe(
      false,
    );
  });

  it('should rejects a modified request body', () => {
    const modifiedBody = Buffer.from('{"event_id":"456"}');

    expect(verifyWebhookSignature(modifiedBody, validSignature, secret)).toBe(
      false,
    );
  });

  it('should rejects malformed signatures', () => {
    expect(verifyWebhookSignature(rawBody, 'invalid', secret)).toBe(false);
  });

  it('should rejects missing signatures', () => {
    expect(verifyWebhookSignature(rawBody, undefined, secret)).toBe(false);
  });
});
