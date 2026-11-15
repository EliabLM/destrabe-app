import { describe, expect, it, vi } from 'vitest';
import { Children, type ReactElement } from 'react';
import { UserRole } from '@destrabe/shared';

const navigationState = vi.hoisted(() => ({
  token: 'session' as string | null,
  user: { id: 'u1', phone: '+56912345678', role: 'OPERATOR' } as object | null,
  profileReady: false,
  hydrated: true,
}));
vi.mock('../../app/src/stores/authStore', () => ({
  authStore: (select: (state: typeof navigationState) => unknown) =>
    select(navigationState),
}));
vi.mock('react-native', () => ({
  Button: () => null,
  View: () => null,
  ActivityIndicator: () => null,
  StyleSheet: { create: (styles: object) => styles },
}));
vi.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: () => null,
    Screen: () => null,
  }),
}));
vi.mock('../../app/src/screens/client/ServicesListScreen', () => ({
  default: () => null,
}));
vi.mock('../../app/src/screens/client/NewServiceScreen', () => ({
  default: () => null,
}));
vi.mock('../../app/src/screens/client/ServiceDetailScreen', () => ({
  default: () => null,
}));
vi.mock('../../app/src/screens/client/PaymentScreen', () => ({
  default: () => null,
}));
vi.mock('../../app/src/screens/client/OperatorInvitationScreen', () => ({
  default: () => null,
}));
vi.mock('../../app/src/navigation/AuthStack', () => ({
  AuthStack: () => null,
}));
vi.mock('../../app/src/navigation/OnboardingStack', () => ({
  OnboardingStack: () => null,
}));
vi.mock('../../app/src/navigation/OperatorStack', () => ({
  OperatorStack: () => null,
}));

// Los navegadores JSX pertenecen a app; Vitest los transforma, mientras backend/tsconfig no habilita JSX.
// @ts-expect-error TS6142: import de módulo JSX desde el runner de pruebas backend.
import { ClientStack } from '../../app/src/navigation/ClientStack';
// @ts-expect-error TS6142: import de módulo JSX desde el runner de pruebas backend.
import { RootNavigator } from '../../app/src/navigation/RootStack';
// @ts-expect-error TS6142: import de módulo JSX desde el runner de pruebas backend.
import { OnboardingStack } from '../../app/src/navigation/OnboardingStack';
// @ts-expect-error TS6142: import de módulo JSX desde el runner de pruebas backend.
import { OperatorStack } from '../../app/src/navigation/OperatorStack';

function rootForOperator(profileReady: boolean) {
  navigationState.token = 'session';
  navigationState.user = {
    id: 'u1',
    phone: '+56912345678',
    role: UserRole.OPERATOR,
  };
  navigationState.profileReady = profileReady;
  navigationState.hydrated = true;
  return RootNavigator() as ReactElement;
}

describe('navegación del alta de operador', () => {
  it('expone desde ClientStack la entrada a canjear invitación', () => {
    const navigator = ClientStack() as ReactElement<{
      children: ReactElement[];
    }>;
    const screens = Children.toArray(navigator.props.children) as ReactElement<{
      name: string;
      options?: (context: {
        navigation: { navigate: (route: string) => void };
      }) => {
        headerRight: () => ReactElement<{ onPress: () => void }>;
      };
    }>[];
    expect(
      screens.some((screen) => screen.props.name === 'OperatorInvitation'),
    ).toBe(true);
    const list = screens.find((screen) => screen.props.name === 'ServicesList');
    const navigate = vi.fn();
    const button = list!.props.options!({
      navigation: { navigate },
    }).headerRight();
    button.props.onPress();
    expect(navigate).toHaveBeenCalledWith('OperatorInvitation');
  });

  it('mantiene onboarding tras reinicio mientras falta perfil operador', () => {
    expect(rootForOperator(false).type).toBe(OnboardingStack);
  });

  it('abre stack operador cuando ya existe perfil operador', () => {
    expect(rootForOperator(true).type).toBe(OperatorStack);
  });
});
