import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'destrabe.token';
const USER_ID_KEY = 'destrabe.userId';
const FEATURES_KEY = 'destrabe.features';

export const secureStorage = {
  async getToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  },

  async setToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },

  async deleteToken(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },

  async getUserId(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(USER_ID_KEY);
    } catch {
      return null;
    }
  },

  async setUserId(userId: string): Promise<void> {
    await SecureStore.setItemAsync(USER_ID_KEY, userId);
  },

  async deleteUserId(): Promise<void> {
    await SecureStore.deleteItemAsync(USER_ID_KEY);
  },

  /** Últimos feature flags conocidos (JSON `{ userId, features }`). */
  async getFeatures(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(FEATURES_KEY);
    } catch {
      return null;
    }
  },

  async setFeatures(value: string): Promise<void> {
    await SecureStore.setItemAsync(FEATURES_KEY, value);
  },

  async clearAll(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_ID_KEY);
    await SecureStore.deleteItemAsync(FEATURES_KEY);
  },
};
