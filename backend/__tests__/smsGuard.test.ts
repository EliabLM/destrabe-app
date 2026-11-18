import { afterEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: {
    NODE_ENV: 'test' as string,
    OTP_TEST_NUMBERS: ['+573000000001'],
    OTP_TEST_CODE: '123456' as string | undefined,
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    OTP_LOG_NUMBERS: ['+573000000009'],
    PLIVO_AUTH_ID: undefined as string | undefined,
    PLIVO_AUTH_TOKEN: undefined as string | undefined,
  },
}));
vi.mock('../src/lib/env', () => ({ env: envMock }));
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import {
  checkSmsAllowed,
  clientIpFromHeaders,
  evaluateSmsLimits,
  isOtpTestNumber,
  reserveSmsSend,
  smsHashes,
  UNKNOWN_IP,
  type SmsCounts,
  type SmsLimits,
} from '../src/lib/smsGuard';
import { maskPhone } from '../src/lib/logMask';

/** DCC-05: lógica de límites de SMS sin BD (la parte persistente va en db/). */

const limits: SmsLimits = {
  phone15Min: 3,
  phoneDay: 10,
  ipHour: 10,
  ipDay: 30,
  dailyCap: 50,
};
const zero: SmsCounts = {
  phone15Min: 0,
  phoneDay: 0,
  ipHour: 0,
  ipDay: 0,
  globalDay: 0,
};

describe('evaluateSmsLimits', () => {
  it('permite el envío por debajo de todos los límites', () => {
    expect(
      evaluateSmsLimits(
        { phone15Min: 2, phoneDay: 9, ipHour: 9, ipDay: 29, globalDay: 49 },
        limits,
      ),
    ).toBeNull();
  });

  it.each([
    ['PHONE_15MIN', { phone15Min: 3 }],
    ['PHONE_DAY', { phoneDay: 10 }],
    ['IP_HOUR', { ipHour: 10 }],
    ['IP_DAY', { ipDay: 30 }],
    ['DAILY_CAP', { globalDay: 50 }],
  ] as const)('bloquea al alcanzar %s', (reason, partial) => {
    expect(evaluateSmsLimits({ ...zero, ...partial }, limits)).toBe(reason);
  });

  it('el tope diario global tiene prioridad', () => {
    expect(
      evaluateSmsLimits({ ...zero, phone15Min: 3, globalDay: 50 }, limits),
    ).toBe('DAILY_CAP');
  });
});

describe('utilidades', () => {
  it('enmascara el teléfono', () => {
    expect(maskPhone('+573001234567')).toBe('+57******4567');
    expect(maskPhone('123')).toBe('***');
  });

  it('lee una IP válida de x-forwarded-for o usa el contador "unknown"', () => {
    expect(
      clientIpFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.7' })),
    ).toBe('203.0.113.7');
    expect(
      clientIpFromHeaders(
        new Headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }),
      ),
    ).toBe(UNKNOWN_IP);
    expect(clientIpFromHeaders(undefined)).toBe(UNKNOWN_IP);
  });

  it('no guarda teléfono ni IP en claro', () => {
    const { phoneHash, ipHash } = smsHashes('+573001234567', '203.0.113.7');
    expect(phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHash).not.toContain('3001234567');
    expect(ipHash).not.toBe(smsHashes('+573001234567', '203.0.113.8').ipHash);
  });

  it('los números de prueba solo valen fuera de producción', () => {
    envMock.NODE_ENV = 'test';
    expect(isOtpTestNumber('+573000000001')).toBe(true);
    expect(isOtpTestNumber('+573000000002')).toBe(false);
    envMock.NODE_ENV = 'production';
    expect(isOtpTestNumber('+573000000001')).toBe(false);
    envMock.NODE_ENV = 'test';
  });

  it.each(['+14155550100', '+576011234567', '3001234567', '+57300123456', 42])(
    'checkSmsAllowed rechaza %s con 400 sin tocar la BD',
    async (phone) => {
      await expect(checkSmsAllowed(phone, '203.0.113.7')).rejects.toMatchObject(
        { statusCode: 400 },
      );
    },
  );
});

describe('acceso restringido sin proveedor de SMS (DCC-22)', () => {
  const restricted = {
    statusCode: 403,
    body: {
      code: 'OTP_LOGIN_RESTRICTED',
      message: 'Por ahora el ingreso está limitado a cuentas de prueba.',
    },
  };

  afterEach(() => {
    envMock.NODE_ENV = 'test';
    envMock.PLIVO_AUTH_ID = undefined;
    envMock.PLIVO_AUTH_TOKEN = undefined;
  });

  it('en producción sin Plivo rechaza los números fuera de OTP_LOG_NUMBERS antes de tocar la BD', async () => {
    envMock.NODE_ENV = 'production';
    // `prisma` es un objeto vacío: si se llegara a la BD, fallaría con otro error.
    await expect(
      checkSmsAllowed('+573001234567', '203.0.113.7'),
    ).rejects.toMatchObject(restricted);
    await expect(
      reserveSmsSend('+573001234567', '203.0.113.7'),
    ).rejects.toMatchObject(restricted);
  });

  it('no rechaza los números de OTP_LOG_NUMBERS ni a nadie si hay Plivo o fuera de producción', async () => {
    const { isOtpDeliveryRestricted } = await import('../src/lib/otpDelivery');
    envMock.NODE_ENV = 'production';
    expect(isOtpDeliveryRestricted('+573000000009')).toBe(false);
    expect(isOtpDeliveryRestricted('+573001234567')).toBe(true);
    envMock.PLIVO_AUTH_ID = 'MAXXXXXXXXXXXXXXXXXX';
    envMock.PLIVO_AUTH_TOKEN = 'auth-token';
    expect(isOtpDeliveryRestricted('+573001234567')).toBe(false);
    envMock.PLIVO_AUTH_ID = undefined;
    envMock.PLIVO_AUTH_TOKEN = undefined;
    envMock.NODE_ENV = 'test';
    expect(isOtpDeliveryRestricted('+573001234567')).toBe(false);
  });
});
