import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/lib/env';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://api.example.invalid',
  CORS_ORIGIN: 'https://app.example.invalid',
  PAYMENT_GATEWAY: 'stub',
  PAYMENT_WEBHOOK_TOKEN: 'placeholder',
};

describe('CORS_ORIGIN outside local development (DCC-17)', () => {
  it('rejects "*" in production', () => {
    expect(() => parseEnv({ ...production, CORS_ORIGIN: ' * ' })).toThrow(
      'CORS_ORIGIN must not be "*" in production',
    );
  });

  it('accepts an explicit origin in production', () => {
    expect(parseEnv(production).CORS_ORIGIN).toBe(
      'https://app.example.invalid',
    );
  });
});
