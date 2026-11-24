import { describe, expect, it } from 'vitest';
import { simulatePaymentSchema } from '../src/schemas/payment.schema';

describe('simulatePaymentSchema (#16)', () => {
  it.each(['approved', 'rejected'])('acepta result=%s', (result) => {
    expect(simulatePaymentSchema.parse({ result })).toEqual({ result });
  });

  it.each([{}, { result: 'CONFIRMED' }, { result: 1 }])(
    'rechaza %j',
    (body) => {
      expect(simulatePaymentSchema.safeParse(body).success).toBe(false);
    },
  );
});
