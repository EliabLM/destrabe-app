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
 * T7 — Quotes lifecycle db smoke (REQ-001..007).
 *
 * Requiere Postgres+PostGIS+Redis up (`npm run db:up`). Ejercicio end-to-end
 * de los 3 endpoints de quotes contra la DB real, autenticando CLIENT y
 * OPERATOR vía OTP (mock Plivo) y reutilizando el patrón de
 * `services.lifecycle.test.ts` (cambio-004).
 *
 * Flujo core: client crea service PENDING → operator cotiza → service QUOTED
 * → client acepta → service ACTIVE + Payment stub.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://destrabe:destrabe@localhost:5432/destrabe_db';

// ─── Hoisted mocks (mismo patrón que services.lifecycle.test.ts) ─────────────

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
  await agent
    .post('/api/auth/phone-number/send-otp')
    .send({ phoneNumber });
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

/** Autentica OPERATOR + crea OperatorProfile (requerido para cotizar). */
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

/** Crea un service PENDING vía API como CLIENT y devuelve { agent, serviceId }. */
async function createPendingService(phone: string) {
  const client = await authenticateAs(phone, UserRole.CLIENT);
  const res = await client.post('/services').send({
    type: ServiceType.BREAKDOWN,
    originLat: 4.65,
    originLng: -74.1,
  });
  expect(res.status).toBe(201);
  return { client, serviceId: res.body.id as string };
}

const CLIENT_PHONE = '+573005000001';
const OPERATOR_PHONE = '+573005000002';
const OPERATOR2_PHONE = '+573005000003';
const CLIENT2_PHONE = '+573005000004';

// ─── POST /services/:id/quotes (REQ-001/007) ─────────────────────────────────

describe('POST /services/:id/quotes (REQ-001/007)', () => {
  it('operador con perfil cotiza sobre PENDING → 201 + service QUOTED', async () => {
    const { serviceId } = await createPendingService(CLIENT_PHONE);
    const operator = await authenticateOperatorWithProfile(OPERATOR_PHONE);

    const res = await operator
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 5000, estimatedMinutes: 20, note: 'Llego pronto' });

    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.amount).toBe(5000);

    // Service transitioned to QUOTED
    const svc = await prisma.service.findUnique({ where: { id: serviceId } });
    expect(svc!.status).toBe(ServiceStatus.QUOTED);
  });

  it('segunda quote sobre QUOTED no transiciona (permanece QUOTED)', async () => {
    const { serviceId } = await createPendingService(CLIENT_PHONE);
    const op1 = await authenticateOperatorWithProfile(OPERATOR_PHONE);
    const op2 = await authenticateOperatorWithProfile(OPERATOR2_PHONE);

    await op1.post(`/services/${serviceId}/quotes`).send({ amount: 4000 });
    const res2 = await op2
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 4500 });

    expect(res2.status).toBe(201);
    const svc = await prisma.service.findUnique({ where: { id: serviceId } });
    expect(svc!.status).toBe(ServiceStatus.QUOTED);
  });

  it('422 si el operador no tiene OperatorProfile', async () => {
    const { serviceId } = await createPendingService(CLIENT_PHONE);
    const operator = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);

    const res = await operator
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 5000 });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OPERATOR_PROFILE_REQUIRED');
  });

  it('409 si el service está ACTIVE (no acepta quotes)', async () => {
    const { client, serviceId } = await createPendingService(CLIENT_PHONE);
    const operator = await authenticateOperatorWithProfile(OPERATOR_PHONE);

    // Create quote + accept it → ACTIVE
    const quoteRes = await operator
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 5000 });
    await client.post(`/quotes/${quoteRes.body.id}/accept`).send({});

    // Second operator tries to quote on ACTIVE
    const op2 = await authenticateOperatorWithProfile(OPERATOR2_PHONE);
    const res = await op2
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 6000 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });

  it('403 si el rol no es OPERATOR', async () => {
    const { serviceId } = await createPendingService(CLIENT_PHONE);
    const client2 = await authenticateAs(CLIENT2_PHONE, UserRole.CLIENT);

    const res = await client2
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 5000 });

    expect(res.status).toBe(403);
  });

  it('401 sin autenticación', async () => {
    const { serviceId } = await createPendingService(CLIENT_PHONE);
    const res = await request(createApp())
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 5000 });
    expect(res.status).toBe(401);
  });
});

// ─── GET /services/:id/quotes (REQ-002) ──────────────────────────────────────

describe('GET /services/:id/quotes (REQ-002)', () => {
  it('dueño ve todas las quotes con datos del operador', async () => {
    const { client, serviceId } = await createPendingService(CLIENT_PHONE);
    const op1 = await authenticateOperatorWithProfile(OPERATOR_PHONE);
    const op2 = await authenticateOperatorWithProfile(OPERATOR2_PHONE);

    await op1.post(`/services/${serviceId}/quotes`).send({ amount: 4000 });
    await op2.post(`/services/${serviceId}/quotes`).send({ amount: 4500 });

    const res = await client.get(`/services/${serviceId}/quotes`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Cada quote incluye datos públicos del operador
    expect(res.body[0].operator).toBeDefined();
    expect(res.body[0].operator.truckType).toBeDefined();
    expect(res.body[0].operator.licensePlate).toBeDefined();
    expect(res.body[0].operator.rating).toBeDefined();
  });

  it('operador ve solo sus propias quotes', async () => {
    const { serviceId } = await createPendingService(CLIENT_PHONE);
    const op1 = await authenticateOperatorWithProfile(OPERATOR_PHONE);
    const op2 = await authenticateOperatorWithProfile(OPERATOR2_PHONE);

    await op1.post(`/services/${serviceId}/quotes`).send({ amount: 4000 });
    await op2.post(`/services/${serviceId}/quotes`).send({ amount: 4500 });

    const res = await op1.get(`/services/${serviceId}/quotes`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].amount).toBe(4000);
  });

  it('cliente ajeno → 404', async () => {
    const { serviceId } = await createPendingService(CLIENT_PHONE);
    const client2 = await authenticateAs(CLIENT2_PHONE, UserRole.CLIENT);

    const res = await client2.get(`/services/${serviceId}/quotes`);
    expect(res.status).toBe(404);
  });
});

// ─── POST /quotes/:id/accept (REQ-003/006) ───────────────────────────────────

describe('POST /quotes/:id/accept (REQ-003/006)', () => {
  it('dueño acepta quote → ACTIVE + acceptedQuoteId + Payment stub', async () => {
    const { client, serviceId } = await createPendingService(CLIENT_PHONE);
    const operator = await authenticateOperatorWithProfile(OPERATOR_PHONE);
    const quoteRes = await operator
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 5000 });

    const res = await client.post(`/quotes/${quoteRes.body.id}/accept`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(ServiceStatus.ACTIVE);
    expect(res.body.acceptedQuoteId).toBe(quoteRes.body.id);

    // Payment stub created
    const payment = await prisma.payment.findUnique({
      where: { serviceId },
    });
    expect(payment).not.toBeNull();
    expect(payment!.amount).toBe(5000);
    expect(payment!.commission).toBe(0);
    expect(payment!.operatorAmount).toBe(5000);
    expect(payment!.status).toBe('PENDING');
  });

  it('doble accept → 409 ALREADY_ACCEPTED', async () => {
    const { client, serviceId } = await createPendingService(CLIENT_PHONE);
    const operator = await authenticateOperatorWithProfile(OPERATOR_PHONE);
    const quoteRes = await operator
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 5000 });

    await client.post(`/quotes/${quoteRes.body.id}/accept`).send({});
    const res = await client
      .post(`/quotes/${quoteRes.body.id}/accept`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_ACCEPTED');
  });

  it('no-dueño → 403', async () => {
    const { serviceId } = await createPendingService(CLIENT_PHONE);
    const operator = await authenticateOperatorWithProfile(OPERATOR_PHONE);
    const quoteRes = await operator
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 5000 });

    // Client2 (not the owner) tries to accept
    const client2 = await authenticateAs(CLIENT2_PHONE, UserRole.CLIENT);
    const res = await client2
      .post(`/quotes/${quoteRes.body.id}/accept`)
      .send({});

    expect(res.status).toBe(403);
  });
});
