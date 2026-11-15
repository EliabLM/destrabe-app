import { describe, expect, it } from 'vitest';
import { listServicesQuerySchema, listServicesResponseSchema } from '../src';

describe('GET /services contract', () => {
  it('defaults to 20 and accepts only bounded positive decimal integers', () => {
    expect(listServicesQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(listServicesQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    for (const limit of [
      '0',
      '-1',
      '101',
      '1.5',
      '1e2',
      ' 2',
      '',
      'Infinity',
      ['2'],
    ]) {
      expect(listServicesQuerySchema.safeParse({ limit }).success).toBe(false);
    }
  });

  it('rejects identity selectors and malformed cursors', () => {
    for (const query of [
      { userId: 'other' },
      { clientProfileId: 'other' },
      { cursor: '???' },
      { cursor: '' },
    ]) {
      expect(listServicesQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('only accepts a page of service items with ISO dates and nullable cursor', () => {
    const item = {
      id: 'svc-1',
      type: 'BREAKDOWN',
      status: 'PENDING',
      originLat: 1,
      originLng: 2,
      destLat: null,
      destLng: null,
      description: null,
      photoUrl: null,
      expiresAt: '2026-11-15T00:00:00.000Z',
      createdAt: '2026-11-14T00:00:00.000Z',
    };
    expect(
      listServicesResponseSchema.parse({ items: [item], nextCursor: null })
        .items,
    ).toEqual([item]);
    expect(
      listServicesResponseSchema.safeParse({
        items: [{ ...item, clientProfileId: 'secret' }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});
