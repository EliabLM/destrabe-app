import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from '../src/routes/health.routes';

const down = () =>
  Promise.reject(new Error('ECONNREFUSED postgres://secret@host'));

function app(checks: Parameters<typeof createHealthRouter>[0]) {
  const a = express();
  a.use(createHealthRouter(checks, 20));
  return a;
}

describe('GET /health/live and /health/ready (DCC-17)', () => {
  it('/health/live responds 200 with the DB down, without probing it', async () => {
    const db = vi.fn(down);
    const res = await request(app({ db })).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(db).not.toHaveBeenCalled();
  });

  it('/health/ready checks the DB like /health', async () => {
    const ok = () => Promise.resolve(1);
    expect((await request(app({ db: ok })).get('/health/ready')).status).toBe(
      200,
    );
    const res = await request(app({ db: down })).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});
