import { BadRequestException } from '@nestjs/common';
import { WebhookValidationPipe } from './webhook-validation.pipe';

describe('validation pipe', () => {
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

  const pipe = new WebhookValidationPipe();

  it('should throw BadRequestException for a invalid webhook payload', () => {
    expect(() => pipe.transform({})).toThrow(BadRequestException);
  });

  it('should return the validated webhook event', () => {
    const resultPipe = pipe.transform(validEvent);

    expect(resultPipe).toEqual(validEvent);
  });
});
