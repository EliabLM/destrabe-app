import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { serviceStatusSchema } from '../src/schemas/service.schema';
import { ServiceStatus } from '../src/types/service';

describe('serviceStatusSchema', () => {
  it('parses a valid ServiceStatus value', () => {
    expect(serviceStatusSchema.parse(ServiceStatus.PENDING)).toBe('PENDING');
  });

  it('parses every enum member', () => {
    for (const status of Object.values(ServiceStatus)) {
      expect(serviceStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects an invalid value with ZodError', () => {
    expect(() => serviceStatusSchema.parse('INVALID')).toThrow(ZodError);
  });
});
