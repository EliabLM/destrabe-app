import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { normalizeClientIp, parseTrustProxy } from '../src/middleware/clientIp';

/** DCC-05: IP real del cliente detrás de Traefik (`trust proxy`). */

function appWith(trust: string) {
  const app = express();
  app.set('trust proxy', parseTrustProxy(trust));
  app.get('/ip', normalizeClientIp, (req, res) => {
    res.json({ xff: req.headers['x-forwarded-for'] ?? null });
  });
  return app;
}

describe('parseTrustProxy', () => {
  it('interpreta false, saltos y listas', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toEqual([
      'loopback',
      '10.0.0.0/8',
    ]);
  });

  it('no admite true (permitiría falsear la IP)', () => {
    expect(() => parseTrustProxy('true')).toThrow('TRUST_PROXY');
  });
});

describe('normalizeClientIp', () => {
  it('desde un proxy de confianza usa la IP que añadió el proxy (la de la derecha)', async () => {
    const res = await request(appWith('loopback'))
      .get('/ip')
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.7');
    expect(res.body.xff).toBe('203.0.113.7');
  });

  it('sin proxy de confianza ignora X-Forwarded-For y usa la IP del socket', async () => {
    const res = await request(appWith('false'))
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.7');
    expect(res.body.xff).toMatch(/127\.0\.0\.1|::1/);
  });

  it('una X-Forwarded-For falsa desde un par que no es proxy de confianza se ignora', async () => {
    // Solo la red de Traefik es de confianza; la conexión llega por loopback.
    const res = await request(appWith('10.0.1.0/24'))
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.99');
    expect(res.body.xff).not.toBe('203.0.113.99');
    expect(res.body.xff).toMatch(/127\.0\.0\.1|::1/);
  });
});
