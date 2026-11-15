import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { prisma, resetDb } from './helpers';
import { createApp } from '../../src/app';

vi.mock('../../src/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(
        async ({ headers }: { headers: { authorization?: string } }) => {
          const id = headers.authorization?.replace('Bearer ', '');
          return id
            ? { user: { id, role: id === 'operator' ? 'OPERATOR' : 'CLIENT' } }
            : null;
        },
      ),
    },
  },
  authHandler: vi.fn((_req, _res, next) => next()),
}));
vi.mock('../../src/lib/queue', () => ({ enqueueServiceExpiry: vi.fn() }));

const app = createApp();
const get = (id: string, path = '/services') =>
  request(app).get(path).set('Authorization', `Bearer ${id}`);

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('GET /services / real Postgres', () => {
  it('isolates two clients, sorts timestamp ties by id and traverses every page exactly once', async () => {
    await prisma.user.createMany({
      data: [
        { id: 'owner-a', phoneNumber: '+573000000100' },
        { id: 'owner-b', phoneNumber: '+573000000101' },
      ],
    });
    const a = await prisma.clientProfile.create({
      data: { userId: 'owner-a' },
    });
    const b = await prisma.clientProfile.create({
      data: { userId: 'owner-b' },
    });
    const timestamp = new Date('2026-11-15T12:00:00.000Z');
    const expiresAt = new Date('2026-11-16T12:00:00.000Z');
    for (const id of ['svc-1', 'svc-3', 'svc-2', 'svc-4', 'svc-5']) {
      await prisma.service.create({
        data: {
          id,
          clientProfileId: a.id,
          type: 'BREAKDOWN',
          status: 'PENDING',
          originLat: 1,
          originLng: 2,
          createdAt: timestamp,
          expiresAt,
        },
      });
    }
    await prisma.service.create({
      data: {
        id: 'foreign',
        clientProfileId: b.id,
        type: 'TRANSFER',
        status: 'CANCELLED',
        originLat: 3,
        originLng: 4,
        createdAt: timestamp,
        expiresAt,
      },
    });
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(
        'owner-a',
        cursor
          ? `/services?limit=2&cursor=${encodeURIComponent(cursor)}`
          : '/services?limit=2',
      );
      expect(res.status).toBe(200);
      ids.push(...res.body.items.map((item: { id: string }) => item.id));
      expect(
        res.body.items.every((item: object) => !('clientProfileId' in item)),
      ).toBe(true);
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(ids).toEqual(['svc-5', 'svc-4', 'svc-3', 'svc-2', 'svc-1']);
    const other = await get('owner-b', '/services?userId=owner-a');
    expect(other.status).toBe(400);
    expect(
      (await get('owner-b')).body.items.map((item: { id: string }) => item.id),
    ).toEqual(['foreign']);
    expect((await get('owner-b', '/services/svc-1')).status).toBe(404);
  });

  it('returns 401/403 and an empty 200 without a ClientProfile', async () => {
    expect((await request(app).get('/services')).status).toBe(401);
    expect((await get('operator')).status).toBe(403);
    expect((await get('new-client')).body).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
