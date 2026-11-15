import type { ListServicesResponse } from '@destrabe/shared';

export interface PagerState {
  items: ListServicesResponse['items'];
  nextCursor: string | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;
}

/** Holds one authenticated listing; stale async results cannot cross sessions or refreshes. */
export function createServicesPager(
  identity: () => string | null,
  fetchPage: (cursor?: string) => Promise<ListServicesResponse>,
  changed: (state: PagerState) => void = () => {},
) {
  let generation = 0;
  let owner = identity();
  let state: PagerState = {
    items: [],
    nextCursor: null,
    initialized: false,
    loading: false,
    error: null,
  };
  const emit = (next: PagerState) => {
    state = next;
    changed(state);
  };
  const reset = () => {
    generation++;
    owner = identity();
    emit({
      items: [],
      nextCursor: null,
      initialized: false,
      loading: false,
      error: null,
    });
  };
  const sync = () => {
    if (owner !== identity()) reset();
  };
  const loadMore = async () => {
    sync();
    if (!owner || state.loading || (state.initialized && !state.nextCursor))
      return;
    const revision = generation;
    const cursor = state.nextCursor ?? undefined;
    emit({ ...state, loading: true, error: null });
    try {
      const page = await fetchPage(cursor);
      if (identity() !== owner || revision !== generation) return;
      const seen = new Set(state.items.map((item) => item.id));
      const unique = page.items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      emit({
        items: [...state.items, ...unique],
        nextCursor: page.nextCursor,
        loading: false,
        initialized: true,
        error: null,
      });
    } catch (error) {
      if (identity() !== owner || revision !== generation) return;
      emit({
        ...state,
        loading: false,
        error:
          error instanceof Error ? error.message : 'Error al cargar servicios',
      });
    }
  };
  return {
    get state() {
      sync();
      return state;
    },
    loadMore,
    refresh: async () => {
      reset();
      await loadMore();
    },
    invalidate: reset,
  };
}
