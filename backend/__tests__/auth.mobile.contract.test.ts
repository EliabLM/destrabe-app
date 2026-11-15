import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AxiosError, type AxiosAdapter } from 'axios';

// Sólo se reemplazan los bordes de persistencia y SMS: Better Auth, el router,
// requireAuth y los interceptores Axios de la app se ejecutan de verdad.
const state = vi.hoisted(() => ({ token: null as string | null, code: '' }));
const authDb = vi.hoisted(() => ({
  user: [] as Record<string, unknown>[],
  session: [] as Record<string, unknown>[],
  account: [] as Record<string, unknown>[],
  verification: [] as Record<string, unknown>[],
}));
const findUnique = vi.hoisted(() => vi.fn());
vi.mock('better-auth/adapters/prisma', async () => {
  const { memoryAdapter } = await import('better-auth/adapters/memory');
  return { prismaAdapter: () => memoryAdapter(authDb) };
});
vi.mock('../src/lib/plivo', () => ({
  sendOtp: vi.fn(async (_phone: string, code: string) => {
    state.code = code;
  }),
}));
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique },
    service: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock('../src/lib/queue', () => ({ enqueueServiceExpiry: vi.fn() }));
vi.mock('../../app/src/stores/authStore', () => ({
  authStore: {
    getState: () => ({
      token: state.token,
      clearLocalSession: async () => {
        state.token = null;
      },
    }),
  },
}));

import { createApp } from '../src/app';
import { api } from '../../app/src/lib/api';
import { otpSend, otpVerify, otpSignOut } from '../../app/src/lib/apiAuth';
import { getMe } from '../../app/src/lib/apiMe';

const app = createApp();
const phoneNumber = '+573001112233';
// Transporte HTTP sin cookie jar: equivalente al Axios móvil con Bearer explícito.
api.defaults.adapter = (async (config) => {
  const path = new URL(config.url!, config.baseURL).pathname;
  const call = (
    request(app) as unknown as Record<string, (path: string) => request.Test>
  )[config.method!](path);
  const headers = config.headers.toJSON() as Record<string, string>;
  const response = await call.set(headers).send(config.data);
  const result = {
    data: response.body,
    status: response.status,
    statusText: '',
    headers: response.headers,
    config,
  };
  if (response.status >= 400)
    throw new AxiosError(
      'HTTP error',
      'ERR_BAD_RESPONSE',
      config,
      undefined,
      result,
    );
  return result;
}) as AxiosAdapter;

beforeEach(() => {
  state.token = null;
  state.code = '';
  findUnique.mockReset();
});

describe('contrato OTP y sesión del cliente móvil (sin DB ni SMS)', () => {
  it('envía OTP, verifica y accede a /api/me y recurso protegido con Bearer', async () => {
    await otpSend(phoneNumber);
    expect(state.code).toMatch(/^\d{6}$/);
    const verified = await otpVerify(phoneNumber, state.code);
    expect(verified.user.phoneNumber).toBe(phoneNumber);
    expect(verified.token).toBeTruthy();
    state.token = verified.token;
    findUnique.mockResolvedValue({
      id: verified.user.id,
      phoneNumber,
      role: 'CLIENT',
      clientProfile: null,
      operatorProfile: null,
    });
    expect((await getMe()).user.id).toBe(verified.user.id);
    // No existe el servicio: 404 después de atravesar requireAuth (no 401).
    await expect(api.get('/services/test-service')).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it('rechaza un OTP inválido sin emitir sesión', async () => {
    await otpSend(phoneNumber);
    const wrong = state.code === '000000' ? '999999' : '000000';
    await expect(otpVerify(phoneNumber, wrong)).rejects.toMatchObject({
      response: { status: 400 },
    });
    expect(state.token).toBeNull();
  });

  it('rechaza /api/me y un recurso protegido sin sesión', async () => {
    await expect(getMe()).rejects.toMatchObject({ response: { status: 401 } });
    await expect(api.get('/services/test-service')).rejects.toMatchObject({
      response: { status: 401 },
    });
  });

  it('rechaza el token de una sesión expirada en /api/me y recurso protegido', async () => {
    await otpSend(phoneNumber);
    state.token = (await otpVerify(phoneNumber, state.code)).token;
    const expiredToken = state.token;
    const session = authDb.session.at(-1)!;
    session.expiresAt = new Date(0);
    await expect(getMe()).rejects.toMatchObject({ response: { status: 401 } });
    // El interceptor limpia el token; se restituye para comprobar que el servidor lo rechaza.
    state.token = expiredToken;
    await expect(api.get('/services/test-service')).rejects.toMatchObject({
      response: { status: 401 },
    });
  });

  it('sign-out revoca la sesión Bearer en servidor', async () => {
    await otpSend(phoneNumber);
    const verified = await otpVerify(phoneNumber, state.code);
    state.token = verified.token;
    await otpSignOut();
    // Reutilizar explícitamente el token firmado previo: no confiar en que el
    // cliente haya borrado su estado para afirmar revocación del lado servidor.
    state.token = verified.token;
    await expect(getMe()).rejects.toMatchObject({ response: { status: 401 } });
    state.token = verified.token;
    await expect(api.get('/services/test-service')).rejects.toMatchObject({
      response: { status: 401 },
    });
  });
});
