import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  createQuoteSchema,
  acceptQuoteSchema,
} from '../src/schemas/service.schema';
import {
  QUOTE_AMOUNT_MAX_COP,
  QUOTE_AMOUNT_MIN_COP,
} from '../src/schemas/inputBounds.schema';

describe('createQuoteSchema (REQ-004)', () => {
  it('parses a valid body with all fields', () => {
    const parsed = createQuoteSchema.parse({
      amount: 150000,
      estimatedMinutes: 30,
      note: 'Llego en 30 min',
    });
    expect(parsed.amount).toBe(150000);
    expect(parsed.estimatedMinutes).toBe(30);
    expect(parsed.note).toBe('Llego en 30 min');
  });

  it('parses with only required amount', () => {
    const parsed = createQuoteSchema.parse({ amount: 20000 });
    expect(parsed.amount).toBe(20000);
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

  it('rejects decimal amount (COP enteros)', () => {
    expect(() => createQuoteSchema.parse({ amount: 50000.5 })).toThrow(
      ZodError,
    );
  });

  it('accepts the configured bounds and rejects values outside them', () => {
    expect(QUOTE_AMOUNT_MIN_COP).toBe(10_000);
    expect(QUOTE_AMOUNT_MAX_COP).toBe(2_000_000);
    expect(
      createQuoteSchema.parse({ amount: QUOTE_AMOUNT_MIN_COP }).amount,
    ).toBe(QUOTE_AMOUNT_MIN_COP);
    expect(
      createQuoteSchema.parse({ amount: QUOTE_AMOUNT_MAX_COP }).amount,
    ).toBe(QUOTE_AMOUNT_MAX_COP);
    expect(() =>
      createQuoteSchema.parse({ amount: QUOTE_AMOUNT_MIN_COP - 1 }),
    ).toThrow(ZodError);
    expect(() =>
      createQuoteSchema.parse({ amount: QUOTE_AMOUNT_MAX_COP + 1 }),
    ).toThrow(ZodError);
  });

  it('rejects amount sent as string', () => {
    expect(() => createQuoteSchema.parse({ amount: '50000' })).toThrow(
      ZodError,
    );
  });

  it('rejects non-integer estimatedMinutes', () => {
    expect(() =>
      createQuoteSchema.parse({ amount: 50000, estimatedMinutes: 1.5 }),
    ).toThrow(ZodError);
  });

  it('rejects note longer than 500 chars', () => {
    expect(() =>
      createQuoteSchema.parse({ amount: 50000, note: 'x'.repeat(501) }),
    ).toThrow(ZodError);
  });
});

describe('acceptQuoteSchema (REQ-004)', () => {
  it('parses an empty body', () => {
    const parsed = acceptQuoteSchema.parse({});
    expect(parsed).toEqual({});
  });
});
