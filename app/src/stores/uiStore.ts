import { create } from 'zustand';

export interface UiState {
  loading: Set<string>;
  setLoading: (key: string, value: boolean) => void;
  withLoading: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
}

export const uiStore = create<UiState>((set, get) => ({
  loading: new Set<string>(),

  setLoading: (key: string, value: boolean) => {
    const next = new Set(get().loading);
    if (value) {
      next.add(key);
    } else {
      next.delete(key);
    }
    set({ loading: next });
  },

  withLoading: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    get().setLoading(key, true);
    try {
      return await fn();
    } finally {
      get().setLoading(key, false);
    }
  },
}));
