import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@destrabe/shared';
import { createApp } from '../src/app';
import { requireAuth } from '../src/middleware/auth';
import { requireFeature } from '../src/middleware/requireFeature';
import { configFlagStore, setFeatureFlagStore } from '../src/lib/featureFlags';
import { parseFeatureFlagsConfig } from '../src/lib/featureFlagsConfig';

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
  authHandler: vi.fn((_req: Request, _res: Response, next: NextFunction) =>
    next(),
  ),
}));
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

function sessionAs(id: string, phoneNumber: string) {
  getSessionMock.mockResolvedValue({
    user: { id, phoneNumber, role: UserRole.CLIENT },
  });
}

function useConfig(raw: string) {
  setFeatureFlagStore(configFlagStore(parseFeatureFlagsConfig(raw)));
}

beforeEach(() => {
  getSessionMock.mockReset();
  useConfig('{"pagoSimulado":{"mode":"allowlist","users":["+573001234567"]}}');
});
afterEach(() => setFeatureFlagStore(configFlagStore({})));

describe('requireFeature', () => {
  function appWithFlaggedRoute() {
    const app = express();
    app.get('/beta', requireAuth, requireFeature('pagoSimulado'), (_req, res) =>
      res.json({ ok: true }),
    );
    return app;
  }

  it('200 para un usuario dentro de la allowlist', async () => {
    sessionAs('user-eliab', '+573001234567');
    const res = await request(appWithFlaggedRoute()).get('/beta');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('404 para un usuario fuera de la allowlist', async () => {
    sessionAs('user-otro', '+573009999999');
    const res = await request(appWithFlaggedRoute()).get('/beta');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found', code: 'NOT_FOUND' });
  });

  it('404 para un flag sin configurar aunque haya sesión', async () => {
    sessionAs('user-eliab', '+573001234567');
    const app = express();
    app.get('/gps', requireAuth, requireFeature('ubicacionGps'), (_req, res) =>
      res.json({ ok: true }),
    );
    expect((await request(app).get('/gps')).status).toBe(404);
  });

  it('pasa los errores del store al manejador de errores', async () => {
    sessionAs('user-eliab', '+573001234567');
    setFeatureFlagStore({
      getRule: async () => {
        throw new Error('store caído');
      },
    });
    const app = appWithFlaggedRoute();
    app.use(
      (_err: Error, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ code: 'INTERNAL' });
      },
    );
    expect((await request(app).get('/beta')).status).toBe(500);
  });
});

describe('GET /api/me/features', () => {
  it('lista los flags activos de la sesión', async () => {
    sessionAs('user-eliab', '+573001234567');
    const res = await request(createApp()).get('/api/me/features');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ features: ['pagoSimulado'] });
  });

  it('lista vacía para un usuario fuera de la allowlist', async () => {
    sessionAs('user-otro', '+573009999999');
    const res = await request(createApp()).get('/api/me/features');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ features: [] });
  });

  it('401 sin sesión', async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await request(createApp()).get('/api/me/features')).status).toBe(
      401,
    );
  });
});
