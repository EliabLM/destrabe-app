import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const session = vi.hoisted(() => vi.fn());
const profile = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/auth', () => ({
  auth: { api: { getSession: session } },
  authHandler: vi.fn((_req, _res, next) => next()),
}));
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: profile },
    service: { findMany },
  },
}));

const row = (id: string, createdAt = '2026-11-15T12:00:00.000Z') => ({
  id,
  type: 'BREAKDOWN',
  status: 'PENDING',
  originLat: 1,
  originLng: 2,
  destLat: null,
  destLng: null,
  description: null,
  photoUrl: null,
  expiresAt: new Date('2026-11-16'),
  createdAt: new Date(createdAt),
});
const client = (id: string, role = 'CLIENT') =>
  session.mockResolvedValue({ user: { id, role } });

describe('GET /services HTTP', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    profile.mockResolvedValue({ id: 'cp-1' });
    findMany.mockResolvedValue([]);
  });
  it('returns 401 without session and 403 for operator', async () => {
    session.mockResolvedValue(null);
    expect((await request(createApp()).get('/services')).status).toBe(401);
    client('operator', 'OPERATOR');
    expect((await request(createApp()).get('/services')).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('returns an empty page without creating a profile', async () => {
    client('new-client');
    profile.mockResolvedValue(null);
    const res = await request(createApp()).get('/services');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
    expect(profile).toHaveBeenCalledWith({
      where: { userId: 'new-client' },
      select: { id: true },
    });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('selects only owned fields and uses limit+1; cursor resumes with lexicographic tie-breaker', async () => {
    client('owner');
    findMany
      .mockResolvedValueOnce([row('b'), row('a')])
      .mockResolvedValueOnce([row('older', '2026-11-14T12:00:00.000Z')]);
    const first = await request(createApp()).get('/services?limit=1');
    expect(first.status).toBe(200);
    expect(first.body.items.map((x: { id: string }) => x.id)).toEqual(['b']);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(first.body.items[0]).not.toHaveProperty('clientProfileId');
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { clientProfileId: 'cp-1' },
      take: 2,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const second = await request(createApp())
      .get('/services')
      .query({ cursor: first.body.nextCursor, limit: '1' });
    expect(second.body.items.map((x: { id: string }) => x.id)).toEqual([
      'older',
    ]);
    expect(second.body.nextCursor).toBeNull();
    expect(findMany.mock.calls[1][0].where).toMatchObject({
      clientProfileId: 'cp-1',
      OR: [
        { createdAt: { lt: new Date('2026-11-15T12:00:00.000Z') } },
        { createdAt: new Date('2026-11-15T12:00:00.000Z'), id: { lt: 'b' } },
      ],
    });
  });
  it('rejects invalid limits, cursors and identity selectors', async () => {
    client('owner');
    for (const query of [
      'limit=0',
      'limit=101',
      'limit=1.5',
      'limit=1e2',
      'cursor=YWJj',
      'userId=other',
      'clientProfileId=other',
    ]) {
      const res = await request(createApp()).get(`/services?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect(findMany).not.toHaveBeenCalled();
  });
  it('cannot switch owners with another client’s valid cursor', async () => {
    client('owner-one');
    findMany.mockResolvedValueOnce([row('b'), row('a')]);
    const first = await request(createApp()).get('/services?limit=1');
    client('owner-two');
    profile.mockResolvedValue({ id: 'cp-2' });
    findMany.mockResolvedValueOnce([]);
    const second = await request(createApp())
      .get('/services')
      .query({ cursor: first.body.nextCursor });
    expect(second.status).toBe(200);
    expect(second.body.items).toEqual([]);
    expect(findMany.mock.calls[1][0].where.clientProfileId).toBe('cp-2');
  });
});
