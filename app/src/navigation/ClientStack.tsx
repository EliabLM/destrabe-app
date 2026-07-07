import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
// import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

// Screen placeholders — real screens created in T11
function ServicesListPlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Servicios</Text>
      <Text>Services list screen (T11)</Text>
    </View>
  );
}

function NewServicePlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Nuevo Servicio</Text>
      <Text>New service screen (T11)</Text>
    </View>
  );
}

function ServiceDetailPlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Detalle</Text>
      <Text>Service detail screen (T11)</Text>
    </View>
  );
}

function PaymentPlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Pago</Text>
      <Text>Payment screen (T11)</Text>
    </View>
  );
}

function ProfilePlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Perfil</Text>
      <Text>Profile tab (placeholder)</Text>
    </View>
  );
}

export type ClientStackParamList = {
  ServicesList: undefined;
  NewService: undefined;
  ServiceDetail: { serviceId: string };
  Payment: { serviceId: string; paymentId: string };
};

const Stack = createNativeStackNavigator<ClientStackParamList>();

// Tab navigator would go here for bottom tabs (ServicesList, Profile)
// For Demo simplicity, we use a flat stack.

export function ClientStack() {
  return (
    <Stack.Navigator initialRouteName="ServicesList">
      <Stack.Screen
        name="ServicesList"
        component={ServicesListPlaceholder}
        options={{ title: 'Mis Servicios' }}
      />
      <Stack.Screen
        name="NewService"
        component={NewServicePlaceholder}
        options={{ title: 'Nuevo Servicio' }}
      />
      <Stack.Screen
        name="ServiceDetail"
        component={ServiceDetailPlaceholder}
        options={{ title: 'Detalle' }}
      />
      <Stack.Screen
        name="Payment"
        component={PaymentPlaceholder}
        options={{ title: 'Pago' }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
});
