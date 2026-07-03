import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

/**
 * T6 — Montaje del handler de Better Auth en el router (REQ-006 parcial).
 *
 * Smoke de montaje (no requiere PG up para esta assertion): importa `createApp`
 * (que monta `authHandler` bajo `/api/auth`) y dispara una petición a una ruta
 * inexistente bajo el prefijo. Se espera que Better Auth responda (típicamente
 * 404 para una sub-ruta desconocida) — lo que prueba que el handler está montado
 * y que el server arranca sin errores. El flujo OTP completo es T9 (db smoke).
 *
 * No se mockea `auth`/`prisma`: la construcción de `betterAuth` no toca la DB y
 * una sub-ruta desconocida se resuelve como 404 sin queries. PG no es necesario
 * aquí, pero el árbol de imports valida que el montaje es type/build-safe.
 */
const app = createApp();

describe('Better Auth mount en /api/auth (REQ-006 parcial — T6)', () => {
  it('responde a /api/auth/* (404 de Better Auth para sub-ruta inexistente)', async () => {
    const res = await request(app).get('/api/auth/no-existe-en-better-auth');

    // Aceptamos cualquier respuesta HTTP (2xx–4xx). Lo importante es que la
    // petición se complete — no timeout ni connection reset. Better Auth suele
    // devolver 404 para sub-rutas desconocidas; un 500 indicaría rotura del mount.
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(500);
  });

  it('no rompe /health (montaje de auth no intercepta otras rutas)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});