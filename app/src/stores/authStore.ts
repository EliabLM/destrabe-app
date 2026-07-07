import { create } from 'zustand';
import type { AuthUser } from '@destrabe/shared';
import { secureStorage } from '../lib/secureStorage';

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  role: string | null;
  hydrated: boolean;
  /** True when the user has the required profile for their role. */
  profileReady: boolean;
  login: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  setAuthToken: (token: string | null) => void;
  setUser: (user: AuthUser | null) => void;
}

export const authStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  role: null,
  hydrated: false,
  profileReady: false,

  login: async (token: string, user: AuthUser) => {
    await secureStorage.setToken(token);
    await secureStorage.setUserId(user.id);
    // CLIENT profile is lazy-created on first service; treat as ready.
    const profileReady = user.role === 'CLIENT';
    set({ token, user, role: user.role, hydrated: true, profileReady });
  },

  logout: async () => {
    await secureStorage.clearAll();
    set({
      token: null,
      user: null,
      role: null,
      hydrated: true,
      profileReady: false,
    });
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

  setUser: (user: AuthUser | null) => {
    set({ user, role: user?.role ?? null });
  },
}));
