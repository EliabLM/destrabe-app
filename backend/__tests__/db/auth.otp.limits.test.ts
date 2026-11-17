import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

/**
 * DCC-05 — Límites del OTP por SMS persistidos en Postgres.
 *
 * Requiere Postgres (`npm run db:up` o el job "Contratos DB" de CI). El
 * proveedor SMS está simulado: nunca se envían SMS reales. Cada prueba carga
 * la app de nuevo (`vi.resetModules`) con sus propias variables de entorno,
 * lo que además equivale a reiniciar el proceso.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://destrabe:destrabe@localhost:5432/destrabe_db';

const { captured, sendOtpMock } = vi.hoisted(() => {
  const captured: { phoneNumber: string; code: string }[] = [];
  return {
    captured,
    sendOtpMock: vi.fn(async (phoneNumber: string, code: string) => {
      captured.push({ phoneNumber, code });
    }),
  };
});
vi.mock('../../src/lib/plivo', () => ({ sendOtp: sendOtpMock }));

const db = new PrismaClient();
const loadedPrismas: { $disconnect: () => Promise<void> }[] = [];

const ENV_KEYS = [
  'SMS_LIMIT_PHONE_15MIN',
  'SMS_LIMIT_PHONE_DAY',
  'SMS_LIMIT_IP_HOUR',
  'SMS_LIMIT_IP_DAY',
  'SMS_DAILY_CAP',
  'OTP_TEST_NUMBERS',
  'OTP_TEST_CODE',
] as const;

/** Carga una app nueva (nuevo `env`, Better Auth y Prisma) = reinicio. */
async function loadApp(
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {},
) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, overrides);
  vi.resetModules();
  const { createApp } = await import('../../src/app');
  const guard = await import('../../src/lib/smsGuard');
  const { prisma } = await import('../../src/lib/prisma');
  loadedPrismas.push(prisma);
  return { app: createApp(), guard };
}

async function truncate() {
  await db.$executeRawUnsafe(
    'TRUNCATE "SmsSendLog", "Session", "Account", "Verification", "User" CASCADE;',
  );
}

function sendOtp(
  app: Parameters<typeof request>[0],
  phoneNumber: string,
  ip = '203.0.113.10',
) {
  return request(app)
    .post('/api/auth/phone-number/send-otp')
    .set('X-Forwarded-For', ip)
    .send({ phoneNumber });
}

/** Registra envíos antiguos (fuera de la ventana corta) directamente en BD. */
async function seedSends(
  guard: typeof import('../../src/lib/smsGuard'),
  n: number,
  phone: string,
  ip: string,
  agoMs: number,
) {
  const { phoneHash, ipHash } = guard.smsHashes(phone, ip);
  const createdAt = new Date(Date.now() - agoMs);
  await db.smsSendLog.createMany({
    data: Array.from({ length: n }, () => ({ phoneHash, ipHash, createdAt })),
  });
}

const HOUR = 3_600_000;
const phone = (n: number) => `+57300700${String(n).padStart(4, '0')}`;

beforeAll(async () => {
  await db.$connect();
});

beforeEach(async () => {
  await truncate();
  captured.length = 0;
  sendOtpMock.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  vi.restoreAllMocks();
});

afterAll(async () => {
  await truncate();
  await Promise.all(loadedPrismas.map((p) => p.$disconnect()));
  await db.$disconnect();
});

describe('OTP por SMS — límites persistentes (DCC-05)', () => {
  it('por número: el 4.º envío en 15 min → 429 y el contador sobrevive a un reinicio', async () => {
    const first = await loadApp();
    for (let i = 0; i < 3; i++) {
      const res = await sendOtp(first.app, phone(1), `203.0.113.${20 + i}`);
      expect(res.status).toBe(200);
    }
    const fourth = await sendOtp(first.app, phone(1), '203.0.113.30');
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe('TOO_MANY_OTP_REQUESTS');
    expect(sendOtpMock).toHaveBeenCalledTimes(3);

    // "Reinicio": módulos, Better Auth y Prisma nuevos; los límites siguen.
    const restarted = await loadApp();
    const afterRestart = await sendOtp(restarted.app, phone(1), '203.0.113.31');
    expect(afterRestart.status).toBe(429);
    expect(sendOtpMock).toHaveBeenCalledTimes(3);
    expect(await db.smsSendLog.count()).toBe(3);

    // Otro número no se ve afectado.
    expect((await sendOtp(restarted.app, phone(2))).status).toBe(200);
  });

  it('por número: 10 envíos en 24 h → 429 aunque estén fuera de los 15 min', async () => {
    const { app, guard } = await loadApp();
    await seedSends(guard, 10, phone(1), '198.51.100.1', 2 * HOUR);
    const res = await sendOtp(app, phone(1));
    expect(res.status).toBe(429);
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it('por IP: 10 envíos en 1 h desde la misma IP → 429; otra IP en X-Forwarded-For tiene su propio contador', async () => {
    const { app } = await loadApp();
    for (let i = 0; i < 10; i++) {
      expect((await sendOtp(app, phone(i), '203.0.113.50')).status).toBe(200);
    }
    expect((await sendOtp(app, phone(10), '203.0.113.50')).status).toBe(429);
    expect((await sendOtp(app, phone(11), '203.0.113.51')).status).toBe(200);
    expect(sendOtpMock).toHaveBeenCalledTimes(11);
  });

  it('por IP: una X-Forwarded-For con varios saltos no evita el límite ni cae en un contador compartido', async () => {
    const { app } = await loadApp({ SMS_LIMIT_IP_HOUR: '2' });
    // El cliente falsea el primer salto; Traefik añade la IP real al final.
    const spoof = (n: number) => `10.9.9.${n}, 203.0.113.60`;
    expect((await sendOtp(app, phone(1), spoof(1))).status).toBe(200);
    expect((await sendOtp(app, phone(2), spoof(2))).status).toBe(200);
    expect((await sendOtp(app, phone(3), spoof(3))).status).toBe(429);
    // Otra IP real sigue pudiendo enviar.
    expect(
      (await sendOtp(app, phone(4), '10.9.9.4, 203.0.113.61')).status,
    ).toBe(200);
  });

  it('por IP: 30 envíos en 24 h → 429', async () => {
    // Tope global por encima de los 30 envíos sembrados.
    const { app, guard } = await loadApp({ SMS_DAILY_CAP: '100' });
    await seedSends(guard, 30, phone(99), '203.0.113.70', 2 * HOUR);
    const res = await sendOtp(app, phone(1), '203.0.113.70');
    expect(res.status).toBe(429);
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it('tope diario global: al alcanzar SMS_DAILY_CAP no se llama al proveedor (503 + aviso en el log)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = await loadApp({ SMS_DAILY_CAP: '2' });
    expect((await sendOtp(app, phone(1), '203.0.113.81')).status).toBe(200);
    expect((await sendOtp(app, phone(2), '203.0.113.82')).status).toBe(200);
    const blocked = await sendOtp(app, phone(3), '203.0.113.83');
    expect(blocked.status).toBe(503);
    expect(blocked.body.code).toBe('SMS_DAILY_CAP_REACHED');
    expect(sendOtpMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('SMS_DAILY_CAP=2'),
    );
    // El log enmascara el teléfono.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('3007000003');
  });

  it('tope diario global: envíos concurrentes no superan el tope', async () => {
    const { app } = await loadApp({ SMS_DAILY_CAP: '3' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        sendOtp(app, phone(i), `203.0.113.${100 + i}`),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(sendOtpMock).toHaveBeenCalledTimes(3);
    expect(await db.smsSendLog.count()).toBe(3);
  });

  it('tras 3 intentos fallidos el OTP deja de ser válido', async () => {
    const { app } = await loadApp();
    expect((await sendOtp(app, phone(1))).status).toBe(200);
    const code = captured.at(-1)!.code;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/auth/phone-number/verify')
        .send({ phoneNumber: phone(1), code: wrong });
      expect(res.status).toBe(400);
    }
    const late = await request(app)
      .post('/api/auth/phone-number/verify')
      .send({ phoneNumber: phone(1), code });
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect(late.headers['set-cookie']).toBeUndefined();
  });

  it('desarrollo: un número de prueba usa OTP_TEST_CODE, sin SMS y sin consumir cupo', async () => {
    const { app } = await loadApp({
      OTP_TEST_NUMBERS: phone(1),
      OTP_TEST_CODE: '246810',
    });
    for (let i = 0; i < 5; i++) {
      expect((await sendOtp(app, phone(1))).status).toBe(200);
    }
    expect(sendOtpMock).not.toHaveBeenCalled();
    expect(await db.smsSendLog.count()).toBe(0);
    const verified = await request(app)
      .post('/api/auth/phone-number/verify')
      .send({ phoneNumber: phone(1), code: '246810' });
    expect(verified.status).toBe(200);
    expect(verified.body.user.phoneNumber).toBe(phone(1));
  });

  it('número no colombiano → 400 sin registrar envío ni llamar al proveedor', async () => {
    const { app } = await loadApp();
    const res = await sendOtp(app, '+14155550100');
    expect(res.status).toBe(400);
    expect(sendOtpMock).not.toHaveBeenCalled();
    expect(await db.smsSendLog.count()).toBe(0);
    expect(await db.verification.count()).toBe(0);
  });
});
