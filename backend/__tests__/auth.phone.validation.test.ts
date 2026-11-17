import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * DCC-05: solo móviles colombianos. Un número no +57 o un fijo colombiano se
 * rechaza con 400 antes de generar el código y sin llamar al proveedor.
 */

const { sendOtpMock } = vi.hoisted(() => ({ sendOtpMock: vi.fn() }));
vi.mock('../src/lib/plivo', () => ({ sendOtp: sendOtpMock }));
// Sin BD: si el código intentara contar envíos o crear la verificación,
// fallaría con 500 en vez de 400.
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/lib/queue', () => ({ enqueueServiceExpiry: vi.fn() }));

import { createApp } from '../src/app';

const app = createApp();

describe('send-otp — validación del número (DCC-05)', () => {
  it.each([
    ['EE. UU.', '+14155550100'],
    ['Chile', '+56912345678'],
    ['fijo colombiano (Bogotá)', '+576011234567'],
    ['móvil sin +57', '3001234567'],
    ['móvil incompleto', '+57300123456'],
    ['móvil con un dígito de más', '+5730012345678'],
  ])('%s → 400 sin llamar al proveedor', async (_label, phoneNumber) => {
    const res = await request(app)
      .post('/api/auth/phone-number/send-otp')
      .send({ phoneNumber });
    expect(res.status).toBe(400);
    expect(sendOtpMock).not.toHaveBeenCalled();
  });
});
