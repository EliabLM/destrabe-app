import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from '../src/routes/health.routes';

function appWithDb(db: () => Promise<unknown>) {
  const app = express();
  app.use(createHealthRouter({ db }, 20));
  return app;
}

describe('GET /health readiness', () => {
  it('returns 200 when the DB responds (no Redis since DCC-19)', async () => {
    const db = vi.fn().mockResolvedValue(1);
    const res = await request(appWithDb(db)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(db).toHaveBeenCalledOnce();
  });

  it('returns 503 without leaking errors when the DB fails', async () => {
    const error = new Error('postgresql://user:secret@host/db');
    const res = await request(appWithDb(() => Promise.reject(error))).get(
      '/health',
    );
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
    expect(res.text).not.toContain('secret');
  });

  it('returns 503 within the configured deadline when the DB hangs', async () => {
    const res = await request(appWithDb(() => new Promise(() => {}))).get(
      '/health',
    );
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});
