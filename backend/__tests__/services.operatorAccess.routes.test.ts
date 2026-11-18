import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import {
  isOpenForQuotes,
  roundCoord,
  toOperatorPreview,
} from '../src/services/serviceAccess';

/**
 * DCC-02 — rutas de servicios con Prisma simulado: acceso del rol OPERATOR
 * (operador asignado vs. no asignado), cambio de estado y aceptación de
 * cotización (fija `assignedOperatorProfileId`).
 */

const m = vi.hoisted(() => ({
  session: vi.fn(),
  serviceFindUnique: vi.fn(),
  serviceUpdate: vi.fn(),
  serviceCreate: vi.fn(),
  operatorFindUnique: vi.fn(),
  clientUpsert: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentCreate: vi.fn(),
  quoteFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../src/lib/auth', () => ({
  auth: { api: { getSession: m.session } },
  authHandler: vi.fn((_req, _res, next) => next()),
}));
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    service: {
      findUnique: m.serviceFindUnique,
      update: m.serviceUpdate,
      create: m.serviceCreate,
    },
    operatorProfile: { findUnique: m.operatorFindUnique },
    clientProfile: { upsert: m.clientUpsert },
    payment: { findUnique: m.paymentFindUnique, create: m.paymentCreate },
    quote: { findUnique: m.quoteFindUnique },
    $queryRaw: m.queryRaw,
    $transaction: m.transaction,
  },
}));
vi.mock('../src/lib/notifications', () => ({ notifyClient: vi.fn() }));

const FUTURE = new Date(Date.now() + 10 * 60_000);
const PAST = new Date(Date.now() - 60_000);

function svc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    clientProfileId: 'cp-1',
    client: { id: 'cp-1', userId: 'client-user' },
    type: 'BREAKDOWN',
    status: 'PENDING',
    description: 'Llanta pinchada',
    photoUrl: 'https://example.com/foto.jpg',
    originLat: 10.391049,
    originLng: -75.479426,
    originAddress: 'Calle 1',
    destLat: 10.423456,
    destLng: -75.548765,
    destAddress: 'Calle 2',
    acceptedQuoteId: null,
    assignedOperatorProfileId: null,
    expiresAt: FUTURE,
    createdAt: new Date('2026-11-16T10:00:00Z'),
    updatedAt: new Date('2026-11-16T10:00:00Z'),
    ...overrides,
  };
}

const as = (id: string, role: string) =>
  m.session.mockResolvedValue({ user: { id, role } });
const operatorProfile = (id: string | null) =>
  m.operatorFindUnique.mockResolvedValue(id ? { id } : null);

const PREVIEW_HIDDEN = [
  'photoUrl',
  'client',
  'clientProfileId',
  'originAddress',
  'destAddress',
  'acceptedQuoteId',
  'assignedOperatorProfileId',
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe('serviceAccess helpers', () => {
  it('roundCoord redondea a 3 decimales y respeta null', () => {
    expect(roundCoord(10.391049)).toBe(10.391);
    expect(roundCoord(-75.548765)).toBe(-75.549);
    expect(roundCoord(null)).toBeNull();
  });
  it('isOpenForQuotes: PENDING/QUOTED sin expirar', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const later = new Date('2026-11-16T12:05:00Z');
    expect(isOpenForQuotes({ status: 'PENDING', expiresAt: later }, now)).toBe(
      true,
    );
    expect(isOpenForQuotes({ status: 'QUOTED', expiresAt: later }, now)).toBe(
      true,
    );
    expect(isOpenForQuotes({ status: 'PENDING', expiresAt: now }, now)).toBe(
      false,
    );
    expect(isOpenForQuotes({ status: 'ACTIVE', expiresAt: later }, now)).toBe(
      false,
    );
  });
  it('toOperatorPreview solo expone la lista blanca', () => {
    const preview = toOperatorPreview(svc());
    expect(Object.keys(preview).sort()).toEqual(
      [
        'createdAt',
        'description',
        'destLat',
        'destLng',
        'expiresAt',
        'id',
        'originLat',
        'originLng',
        'status',
        'type',
        'updatedAt',
      ].sort(),
    );
    expect(
      toOperatorPreview(svc({ destLat: null, destLng: null })).destLat,
    ).toBeNull();
  });
});

describe('GET /services/:id — rol OPERATOR', () => {
  it('404 si no existe', async () => {
    as('op-a-user', 'OPERATOR');
    m.serviceFindUnique.mockResolvedValue(null);
    expect((await request(createApp()).get('/services/x')).status).toBe(404);
  });

  it('operador asignado ve detalle exacto sin datos del cliente', async () => {
    as('op-a-user', 'OPERATOR');
    operatorProfile('op-a');
    m.serviceFindUnique.mockResolvedValue(
      svc({ status: 'ACTIVE', assignedOperatorProfileId: 'op-a' }),
    );
    const res = await request(createApp()).get('/services/svc-1');
    expect(res.status).toBe(200);
    expect(res.body.originLat).toBe(10.391049);
    expect(res.body.photoUrl).toBe('https://example.com/foto.jpg');
    expect(res.body).not.toHaveProperty('client');
    expect(res.body).not.toHaveProperty('clientProfileId');
    expect(m.operatorFindUnique).toHaveBeenCalledWith({
      where: { userId: 'op-a-user' },
      select: { id: true },
    });
  });

  it('operador no asignado → 404 en ACTIVE asignado a otro', async () => {
    as('op-b-user', 'OPERATOR');
    operatorProfile('op-b');
    m.serviceFindUnique.mockResolvedValue(
      svc({ status: 'ACTIVE', assignedOperatorProfileId: 'op-a' }),
    );
    expect((await request(createApp()).get('/services/svc-1')).status).toBe(
      404,
    );
  });

  it.each(['PENDING', 'QUOTED'])(
    'operador no asignado ve vista previa en %s',
    async (status) => {
      as('op-b-user', 'OPERATOR');
      operatorProfile('op-b');
      m.serviceFindUnique.mockResolvedValue(svc({ status }));
      const res = await request(createApp()).get('/services/svc-1');
      expect(res.status).toBe(200);
      expect(res.body.originLat).toBe(10.391);
      expect(res.body.originLng).toBe(-75.479);
      expect(res.body.destLat).toBe(10.423);
      expect(res.body.destLng).toBe(-75.549);
      for (const field of PREVIEW_HIDDEN) {
        expect(res.body).not.toHaveProperty(field);
      }
    },
  );

  it('operador sin perfil ve vista previa en PENDING', async () => {
    as('op-x-user', 'OPERATOR');
    operatorProfile(null);
    m.serviceFindUnique.mockResolvedValue(svc());
    const res = await request(createApp()).get('/services/svc-1');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('photoUrl');
  });

  it('404 si el servicio expiró', async () => {
    as('op-b-user', 'OPERATOR');
    operatorProfile('op-b');
    m.serviceFindUnique.mockResolvedValue(svc({ expiresAt: PAST }));
    expect((await request(createApp()).get('/services/svc-1')).status).toBe(
      404,
    );
  });

  it('dueño ve todo; cliente ajeno 404', async () => {
    m.serviceFindUnique.mockResolvedValue(svc());
    as('client-user', 'CLIENT');
    const owner = await request(createApp()).get('/services/svc-1');
    expect(owner.status).toBe(200);
    expect(owner.body.photoUrl).toBe('https://example.com/foto.jpg');
    as('other-client', 'CLIENT');
    expect((await request(createApp()).get('/services/svc-1')).status).toBe(
      404,
    );
  });

  it('500 si falla la BD', async () => {
    as('op-a-user', 'OPERATOR');
    m.serviceFindUnique.mockRejectedValue(new Error('db down'));
    expect((await request(createApp()).get('/services/svc-1')).status).toBe(
      500,
    );
  });
});

describe('PATCH /services/:id/status — rol OPERATOR', () => {
  const patch = (status: string) =>
    request(createApp()).patch('/services/svc-1/status').send({ status });

  it('404 si el servicio no existe', async () => {
    as('op-a-user', 'OPERATOR');
    m.serviceFindUnique.mockResolvedValue(null);
    expect((await patch('COMPLETED')).status).toBe(404);
  });

  it('operador no asignado → 404 y no se actualiza', async () => {
    as('op-b-user', 'OPERATOR');
    operatorProfile('op-b');
    m.serviceFindUnique.mockResolvedValue(
      svc({
        status: 'ACTIVE',
        acceptedQuoteId: 'q-a',
        assignedOperatorProfileId: 'op-a',
      }),
    );
    const res = await patch('COMPLETED');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(m.serviceUpdate).not.toHaveBeenCalled();
  });

  it('operador sin perfil → 404', async () => {
    as('op-x-user', 'OPERATOR');
    operatorProfile(null);
    m.serviceFindUnique.mockResolvedValue(
      svc({ status: 'ACTIVE', assignedOperatorProfileId: 'op-a' }),
    );
    expect((await patch('COMPLETED')).status).toBe(404);
  });

  it('servicio sin asignar → 404', async () => {
    as('op-a-user', 'OPERATOR');
    operatorProfile('op-a');
    m.serviceFindUnique.mockResolvedValue(svc({ status: 'QUOTED' }));
    expect((await patch('COMPLETED')).status).toBe(404);
  });

  it('asignado: otra transición → 403', async () => {
    as('op-a-user', 'OPERATOR');
    operatorProfile('op-a');
    m.serviceFindUnique.mockResolvedValue(
      svc({ status: 'ACTIVE', assignedOperatorProfileId: 'op-a' }),
    );
    expect((await patch('CANCELLED')).status).toBe(403);
  });

  it('asignado con pago pendiente → 409', async () => {
    as('op-a-user', 'OPERATOR');
    operatorProfile('op-a');
    m.serviceFindUnique.mockResolvedValue(
      svc({ status: 'ACTIVE', assignedOperatorProfileId: 'op-a' }),
    );
    m.paymentFindUnique.mockResolvedValue({ status: 'PENDING' });
    expect((await patch('COMPLETED')).status).toBe(409);
    expect(m.serviceUpdate).not.toHaveBeenCalled();
  });

  it('asignado con pago confirmado completa → 200', async () => {
    as('op-a-user', 'OPERATOR');
    operatorProfile('op-a');
    m.serviceFindUnique.mockResolvedValue(
      svc({ status: 'ACTIVE', assignedOperatorProfileId: 'op-a' }),
    );
    m.paymentFindUnique.mockResolvedValue({ status: 'CONFIRMED' });
    m.serviceUpdate.mockResolvedValue({ id: 'svc-1', status: 'COMPLETED' });
    const res = await patch('COMPLETED');
    expect(res.status).toBe(200);
    expect(m.serviceUpdate).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: { status: 'COMPLETED' },
    });
  });

  it('cliente ajeno → 403; dueño cancela PENDING → 200; ADMIN → 403', async () => {
    m.serviceFindUnique.mockResolvedValue(svc());
    as('other-client', 'CLIENT');
    expect((await patch('CANCELLED')).status).toBe(403);
    as('client-user', 'CLIENT');
    m.serviceUpdate.mockResolvedValue({ id: 'svc-1', status: 'CANCELLED' });
    expect((await patch('CANCELLED')).status).toBe(200);
    as('admin', 'ADMIN');
    expect((await patch('CANCELLED')).status).toBe(403);
  });
});

describe('GET /services/nearby — vista previa', () => {
  it('devuelve coordenadas redondeadas sin foto', async () => {
    as('op-b-user', 'OPERATOR');
    m.queryRaw.mockResolvedValue([svc()]);
    const res = await request(createApp())
      .get('/services/nearby')
      .query({ lat: 10.39, lng: -75.48, radiusKm: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].originLat).toBe(10.391);
    for (const field of PREVIEW_HIDDEN) {
      expect(res.body[0]).not.toHaveProperty(field);
    }
  });

  it('500 si falla la consulta', async () => {
    as('op-b-user', 'OPERATOR');
    m.queryRaw.mockRejectedValue(new Error('db down'));
    const res = await request(createApp())
      .get('/services/nearby')
      .query({ lat: 10.39, lng: -75.48, radiusKm: 5 });
    expect(res.status).toBe(500);
  });
});

describe('POST /quotes/:id/accept — fija el operador asignado', () => {
  it('guarda assignedOperatorProfileId de la cotización en la transacción', async () => {
    as('client-user', 'CLIENT');
    m.quoteFindUnique.mockResolvedValue({
      id: 'q-a',
      operatorProfileId: 'op-a',
      amount: 50000,
      service: svc({ status: 'QUOTED' }),
    });
    m.serviceUpdate.mockResolvedValue(
      svc({
        status: 'ACTIVE',
        acceptedQuoteId: 'q-a',
        assignedOperatorProfileId: 'op-a',
      }),
    );
    m.transaction.mockImplementation(async (fn) =>
      fn({
        service: { update: m.serviceUpdate },
        payment: { create: m.paymentCreate },
      }),
    );
    const res = await request(createApp()).post('/quotes/q-a/accept').send({});
    expect(res.status).toBe(200);
    expect(m.serviceUpdate).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: {
        status: 'ACTIVE',
        acceptedQuoteId: 'q-a',
        assignedOperatorProfileId: 'op-a',
      },
    });
    expect(m.paymentCreate).toHaveBeenCalled();
  });
});
