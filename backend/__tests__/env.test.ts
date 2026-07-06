import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/lib/env';

describe('parseEnv', () => {
  it('parses valid env into a typed object', () => {
    const env = parseEnv({ PORT: '3000', NODE_ENV: 'test' });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('test');
  });

  it('defaults NODE_ENV to development when absent', () => {
    const env = parseEnv({
      PORT: '3000',
      REDIS_URL: 'redis://localhost:6379',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      BETTER_AUTH_URL: 'http://localhost:3000',
    });
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws mentioning PORT when PORT is not numeric', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });
});

/**
 * T10 — Ampliación tests de env (REQ-004)
 *
 * Valida las vars de auth introducidas en T1:
 *  - envs auth válidos → `env.BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` seteados,
 *    y `PLIVO_*` quedan como `string | undefined` (opcionales en modo dev).
 *  - `BETTER_AUTH_SECRET` ausente → lanza error que menciona `BETTER_AUTH_SECRET`.
 *  - `BETTER_AUTH_SECRET` presente pero < 32 chars → error que lo menciona.
 *  - `BETTER_AUTH_URL` ausente o inválida → error que menciona `BETTER_AUTH_URL`.
 *
 * Nota: para forzar la rama *requerido* (no test-defaults) usamos
 * `NODE_ENV: 'development'` en el input; con `NODE_ENV: 'test'` los defaults
 * del fixture se aplicarían y no validaríamos el caso de ausencia real.
 */
describe('parseEnv — auth vars (REQ-004)', () => {
  const VALID_SECRET = 'a'.repeat(32);
  const VALID_URL = 'http://localhost:3000';

  it('sets BETTER_AUTH_SECRET and BETTER_AUTH_URL when provided (valid)', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      REDIS_URL: 'redis://localhost:6379',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: VALID_URL,
    });
    expect(env.BETTER_AUTH_SECRET).toBe(VALID_SECRET);
    expect(env.BETTER_AUTH_URL).toBe(VALID_URL);
  });

  it('keeps PLIVO_* as string | undefined when not provided', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      REDIS_URL: 'redis://localhost:6379',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: VALID_URL,
    });
    expect(env.PLIVO_AUTH_ID).toBeUndefined();
    expect(env.PLIVO_AUTH_TOKEN).toBeUndefined();
    expect(env.PLIVO_PHONE_NUMBER).toBeUndefined();
  });

  it('keeps PLIVO_* values when provided', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      REDIS_URL: 'redis://localhost:6379',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: VALID_URL,
      PLIVO_AUTH_ID: 'auth-id',
      PLIVO_AUTH_TOKEN: 'auth-token',
      PLIVO_PHONE_NUMBER: '+571234567890',
    });
    expect(env.PLIVO_AUTH_ID).toBe('auth-id');
    expect(env.PLIVO_AUTH_TOKEN).toBe('auth-token');
    expect(env.PLIVO_PHONE_NUMBER).toBe('+571234567890');
  });

  it('throws mentioning BETTER_AUTH_SECRET when it is absent (non-test env)', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'development',
        BETTER_AUTH_URL: VALID_URL,
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('throws mentioning BETTER_AUTH_SECRET when it is shorter than 32 chars', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'development',
        BETTER_AUTH_SECRET: 'too-short',
        BETTER_AUTH_URL: VALID_URL,
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('throws mentioning BETTER_AUTH_URL when it is absent (non-test env)', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'development',
        BETTER_AUTH_SECRET: VALID_SECRET,
      }),
    ).toThrow(/BETTER_AUTH_URL/);
  });

  it('throws mentioning BETTER_AUTH_URL when it is not a valid URL', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'development',
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: 'not-a-url',
      }),
    ).toThrow(/BETTER_AUTH_URL/);
  });
});

/**
 * T10 — Ampliación tests env vars de servicio (REQ-008)
 *
 * Valida:
 *  - REDIS_URL requerida en dev/prod, opcional en test (default aplicado)
 *  - SERVICE_TIMEOUT_MINUTES default 15
 *  - NEARBY_RADIUS_KM default 5
 *
 * Ver spec: docs/specs/cambio-004-servicios/spec.md (REQ-008)
 */
describe('parseEnv — service env vars T10 (REQ-008)', () => {
  const VALID_SECRET = 'a'.repeat(32);
  const VALID_URL = 'http://localhost:3000';

  it('allows REDIS_URL to be absent in test mode (uses default)', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: VALID_URL,
    });
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('throws mentioning REDIS_URL when absent in development mode', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'development',
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: VALID_URL,
      }),
    ).toThrow(/REDIS_URL/);
  });

  it('throws mentioning REDIS_URL when absent in production mode', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: VALID_URL,
      }),
    ).toThrow(/REDIS_URL/);
  });

  it('accepts REDIS_URL when explicitly provided in development', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      REDIS_URL: 'redis://custom:6379',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: VALID_URL,
    });
    expect(env.REDIS_URL).toBe('redis://custom:6379');
  });

  it('defaults SERVICE_TIMEOUT_MINUTES to 15 when absent', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: VALID_URL,
    });
    expect(env.SERVICE_TIMEOUT_MINUTES).toBe(15);
  });

  it('accepts SERVICE_TIMEOUT_MINUTES override', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      SERVICE_TIMEOUT_MINUTES: '30',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: VALID_URL,
    });
    expect(env.SERVICE_TIMEOUT_MINUTES).toBe(30);
  });

  it('defaults NEARBY_RADIUS_KM to 5 when absent', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: VALID_URL,
    });
    expect(env.NEARBY_RADIUS_KM).toBe(5);
  });

  it('accepts NEARBY_RADIUS_KM override', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      NEARBY_RADIUS_KM: '10',
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: VALID_URL,
    });
    expect(env.NEARBY_RADIUS_KM).toBe(10);
  });
});
