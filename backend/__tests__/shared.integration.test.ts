import { describe, it, expect } from 'vitest';
import { serviceStatusSchema, ServiceStatus } from '@destrabe/shared';

describe('@destrabe/shared workspace integration', () => {
  it('resolves the workspace package from backend and parses a valid status', () => {
    expect(serviceStatusSchema.parse(ServiceStatus.ACTIVE)).toBe('ACTIVE');
  });

  it('rejects invalid status values', () => {
    expect(() => serviceStatusSchema.parse('NOPE')).toThrow();
  });
});
