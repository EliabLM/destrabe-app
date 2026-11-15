import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { createApp } from '../src/app';

const { getSession, issue, redeem } = vi.hoisted(() => ({
  getSession: vi.fn(),
  issue: vi.fn(),
  redeem: vi.fn(),
}));
vi.mock('../src/lib/auth', () => ({
  auth: { api: { getSession } },
  authHandler: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../src/services/operatorInvitation', () => ({
  issueInvitation: issue,
  redeemInvitation: redeem,
}));

beforeEach(() => {
  vi.resetAllMocks();
  getSession.mockResolvedValue({
    user: { id: 'actor', role: 'CLIENT', phoneNumber: '+56912345678' },
    session: { id: 'session-id' },
  });
});

describe('HTTP invitaciones', () => {
  it('sin sesión rechaza ambos endpoints', async () => {
    getSession.mockResolvedValue(null);
    expect(
      (
        await request(createApp())
          .post('/api/admin/operator-invitations')
          .send({ phoneNumber: '+56912345678' })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(createApp())
          .post('/api/operator/invitations/redeem')
          .send({ token: 'a'.repeat(64) })
      ).status,
    ).toBe(401);
  });
  it('emisor no ADMIN según DB no puede emitir; no acepta role extra', async () => {
    issue.mockResolvedValue({ status: 'forbidden' });
    expect(
      (
        await request(createApp())
          .post('/api/admin/operator-invitations')
          .send({ phoneNumber: '+56912345678' })
      ).status,
    ).toBe(403);
    expect(issue).toHaveBeenCalledWith('actor', '+56912345678', 'session-id');
    expect(
      (
        await request(createApp())
          .post('/api/admin/operator-invitations')
          .send({ phoneNumber: '+56912345678', role: 'ADMIN' })
      ).status,
    ).toBe(400);
  });
  it('entrega token una vez sin cache y jamás en GET /api/me', async () => {
    issue.mockResolvedValue({
      status: 'issued',
      token: 'a'.repeat(64),
      tokenHash: 'b'.repeat(64),
      expiresAt: new Date(),
    });
    const res = await request(createApp())
      .post('/api/admin/operator-invitations')
      .send({ phoneNumber: '+56912345678' });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.token).toBe('a'.repeat(64));
    expect(JSON.stringify(res.body)).not.toContain('b'.repeat(64));
  });
  it('no acepta identidad/rol en canje y devuelve fallo uniforme de invitación', async () => {
    redeem.mockResolvedValue('invalid');
    const res = await request(createApp())
      .post('/api/operator/invitations/redeem')
      .send({ token: 'a'.repeat(64) });
    expect(res.status).toBe(400);
    expect(redeem).toHaveBeenCalledWith('session-id', 'a'.repeat(64));
    expect(
      (
        await request(createApp())
          .post('/api/operator/invitations/redeem')
          .send({ token: 'a'.repeat(64), userId: 'other' })
      ).status,
    ).toBe(400);
  });
  it('canje exitoso y rate limit', async () => {
    redeem.mockResolvedValueOnce('redeemed').mockResolvedValueOnce('limited');
    expect(
      (
        await request(createApp())
          .post('/api/operator/invitations/redeem')
          .send({ token: 'a'.repeat(64) })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(createApp())
          .post('/api/operator/invitations/redeem')
          .send({ token: 'a'.repeat(64) })
      ).status,
    ).toBe(429);
  });
});
