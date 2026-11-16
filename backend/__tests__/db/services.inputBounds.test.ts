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
import {
  NEARBY_MAX_RADIUS_KM,
  NEARBY_MAX_RESULTS,
  ServiceStatus,
  ServiceType,
  UserRole,
} from '@destrabe/shared';

/**
 * DCC-03 — Validación estricta de entradas (db).
 *
 *   - POST /services con coordenadas fuera de rango → 400 y nada persistido.
 *   - GET /services/nearby: radio por encima del máximo → 400; nunca más de
 *     `NEARBY_MAX_RESULTS` filas; sigue en 200 con un registro antiguo con
 *     coordenadas atípicas (anterior al CHECK, que se añade `NOT VALID`).
 *   - CHECK en BD: rechaza coordenadas fuera de rango en escrituras nuevas.
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
vi.mock('../../src/lib/queue', () => ({
  enqueueServiceExpiry: vi.fn().mockResolvedValue(undefined),
  createWorker: vi.fn(),
}));

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

async function authenticateAs(phoneNumber: string, role: UserRole) {
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

async function seedClientProfile(phoneNumber: string) {
  const user = await prisma.user.create({ data: { phoneNumber } });
  return prisma.clientProfile.create({ data: { userId: user.id } });
}

const CLIENT_PHONE = '+573001234700';
const OPERATOR_PHONE = '+573001234701';
const QUERY = { lat: 4.65, lng: -74.1 };
const expiresAt = () => new Date(Date.now() + 15 * 60 * 1000);

describe('POST /services — coordenadas', () => {
  it('400 VALIDATION_ERROR con originLat fuera de rango y no persiste nada', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const res = await client.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: 1000,
      originLng: QUERY.lng,
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.any(String),
      code: 'VALIDATION_ERROR',
    });
    expect(await prisma.service.count()).toBe(0);
  });

  it('400 con photoUrl http', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const res = await client.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: QUERY.lat,
      originLng: QUERY.lng,
      photoUrl: 'http://cdn.example.com/f.jpg',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /services/nearby — radio y límite', () => {
  it('400 si radiusKm supera el máximo', async () => {
    const operator = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);
    const res = await operator
      .get('/services/nearby')
      .query({ ...QUERY, radiusKm: NEARBY_MAX_RADIUS_KM + 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('400 si lat está fuera de rango', async () => {
    const operator = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);
    const res = await operator
      .get('/services/nearby')
      .query({ lat: 1000, lng: QUERY.lng });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it(`nunca devuelve más de ${NEARBY_MAX_RESULTS} filas`, async () => {
    const cp = await seedClientProfile('+573002100000');
    await prisma.service.createMany({
      data: Array.from({ length: NEARBY_MAX_RESULTS + 10 }, () => ({
        clientProfileId: cp.id,
        type: ServiceType.BREAKDOWN,
        status: ServiceStatus.PENDING,
        originLat: QUERY.lat,
        originLng: QUERY.lng,
        expiresAt: expiresAt(),
      })),
    });

    const operator = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);
    const res = await operator.get('/services/nearby').query(QUERY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(NEARBY_MAX_RESULTS);
  });
});

describe('Service — CHECK de coordenadas en BD', () => {
  const CHECK_SQL = `ALTER TABLE "Service" ADD CONSTRAINT "Service_coordinates_range_check" CHECK (
    "originLat" BETWEEN -90 AND 90
    AND "originLng" BETWEEN -180 AND 180
    AND ("destLat" IS NULL OR "destLat" BETWEEN -90 AND 90)
    AND ("destLng" IS NULL OR "destLng" BETWEEN -180 AND 180)
  ) NOT VALID`;

  it('rechaza escrituras nuevas con coordenadas fuera de rango', async () => {
    const cp = await seedClientProfile('+573002200000');
    await expect(
      prisma.service.create({
        data: {
          clientProfileId: cp.id,
          type: ServiceType.BREAKDOWN,
          originLat: 1000,
          originLng: QUERY.lng,
          expiresAt: expiresAt(),
        },
      }),
    ).rejects.toThrow();
  });

  it('/nearby responde 200 aunque exista un registro antiguo con coordenadas atípicas', async () => {
    const cp = await seedClientProfile('+573002300000');
    // Simula una fila previa al CHECK (la restricción es NOT VALID).
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS "Service_coordinates_range_check"',
    );
    try {
      for (const [lat, lng] of [
        [1000, QUERY.lng],
        [QUERY.lat, 1e300],
      ]) {
        await prisma.service.create({
          data: {
            clientProfileId: cp.id,
            type: ServiceType.BREAKDOWN,
            originLat: lat,
            originLng: lng,
            expiresAt: expiresAt(),
          },
        });
      }
    } finally {
      await prisma.$executeRawUnsafe(CHECK_SQL);
    }
    await prisma.service.create({
      data: {
        clientProfileId: cp.id,
        type: ServiceType.BREAKDOWN,
        originLat: QUERY.lat,
        originLng: QUERY.lng,
        expiresAt: expiresAt(),
      },
    });

    const operator = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);
    const res = await operator.get('/services/nearby').query(QUERY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].originLng).toBeCloseTo(QUERY.lng);
  });
});
