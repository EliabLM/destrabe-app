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
 * DCC-07 / DCC-19 — ciclo de vida del servicio con BD real (sin Redis).
 *
 *   - `expireOverdueServices()` cancela PENDING y QUOTED vencidos, no toca los
 *     vigentes ni los ACTIVE, y no duplica notificaciones al repetirse ni con
 *     dos barridos simultáneos.
 *   - `/services/nearby` muestra a otros operadores los servicios ya
 *     cotizados, con `quoteCount`, y no repite los que el operador cotizó.
 *   - La consulta de `/nearby` puede usar el índice parcial
 *     "Service_open_origin_geog_idx".
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://destrabe:destrabe@localhost:5432/destrabe_db';

const { capturedSendOtps, sendOtpMock, notifyClientMock } = vi.hoisted(() => ({
  capturedSendOtps: [] as { phoneNumber: string; code: string }[],
  sendOtpMock: vi.fn(async (phoneNumber: string, code: string) => {
    capturedSendOtps.push({ phoneNumber, code });
  }),
  notifyClientMock: vi.fn(),
}));
vi.mock('../../src/lib/plivo', () => ({ sendOtp: sendOtpMock }));
vi.mock('../../src/lib/notifications', () => ({
  notifyClient: notifyClientMock,
}));

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
  notifyClientMock.mockClear();
});

afterAll(async () => {
  await truncateAll();
  await prisma.$disconnect();
});

import { createApp } from '../../src/app';
import { expireOverdueServices } from '../../src/jobs/serviceExpiry.job';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Agent = ReturnType<typeof request.agent>;

const CLIENT_PHONE = '+573001110001';
const OPERATOR_A_PHONE = '+573001110002';
const OPERATOR_B_PHONE = '+573001110003';
const ORIGIN = { lat: 10.391049, lng: -75.479426 };

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

let seq = 0;
async function seedService(status: ServiceStatus, expiresInMs: number) {
  seq += 1;
  const user = await prisma.user.create({
    data: { phoneNumber: `+5730099${String(seq).padStart(5, '0')}` },
  });
  const client = await prisma.clientProfile.create({
    data: { userId: user.id },
  });
  return prisma.service.create({
    data: {
      clientProfileId: client.id,
      type: ServiceType.BREAKDOWN,
      status,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      expiresAt: new Date(Date.now() + expiresInMs),
    },
  });
}

async function statusOf(id: string) {
  const s = await prisma.service.findUniqueOrThrow({ where: { id } });
  return s.status;
}

// ─── Expiración ──────────────────────────────────────────────────────────────

describe('DCC-07 — expireOverdueServices', () => {
  it('cancela PENDING y QUOTED vencidos; repetir no duplica notificaciones', async () => {
    const pending = await seedService(ServiceStatus.PENDING, -60_000);
    const quoted = await seedService(ServiceStatus.QUOTED, -60_000);
    const fresh = await seedService(ServiceStatus.PENDING, 15 * 60_000);
    const active = await seedService(ServiceStatus.ACTIVE, -60_000);

    expect(await expireOverdueServices()).toBe(2);

    expect(await statusOf(pending.id)).toBe(ServiceStatus.CANCELLED);
    expect(await statusOf(quoted.id)).toBe(ServiceStatus.CANCELLED);
    expect(await statusOf(fresh.id)).toBe(ServiceStatus.PENDING);
    expect(await statusOf(active.id)).toBe(ServiceStatus.ACTIVE);
    expect(notifyClientMock).toHaveBeenCalledTimes(2);
    expect(notifyClientMock).toHaveBeenCalledWith(
      { id: pending.id, clientProfileId: pending.clientProfileId },
      'expired',
    );
    expect(notifyClientMock).toHaveBeenCalledWith(
      { id: quoted.id, clientProfileId: quoted.clientProfileId },
      'expired',
    );

    // Segunda ejecución: nada que cancelar, ninguna notificación nueva.
    expect(await expireOverdueServices()).toBe(0);
    expect(notifyClientMock).toHaveBeenCalledTimes(2);
  });

  it('dos barridos simultáneos notifican cada servicio una sola vez', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await seedService(ServiceStatus.PENDING, -60_000)).id);
    }

    const counts = await Promise.all([
      expireOverdueServices(),
      expireOverdueServices(),
    ]);

    expect(counts[0] + counts[1]).toBe(5);
    expect(notifyClientMock).toHaveBeenCalledTimes(5);
    const notified = notifyClientMock.mock.calls.map(([s]) => s.id).sort();
    expect(notified).toEqual([...ids].sort());
  });
});

// ─── /nearby con varias ofertas ──────────────────────────────────────────────

describe('DCC-07 — /services/nearby con varias ofertas', () => {
  const near = { lat: ORIGIN.lat, lng: ORIGIN.lng, radiusKm: 5 };

  it('B ve el servicio cotizado por A con quoteCount = 1; A no lo ve repetido', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const a = await operatorWithProfile(OPERATOR_A_PHONE);
    const b = await operatorWithProfile(OPERATOR_B_PHONE);
    const created = await client.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
    });
    expect(created.status).toBe(201);
    const serviceId = created.body.id as string;

    const before = await b.agent.get('/services/nearby').query(near);
    expect(before.body).toHaveLength(1);
    expect(before.body[0].quoteCount).toBe(0);

    const quote = await a.agent
      .post(`/services/${serviceId}/quotes`)
      .send({ amount: 50000 });
    expect(quote.status).toBe(201);

    const forB = await b.agent.get('/services/nearby').query(near);
    expect(forB.status).toBe(200);
    expect(forB.body).toHaveLength(1);
    expect(forB.body[0]).toMatchObject({
      id: serviceId,
      status: ServiceStatus.QUOTED,
      quoteCount: 1,
    });

    const forA = await a.agent.get('/services/nearby').query(near);
    expect(forA.status).toBe(200);
    expect(forA.body).toHaveLength(0);
  });

  it('no muestra servicios QUOTED vencidos aunque el barrido no haya pasado', async () => {
    const b = await operatorWithProfile(OPERATOR_B_PHONE);
    await seedService(ServiceStatus.QUOTED, -1_000);

    const res = await b.agent.get('/services/nearby').query(near);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('la consulta puede usar el índice parcial de servicios abiertos', async () => {
    await seedService(ServiceStatus.PENDING, 15 * 60_000);
    const plan = await prisma.$transaction(async (tx) => {
      // Sin datos el planificador prefiere el seq scan; se desactiva solo
      // para comprobar que el índice es aplicable a la consulta.
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
        EXPLAIN
        SELECT s.id FROM "Service" s
        WHERE ST_DWithin(
            ST_MakePoint(s."originLng", s."originLat")::geography,
            ST_MakePoint(${ORIGIN.lng}::float8, ${ORIGIN.lat}::float8)::geography,
            ${5000}::float8
          )
          AND s.status IN ('PENDING'::"ServiceStatus", 'QUOTED'::"ServiceStatus")
          AND s."expiresAt" > NOW()
      `;
    });
    const text = plan.map((row) => row['QUERY PLAN']).join('\n');
    expect(text).toContain('Service_open_origin_geog_idx');
  });
});
