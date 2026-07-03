import { describe, it, expect, vi } from 'vitest';

/**
 * T5 — auth.ts config (REQ-003)
 * Unit, no Docker: se mockea el PrismaClient, Plivo y env para que importar
 * `auth` no toque una DB real. La instancia real de betterAuth + el plugin
 * phoneNumber sí corren (es lo que valida REQ-003).
 *
 * Los mocks se declaran con `vi.hoisted` para que estén disponibles en las
 * factorías de `vi.mock` (que vitest hoistea por encima de los imports).
 */
const { envMock, sendOtpMock } = vi.hoisted(() => ({
  envMock: {
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-32chars',
    BETTER_AUTH_URL: 'http://localhost:3000',
  },
  sendOtpMock: vi.fn(),
}));

vi.mock('../src/lib/env', () => ({ env: envMock }));
// prismaAdapter sólo accede a `db[model]` en tiempo de request (create/findOne),
// nunca al construirse → un stub vacío basta para que `betterAuth` inicialice.
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/lib/plivo', () => ({ sendOtp: sendOtpMock }));

import { auth, authHandler } from '../src/lib/auth';

describe('auth.ts config (REQ-003)', () => {
  it('exports an auth instance with a function handler', () => {
    expect(auth).toBeDefined();
    expect(typeof auth.handler).toBe('function');
  });

  it('exposes phoneNumber plugin methods on auth.api', () => {
    // Endpoint /phone-number/send-otp → auth.api.sendPhoneNumberOTP
    expect(typeof auth.api.sendPhoneNumberOTP).toBe('function');
    // Endpoint /phone-number/verify → auth.api.verifyPhoneNumber
    expect(typeof auth.api.verifyPhoneNumber).toBe('function');
  });

  it('exports authHandler as a Node-style request handler function', () => {
    expect(typeof authHandler).toBe('function');
  });
});
