import { describe, expect, it } from 'vitest';
import {
  isColombianMobile,
  sendOtpRequestSchema,
  verifyOtpRequestSchema,
} from '../src/schemas/auth.schema';

/** DCC-05: el OTP por SMS solo se envía a móviles colombianos. */
describe('auth.schema — teléfono', () => {
  it('acepta móviles colombianos +573XXXXXXXXX', () => {
    expect(isColombianMobile('+573001234567')).toBe(true);
    expect(
      sendOtpRequestSchema.safeParse({ phoneNumber: '+573151234567' }).success,
    ).toBe(true);
    expect(
      verifyOtpRequestSchema.safeParse({
        phoneNumber: '+573001234567',
        code: '123456',
      }).success,
    ).toBe(true);
  });

  it.each([
    '+14155550100',
    '+56912345678',
    '+576011234567',
    '3001234567',
    '+57300123456',
    '+5730012345678',
    ' +573001234567',
  ])('rechaza %s', (phoneNumber) => {
    expect(isColombianMobile(phoneNumber)).toBe(false);
    expect(sendOtpRequestSchema.safeParse({ phoneNumber }).success).toBe(false);
  });
});
