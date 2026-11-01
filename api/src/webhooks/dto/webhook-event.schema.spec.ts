import { webhookEventSchema } from './webhook-event.schema';

describe('Webhook event schema', () => {
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

  it('should reject amount_delta as a number', () => {
    const event = {
      ...validEvent,
      payload: {
        ...validEvent.payload,
        amount_delta: 250.5,
      },
    };
    const resultValidation = webhookEventSchema.safeParse(event);

    expect(resultValidation.success).toBe(false);
  });

  it('should accept a negative decimal string', () => {
    const event = {
      ...validEvent,
      payload: {
        ...validEvent.payload,
        amount_delta: '-250.5',
      },
    };
    const resultValidation = webhookEventSchema.safeParse(event);

    expect(resultValidation.success).toBe(true);
  });

  it('should reject a amount_delta bigger than 8 decimal caracter', () => {
    const event = {
      ...validEvent,
      payload: {
        ...validEvent.payload,
        amount_delta: '100.123456789',
      },
    };
    const resultValidation = webhookEventSchema.safeParse(event);

    expect(resultValidation.success).toBe(false);
  });

  it('should reject a webhook containing unknown payload fields', () => {
    const event = {
      ...validEvent,
      payload: {
        ...validEvent.payload,
        is_admin: true,
      },
    };
    const resultValidation = webhookEventSchema.safeParse(event);

    expect(resultValidation.success).toBe(false);

    if (resultValidation.success) {
      throw new Error('Expected webhook validation to fail');
    }

    const hasUnknownFieldsError = resultValidation.error.issues.some((issue) =>
      issue.code.includes('unrecognized_keys'),
    );
    expect(hasUnknownFieldsError).toBe(true);
  });

  it('should reject a webhook containing a invalid event_id', () => {
    const event = {
      ...validEvent,
      event_id: '123',
    };
    const resultValidation = webhookEventSchema.safeParse(event);

    expect(resultValidation.success).toBe(false);

    if (resultValidation.success) {
      throw new Error('Expected webhook validation to fail');
    }

    const hasInvalidEventIdError = resultValidation.error.issues.some((issue) =>
      issue.path.includes('event_id'),
    );
    expect(hasInvalidEventIdError).toBe(true);
  });
});
