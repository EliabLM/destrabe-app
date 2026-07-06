import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { createQuoteSchema, acceptQuoteSchema } from '../src/schemas/service.schema';

describe('createQuoteSchema (REQ-004)', () => {
  it('parses a valid body with all fields', () => {
    const parsed = createQuoteSchema.parse({
      amount: 1500,
      estimatedMinutes: 30,
      note: 'Llego en 30 min',
    });
    expect(parsed.amount).toBe(1500);
    expect(parsed.estimatedMinutes).toBe(30);
    expect(parsed.note).toBe('Llego en 30 min');
  });

  it('parses with only required amount', () => {
    const parsed = createQuoteSchema.parse({ amount: 2000 });
    expect(parsed.amount).toBe(2000);
    expect(parsed.estimatedMinutes).toBeUndefined();
    expect(parsed.note).toBeUndefined();
  });

  it('rejects missing amount', () => {
    expect(() => createQuoteSchema.parse({})).toThrow(ZodError);
  });

  it('rejects zero amount', () => {
    expect(() => createQuoteSchema.parse({ amount: 0 })).toThrow(ZodError);
  });

  it('rejects negative amount', () => {
    expect(() => createQuoteSchema.parse({ amount: -100 })).toThrow(ZodError);
  });

  it('rejects non-integer estimatedMinutes', () => {
    expect(() =>
      createQuoteSchema.parse({ amount: 100, estimatedMinutes: 1.5 }),
    ).toThrow(ZodError);
  });

  it('rejects note longer than 500 chars', () => {
    expect(() =>
      createQuoteSchema.parse({ amount: 100, note: 'x'.repeat(501) }),
    ).toThrow(ZodError);
  });
});

describe('acceptQuoteSchema (REQ-004)', () => {
  it('parses an empty body', () => {
    const parsed = acceptQuoteSchema.parse({});
    expect(parsed).toEqual({});
  });
});
