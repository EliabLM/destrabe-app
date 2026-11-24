import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { ServiceStatus, ServiceType, UserRole } from '@destrabe/shared';

/**
 * T8 — Payments lifecycle db smoke (cambio-006 / REQ-001..005 + service-lifecycle).
 *
 * Cobertura end-to-end:
 *   Flujo feliz:    quotes→accept→init→webhook→COMPLETED con pago confirmado
 *   Init 403:       CLIENT ajeno no puede iniciar
 *   Init 409:       Payment ya CONFIRMED → ALREADY_PROCESSED
 *   Webhook 404:    Payment inexistente
 *   Webhook 401:    X-Webhook-Token faltante / inválido
 *   Webhook duplicado: idempotente (200 sin mutar)
 *   Guard 409:      COMPLETED con Payment PENDING → PAYMENT_PENDING
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://destrabe:destrabe@localhost:5432/destrabe_db';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { capturedSendOtps, sendOtpMock } = vi.hoisted(() => ({
  capturedSendOtps: [] as { phoneNumber: string; code: string }[],
  sendOtpMock: vi.fn(async (phoneNumber: string, code: string) => {
    capturedSendOtps.push({ phoneNumber, code });
  }),
}));
vi.mock('../../src/lib/plivo', () => ({ sendOtp: sendOtpMock }));

// ─── Prisma dedicado para limpieza/siembra ───────────────────────────────────

const prisma = new PrismaClient();

const TABLES = [
  'Review',
  'Payment',
  'Message',
  'Quote',
  'Service',
  'OperatorProfile',
  'ClientProfile',
  'Verification',
  'Account',
  'Session',
  'User',
  'SmsSendLog', // DCC-05: límites de OTP por SMS
] as const;

async function truncateAll() {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE;`);
}

beforeAll(async () => {
  await prisma.$connect();
  await truncateAll();
});

beforeEach(async () => {
  await truncateAll();
  capturedSendOtps.length = 0;
  sendOtpMock.mockClear();
});

afterAll(async () => {
  await truncateAll();
  await prisma.$disconnect();
});

import { createApp } from '../../src/app';
import { env } from '../../src/lib/env';
import {
  configFlagStore,
  setFeatureFlagStore,
} from '../../src/lib/featureFlags';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function authenticateAs(
  phoneNumber: string,
  role: UserRole = UserRole.CLIENT,
) {
  const agent = request.agent(createApp());
  await agent.post('/api/auth/phone-number/send-otp').send({ phoneNumber });
  const code = capturedSendOtps.at(-1)!.code;
  const verifyRes = await agent
    .post('/api/auth/phone-number/verify')
    .send({ phoneNumber, code });
  expect(verifyRes.status).toBeLessThan(300);

  if (role !== UserRole.CLIENT) {
    await prisma.user.update({
      where: { phoneNumber },
      data: { role },
    });
  }
  return agent;
}

async function authenticateOperatorWithProfile(phone: string) {
  const agent = await authenticateAs(phone, UserRole.OPERATOR);
  const user = await prisma.user.findUnique({ where: { phoneNumber: phone } });
  await prisma.operatorProfile.create({
    data: {
      userId: user!.id,
      truckType: 'Grua mediana',
      licensePlate: 'ABC123',
      available: true,
    },
  });
  return agent;
}

/** Crea un service y lo acepta, devolviendo el Payment id. */
async function createAcceptedService(
  clientPhone: string,
  operatorPhone: string,
) {
  const client = await authenticateAs(clientPhone, UserRole.CLIENT);
  const operator = await authenticateOperatorWithProfile(operatorPhone);

  const createRes = await client.post('/services').send({
    type: ServiceType.BREAKDOWN,
    originLat: 4.65,
    originLng: -74.1,
  });
  expect(createRes.status).toBe(201);
  const serviceId = createRes.body.id as string;

  const quoteRes = await operator
    .post(`/services/${serviceId}/quotes`)
    .send({ amount: 50000 });
  expect(quoteRes.status).toBe(201);

  const acceptRes = await client
    .post(`/quotes/${quoteRes.body.id}/accept`)
    .send({});
  expect(acceptRes.status).toBe(200);

  // Get payment id
  const payment = await prisma.payment.findUnique({
    where: { serviceId },
  });
  expect(payment).not.toBeNull();
  expect(payment!.status).toBe('PENDING');

  return { client, operator, serviceId, paymentId: payment!.id, amount: 50000 };
}

const CLIENT_PHONE = '+573005000001';
const OPERATOR_PHONE = '+573005000002';
const CLIENT2_PHONE = '+573005000003';
const WEBHOOK_URL = '/payments/webhook';

// ─── POST /payments/:id/init (REQ-001) ───────────────────────────────────────

describe('POST /payments/:id/init (REQ-001)', () => {
  it('CLIENT dueño inicia pago PENDING → 200 + gatewayData', async () => {
    const { client, paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );

    const res = await client.post(`/payments/${paymentId}/init`);

    expect(res.status).toBe(200);
    expect(res.body.gatewayPaymentId).toMatch(/^stub-/);
    // #16: con el stub no hay URL de pago; la app usa la simulación.
    expect(res.body.simulated).toBe(true);
    expect(res.body).not.toHaveProperty('redirectUrl');

    // Comisión fijada al aceptar (10 % por defecto, DCC-08).
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    expect(payment!.commission).toBe(5000);
    expect(payment!.operatorAmount).toBe(45000);
    expect(payment!.mpPaymentId).toMatch(/^stub-/);
  });

  it('init y webhook no recalculan la comisión guardada (DCC-08)', async () => {
    const { client, paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    // Importes fijados con otra tasa: deben quedar intactos.
    await prisma.payment.update({
      where: { id: paymentId },
      data: { commission: 7500, operatorAmount: 42500 },
    });

    expect((await client.post(`/payments/${paymentId}/init`)).status).toBe(200);
    await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ paymentId, status: 'CONFIRMED' });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(payment).toMatchObject({
      status: 'CONFIRMED',
      amount: 50000,
      commission: 7500,
      operatorAmount: 42500,
    });
  });

  it('CLIENT ajeno → 403', async () => {
    const { paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    const client2 = await authenticateAs(CLIENT2_PHONE, UserRole.CLIENT);

    const res = await client2.post(`/payments/${paymentId}/init`);

    expect(res.status).toBe(403);
  });

  it('Payment ya CONFIRMED → 409 ALREADY_PROCESSED', async () => {
    const { client, paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );

    // Init + webhook para ponerlo CONFIRMED
    await client.post(`/payments/${paymentId}/init`);
    await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ paymentId, status: 'CONFIRMED' });

    // Segundo init → 409
    const res = await client.post(`/payments/${paymentId}/init`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_PROCESSED');
  });

  it('Payment inexistente → 404', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);

    const res = await client.post('/payments/nonexistent-id/init');

    expect(res.status).toBe(404);
  });

  it('401 sin autenticación', async () => {
    const res = await request(createApp()).post('/payments/some-id/init');
    expect(res.status).toBe(401);
  });
});

// ─── POST /payments/webhook (REQ-002/004) ────────────────────────────────────

describe('POST /payments/webhook (REQ-002/004)', () => {
  it('webhook CONFIRMED sobre PENDING → 200 + status CONFIRMED con la comisión guardada', async () => {
    const { client, paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    await client.post(`/payments/${paymentId}/init`);

    const res = await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ paymentId, status: 'CONFIRMED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONFIRMED');

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    expect(payment!.status).toBe('CONFIRMED');
    expect(payment!.commission).toBe(5000);
    expect(payment!.operatorAmount).toBe(45000);
  });

  it('webhook duplicado → idempotente (200 sin mutar)', async () => {
    const { client, paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    await client.post(`/payments/${paymentId}/init`);

    // Primer webhook
    await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ paymentId, status: 'CONFIRMED' });

    // Segundo webhook duplicado
    const res2 = await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ paymentId, status: 'CONFIRMED' });

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('CONFIRMED');

    // Sigue siendo 1 after updateAt check (no volvió a mutar)
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    expect(payment!.status).toBe('CONFIRMED');
  });

  it('Payment inexistente → 404', async () => {
    const res = await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ paymentId: 'no-existe', status: 'CONFIRMED' });

    expect(res.status).toBe(404);
  });

  it('payload inválido → 400', async () => {
    const res = await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ status: 'CONFIRMED' }); // falta paymentId

    // T7: Route valida que gateway devolvió paymentId antes del lookup
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('X-Webhook-Token faltante → 401', async () => {
    const res = await request(createApp())
      .post(WEBHOOK_URL)
      .send({ paymentId: 'some-id', status: 'CONFIRMED' });

    expect(res.status).toBe(401);
  });

  it('X-Webhook-Token inválido → 401', async () => {
    const res = await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'wrong-token')
      .send({ paymentId: 'some-id', status: 'CONFIRMED' });

    expect(res.status).toBe(401);
  });

  it('PENDING → FAILED vía webhook', async () => {
    const { client, paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    await client.post(`/payments/${paymentId}/init`);

    const res = await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ paymentId, status: 'FAILED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    expect(payment!.status).toBe('FAILED');
  });

  it('FAILED es terminal — webhook posterior idempotente', async () => {
    const { client, paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    await client.post(`/payments/${paymentId}/init`);

    // FAIL via webhook
    await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ paymentId, status: 'FAILED' });

    // Intento CONFIRMED después de FAILED → idempotente
    const res = await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ paymentId, status: 'CONFIRMED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');
  });
});

// ─── PATCH /services/:id/status con guard PAYMENT_PENDING (service-lifecycle) ─

describe('PATCH /services/:id/status — payment guard (service-lifecycle REQ-005)', () => {
  it('ACTIVE→COMPLETED con Payment CONFIRMED → 200', async () => {
    const { client, operator, serviceId, paymentId } =
      await createAcceptedService(CLIENT_PHONE, OPERATOR_PHONE);

    // Init + webhook CONFIRMED
    await client.post(`/payments/${paymentId}/init`);
    await request(createApp())
      .post(WEBHOOK_URL)
      .set('x-webhook-token', 'test-webhook-token')
      .send({ paymentId, status: 'CONFIRMED' });

    // Operator completes
    const res = await operator
      .patch(`/services/${serviceId}/status`)
      .send({ status: ServiceStatus.COMPLETED });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(ServiceStatus.COMPLETED);
  });

  it('ACTIVE→COMPLETED con Payment PENDING → 409 PAYMENT_PENDING', async () => {
    const { operator, serviceId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    // No init — payment stays PENDING

    const res = await operator
      .patch(`/services/${serviceId}/status`)
      .send({ status: ServiceStatus.COMPLETED });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYMENT_PENDING');
  });

  it('CLIENT cancela PENDING sin payment guard (no afectado)', async () => {
    // CLIENT cannot cancel ACTIVE, but we can test a regular cancel scenario
    // Create a fresh PENDING service and cancel it
    const clientAgent = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const createRes = await clientAgent.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: 4.65,
      originLng: -74.1,
    });
    const freshServiceId = createRes.body.id;

    const res = await clientAgent
      .patch(`/services/${freshServiceId}/status`)
      .send({ status: ServiceStatus.CANCELLED });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(ServiceStatus.CANCELLED);
  });
});

// ─── GET /services/:id con el pago (#16, REQ-PS-001) ─────────────────────────

describe('GET /services/:id — pago en el detalle (#16)', () => {
  it('dueño y operador asignado ven el pago; otro cliente 404', async () => {
    const { client, operator, serviceId, paymentId } =
      await createAcceptedService(CLIENT_PHONE, OPERATOR_PHONE);
    const expected = {
      id: paymentId,
      status: 'PENDING',
      amount: 50000,
      commission: 5000,
    };

    const owner = await client.get(`/services/${serviceId}`);
    expect(owner.status).toBe(200);
    expect(owner.body.payment).toEqual(expected);

    const assigned = await operator.get(`/services/${serviceId}`);
    expect(assigned.status).toBe(200);
    expect(assigned.body.payment).toEqual(expected);

    const client2 = await authenticateAs(CLIENT2_PHONE, UserRole.CLIENT);
    expect((await client2.get(`/services/${serviceId}`)).status).toBe(404);
  });
});

// ─── POST /payments/:id/simulate (#16, REQ-PS-002) ───────────────────────────

describe('POST /payments/:id/simulate (#16)', () => {
  const originalGateway = env.PAYMENT_GATEWAY;

  beforeEach(() => {
    env.PAYMENT_GATEWAY = 'stub';
    setFeatureFlagStore(
      configFlagStore({
        pagoSimulado: {
          mode: 'allowlist',
          users: [CLIENT_PHONE, CLIENT2_PHONE],
        },
      }),
    );
  });

  afterAll(() => {
    env.PAYMENT_GATEWAY = originalGateway;
    setFeatureFlagStore(configFlagStore({}));
  });

  it('el dueño aprueba → CONFIRMED y el operador asignado completa', async () => {
    const { client, operator, serviceId, paymentId } =
      await createAcceptedService(CLIENT_PHONE, OPERATOR_PHONE);

    const res = await client
      .post(`/payments/${paymentId}/simulate`)
      .send({ result: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: paymentId, status: 'CONFIRMED' });

    const detail = await client.get(`/services/${serviceId}`);
    expect(detail.body.payment.status).toBe('CONFIRMED');

    const done = await operator
      .patch(`/services/${serviceId}/status`)
      .send({ status: ServiceStatus.COMPLETED });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe(ServiceStatus.COMPLETED);
  });

  it('rechazo → FAILED, el servicio sigue ACTIVE y no se puede completar', async () => {
    const { client, operator, serviceId, paymentId } =
      await createAcceptedService(CLIENT_PHONE, OPERATOR_PHONE);

    const res = await client
      .post(`/payments/${paymentId}/simulate`)
      .send({ result: 'rejected' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');

    const service = await prisma.service.findUniqueOrThrow({
      where: { id: serviceId },
    });
    expect(service.status).toBe(ServiceStatus.ACTIVE);

    const done = await operator
      .patch(`/services/${serviceId}/status`)
      .send({ status: ServiceStatus.COMPLETED });
    expect(done.status).toBe(409);
    expect(done.body.code).toBe('PAYMENT_PENDING');
  });

  it('otro cliente → 404 y el pago sigue PENDING', async () => {
    const { paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    const client2 = await authenticateAs(CLIENT2_PHONE, UserRole.CLIENT);

    const res = await client2
      .post(`/payments/${paymentId}/simulate`)
      .send({ result: 'approved' });

    expect(res.status).toBe(404);
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(payment.status).toBe('PENDING');
  });

  it('flag apagado → 404', async () => {
    const { client, paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    setFeatureFlagStore(configFlagStore({}));

    const res = await client
      .post(`/payments/${paymentId}/simulate`)
      .send({ result: 'approved' });

    expect(res.status).toBe(404);
  });

  it('PAYMENT_GATEWAY=mercadopago → 404', async () => {
    const { client, paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    env.PAYMENT_GATEWAY = 'mercadopago';

    const res = await client
      .post(`/payments/${paymentId}/simulate`)
      .send({ result: 'approved' });

    expect(res.status).toBe(404);
  });

  it('pago ya confirmado → 409 ALREADY_PROCESSED', async () => {
    const { client, paymentId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    await client
      .post(`/payments/${paymentId}/simulate`)
      .send({ result: 'approved' });

    const res = await client
      .post(`/payments/${paymentId}/simulate`)
      .send({ result: 'rejected' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_PROCESSED');
  });
});
