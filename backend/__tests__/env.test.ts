import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/lib/env';

describe('parseEnv', () => {
  it('parses valid env into a typed object', () => {
    const env = parseEnv({ PORT: '3000', NODE_ENV: 'test' });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('test');
  });

  it('defaults NODE_ENV to development when absent', () => {
    const env = parseEnv({ PORT: '3000' });
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws mentioning PORT when PORT is not numeric', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });
});
