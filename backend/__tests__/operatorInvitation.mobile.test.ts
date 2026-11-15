import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '../../app/src/stores/authStore';
import { UserRole } from '@destrabe/shared';
import {
  redeemAndRefreshOperator,
  refreshOperatorFromServer,
} from '../../app/src/lib/operatorInvitation';

const { redeem, me } = vi.hoisted(() => ({ redeem: vi.fn(), me: vi.fn() }));
vi.mock('../../app/src/lib/api', () => ({ api: { post: redeem } }));
vi.mock('../../app/src/lib/apiMe', () => ({ getMe: me }));
vi.mock('../../app/src/lib/secureStorage', () => ({
  secureStorage: { setToken: vi.fn(), setUserId: vi.fn() },
}));

beforeEach(() => {
  vi.resetAllMocks();
  authStore.setState({
    token: 'session',
    user: { id: 'u1', phone: '+56912345678', role: UserRole.CLIENT },
    role: UserRole.CLIENT,
    profileReady: true,
  });
});

describe('canje móvil', () => {
  it('espera /api/me del servidor antes de pasar al onboarding de perfil operador', async () => {
    redeem.mockResolvedValue({ data: { redeemed: true } });
    me.mockResolvedValue({
      user: { id: 'u1', phoneNumber: '+56912345678', role: 'OPERATOR' },
      operatorProfile: null,
    });
    await redeemAndRefreshOperator('a'.repeat(64));
    expect(redeem).toHaveBeenCalledWith('/api/operator/invitations/redeem', {
      token: 'a'.repeat(64),
    });
    expect(me).toHaveBeenCalledOnce();
    expect(authStore.getState()).toMatchObject({
      token: 'session',
      user: { role: 'OPERATOR' },
      profileReady: false,
    });
  });
  it('si falla red o respuesta de /api/me no eleva rol ni pierde ClientStack', async () => {
    redeem.mockResolvedValue({ data: { redeemed: true } });
    me.mockRejectedValue(new Error('red'));
    await expect(redeemAndRefreshOperator('a'.repeat(64))).rejects.toThrow();
    expect(authStore.getState()).toMatchObject({
      token: 'session',
      user: { role: 'CLIENT' },
      profileReady: true,
    });
  });
  it('no confía en rol del cliente cuando /api/me no confirma OPERATOR', async () => {
    redeem.mockResolvedValue({ data: { redeemed: true } });
    me.mockResolvedValue({
      user: { id: 'u1', phoneNumber: '+56912345678', role: 'CLIENT' },
    });
    await expect(redeemAndRefreshOperator('a'.repeat(64))).rejects.toThrow();
    expect(authStore.getState().role).toBe('CLIENT');
  });
  it('recupera estado tras canje ya realizado sin reenviar token', async () => {
    me.mockResolvedValue({
      user: { id: 'u1', phoneNumber: '+56912345678', role: 'OPERATOR' },
      operatorProfile: null,
    });
    await refreshOperatorFromServer();
    expect(redeem).not.toHaveBeenCalled();
    expect(authStore.getState()).toMatchObject({
      token: 'session',
      user: { role: 'OPERATOR' },
      profileReady: false,
    });
  });
});
