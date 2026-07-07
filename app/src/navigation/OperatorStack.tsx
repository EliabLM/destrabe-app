import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AvailableToggleScreen from '../screens/operator/AvailableToggleScreen';
import NearbyServicesScreen from '../screens/operator/NearbyServicesScreen';
import ActiveServiceScreen from '../screens/operator/ActiveServiceScreen';

export type OperatorStackParamList = {
  AvailableToggle: undefined;
  NearbyServices: undefined;
  ActiveService: { serviceId: string } | undefined;
};

const Stack = createNativeStackNavigator<OperatorStackParamList>();

export function OperatorStack() {
  return (
    <Stack.Navigator initialRouteName="AvailableToggle">
      <Stack.Screen
        name="AvailableToggle"
        component={AvailableToggleScreen}
        options={{ title: 'Disponible' }}
      />
      <Stack.Screen
        name="NearbyServices"
        component={NearbyServicesScreen}
        options={{ title: 'Cercanos' }}
      />
      <Stack.Screen
        name="ActiveService"
        component={ActiveServiceScreen}
        options={{ title: 'Activo' }}
      />
    </Stack.Navigator>
  );
}
