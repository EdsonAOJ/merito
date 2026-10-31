import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PATTERN = /^sha256=([a-fA-F0-9]{64})$/;

export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!Buffer.isBuffer(rawBody) || !signature || !secret) {
    return false;
  }

  const match = SIGNATURE_PATTERN.exec(signature);

  if (!match) {
    return false;
  }

  const receivedSignature = Buffer.from(match[1], 'hex');

  const expectedSignature = createHmac('sha256', secret)
    .update(rawBody)
    .digest();

  return timingSafeEqual(receivedSignature, expectedSignature);
}
