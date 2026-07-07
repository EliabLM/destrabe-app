import type { Request, Response, NextFunction } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { UserRole } from '@destrabe/shared';
import { createApp } from '../src/app';

/**
 * T4 — Operator routes tests (cambio-008 / D1-D2 / REQ-OP-001/002)
 *
 * Unit tests via supertest. Mockea `auth.api.getSession` para controlar
 * autenticación sin tocar DB, y `prisma.operatorProfile` para controlar
 * persistencia.
 *
 * Cobertura:
 *  - POST /api/operator/profile: 201 happy, 409 si existe, 401 sin Bearer, 403 si no OPERATOR
 *  - PATCH /api/operator/location: 200 happy, actualiza lastSeenAt, 401 sin Bearer, 403 si no OPERATOR, 404 si no existe perfil
 */

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
  authHandler: vi.fn(
    (_req: Request, _res: Response, next: NextFunction) => next(),
  ),
}));

const prismaFindUniqueMock = vi.hoisted(() => vi.fn());
const prismaCreateMock = vi.hoisted(() => vi.fn());
const prismaUpdateMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    operatorProfile: {
      findUnique: prismaFindUniqueMock,
      create: prismaCreateMock,
      update: prismaUpdateMock,
    },
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockSession(overrides: Partial<{ id: string; phone: string; role: string }> = {}) {
  const defaults = { id: 'user-op-1', phoneNumber: '+573001234567', role: UserRole.OPERATOR };
  const s = { ...defaults, ...overrides };
  getSessionMock.mockResolvedValue({ user: s });
}

function noSession() {
  getSessionMock.mockResolvedValue(null);
}

const VALID_PROFILE_BODY = {
  truckType: 'grua',
  licensePlate: 'ABC123',
};

const VALID_LOCATION_BODY = {
  lastLatitude: 4.6,
  lastLongitude: -74.0,
};

describe('POST /api/operator/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds 201 with created profile (happy path)', async () => {
    mockSession();
    prismaFindUniqueMock.mockResolvedValue(null); // no existing profile
    prismaCreateMock.mockResolvedValue({
      id: 'op-1',
      userId: 'user-op-1',
      truckType: 'grua',
      licensePlate: 'ABC123',
      photoUrl: null,
      available: false,
      rating: 0,
      ratingCount: 0,
      lastLatitude: null,
      lastLongitude: null,
      lastSeenAt: null,
      mpAccountId: null,
    });

    const res = await request(createApp())
      .post('/api/operator/profile')
      .send(VALID_PROFILE_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 'op-1',
      truckType: 'grua',
      licensePlate: 'ABC123',
      available: false,
    });
    expect(prismaCreateMock).toHaveBeenCalledWith({
      data: {
        userId: 'user-op-1',
        truckType: 'grua',
        licensePlate: 'ABC123',
        photoUrl: null,
        available: false,
        lastLatitude: null,
        lastLongitude: null,
      },
    });
  });

  it('responds 409 when profile already exists', async () => {
    mockSession();
    prismaFindUniqueMock.mockResolvedValue({ id: 'op-existing', userId: 'user-op-1' });

    const res = await request(createApp())
      .post('/api/operator/profile')
      .send(VALID_PROFILE_BODY);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'Profile already exists',
      code: 'PROFILE_EXISTS',
    });
    expect(prismaCreateMock).not.toHaveBeenCalled();
  });

  it('responds 401 without Bearer token', async () => {
    noSession();

    const res = await request(createApp())
      .post('/api/operator/profile')
      .send(VALID_PROFILE_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('responds 403 with CLIENT role', async () => {
    mockSession({ role: UserRole.CLIENT });

    const res = await request(createApp())
      .post('/api/operator/profile')
      .send(VALID_PROFILE_BODY);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('PATCH /api/operator/location', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds 200 with updated location (happy path)', async () => {
    mockSession();
    prismaFindUniqueMock.mockResolvedValue({ id: 'op-1', userId: 'user-op-1' });
    prismaUpdateMock.mockResolvedValue({
      id: 'op-1',
      userId: 'user-op-1',
      lastLatitude: 4.6,
      lastLongitude: -74.0,
      available: false,
      lastSeenAt: new Date().toISOString(),
    });

    const res = await request(createApp())
      .patch('/api/operator/location')
      .send(VALID_LOCATION_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      lastLatitude: 4.6,
      lastLongitude: -74.0,
    });
  });

  it('updates lastSeenAt on location update', async () => {
    mockSession();
    prismaFindUniqueMock.mockResolvedValue({ id: 'op-1', userId: 'user-op-1' });
    prismaUpdateMock.mockResolvedValue({
      id: 'op-1',
      userId: 'user-op-1',
      lastLatitude: 4.6,
      lastLongitude: -74.0,
      available: false,
      lastSeenAt: new Date().toISOString(),
    });

    await request(createApp())
      .patch('/api/operator/location')
      .send(VALID_LOCATION_BODY);

    expect(prismaUpdateMock).toHaveBeenCalled();
    const updateArgs = prismaUpdateMock.mock.calls[0][0];
    expect(updateArgs.data.lastSeenAt).toBeDefined();
    expect(updateArgs.data.lastSeenAt).toBeInstanceOf(Date);
  });

  it('responds 401 without Bearer token', async () => {
    noSession();

    const res = await request(createApp())
      .patch('/api/operator/location')
      .send(VALID_LOCATION_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('responds 403 with CLIENT role', async () => {
    mockSession({ role: UserRole.CLIENT });

    const res = await request(createApp())
      .patch('/api/operator/location')
      .send(VALID_LOCATION_BODY);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('responds 404 when operator profile does not exist', async () => {
    mockSession();
    prismaFindUniqueMock.mockResolvedValue(null); // no profile

    const res = await request(createApp())
      .patch('/api/operator/location')
      .send(VALID_LOCATION_BODY);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
