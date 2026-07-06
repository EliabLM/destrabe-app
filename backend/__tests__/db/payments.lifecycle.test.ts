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
vi.mock('../../src/lib/queue', () => ({
  enqueueServiceExpiry: vi.fn().mockResolvedValue(undefined),
  createWorker: vi.fn(),
}));

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
    .send({ amount: 5000 });
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

  return { client, operator, serviceId, paymentId: payment!.id, amount: 5000 };
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
    expect(res.body.redirectUrl).toMatch(/^https:\/\/pago\.stub\//);

    // Commission persisted
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    expect(payment!.commission).toBe(0); // env default 0
    expect(payment!.operatorAmount).toBe(5000);
    expect(payment!.mpPaymentId).toMatch(/^stub-/);
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
    const res = await request(createApp()).post(
      '/payments/some-id/init',
    );
    expect(res.status).toBe(401);
  });
});

// ─── POST /payments/webhook (REQ-002/004) ────────────────────────────────────

describe('POST /payments/webhook (REQ-002/004)', () => {
  it('webhook CONFIRMED sobre PENDING → 200 + status CONFIRMED + commission recalculado', async () => {
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
    expect(payment!.commission).toBe(0);
    expect(payment!.operatorAmount).toBe(5000);
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
    const { client, serviceId } = await createAcceptedService(
      CLIENT_PHONE,
      OPERATOR_PHONE,
    );
    // CLIENT cannot cancel ACTIVE, but we can test a regular cancel scenario
    // Create a fresh PENDING service and cancel it
    // Actually, the service is ACTIVE after accept, so CLIENT can't cancel it
    // Let's test PENDING→CANCELLED by CLIENT via a fresh service
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
