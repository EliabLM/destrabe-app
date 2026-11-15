import axios from 'axios';
import { authStore } from '../stores/authStore';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: inject Bearer token
api.interceptors.request.use((config) => {
  const token = authStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: 401 → logout
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const current = authStore.getState();
      // A late 401 from a previous session must not log out a newer login.
      if (
        current.token &&
        error.config?.headers?.Authorization === `Bearer ${current.token}`
      ) {
        void current.clearLocalSession();
      }
    }
    return Promise.reject(error);
  },
);
