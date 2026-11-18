import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { ServiceStatus, ServiceType, UserRole } from '@destrabe/shared';

/**
 * DCC-02 — Acceso del rol OPERATOR a servicios (BD real, dos operadores).
 *
 *   - Solo el operador asignado lee el detalle y cambia el estado; para el
 *     resto, 404.
 *   - Un operador no asignado ve una vista previa (coordenadas redondeadas,
 *     sin foto ni datos del cliente) solo en PENDING/QUOTED sin expirar.
 *   - Aceptar una cotización fija `assignedOperatorProfileId`.
 *   - El backfill de la migración rellena los servicios existentes.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://destrabe:destrabe@localhost:5432/destrabe_db';

const { capturedSendOtps, sendOtpMock } = vi.hoisted(() => ({
  capturedSendOtps: [] as { phoneNumber: string; code: string }[],
  sendOtpMock: vi.fn(async (phoneNumber: string, code: string) => {
    capturedSendOtps.push({ phoneNumber, code });
  }),
}));
vi.mock('../../src/lib/plivo', () => ({ sendOtp: sendOtpMock }));

const prisma = new PrismaClient();

const TABLES = [
  'SmsSendLog',
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

type Agent = ReturnType<typeof request.agent>;

async function authenticateAs(
  phoneNumber: string,
  role: UserRole,
): Promise<Agent> {
  const agent = request.agent(createApp());
  await agent.post('/api/auth/phone-number/send-otp').send({ phoneNumber });
  const code = capturedSendOtps.at(-1)!.code;
  const verifyRes = await agent
    .post('/api/auth/phone-number/verify')
    .send({ phoneNumber, code });
  expect(verifyRes.status).toBeLessThan(300);
  if (role !== UserRole.CLIENT) {
    await prisma.user.update({ where: { phoneNumber }, data: { role } });
  }
  return agent;
}

async function operatorWithProfile(phoneNumber: string) {
  const agent = await authenticateAs(phoneNumber, UserRole.OPERATOR);
  const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber } });
  const profile = await prisma.operatorProfile.create({
    data: {
      userId: user.id,
      truckType: 'Grua',
      licensePlate: 'ABC123',
      available: true,
    },
  });
  return { agent, profileId: profile.id };
}

// Coordenadas con más de 3 decimales (Cartagena) para comprobar el redondeo.
const ORIGIN = { lat: 10.391049, lng: -75.479426 };
const DEST = { lat: 10.423456, lng: -75.548765 };
const PHOTO = 'https://example.com/foto.jpg';

async function createService(client: Agent) {
  const res = await client.post('/services').send({
    type: ServiceType.BREAKDOWN,
    originLat: ORIGIN.lat,
    originLng: ORIGIN.lng,
    destLat: DEST.lat,
    destLng: DEST.lng,
    description: 'Llanta pinchada',
    photoUrl: PHOTO,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function expectPreview(body: Record<string, unknown>) {
  expect(body.originLat).toBe(10.391);
  expect(body.originLng).toBe(-75.479);
  expect(body.destLat).toBe(10.423);
  expect(body.destLng).toBe(-75.549);
  for (const field of [
    'photoUrl',
    'client',
    'clientProfileId',
    'originAddress',
    'destAddress',
    'acceptedQuoteId',
    'assignedOperatorProfileId',
  ]) {
    expect(body).not.toHaveProperty(field);
  }
}

const CLIENT_PHONE = '+573006000001';
const OPERATOR_A_PHONE = '+573006000002';
const OPERATOR_B_PHONE = '+573006000003';
const OPERATOR_NO_PROFILE_PHONE = '+573006000004';

// ─── Servicio ACTIVE asignado a A ────────────────────────────────────────────

describe('DCC-02 — servicio ACTIVE asignado al operador A', () => {
  it('aceptar fija el operador asignado; B recibe 404 al leer y completar; A sí puede', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const a = await operatorWithProfile(OPERATOR_A_PHONE);
    const b = await operatorWithProfile(OPERATOR_B_PHONE);
    const noProfile = await authenticateAs(
      OPERATOR_NO_PROFILE_PHONE,
      UserRole.OPERATOR,
    );

    const serviceId = await createService(client);
    const quoteA = await a.agent
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 50000 });
    expect(quoteA.status).toBe(201);
    const quoteB = await b.agent
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 45000 });
    expect(quoteB.status).toBe(201);

    const accept = await client
      .post(`/quotes/${quoteA.body.id}/accept`)
      .send({});
    expect(accept.status).toBe(200);

    const assigned = await prisma.service.findUniqueOrThrow({
      where: { id: serviceId },
    });
    expect(assigned.status).toBe(ServiceStatus.ACTIVE);
    expect(assigned.assignedOperatorProfileId).toBe(a.profileId);

    await prisma.payment.update({
      where: { serviceId },
      data: { status: 'CONFIRMED' },
    });

    // B (cotizó pero no fue elegido) no ve ni actúa sobre el servicio.
    expect((await b.agent.get(`/services/${serviceId}`)).status).toBe(404);
    const bPatch = await b.agent
      .patch(`/services/${serviceId}/status`)
      .send({ status: ServiceStatus.COMPLETED });
    expect(bPatch.status).toBe(404);
    expect(bPatch.body.code).toBe('NOT_FOUND');

    // Un operador sin perfil tampoco.
    expect((await noProfile.get(`/services/${serviceId}`)).status).toBe(404);
    expect(
      (
        await noProfile
          .patch(`/services/${serviceId}/status`)
          .send({ status: ServiceStatus.COMPLETED })
      ).status,
    ).toBe(404);

    const stillActive = await prisma.service.findUniqueOrThrow({
      where: { id: serviceId },
    });
    expect(stillActive.status).toBe(ServiceStatus.ACTIVE);

    // A ve el detalle completo (coordenadas exactas y foto), sin datos del cliente.
    const aGet = await a.agent.get(`/services/${serviceId}`);
    expect(aGet.status).toBe(200);
    expect(aGet.body.originLat).toBe(ORIGIN.lat);
    expect(aGet.body.destLng).toBe(DEST.lng);
    expect(aGet.body.photoUrl).toBe(PHOTO);
    expect(aGet.body).not.toHaveProperty('client');
    expect(aGet.body).not.toHaveProperty('clientProfileId');

    // A no puede hacer otras transiciones, pero sí completar.
    const aCancel = await a.agent
      .patch(`/services/${serviceId}/status`)
      .send({ status: ServiceStatus.CANCELLED });
    expect(aCancel.status).toBe(403);
    const aComplete = await a.agent
      .patch(`/services/${serviceId}/status`)
      .send({ status: ServiceStatus.COMPLETED });
    expect(aComplete.status).toBe(200);
    expect(aComplete.body.status).toBe(ServiceStatus.COMPLETED);
  });
});

// ─── Vista previa para operadores no asignados ───────────────────────────────

describe('DCC-02 — operador no asignado en PENDING/QUOTED', () => {
  it('ve coordenadas redondeadas y sin foto ni datos del cliente', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const a = await operatorWithProfile(OPERATOR_A_PHONE);
    const b = await operatorWithProfile(OPERATOR_B_PHONE);
    const serviceId = await createService(client);

    // PENDING
    const pending = await b.agent.get(`/services/${serviceId}`);
    expect(pending.status).toBe(200);
    expect(pending.body.status).toBe(ServiceStatus.PENDING);
    expect(pending.body.description).toBe('Llanta pinchada');
    expectPreview(pending.body);

    // QUOTED (A cotiza; B sigue sin estar asignado)
    await a.agent.post(`/services/${serviceId}/quotes`).send({ amount: 50000 });
    const quoted = await b.agent.get(`/services/${serviceId}`);
    expect(quoted.status).toBe(200);
    expect(quoted.body.status).toBe(ServiceStatus.QUOTED);
    expectPreview(quoted.body);

    // /nearby usa la misma vista previa (QUOTED incluido, DCC-07).
    const nearby = await b.agent
      .get('/services/nearby')
      .query({ lat: ORIGIN.lat, lng: ORIGIN.lng, radiusKm: 5 });
    expect(nearby.status).toBe(200);
    expect(nearby.body).toHaveLength(1);
    expectPreview(nearby.body[0]);

    // El dueño sigue viendo todo exacto.
    const owner = await client.get(`/services/${serviceId}`);
    expect(owner.body.originLat).toBe(ORIGIN.lat);
    expect(owner.body.photoUrl).toBe(PHOTO);
  });

  it('404 si el servicio expiró o ya no admite cotizaciones', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const b = await operatorWithProfile(OPERATOR_B_PHONE);
    const expiredId = await createService(client);
    await prisma.service.update({
      where: { id: expiredId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect((await b.agent.get(`/services/${expiredId}`)).status).toBe(404);

    const cancelledId = await createService(client);
    await prisma.service.update({
      where: { id: cancelledId },
      data: { status: ServiceStatus.CANCELLED },
    });
    expect((await b.agent.get(`/services/${cancelledId}`)).status).toBe(404);
  });
});

// ─── Backfill de la migración ────────────────────────────────────────────────

describe('DCC-02 — backfill de assignedOperatorProfileId', () => {
  const migrationSql = readFileSync(
    join(
      __dirname,
      '../../prisma/migrations/20261116120000_service_assigned_operator/migration.sql',
    ),
    'utf8',
  );
  const backfill = migrationSql.slice(migrationSql.indexOf('UPDATE "Service"'));

  it('rellena los servicios con cotización aceptada y no toca el resto', async () => {
    const clientUser = await prisma.user.create({
      data: { phoneNumber: '+573006100001' },
    });
    const opUser = await prisma.user.create({
      data: { phoneNumber: '+573006100002' },
    });
    const cp = await prisma.clientProfile.create({
      data: { userId: clientUser.id },
    });
    const op = await prisma.operatorProfile.create({
      data: { userId: opUser.id, truckType: 'Grua', licensePlate: 'XYZ987' },
    });
    const base = {
      clientProfileId: cp.id,
      type: ServiceType.BREAKDOWN,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      expiresAt: new Date(Date.now() + 60_000),
    };
    // Datos "anteriores a la migración": aceptado pero sin operador asignado.
    const legacy = await prisma.service.create({
      data: { ...base, status: ServiceStatus.ACTIVE },
    });
    const quote = await prisma.quote.create({
      data: { serviceId: legacy.id, operatorProfileId: op.id, amount: 1000 },
    });
    await prisma.service.update({
      where: { id: legacy.id },
      data: { acceptedQuoteId: quote.id },
    });
    const pending = await prisma.service.create({
      data: { ...base, status: ServiceStatus.PENDING },
    });

    expect(backfill).toMatch(/^UPDATE "Service"/);
    await prisma.$executeRawUnsafe(backfill);
    // Idempotente: una segunda ejecución no cambia nada.
    await prisma.$executeRawUnsafe(backfill);

    const after = await prisma.service.findMany({
      where: { id: { in: [legacy.id, pending.id] } },
      select: { id: true, assignedOperatorProfileId: true },
    });
    const byId = Object.fromEntries(
      after.map((s) => [s.id, s.assignedOperatorProfileId]),
    );
    expect(byId[legacy.id]).toBe(op.id);
    expect(byId[pending.id]).toBeNull();
  });
});
