import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RolePickerScreen from '../screens/onboarding/RolePickerScreen';
import ClientProfileScreen from '../screens/onboarding/ClientProfileScreen';
import OperatorProfileScreen from '../screens/onboarding/OperatorProfileScreen';

export type OnboardingStackParamList = {
  RolePicker: undefined;
  ClientProfile: undefined;
  OperatorProfile: undefined;
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingStack() {
  return (
    <Stack.Navigator initialRouteName="RolePicker">
      <Stack.Screen
        name="RolePicker"
        component={RolePickerScreen}
        options={{ title: 'Tu rol' }}
      />
      <Stack.Screen
        name="ClientProfile"
        component={ClientProfileScreen}
        options={{ title: 'Perfil Cliente' }}
      />
      <Stack.Screen
        name="OperatorProfile"
        component={OperatorProfileScreen}
        options={{ title: 'Perfil Operador' }}
      />
    </Stack.Navigator>
  );
}
