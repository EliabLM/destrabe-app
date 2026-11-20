import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { captureLogs } from './helpers/logCapture';

describe('HTTP hardening (DCC-17)', () => {
  const app = createApp();

  it('does not expose X-Powered-By and sends helmet headers', async () => {
    const res = await request(app).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
  });

  it('returns an X-Request-Id, reusing a safe incoming one', async () => {
    const generated = await request(app).get('/no-existe');
    expect(generated.headers['x-request-id']).toMatch(/^[\w-]{36}$/);

    const reused = await request(app)
      .get('/no-existe')
      .set('X-Request-Id', 'traefik-abc.123');
    expect(reused.headers['x-request-id']).toBe('traefik-abc.123');

    const replaced = await request(app)
      .get('/no-existe')
      .set('X-Request-Id', 'bad id\twith spaces');
    expect(replaced.headers['x-request-id']).not.toContain('bad');
  });

  it('logs one JSON line per request with the requestId, skipping health probes', async () => {
    const logs = captureLogs();
    const logged = createApp({ logger: logs.logger });
    await request(logged).get('/health/live');
    const res = await request(logged).get('/no-existe?phone=3001234567');

    const entries = logs.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 40,
      req: {
        id: res.headers['x-request-id'],
        method: 'GET',
        url: '/no-existe',
      },
      res: { statusCode: 404 },
    });
  });
});
