import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ServicesListScreen from '../screens/client/ServicesListScreen';
import NewServiceScreen from '../screens/client/NewServiceScreen';
import ServiceDetailScreen from '../screens/client/ServiceDetailScreen';
import PaymentScreen from '../screens/client/PaymentScreen';

export type ClientStackParamList = {
  ServicesList: undefined;
  NewService: undefined;
  ServiceDetail: { serviceId: string };
  Payment: { serviceId: string; paymentId: string };
};

const Stack = createNativeStackNavigator<ClientStackParamList>();

export function ClientStack() {
  return (
    <Stack.Navigator initialRouteName="ServicesList">
      <Stack.Screen
        name="ServicesList"
        component={ServicesListScreen}
        options={{ title: 'Mis Servicios' }}
      />
      <Stack.Screen
        name="NewService"
        component={NewServiceScreen}
        options={{ title: 'Nuevo Servicio' }}
      />
      <Stack.Screen
        name="ServiceDetail"
        component={ServiceDetailScreen}
        options={{ title: 'Detalle' }}
      />
      <Stack.Screen
        name="Payment"
        component={PaymentScreen}
        options={{ title: 'Pago' }}
      />
    </Stack.Navigator>
  );
}
