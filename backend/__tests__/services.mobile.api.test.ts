import { describe, expect, it, vi } from 'vitest';
import { listMyServices } from '../../app/src/lib/apiServices';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../app/src/lib/api', () => ({ api: { get } }));

describe('mobile GET /services adapter', () => {
  it('passes the cursor and returns the page envelope', async () => {
    const page = { items: [], nextCursor: 'continuation' };
    get.mockResolvedValue({ data: page });
    expect(await listMyServices('opaque')).toEqual(page);
    expect(get).toHaveBeenCalledWith('/services', {
      params: { cursor: 'opaque' },
    });
  });
});
