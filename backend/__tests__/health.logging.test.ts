import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from '../src/routes/health.routes';
import { createRequestLogger } from '../src/middleware/requestLogger';
import { captureLogs } from './helpers/logCapture';

const ok = () => Promise.resolve(1);
const down = () => Promise.reject(new Error('ECONNREFUSED'));

function app(checks: Parameters<typeof createHealthRouter>[0]) {
  const logs = captureLogs();
  const a = express();
  a.use(createRequestLogger(logs.logger));
  a.use(createHealthRouter(checks, 20));
  return { app: a, logs };
}

const requestLines = (logs: ReturnType<typeof captureLogs>) =>
  logs.entries().filter((entry) => entry.req !== undefined);

describe('health probe logging (DCC-17)', () => {
  it('does not log probes that respond 200', async () => {
    const { app: a, logs } = app({ db: ok, redis: ok });
    expect((await request(a).get('/health/live')).status).toBe(200);
    expect((await request(a).get('/health/ready')).status).toBe(200);
    expect(requestLines(logs)).toHaveLength(0);
  });

  it('logs /health/ready when it responds 503 with the DB down', async () => {
    const { app: a, logs } = app({ db: down, redis: ok });
    const res = await request(a).get('/health/ready');
    expect(res.status).toBe(503);
    const lines = requestLines(logs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 50,
      req: { url: '/health/ready' },
      res: { statusCode: 503 },
    });
  });
});
