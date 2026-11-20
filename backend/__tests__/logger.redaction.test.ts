import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequestLogger } from '../src/middleware/requestLogger';
import { errorHandler } from '../src/middleware/errorHandler';
import { maskPhonesInText } from '../src/lib/logger';
import { captureLogs } from './helpers/logCapture';

const PHONE = '+573001234567';
const OTP = '482913';
const TOKEN = 'bearer-secret-token-abc';
const COOKIE = 'better-auth.session_token=cookie-secret-xyz';

describe('log redaction (DCC-17)', () => {
  it('never writes the full phone, the OTP, tokens or cookies', async () => {
    const logs = captureLogs();
    const app = express();
    app.use(createRequestLogger(logs.logger));
    app.use(express.json());
    app.post('/api/auth/phone-number/verify', (req, res) => {
      // Un log descuidado con datos sensibles en campos conocidos.
      req.log.info(
        {
          phoneNumber: req.body.phoneNumber,
          otp: req.body.code,
          headers: req.headers,
          user: { phone: req.body.phoneNumber, token: TOKEN },
        },
        'verifying',
      );
      res.json({ ok: true });
    });
    app.get('/fail', () => {
      // Prisma repite los argumentos en sus errores de validación.
      throw new Error(`Argument phoneNumber: got "${PHONE}"`);
    });
    app.use(errorHandler);

    await request(app)
      .post(
        `/api/auth/phone-number/verify?phoneNumber=${encodeURIComponent(PHONE)}&code=${OTP}`,
      )
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Cookie', COOKIE)
      .send({ phoneNumber: PHONE, code: OTP });
    await request(app).get('/fail');

    const text = logs.text();
    expect(logs.entries().length).toBeGreaterThanOrEqual(3);
    expect(text).toContain('[REDACTED]');
    expect(text).toContain('+57******4567');
    for (const secret of [
      PHONE,
      '3001234567',
      OTP,
      TOKEN,
      'cookie-secret-xyz',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('masks phone-like numbers inside free text', () => {
    expect(maskPhonesInText(`call ${PHONE} or 3001234567`)).toBe(
      'call +57******4567 or 300***4567',
    );
  });
});
