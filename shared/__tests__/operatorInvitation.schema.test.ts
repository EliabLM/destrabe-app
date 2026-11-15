import { describe, expect, it } from 'vitest';
import {
  issueOperatorInvitationSchema,
  redeemOperatorInvitationSchema,
} from '../src/schemas';

describe('invitaciones de operador', () => {
  it('acepta exclusivamente un teléfono E.164 estricto', () => {
    expect(
      issueOperatorInvitationSchema.parse({ phoneNumber: '+56912345678' }),
    ).toEqual({ phoneNumber: '+56912345678' });
    for (const phoneNumber of [
      '56912345678',
      '+0123',
      '+1',
      '+569 12345678',
      '+1234567890123456',
    ]) {
      expect(
        issueOperatorInvitationSchema.safeParse({ phoneNumber }).success,
      ).toBe(false);
    }
    expect(
      issueOperatorInvitationSchema.safeParse({
        phoneNumber: '+56912345678',
        role: 'ADMIN',
      }).success,
    ).toBe(false);
  });
  it('solo acepta token hexadecimal de 256 bits, sin campos de autoridad', () => {
    expect(
      redeemOperatorInvitationSchema.safeParse({ token: 'a'.repeat(64) })
        .success,
    ).toBe(true);
    expect(
      redeemOperatorInvitationSchema.safeParse({
        token: 'a'.repeat(64),
        userId: 'other',
      }).success,
    ).toBe(false);
    expect(
      redeemOperatorInvitationSchema.safeParse({ token: 'short' }).success,
    ).toBe(false);
  });
});
