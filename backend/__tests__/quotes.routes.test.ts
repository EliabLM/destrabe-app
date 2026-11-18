import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../src/app';

/** Rutas de cotizaciones con Prisma simulado (cobertura HTTP). */

const m = vi.hoisted(() => ({
  session: vi.fn(),
  serviceFindUnique: vi.fn(),
  serviceUpdate: vi.fn(),
  operatorFindUnique: vi.fn(),
  quoteFindUnique: vi.fn(),
  quoteFindMany: vi.fn(),
  quoteCreate: vi.fn(),
  paymentCreate: vi.fn(),
  transaction: vi.fn(),
  notifyClient: vi.fn(),
}));

vi.mock('../src/lib/auth', () => ({
  auth: { api: { getSession: m.session } },
  authHandler: vi.fn((_req, _res, next) => next()),
}));
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    service: { findUnique: m.serviceFindUnique, update: m.serviceUpdate },
    operatorProfile: { findUnique: m.operatorFindUnique },
    quote: {
      findUnique: m.quoteFindUnique,
      findMany: m.quoteFindMany,
      create: m.quoteCreate,
    },
    payment: { create: m.paymentCreate },
    $transaction: m.transaction,
  },
}));
vi.mock('../src/lib/notifications', () => ({ notifyClient: m.notifyClient }));

const as = (id: string, role: string) =>
  m.session.mockResolvedValue({ user: { id, role } });

const service = (status = 'PENDING') => ({
  id: 'svc-1',
  status,
  client: { id: 'cp-1', userId: 'client-user' },
});

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation(async (fn) =>
    fn({
      quote: { create: m.quoteCreate },
      service: { update: m.serviceUpdate },
      payment: { create: m.paymentCreate },
    }),
  );
});

describe('POST /services/:id/quotes', () => {
  const post = () =>
    request(createApp())
      .post('/services/svc-1/quotes')
      .send({ amount: 50000, estimatedMinutes: 20 });

  it('404 si el servicio no existe', async () => {
    as('op-user', 'OPERATOR');
    m.serviceFindUnique.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
  });

  it('409 si el servicio no admite cotizaciones', async () => {
    as('op-user', 'OPERATOR');
    m.serviceFindUnique.mockResolvedValue(service('ACTIVE'));
    expect((await post()).status).toBe(409);
  });

  it('422 sin perfil de operador', async () => {
    as('op-user', 'OPERATOR');
    m.serviceFindUnique.mockResolvedValue(service());
    m.operatorFindUnique.mockResolvedValue(null);
    expect((await post()).status).toBe(422);
  });

  it('201 en PENDING: crea y pasa a QUOTED; en QUOTED no transiciona', async () => {
    as('op-user', 'OPERATOR');
    m.operatorFindUnique.mockResolvedValue({ id: 'op-a' });
    m.quoteCreate.mockResolvedValue({
      id: 'q-1',
      amount: 50000,
      estimatedMinutes: 20,
      note: null,
    });
    m.serviceFindUnique.mockResolvedValue(service('PENDING'));
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('q-1');
    expect(m.serviceUpdate).toHaveBeenCalledTimes(1);
    expect(m.notifyClient).toHaveBeenCalled();

    m.serviceFindUnique.mockResolvedValue(service('QUOTED'));
    expect((await post()).status).toBe(201);
    expect(m.serviceUpdate).toHaveBeenCalledTimes(1);
  });

  it('500 si falla la BD', async () => {
    as('op-user', 'OPERATOR');
    m.serviceFindUnique.mockRejectedValue(new Error('db down'));
    expect((await post()).status).toBe(500);
  });
});

describe('GET /services/:id/quotes', () => {
  const get = () => request(createApp()).get('/services/svc-1/quotes');

  it('404 si el servicio no existe', async () => {
    as('client-user', 'CLIENT');
    m.serviceFindUnique.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });

  it('dueño ve todas; operador solo las suyas; sin perfil, lista vacía', async () => {
    m.serviceFindUnique.mockResolvedValue(service('QUOTED'));
    m.quoteFindMany.mockResolvedValue([{ id: 'q-1' }]);

    as('client-user', 'CLIENT');
    expect((await get()).body).toEqual([{ id: 'q-1' }]);

    as('op-user', 'OPERATOR');
    m.operatorFindUnique.mockResolvedValue({ id: 'op-a' });
    expect((await get()).status).toBe(200);
    expect(m.quoteFindMany.mock.calls.at(-1)![0].where).toEqual({
      serviceId: 'svc-1',
      operatorProfileId: 'op-a',
    });

    m.operatorFindUnique.mockResolvedValue(null);
    expect((await get()).body).toEqual([]);
  });

  it('cliente ajeno → 404; error de BD → 500', async () => {
    as('other-client', 'CLIENT');
    m.serviceFindUnique.mockResolvedValue(service());
    expect((await get()).status).toBe(404);
    m.serviceFindUnique.mockRejectedValue(new Error('db down'));
    expect((await get()).status).toBe(500);
  });
});

describe('POST /quotes/:id/accept', () => {
  const accept = () => request(createApp()).post('/quotes/q-a/accept').send({});
  const quote = (status = 'QUOTED') => ({
    id: 'q-a',
    operatorProfileId: 'op-a',
    amount: 50000,
    service: service(status),
  });

  it('404 si la cotización no existe; 403 si no es el dueño', async () => {
    as('client-user', 'CLIENT');
    m.quoteFindUnique.mockResolvedValue(null);
    expect((await accept()).status).toBe(404);
    as('other-client', 'CLIENT');
    m.quoteFindUnique.mockResolvedValue(quote());
    expect((await accept()).status).toBe(403);
  });

  it('409 ALREADY_ACCEPTED si ya está ACTIVE o hay carrera (P2002)', async () => {
    as('client-user', 'CLIENT');
    m.quoteFindUnique.mockResolvedValue(quote('ACTIVE'));
    expect((await accept()).body.code).toBe('ALREADY_ACCEPTED');

    m.quoteFindUnique.mockResolvedValue(quote());
    m.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const race = await accept();
    expect(race.status).toBe(409);
    expect(race.body.code).toBe('ALREADY_ACCEPTED');
  });

  it('409 INVALID_TRANSITION desde PENDING; 500 ante otro error', async () => {
    as('client-user', 'CLIENT');
    m.quoteFindUnique.mockResolvedValue(quote('PENDING'));
    expect((await accept()).body.code).toBe('INVALID_TRANSITION');
    m.quoteFindUnique.mockResolvedValue(quote());
    m.transaction.mockRejectedValue(new Error('db down'));
    expect((await accept()).status).toBe(500);
  });
});
