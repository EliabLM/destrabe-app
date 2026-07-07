import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PhoneScreen from '../screens/auth/PhoneScreen';
import CodeScreen from '../screens/auth/CodeScreen';

export type AuthStackParamList = {
  Phone: undefined;
  Code: { phoneNumber: string };
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
  return (
    <Stack.Navigator initialRouteName="Phone">
      <Stack.Screen
        name="Phone"
        component={PhoneScreen}
        options={{ title: 'Ingresar' }}
      />
      <Stack.Screen
        name="Code"
        component={CodeScreen}
        options={{ title: 'Código' }}
      />
    </Stack.Navigator>
  );
}
