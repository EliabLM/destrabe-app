import { create } from 'zustand';
import type { AuthUser } from '@destrabe/shared';
import { secureStorage } from '../lib/secureStorage';

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  role: string | null;
  hydrated: boolean;
  login: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  setAuthToken: (token: string | null) => void;
}

export const authStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  role: null,
  hydrated: false,

  login: async (token: string, user: AuthUser) => {
    await secureStorage.setToken(token);
    await secureStorage.setUserId(user.id);
    set({ token, user, role: user.role, hydrated: true });
  },

  logout: async () => {
    await secureStorage.clearAll();
    set({ token: null, user: null, role: null, hydrated: true });
  },

  hydrate: async () => {
    const token = await secureStorage.getToken();
    if (token) {
      set({ token, hydrated: true });
    } else {
      set({ hydrated: true });
    }
  },

  setAuthToken: (token: string | null) => {
    set({ token });
  },
}));
