import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/lib/env';

const valid = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://api.example.invalid',
  CORS_ORIGIN: 'https://app.example.invalid',
  PAYMENT_GATEWAY: 'stub',
  PAYMENT_WEBHOOK_TOKEN: 'placeholder',
};

describe('production configuration', () => {
  it('accepts a stub demo without Plivo or MercadoPago credentials', () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.PLIVO_AUTH_ID).toBeUndefined();
    expect(env.MP_ACCESS_TOKEN).toBeUndefined();
  });

  it.each([
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'CORS_ORIGIN',
    'PAYMENT_WEBHOOK_TOKEN',
  ])('rejects absent %s with a named error', (name) => {
    const input: Record<string, string | undefined> = {
      ...valid,
      [name]: undefined,
    };
    expect(() => parseEnv(input)).toThrow(name);
  });
});
