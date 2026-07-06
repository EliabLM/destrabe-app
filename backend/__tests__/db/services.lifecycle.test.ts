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
 * T9 — Services lifecycle db smoke (REQ-002/003/004/005/010).
 *
 * Requiere Postgres+PostGIS+Redis up (`npm run db:up`). Ejercicio end-to-end
 * de los 4 endpoints de `/services` contra la DB real de dev, autenticando
 * vía el flujo OTP de Better Auth (mock de Plivo captura el código).
 *
 * Cobertura:
 *   POST   /services        (CLIENT): PENDING + ClientProfile lazy (REQ-002)
 *   GET    /services/:id    dueño completo / operador público / ajeno 404 (REQ-004)
 *   PATCH  /services/:id/status  PENDING→CANCELLED dueño; 409 ilegal (REQ-005)
 *   GET    /services/nearby PostGIS: PENDING 1km dentro, 10km fora, COMPLETED fora (REQ-003/010)
 *   init_postgis idempotente (pg_extension) (REQ-010)
 *
 * `enqueueServiceExpiry` se mockea para evitar la conexión Redis al cargar
 * `queue.ts` (el route ya la skippea en NODE_ENV=test, el mock es belt-and-
 * suspenders para que el db test no dependa de Redis para el cycle de POST).
 */

// Prisma lee env("DATABASE_URL") de process.env en tiempo de conexión (lazy).
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://destrabe:destrabe@localhost:5432/destrabe_db';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

// Mock de Plivo: captura el OTP generado por el plugin phoneNumber.
const { capturedSendOtps, sendOtpMock } = vi.hoisted(() => ({
  capturedSendOtps: [] as { phoneNumber: string; code: string }[],
  sendOtpMock: vi.fn(async (phoneNumber: string, code: string) => {
    capturedSendOtps.push({ phoneNumber, code });
  }),
}));
vi.mock('../../src/lib/plivo', () => ({ sendOtp: sendOtpMock }));

// Mock de queue: evita `new Queue`/`new IORedis` al cargar queue.ts (side
// effect de módulo). El route skippea el enqueue en test, así que el spy
// no se invoca; el mock existe solo para aislar la conexión Redis.
vi.mock('../../src/lib/queue', () => ({
  enqueueServiceExpiry: vi.fn().mockResolvedValue(undefined),
  createWorker: vi.fn(),
}));

// ─── Prisma dedicado para limpieza/siembra (no se mockea: db smoke) ──────────

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

// `createApp` se importa DESPUÉS de setear DATABASE_URL y los mocks (vitest
// hoist-ea los vi.mock sobre los imports).
import { createApp } from '../../src/app';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Autentica un usuario vía OTP y devuelve un supertest agent con la cookie de
 * sesión seteada. Si `role !== CLIENT`, actualiza el rol en DB después del
 * verify (getSession relee el rol de la fila User en cada request).
 */
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

/** Siembra un Service directamente en DB (User + ClientProfile + Service). */
async function seedService(opts: {
  status: ServiceStatus;
  lat: number;
  lng: number;
  phoneNumber?: string;
}) {
  const user = await prisma.user.create({
    data: { phoneNumber: opts.phoneNumber ?? `+57300${Math.random().toString(36).slice(2, 8)}` },
  });
  const cp = await prisma.clientProfile.create({ data: { userId: user.id } });
  return prisma.service.create({
    data: {
      clientProfileId: cp.id,
      type: ServiceType.BREAKDOWN,
      status: opts.status,
      originLat: opts.lat,
      originLng: opts.lng,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
}

const CLIENT_PHONE = '+573001234600';
const OPERATOR_PHONE = '+573001234601';
const CLIENT2_PHONE = '+573001234602';

// Punto de referencia (Bogotá): ~4.65, -74.10. 1 deg lat ≈ 111km.
const QUERY = { lat: 4.65, lng: -74.1 };
// ~10km al norte: 10/111 ≈ 0.09 deg.
const FAR_LAT = 4.65 + 0.09;

// ─── POST /services (REQ-002) ────────────────────────────────────────────────

describe('POST /services (REQ-002) — CLIENT crea servicio PENDING', () => {
  it('201 con status PENDING + ClientProfile lazy upsert', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);

    const res = await client.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: QUERY.lat,
      originLng: QUERY.lng,
      description: 'Grúa solicitada en Bogotá',
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.status).toBe(ServiceStatus.PENDING);
    expect(res.body.expiresAt).toBeDefined();
    // expiresAt ≈ now + 15min (SERVICE_TIMEOUT_MINUTES)
    const ttl = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(10 * 60 * 1000);
    expect(ttl).toBeLessThan(20 * 60 * 1000);

    // REQ-002: ClientProfile se creó (lazy upsert) para el user.
    const cp = await prisma.clientProfile.findFirst();
    expect(cp).not.toBeNull();

    // El Service existe en DB con status PENDING.
    const svc = await prisma.service.findFirst();
    expect(svc).not.toBeNull();
    expect(svc!.status).toBe(ServiceStatus.PENDING);
  });

  it('401 sin autenticación', async () => {
    const res = await request(createApp()).post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: QUERY.lat,
      originLng: QUERY.lng,
    });
    expect(res.status).toBe(401);
  });

  it('403 si el rol no es CLIENT', async () => {
    const operator = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);
    const res = await operator.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: QUERY.lat,
      originLng: QUERY.lng,
    });
    expect(res.status).toBe(403);
  });
});

// ─── GET /services/:id (REQ-004) ─────────────────────────────────────────────

describe('GET /services/:id (REQ-004) — visibilidad por rol', () => {
  it('dueño (CLIENT) ve datos completos incluido client', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const postRes = await client.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: QUERY.lat,
      originLng: QUERY.lng,
    });
    const id = postRes.body.id;

    const res = await client.get(`/services/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.client).toBeDefined();
    expect(res.body.clientProfileId).toBeDefined();
  });

  it('operador ve datos públicos (sin client/clientProfileId)', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const operator = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);
    const postRes = await client.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: QUERY.lat,
      originLng: QUERY.lng,
    });
    const id = postRes.body.id;

    const res = await operator.get(`/services/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.client).toBeUndefined();
    expect(res.body.clientProfileId).toBeUndefined();
  });

  it('cliente ajeno recibe 404 (no revela existencia)', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const client2 = await authenticateAs(CLIENT2_PHONE, UserRole.CLIENT);
    const postRes = await client.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: QUERY.lat,
      originLng: QUERY.lng,
    });
    const id = postRes.body.id;

    const res = await client2.get(`/services/${id}`);
    expect(res.status).toBe(404);
  });

  it('servicio inexistente → 404', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const res = await client.get('/services/nonexistent-id');
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /services/:id/status (REQ-005) ────────────────────────────────────

describe('PATCH /services/:id/status (REQ-005) — FSM transitions', () => {
  it('dueño (CLIENT) PENDING → CANCELLED → 200', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const postRes = await client.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: QUERY.lat,
      originLng: QUERY.lng,
    });
    const id = postRes.body.id;

    const res = await client
      .patch(`/services/${id}/status`)
      .send({ status: ServiceStatus.CANCELLED });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(ServiceStatus.CANCELLED);

    // Persistido en DB.
    const svc = await prisma.service.findUnique({ where: { id } });
    expect(svc!.status).toBe(ServiceStatus.CANCELLED);
  });

  it('transición ilegal (PENDING → COMPLETED por CLIENT) → 409 INVALID_TRANSITION', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const postRes = await client.post('/services').send({
      type: ServiceType.BREAKDOWN,
      originLat: QUERY.lat,
      originLng: QUERY.lng,
    });
    const id = postRes.body.id;

    const res = await client
      .patch(`/services/${id}/status`)
      .send({ status: ServiceStatus.COMPLETED });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });
});

// ─── GET /services/nearby (REQ-003/010) — PostGIS ────────────────────────────

describe('GET /services/nearby (REQ-003/010) — PostGIS ST_DWithin', () => {
  it('devuelve solo PENDING dentro del radio', async () => {
    // A: PENDING en el punto de consulta (0km) → dentro.
    await seedService({
      status: ServiceStatus.PENDING,
      lat: QUERY.lat,
      lng: QUERY.lng,
      phoneNumber: '+573002000001',
    });
    // B: PENDING ~10km lejos → fuera del radio de 1km (y de 5km).
    await seedService({
      status: ServiceStatus.PENDING,
      lat: FAR_LAT,
      lng: QUERY.lng,
      phoneNumber: '+573002000002',
    });
    // C: COMPLETED en el punto (0km) → fuera por status.
    await seedService({
      status: ServiceStatus.COMPLETED,
      lat: QUERY.lat,
      lng: QUERY.lng,
      phoneNumber: '+573002000003',
    });

    const operator = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);
    const res = await operator
      .get('/services/nearby')
      .query({ lat: QUERY.lat, lng: QUERY.lng, radiusKm: 1 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe(ServiceStatus.PENDING);
    // Datos públicos: sin client/clientProfileId.
    expect(res.body[0].client).toBeUndefined();
    expect(res.body[0].clientProfileId).toBeUndefined();
  });

  it('radio amplio (15km) incluye el PENDING lejano', async () => {
    await seedService({
      status: ServiceStatus.PENDING,
      lat: FAR_LAT,
      lng: QUERY.lng,
      phoneNumber: '+573002000010',
    });
    const operator = await authenticateAs(OPERATOR_PHONE, UserRole.OPERATOR);
    const res = await operator
      .get('/services/nearby')
      .query({ lat: QUERY.lat, lng: QUERY.lng, radiusKm: 15 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('403 si el rol no es OPERATOR', async () => {
    const client = await authenticateAs(CLIENT_PHONE, UserRole.CLIENT);
    const res = await client
      .get('/services/nearby')
      .query({ lat: QUERY.lat, lng: QUERY.lng });
    expect(res.status).toBe(403);
  });
});

// ─── init_postgis idempotencia (REQ-010) ─────────────────────────────────────

describe('init_postgis migration (REQ-010) — idempotente', () => {
  it('la extensión postgis está instalada en pg_extension', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ extname: string }>
    >`SELECT extname FROM pg_extension WHERE extname = 'postgis'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].extname).toBe('postgis');
  });

  it('CREATE EXTENSION IF NOT EXISTS es idempotente (no lanza)', async () => {
    await expect(
      prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS postgis;'),
    ).resolves.toBeDefined();
  });
});
