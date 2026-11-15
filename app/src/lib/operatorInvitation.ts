import { UserRole } from '@destrabe/shared';
import { api } from './api';
import { getMe } from './apiMe';
import { authStore } from '../stores/authStore';

/** Nunca persiste el token de invitación; actualiza estado solo tras confirmación de /api/me. */
export async function redeemAndRefreshOperator(token: string): Promise<void> {
  await api.post('/api/operator/invitations/redeem', { token });
  await refreshOperatorFromServer();
}

export async function refreshOperatorFromServer(): Promise<void> {
  const { user, operatorProfile } = await getMe();
  const previous = authStore.getState();
  if (user.role !== UserRole.OPERATOR || user.id !== previous.user?.id) {
    throw new Error('No se pudo confirmar el perfil de operador');
  }
  authStore.setState({
    user: { id: user.id, phone: user.phoneNumber, role: UserRole.OPERATOR },
    role: UserRole.OPERATOR,
    profileReady: Boolean(operatorProfile),
  });
}
