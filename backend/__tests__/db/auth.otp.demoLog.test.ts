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
 * DCC-22 — OTP de la demo en el log para los números de `OTP_LOG_NUMBERS`.
 *
 * Requiere Postgres (`npm run db:up` o el job "Contratos DB" de CI). A
 * diferencia del resto de pruebas de auth, `plivo.ts` NO se simula: el código
 * se lee del log real. `fetch` está simulado para detectar cualquier llamada a
 * Plivo; nunca se envían SMS.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://destrabe:destrabe@localhost:5432/destrabe_db';

const ENV_KEYS = [
  'OTP_LOG_NUMBERS',
  'OTP_TEST_NUMBERS',
  'OTP_TEST_CODE',
  'PLIVO_AUTH_ID',
  'PLIVO_AUTH_TOKEN',
] as const;

const DEMO_PHONE = '+573007000001';
const OTHER_PHONE = '+573007000002';
const FIVE_MINUTES = 5 * 60_000;

const db = new PrismaClient();
const loadedPrismas: { $disconnect: () => Promise<void> }[] = [];
const fetchMock = vi.fn();

/** Carga una app nueva con `OTP_LOG_NUMBERS` y sin credenciales de Plivo. */
async function loadApp() {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.OTP_LOG_NUMBERS = DEMO_PHONE;
  vi.resetModules();
  const { createApp } = await import('../../src/app');
  const { env } = await import('../../src/lib/env');
  const { prisma } = await import('../../src/lib/prisma');
  loadedPrismas.push(prisma);
  return { app: createApp(), env };
}

async function truncate() {
  await db.$executeRawUnsafe(
    'TRUNCATE "SmsSendLog", "Session", "Account", "Verification", "User" CASCADE;',
  );
}

function sendOtp(app: Parameters<typeof request>[0], phoneNumber: string) {
  return request(app)
    .post('/api/auth/phone-number/send-otp')
    .set('X-Forwarded-For', '203.0.113.90')
    .send({ phoneNumber });
}

function verify(
  app: Parameters<typeof request>[0],
  phoneNumber: string,
  code: string,
) {
  return request(app)
    .post('/api/auth/phone-number/verify')
    .send({ phoneNumber, code });
}

/** Todo lo que salió por consola, en una sola cadena. */
function logged(spies: ReturnType<typeof vi.spyOn>[]): string {
  return spies
    .flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call)))
    .join('\n');
}

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

/** Código que quedó en la línea `[otp-demo]` del log. */
function codeFromLog(): string {
  const match = /\[otp-demo\] OTP for \+57\*+0001: (\d{6})/.exec(
    logged(consoleSpies),
  );
  expect(match).not.toBeNull();
  return match![1]!;
}

beforeAll(async () => {
  await db.$connect();
});

beforeEach(async () => {
  await truncate();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await truncate();
  await Promise.all(loadedPrismas.map((p) => p.$disconnect()));
  await db.$disconnect();
});

describe('OTP de la demo en el log (DCC-22)', () => {
  it('el código del log inicia sesión, no llama a Plivo y cuenta para los límites', async () => {
    const { app } = await loadApp();

    expect((await sendOtp(app, DEMO_PHONE)).status).toBe(200);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged(consoleSpies)).not.toContain(DEMO_PHONE);
    expect(await db.smsSendLog.count()).toBe(1);

    const res = await verify(app, DEMO_PHONE, codeFromLog());
    expect(res.status).toBe(200);
    expect(res.body.user.phoneNumber).toBe(DEMO_PHONE);
  });

  it('el código del log vence a los 5 minutos, como uno enviado por SMS', async () => {
    const { app } = await loadApp();
    const before = Date.now();

    expect((await sendOtp(app, DEMO_PHONE)).status).toBe(200);
    const code = codeFromLog();

    const row = await db.verification.findFirstOrThrow({
      where: { identifier: { contains: DEMO_PHONE } },
    });
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + FIVE_MINUTES - 1_000,
    );
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + FIVE_MINUTES + 1_000,
    );

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(row.expiresAt.getTime() + 1_000);
    const late = await verify(app, DEMO_PHONE, code);
    expect(late.status).toBe(400);
    expect(late.headers['set-cookie']).toBeUndefined();
  });

  it('producción sin Plivo: otro número recibe el rechazo y su código no se genera ni se registra', async () => {
    const { app, env } = await loadApp();
    // Se cambia solo la variable que lee la regla; arrancar el proceso en modo
    // producción exigiría el resto de configuración de producción.
    env.NODE_ENV = 'production';

    const res = await sendOtp(app, OTHER_PHONE);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'OTP_LOGIN_RESTRICTED',
      message: 'Por ahora el ingreso está limitado a cuentas de prueba.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged(consoleSpies)).not.toContain('OTP for');
    expect(await db.verification.count()).toBe(0);
    expect(await db.smsSendLog.count()).toBe(0);

    // El número autorizado sigue entrando.
    expect((await sendOtp(app, DEMO_PHONE)).status).toBe(200);
    expect((await verify(app, DEMO_PHONE, codeFromLog())).status).toBe(200);
  });
});
