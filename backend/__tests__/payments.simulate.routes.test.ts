import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/lib/env';
import { configFlagStore, setFeatureFlagStore } from '../src/lib/featureFlags';
import { parseFeatureFlagsConfig } from '../src/lib/featureFlagsConfig';

/**
 * #16 — POST /payments/:id/simulate con Prisma simulado (REQ-PS-002).
 * El flujo completo contra Postgres está en db/payments.lifecycle.test.ts.
 */

const m = vi.hoisted(() => ({
  session: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentUpdateMany: vi.fn(),
}));

vi.mock('../src/lib/auth', () => ({
  auth: { api: { getSession: m.session } },
  authHandler: vi.fn((_req, _res, next) => next()),
}));
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    payment: {
      findUnique: m.paymentFindUnique,
      updateMany: m.paymentUpdateMany,
    },
  },
}));

const OWNER = 'client-user';

function as(id: string, role = 'CLIENT') {
  m.session.mockResolvedValue({ user: { id, role } });
}

function payment(status = 'PENDING') {
  return {
    id: 'pay-1',
    status,
    service: { id: 'svc-1', client: { id: 'cp-1', userId: OWNER } },
  };
}

const simulate = (body: unknown = { result: 'approved' }) =>
  request(createApp())
    .post('/payments/pay-1/simulate')
    .send(body as object);

const originalGateway = env.PAYMENT_GATEWAY;

beforeEach(() => {
  vi.resetAllMocks();
  env.PAYMENT_GATEWAY = 'stub';
  setFeatureFlagStore(
    configFlagStore(
      parseFeatureFlagsConfig(
        `{"pagoSimulado":{"mode":"allowlist","users":["${OWNER}","other-client","op-user"]}}`,
      ),
    ),
  );
  m.paymentFindUnique.mockResolvedValue(payment());
  m.paymentUpdateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  env.PAYMENT_GATEWAY = originalGateway;
  setFeatureFlagStore(configFlagStore({}));
});

describe('POST /payments/:id/simulate (#16)', () => {
  it('401 sin sesión', async () => {
    m.session.mockResolvedValue(null);
    expect((await simulate()).status).toBe(401);
  });

  it('el dueño aprueba → CONFIRMED con la transición del webhook', async () => {
    as(OWNER);
    const res = await simulate({ result: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'pay-1', status: 'CONFIRMED' });
    expect(m.paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: 'PENDING' },
      data: { status: 'CONFIRMED' },
    });
  });

  it('el dueño rechaza → FAILED', async () => {
    as(OWNER);
    const res = await simulate({ result: 'rejected' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'pay-1', status: 'FAILED' });
    expect(m.paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  });

  it('otro cliente → 404 sin tocar el pago', async () => {
    as('other-client');
    const res = await simulate();

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(m.paymentUpdateMany).not.toHaveBeenCalled();
  });

  it('operador → 404', async () => {
    as('op-user', 'OPERATOR');
    expect((await simulate()).status).toBe(404);
    expect(m.paymentUpdateMany).not.toHaveBeenCalled();
  });

  it('pago inexistente → 404', async () => {
    as(OWNER);
    m.paymentFindUnique.mockResolvedValue(null);
    expect((await simulate()).status).toBe(404);
  });

  it('flag apagado para el usuario → 404 sin consultar el pago', async () => {
    as(OWNER);
    setFeatureFlagStore(configFlagStore({}));

    const res = await simulate();

    expect(res.status).toBe(404);
    expect(m.paymentFindUnique).not.toHaveBeenCalled();
  });

  it('PAYMENT_GATEWAY=mercadopago → 404 sin consultar el pago', async () => {
    as(OWNER);
    env.PAYMENT_GATEWAY = 'mercadopago';

    const res = await simulate();

    expect(res.status).toBe(404);
    expect(m.paymentFindUnique).not.toHaveBeenCalled();
  });

  it.each(['CONFIRMED', 'FAILED'])(
    'pago ya %s → 409 ALREADY_PROCESSED',
    async (status) => {
      as(OWNER);
      m.paymentFindUnique.mockResolvedValue(payment(status));

      const res = await simulate();

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_PROCESSED');
      expect(m.paymentUpdateMany).not.toHaveBeenCalled();
    },
  );

  it('409 si otro proceso lo cerró entre la lectura y la escritura', async () => {
    as(OWNER);
    m.paymentUpdateMany.mockResolvedValue({ count: 0 });

    const res = await simulate();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_PROCESSED');
  });

  it('result inválido → 400 VALIDATION_ERROR', async () => {
    as(OWNER);
    const res = await simulate({ result: 'CONFIRMED' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
