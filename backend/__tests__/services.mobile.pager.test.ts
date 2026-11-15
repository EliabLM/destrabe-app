import { describe, expect, it, vi } from 'vitest';
import { createServicesPager } from '../../app/src/lib/servicesPager';

const item = (id: string) => ({
  id,
  type: 'BREAKDOWN',
  status: 'PENDING',
  originLat: 1,
  originLng: 2,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('services pager', () => {
  it('loads successive pages, deduplicates and refreshes from page one', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('a')], nextCursor: 'next' })
      .mockResolvedValueOnce({
        items: [item('a'), item('b'), item('b')],
        nextCursor: null,
      })
      .mockResolvedValueOnce({ items: [item('c')], nextCursor: null });
    const pager = createServicesPager(() => 'session-1', load);
    await pager.loadMore();
    await pager.loadMore();
    await pager.loadMore();
    expect(pager.state.items.map((x) => x.id)).toEqual(['a', 'b']);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.map((c) => c[0])).toEqual([undefined, 'next']);
    await pager.refresh();
    expect(pager.state.items.map((x) => x.id)).toEqual(['c']);
    expect(load.mock.calls[2][0]).toBeUndefined();
  });
  it('retains error and cursor for retry instead of presenting an empty result', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('401 Unauthorized'))
      .mockResolvedValueOnce({ items: [item('a')], nextCursor: null });
    const pager = createServicesPager(() => 'session-1', load);
    await pager.loadMore();
    expect(pager.state.error).toContain('401');
    expect(pager.state.initialized).toBe(false);
    await pager.loadMore();
    expect(pager.state.items.map((x) => x.id)).toEqual(['a']);
    expect(pager.state.error).toBeNull();
  });
  it('discards late responses after logout, user switch or refresh', async () => {
    let identity = 'user-one:token-a';
    const pending = deferred<{
      items: ReturnType<typeof item>[];
      nextCursor: null;
    }>();
    const load = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ items: [item('fresh')], nextCursor: null });
    const pager = createServicesPager(() => identity, load);
    const first = pager.loadMore();
    identity = 'user-two:token-b';
    await pager.refresh();
    pending.resolve({ items: [item('old')], nextCursor: null });
    await first;
    expect(pager.state.items.map((x) => x.id)).toEqual(['fresh']);
    identity = null as unknown as string;
    await pager.loadMore();
    expect(pager.state.items).toEqual([]);
  });
});
