import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  UserRole,
  ServiceType,
  PaymentStatus,
  userRoleSchema,
  serviceTypeSchema,
  paymentStatusSchema,
} from '../src';

describe('userRoleSchema', () => {
  it('parses a valid role', () => {
    expect(userRoleSchema.parse(UserRole.OPERATOR)).toBe('OPERATOR');
  });
  it('rejects an invalid role with ZodError', () => {
    expect(() => userRoleSchema.parse('NOT_A_ROLE')).toThrow(ZodError);
  });
});

describe('serviceTypeSchema', () => {
  it('parses a valid type', () => {
    expect(serviceTypeSchema.parse(ServiceType.TRANSFER)).toBe('TRANSFER');
  });
  it('rejects an invalid type with ZodError', () => {
    expect(() => serviceTypeSchema.parse('NOT_A_TYPE')).toThrow(ZodError);
  });
});

describe('paymentStatusSchema', () => {
  it('parses a valid status', () => {
    expect(paymentStatusSchema.parse(PaymentStatus.CONFIRMED)).toBe(
      'CONFIRMED',
    );
  });
  it('rejects an invalid status with ZodError', () => {
    expect(() => paymentStatusSchema.parse('NOT_A_STATUS')).toThrow(ZodError);
  });
});
