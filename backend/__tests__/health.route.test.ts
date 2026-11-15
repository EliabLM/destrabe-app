import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from '../src/routes/health.routes';

function appWithChecks(
  db: () => Promise<unknown>,
  redis: () => Promise<unknown>,
) {
  const app = express();
  app.use(createHealthRouter({ db, redis }, 20));
  return app;
}

describe('GET /health readiness', () => {
  it('returns 200 only when DB and Redis respond', async () => {
    const db = vi.fn().mockResolvedValue(1);
    const redis = vi.fn().mockResolvedValue('PONG');
    const res = await request(appWithChecks(db, redis)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(db).toHaveBeenCalledOnce();
    expect(redis).toHaveBeenCalledOnce();
  });

  it.each(['db', 'redis'])(
    'returns 503 without leaking errors when %s fails',
    async (failed) => {
      const error = new Error('postgresql://user:secret@host/db');
      const db = () =>
        failed === 'db' ? Promise.reject(error) : Promise.resolve(1);
      const redis = () =>
        failed === 'redis' ? Promise.reject(error) : Promise.resolve('PONG');
      const res = await request(appWithChecks(db, redis)).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'unavailable' });
      expect(res.text).not.toContain('secret');
    },
  );

  it('returns 503 within the configured deadline when a dependency hangs', async () => {
    const res = await request(
      appWithChecks(
        () => new Promise(() => {}),
        () => Promise.resolve('PONG'),
      ),
    ).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});
