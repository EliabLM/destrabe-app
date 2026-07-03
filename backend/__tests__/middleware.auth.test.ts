import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserRole } from '@destrabe/shared';

/**
 * T7 — Middleware requireAuth + requireRole (REQ-008, REQ-009)
 * Unit, no Docker: se mockea `auth.api.getSession` para controlar la sesión
 * sin tocar una DB/cookie real. Express-style (req, res, next) con mocks.
 *
 * better-auth expone `auth.api.getSession({ headers })` que devuelve la
 * sesión (con `session.user`) o `null` cuando no hay cookie válida.
 */
const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}));

import { requireAuth, requireRole } from '../src/middleware/auth';
import type { AuthedRequest } from '../src/middleware/auth';

/**
 * Factorías de mocks Express-style. `res` encadena `status().json()` como
 * hace el middleware real (req/res/next no necesitan un servidor).
 */
function makeReq(headers: Record<string, string> = {}): AuthedRequest {
  return { headers } as unknown as AuthedRequest;
}

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function makeNext() {
  return vi.fn();
}

describe('requireAuth middleware (REQ-008)', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('responds 401 { error, code: "UNAUTHORIZED" } when there is no session', async () => {
    getSessionMock.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await requireAuth(req as never, res as never, next);

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(getSessionMock).toHaveBeenCalledWith({ headers: req.headers });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
    expect(next).not.toHaveBeenCalled();
    expect((req as AuthedRequest).user).toBeUndefined();
  });

  it('sets req.user and calls next() when a valid session exists', async () => {
    // better-auth phoneNumber plugin expone el teléfono como `phoneNumber`
    // (la spec/§6 usa `phone` como columna Prisma; discrepancia documentada).
    const session = {
      user: {
        id: 'user-1',
        phoneNumber: '+573001234567',
        role: 'CLIENT',
      },
    };
    getSessionMock.mockResolvedValue(session);

    const req = makeReq({ cookie: 'better-auth.session_token=abc' });
    const res = makeRes();
    const next = makeNext();

    await requireAuth(req as never, res as never, next);

    expect(getSessionMock).toHaveBeenCalledWith({ headers: req.headers });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as AuthedRequest).user).toEqual({
      id: 'user-1',
      phone: '+573001234567',
      role: UserRole.CLIENT,
    });
  });
});

describe('requireRole middleware (REQ-009)', () => {
  it('responds 403 { error, code: "FORBIDDEN" } when user role does not match', () => {
    const req = makeReq();
    (req as AuthedRequest).user = {
      id: 'user-1',
      phone: '+573001234567',
      role: UserRole.CLIENT,
    };
    const res = makeRes();
    const next = makeNext();

    const middleware = requireRole(UserRole.OPERATOR);
    middleware(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      code: 'FORBIDDEN',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when user role matches', () => {
    const req = makeReq();
    (req as AuthedRequest).user = {
      id: 'user-2',
      phone: '+573001234567',
      role: UserRole.OPERATOR,
    };
    const res = makeRes();
    const next = makeNext();

    const middleware = requireRole(UserRole.OPERATOR);
    middleware(req as never, res as never, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
