import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/lib/env';

/** DCC-05: variables de límites de SMS, proxy de confianza y OTP de pruebas. */

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

describe('env — límites de SMS y OTP de pruebas (DCC-05)', () => {
  it('aplica valores por defecto conservadores', () => {
    const env = parseEnv({ NODE_ENV: 'test' });
    expect(env.SMS_LIMIT_PHONE_15MIN).toBe(3);
    expect(env.SMS_LIMIT_PHONE_DAY).toBe(10);
    expect(env.SMS_LIMIT_IP_HOUR).toBe(10);
    expect(env.SMS_LIMIT_IP_DAY).toBe(30);
    expect(env.SMS_DAILY_CAP).toBe(50);
    expect(env.TRUST_PROXY).toBe('loopback,uniquelocal');
    expect(env.OTP_TEST_NUMBERS).toEqual([]);
    expect(env.OTP_TEST_CODE).toBeUndefined();
  });

  it('lee los límites desde variables de entorno', () => {
    const env = parseEnv({ NODE_ENV: 'test', SMS_DAILY_CAP: '7' });
    expect(env.SMS_DAILY_CAP).toBe(7);
  });

  it.each(['0', '-1', 'abc'])('rechaza SMS_DAILY_CAP=%s', (value) => {
    expect(() =>
      parseEnv({ NODE_ENV: 'test', SMS_DAILY_CAP: value }),
    ).toThrow();
  });

  it('acepta números de prueba +573 con código fijo fuera de producción', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      OTP_TEST_NUMBERS: '+573000000001, +573000000002',
      OTP_TEST_CODE: '123456',
    });
    expect(env.OTP_TEST_NUMBERS).toEqual(['+573000000001', '+573000000002']);
    expect(env.OTP_TEST_CODE).toBe('123456');
  });

  it('exige OTP_TEST_CODE si hay OTP_TEST_NUMBERS', () => {
    expect(() =>
      parseEnv({ NODE_ENV: 'test', OTP_TEST_NUMBERS: '+573000000001' }),
    ).toThrow('OTP_TEST_CODE');
  });

  it('rechaza números de prueba que no son móviles colombianos', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'test',
        OTP_TEST_NUMBERS: '+14155550100',
        OTP_TEST_CODE: '123456',
      }),
    ).toThrow();
  });

  it.each(['OTP_TEST_NUMBERS', 'OTP_TEST_CODE'])(
    'en producción el arranque falla si %s está definida',
    (name) => {
      const value = name === 'OTP_TEST_CODE' ? '123456' : '+573000000001';
      expect(() => parseEnv({ ...production, [name]: value })).toThrow(
        `${name} must not be set in production`,
      );
    },
  );
});
