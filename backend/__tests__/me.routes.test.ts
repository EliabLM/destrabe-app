import type { Request, Response, NextFunction } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { UserRole } from '@destrabe/shared';
import { createApp } from '../src/app';

/**
 * T5 — /me route tests (cambio-008 / D3 / REQ-AUTH-011)
 *
 * Unit tests via supertest. Mockea `auth.api.getSession` para controlar
 * autenticación, y `prisma.user.findUnique` para controlar la DB.
 *
 * Cobertura:
 *  - GET /api/me: 200 con cliente+operador, 200 con solo cliente,
 *    200 con solo operador, 200 sin perfiles, 401 sin Bearer
 */

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
  authHandler: vi.fn((_req: Request, _res: Response, next: NextFunction) =>
    next(),
  ),
}));

const userFindUniqueMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockSession(
  overrides: Partial<{ id: string; phone: string; role: string }> = {},
) {
  const defaults = {
    id: 'user-1',
    phoneNumber: '+573001234567',
    role: UserRole.CLIENT,
  };
  const s = { ...defaults, ...overrides };
  getSessionMock.mockResolvedValue({ user: s });
}

function noSession() {
  getSessionMock.mockResolvedValue(null);
}

const BASE_USER = {
  id: 'user-1',
  phoneNumber: '+573001234567',
  email: null,
  name: null,
  role: UserRole.CLIENT,
  image: null,
  phoneNumberVerified: true,
  emailVerified: false,
  createdAt: new Date('2025-01-01').toISOString(),
  updatedAt: new Date('2025-01-01').toISOString(),
};

describe('GET /api/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds 200 with user + clientProfile', async () => {
    mockSession({ role: UserRole.CLIENT });
    userFindUniqueMock.mockResolvedValue({
      ...BASE_USER,
      role: UserRole.CLIENT,
      clientProfile: { id: 'cp-1', userId: 'user-1' },
      operatorProfile: null,
    });

    const res = await request(createApp()).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: {
        id: 'user-1',
        phoneNumber: '+573001234567',
        role: UserRole.CLIENT,
      },
      clientProfile: { id: 'cp-1', userId: 'user-1' },
    });
    expect(res.body.operatorProfile).toBeUndefined();
  });

  it('responds 200 with user + operatorProfile', async () => {
    mockSession({ role: UserRole.OPERATOR });
    userFindUniqueMock.mockResolvedValue({
      ...BASE_USER,
      role: UserRole.OPERATOR,
      clientProfile: null,
      operatorProfile: {
        id: 'op-1',
        userId: 'user-1',
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
      },
    });

    const res = await request(createApp()).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: {
        id: 'user-1',
        phoneNumber: '+573001234567',
        role: UserRole.OPERATOR,
      },
      operatorProfile: { id: 'op-1', truckType: 'grua' },
    });
    expect(res.body.clientProfile).toBeUndefined();
  });

  it('responds 200 with user + both profiles (rare but valid)', async () => {
    mockSession({ role: UserRole.CLIENT });
    userFindUniqueMock.mockResolvedValue({
      ...BASE_USER,
      role: UserRole.CLIENT,
      clientProfile: { id: 'cp-1', userId: 'user-1' },
      operatorProfile: {
        id: 'op-1',
        userId: 'user-1',
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
      },
    });

    const res = await request(createApp()).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { id: 'user-1', role: UserRole.CLIENT },
      clientProfile: { id: 'cp-1' },
      operatorProfile: { id: 'op-1' },
    });
  });

  it('responds 200 with user only (no profiles)', async () => {
    mockSession({ role: UserRole.CLIENT });
    userFindUniqueMock.mockResolvedValue({
      ...BASE_USER,
      role: UserRole.CLIENT,
      clientProfile: null,
      operatorProfile: null,
    });

    const res = await request(createApp()).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe('user-1');
    expect(res.body.clientProfile).toBeUndefined();
    expect(res.body.operatorProfile).toBeUndefined();
  });

  it('responds 401 without Bearer token', async () => {
    noSession();

    const res = await request(createApp()).get('/api/me');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
