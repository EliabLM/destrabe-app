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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
 *   - GET /services/nearby: radio por encima del máximo o lat/lng vacíos → 400;
 *     nunca más de `NEARBY_MAX_RESULTS` filas.
 *   - CHECK en BD validado: rechaza coordenadas fuera de rango.
 *   - La migración limpia filas inválidas previas, que después se pueden
 *     expirar, cancelar y cotizar.
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
import { expireOverdueServices } from '../../src/jobs/serviceExpiry.job';

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
const originAt = (p: { lat: number; lng: number }) => ({
  originLat: p.lat,
  originLng: p.lng,
});
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

  it('400 si lat o lng llegan vacíos', async () => {
    const operator = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);
    const res = await operator.get('/services/nearby?lat=&lng=');
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

describe('CHECK de coordenadas en BD', () => {
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
    const user = await prisma.user.create({
      data: { phoneNumber: '+573002200001' },
    });
    await expect(
      prisma.operatorProfile.create({
        data: {
          userId: user.id,
          truckType: 'grúa',
          licensePlate: 'ABC123',
          lastLongitude: -181,
        },
      }),
    ).rejects.toThrow();
  });

  it('la restricción queda validada (no NOT VALID)', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ conname: string; convalidated: boolean }>
    >`SELECT conname, convalidated FROM pg_constraint
      WHERE conname IN ('Service_coordinates_range_check', 'OperatorProfile_coordinates_range_check')
      ORDER BY conname`;
    expect(rows).toEqual([
      {
        conname: 'OperatorProfile_coordinates_range_check',
        convalidated: true,
      },
      { conname: 'Service_coordinates_range_check', convalidated: true },
    ]);
  });
});

describe('Migración de coordenadas con filas inválidas previas', () => {
  const migrationSql = readFileSync(
    join(
      __dirname,
      '../../prisma/migrations/20261116180000_service_coordinates_check/migration.sql',
    ),
    'utf8',
  );

  /** Ejecuta la migración sentencia a sentencia (sin comentarios). */
  async function runMigration() {
    const statements = migrationSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((sql) => sql.trim())
      .filter(Boolean);
    for (const sql of statements) await prisma.$executeRawUnsafe(sql);
  }

  it('limpia los datos, valida el CHECK y las filas se pueden expirar, cancelar y cotizar', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const clientUser = await prisma.user.findUniqueOrThrow({
      where: { phoneNumber: CLIENT_PHONE },
    });
    const cp = await prisma.clientProfile.create({
      data: { userId: clientUser.id },
    });
    const opUser = await prisma.user.create({
      data: { phoneNumber: '+573002400000', role: UserRole.OPERATOR },
    });

    // Estado previo a la migración: sin CHECK y con filas inválidas.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS "Service_coordinates_range_check"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "OperatorProfile" DROP CONSTRAINT IF EXISTS "OperatorProfile_coordinates_range_check"',
    );
    const base = {
      clientProfileId: cp.id,
      type: ServiceType.TRANSFER,
      expiresAt: expiresAt(),
    };
    const badOrigin = await prisma.service.create({
      data: { ...base, originLat: 1000, originLng: QUERY.lng },
    });
    const badOriginActive = await prisma.service.create({
      data: {
        ...base,
        status: ServiceStatus.ACTIVE,
        originLat: QUERY.lat,
        originLng: 1e300,
      },
    });
    const toQuote = await prisma.service.create({
      data: { ...base, ...originAt(QUERY), destLat: 1000, destLng: -74 },
    });
    const toExpire = await prisma.service.create({
      data: { ...base, ...originAt(QUERY), destLat: 4, destLng: -500 },
    });
    const toCancel = await prisma.service.create({
      data: { ...base, ...originAt(QUERY), destLat: -91, destLng: 0 },
    });
    const operator = await prisma.operatorProfile.create({
      data: {
        userId: opUser.id,
        truckType: 'grúa',
        licensePlate: 'ABC123',
        lastLatitude: 1000,
        lastLongitude: QUERY.lng,
      },
    });

    await runMigration();

    // Limpieza: origen acotado (abiertos cancelados), destino y operador a NULL.
    const after = async (id: string) =>
      prisma.service.findUniqueOrThrow({ where: { id } });
    expect(await after(badOrigin.id)).toMatchObject({
      status: ServiceStatus.CANCELLED,
      originLat: 90,
    });
    expect(await after(badOriginActive.id)).toMatchObject({
      status: ServiceStatus.ACTIVE,
      originLng: 180,
    });
    for (const s of [toQuote, toExpire, toCancel]) {
      expect(await after(s.id)).toMatchObject({
        status: ServiceStatus.PENDING,
        destLat: null,
        destLng: null,
      });
    }
    expect(
      await prisma.operatorProfile.findUniqueOrThrow({
        where: { id: operator.id },
      }),
    ).toMatchObject({ lastLatitude: null, lastLongitude: null });

    // Las filas antes inválidas admiten actualizaciones.
    await prisma.service.update({
      where: { id: toExpire.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expireOverdueServices();
    expect((await after(toExpire.id)).status).toBe(ServiceStatus.CANCELLED);

    const cancel = await client
      .patch(`/services/${toCancel.id}/status`)
      .send({ status: ServiceStatus.CANCELLED });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe(ServiceStatus.CANCELLED);

    await prisma.quote.create({
      data: {
        serviceId: toQuote.id,
        operatorProfileId: operator.id,
        amount: 100,
      },
    });
    await prisma.service.update({
      where: { id: toQuote.id },
      data: { status: ServiceStatus.QUOTED },
    });
    await prisma.service.update({
      where: { id: badOriginActive.id },
      data: { status: ServiceStatus.COMPLETED },
    });
    await prisma.operatorProfile.update({
      where: { id: operator.id },
      data: { available: true },
    });

    // /nearby sigue en 200 y solo devuelve servicios abiertos válidos.
    const op = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);
    const res = await op.get('/services/nearby').query(QUERY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
