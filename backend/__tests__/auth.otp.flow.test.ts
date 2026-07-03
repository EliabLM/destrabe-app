import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

/**
 * T9 — Flujo OTP end-to-end (db smoke TDD / REQ-006, REQ-007, REQ-010).
 *
 * Requiere Postgres up (`npm run db:up`). Conecta a la DB real de dev a través
 * del cliente Prisma y del handler de Better Auth montado en `createApp()`.
 *
 * Flow:
 *   1) POST /api/auth/phone-number/send-otp { phoneNumber }  → 2xx, OTP capturado
 *      vía mock de `./plivo` (REQ-010: no se llama a Plivo real).
 *   2) POST /api/auth/phone-number/verify { phoneNumber, code } con cookie jar
 *      (supertest agent) → 2xx + Set-Cookie (sesión).
 *   3) GET /api/auth/get-session con la cookie → 200 body { user: { phoneNumber } }
 *      con teléfono coincidente.
 *   4) (Opcional) POST /api/auth/sign-out → cookie limpiada; GET get-session → null.
 *
 * ### Rutas REALES del plugin `phoneNumber` (documentadas como desviación)
 * La spec REQ-006/007 usa `/phone/send-otp` y `/phone/verify-otp`, pero el
 * plugin instalado (`better-auth@^1.6.23`) expone `/phone-number/send-otp` y
 * `/phone-number/verify` (ver `node_modules/better-auth/.../phone-number`).
 * Estos tests validan las rutas reales — desviación documentada.
 *
 * ### `signUpOnVerification`
 * El plugin, al verificar un teléfono SIN usuario existente, lanza
 * `FAILED_TO_UPDATE_USER` (500) a menos que se configure `signUpOnVerification`,
 * que crea el User con un email temporal. T9 ajusta `auth.ts` para añadirlo.
 */

// Prisma lee `env("DATABASE_URL")` de process.env en tiempo de conexión (lazy),
// no de construction. Lo fijamos aquí para que el cliente de test y el `prisma`
// singleton (importado transitivamente vía auth.ts) apunten a la dev DB.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://destrabe:destrabe@localhost:5432/destrabe_db';

/**
 * Mock de Plivo que captura el OTP generado por el plugin. El plugin invoca
 * `sendOTP({ phoneNumber, code })` durante send-otp con el código que él mismo
 * generó y persistió en `Verification` (valor `${code}:0`). El callback es
 * await/void según config de background tasks; lo hacemos async y registramos
 * la llamada para extraer el `code` y reintegrarlo en /verify.
 *
 * `vi.hoisted` garantiza que `capturedSendOtps` y `sendOtpMock` existan antes
 * de que `vi.mock` (hoist-eado por encima de los imports) resuelva la factoría.
 */
const { capturedSendOtps, sendOtpMock } = vi.hoisted(() => ({
  capturedSendOtps: [] as { phoneNumber: string; code: string }[],
  sendOtpMock: vi.fn(async (phoneNumber: string, code: string) => {
    capturedSendOtps.push({ phoneNumber, code });
  }),
}));

vi.mock('../src/lib/plivo', () => ({ sendOtp: sendOtpMock }));

// Cliente Prisma dedicado para limpieza (no se mockea: T9 es db smoke).
const cleanupPrisma = new PrismaClient();

const AUTH_TABLES = [
  'Message',
  'ClientProfile',
  'OperatorProfile',
  'Session',
  'Account',
  'Verification',
  'User',
] as const;

async function truncateAuthTables() {
  const list = AUTH_TABLES.map((t) => `"${t}"`).join(', ');
  // CASCADE asegura que dependientes se borren (ya vacíos en dev, pero robusto).
  await cleanupPrisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE;`);
}

beforeAll(async () => {
  // Sanity: la DB responde.
  await cleanupPrisma.$connect();
  await truncateAuthTables();
});

beforeEach(async () => {
  await truncateAuthTables();
  capturedSendOtps.length = 0;
  sendOtpMock.mockClear();
});

afterAll(async () => {
  await truncateAuthTables();
  await cleanupPrisma.$disconnect();
});

// `createApp` se importa DESPUÉS de setear DATABASE_URL y de declarar el mock
// (vitest hoist-ea los vi.mock sobre los imports automáticamente).
import { createApp } from '../src/app';

const TEST_PHONE = '+573001234599';

describe('Flujo OTP end-to-end (REQ-006, REQ-007, REQ-010 — T9)', () => {
  it(
    'send-otp → 2xx y captura el OTP vía mock de Plivo (REQ-006/010)',
    async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/auth/phone-number/send-otp')
        .send({ phoneNumber: TEST_PHONE });

      // REQ-006: respuesta exitosa (2xx).
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);

      // REQ-010: Plivo real no fue llamado; el mock capturó el código generado.
      expect(sendOtpMock).toHaveBeenCalledTimes(1);
      expect(sendOtpMock).toHaveBeenCalledWith(
        TEST_PHONE,
        expect.any(String),
      );
      const captured = capturedSendOtps.find(
        (o) => o.phoneNumber === TEST_PHONE,
      );
      expect(captured).toBeDefined();
      expect(captured!.code).toMatch(/^\d{6}$/);
    },
  );

  it('flujo completo send → verify → get-session (REQ-007)', async () => {
    const agent = request.agent(createApp());

    // 1) send-otp
    const sendRes = await agent
      .post('/api/auth/phone-number/send-otp')
      .send({ phoneNumber: TEST_PHONE });
    expect(sendRes.status).toBeLessThan(300);
    expect(capturedSendOtps.length).toBeGreaterThan(0);
    const code = capturedSendOtps[capturedSendOtps.length - 1].code;
    expect(code).toMatch(/^\d{6}$/);

    // 2) verify con el código capturado (cookie jar del agent conserva cookies).
    const verifyRes = await agent
      .post('/api/auth/phone-number/verify')
      .send({ phoneNumber: TEST_PHONE, code });

    // REQ-007: respuesta exitosa + cookie de sesión seteada.
    expect(verifyRes.status).toBeGreaterThanOrEqual(200);
    expect(verifyRes.status).toBeLessThan(300);
    const setCookie = verifyRes.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie)
      ? set_cookie_join(setCookie)
      : setCookie;
    expect(cookieHeader).toMatch(/session_token/i);

    // 3) get-session con la cookie → usuario autenticado con teléfono coincidente.
    const sessionRes = await agent.get('/api/auth/get-session');
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body).not.toBeNull();
    expect(sessionRes.body.user).toBeDefined();
    expect(sessionRes.body.user.phoneNumber).toBe(TEST_PHONE);
    // role por defecto (additionalFields, REQ-001).
    expect(sessionRes.body.user.role).toBe('CLIENT');
  });

  it('get-session sin cookie → null (no autenticado)', async () => {
    const app = createApp();
    const res = await request(app).get('/api/auth/get-session');
    // Better Auth responde 200 con body null cuando no hay cookie de sesión.
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('sign-out limpia la cookie y la sesión queda null (REQ-010)', async () => {
    const agent = request.agent(createApp());

    // Setup: send → verify para tener una sesión activa.
    await agent
      .post('/api/auth/phone-number/send-otp')
      .send({ phoneNumber: TEST_PHONE });
    const code = capturedSendOtps[capturedSendOtps.length - 1].code;
    const verifyRes = await agent
      .post('/api/auth/phone-number/verify')
      .send({ phoneNumber: TEST_PHONE, code });
    expect(verifyRes.status).toBeLessThan(300);

    // Confirmamos que hay sesión antes del sign-out.
    const before = await agent.get('/api/auth/get-session');
    expect(before.body?.user).toBeDefined();

    // sign-out
    const signOutRes = await agent.post('/api/auth/sign-out');
    expect(signOutRes.status).toBeLessThan(300);
    const setCookie = signOutRes.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie)
      ? set_cookie_join(setCookie)
      : setCookie;
    // La cookie de sesión se borra (Max-Age=0 / expira).
    expect(cookieHeader.toLowerCase()).toMatch(/max-age=0|expires=/);

    // get-session después → null.
    const after = await agent.get('/api/auth/get-session');
    expect(after.status).toBe(200);
    expect(after.body).toBeNull();
  });
});

/** Une un array de Set-Cookie en un solo string para inspección. */
function set_cookie_join(arr: string[]): string {
  return arr.join('; ');
}