import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  token: null as string | null,
  userId: null as string | null,
}));
const getMeMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn());
vi.mock('../../app/src/lib/secureStorage', () => ({
  secureStorage: {
    getToken: async () => storage.token,
    setToken: async (token: string) => {
      storage.token = token;
    },
    setUserId: async (id: string) => {
      storage.userId = id;
    },
    clearAll: async () => {
      storage.token = null;
      storage.userId = null;
    },
  },
}));
vi.mock('../../app/src/lib/apiMe', () => ({ getMe: getMeMock }));
vi.mock('../../app/src/lib/apiAuth', () => ({ otpSignOut: signOutMock }));
const featuresLoadMock = vi.hoisted(() => vi.fn());
const featuresResetMock = vi.hoisted(() => vi.fn());
vi.mock('../../app/src/stores/featuresStore', () => ({
  featuresStore: {
    getState: () => ({ load: featuresLoadMock, reset: featuresResetMock }),
  },
}));
import { authStore } from '../../app/src/stores/authStore';
import { UserRole } from '@destrabe/shared';

beforeEach(() => {
  storage.token = null;
  storage.userId = null;
  getMeMock.mockReset();
  signOutMock.mockReset();
  featuresLoadMock.mockReset();
  featuresResetMock.mockReset();
  authStore.setState({
    token: null,
    user: null,
    role: null,
    hydrated: false,
    profileReady: false,
  });
});

describe('ciclo de sesión móvil', () => {
  it('rehidrata usuario y perfil a partir del token guardado', async () => {
    storage.token = 'signed-token';
    getMeMock.mockResolvedValue({
      user: { id: 'u1', phoneNumber: '+573001112233', role: 'OPERATOR' },
      operatorProfile: { id: 'op1' },
    });
    await authStore.getState().hydrate();
    expect(authStore.getState()).toMatchObject({
      hydrated: true,
      token: 'signed-token',
      user: { id: 'u1', role: 'OPERATOR' },
      profileReady: true,
    });
    expect(featuresLoadMock).toHaveBeenCalledWith('u1');
  });

  it('mantiene onboarding de vehículo tras reinicio si OPERATOR solo tiene perfil cliente', async () => {
    storage.token = 'signed-token';
    getMeMock.mockResolvedValue({
      user: { id: 'u1', phoneNumber: '+56912345678', role: 'OPERATOR' },
      clientProfile: { id: 'cl1' },
      operatorProfile: null,
    });
    await authStore.getState().hydrate();
    expect(authStore.getState()).toMatchObject({
      hydrated: true,
      token: 'signed-token',
      user: { role: 'OPERATOR' },
      profileReady: false,
    });
  });

  it('abre OperatorStack tras reinicio cuando existe perfil operador además del cliente', async () => {
    storage.token = 'signed-token';
    getMeMock.mockResolvedValue({
      user: { id: 'u1', phoneNumber: '+56912345678', role: 'OPERATOR' },
      clientProfile: { id: 'cl1' },
      operatorProfile: { id: 'op1' },
    });
    await authStore.getState().hydrate();
    expect(authStore.getState()).toMatchObject({
      hydrated: true,
      user: { role: 'OPERATOR' },
      profileReady: true,
    });
  });

  it('borra el token persistido cuando el servidor rechaza la rehidratación', async () => {
    storage.token = 'expired-token';
    getMeMock.mockRejectedValue(new Error('Unauthorized'));
    await authStore.getState().hydrate();
    expect(authStore.getState()).toMatchObject({
      hydrated: true,
      token: null,
      user: null,
    });
    expect(storage.token).toBeNull();
  });

  it('revoca la sesión antes de limpiar el estado al cerrar sesión', async () => {
    await authStore.getState().login('signed-token', {
      id: 'u1',
      phone: '+573001112233',
      role: UserRole.CLIENT,
    });
    signOutMock.mockImplementation(async () => {
      expect(storage.token).toBe('signed-token');
    });
    expect(featuresLoadMock).toHaveBeenCalledWith('u1');
    await authStore.getState().logout();
    expect(signOutMock).toHaveBeenCalledOnce();
    expect(storage.token).toBeNull();
    expect(featuresResetMock).toHaveBeenCalled();
  });
});
