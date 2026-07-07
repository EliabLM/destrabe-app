import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Screen placeholders — real screens created in T12
function AvailableTogglePlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Disponibilidad</Text>
      <Text>Available toggle screen (T12)</Text>
    </View>
  );
}

function NearbyServicesPlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Servicios Cercanos</Text>
      <Text>Nearby services screen (T12)</Text>
    </View>
  );
}

function ActiveServicePlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Servicio Activo</Text>
      <Text>Active service screen (T12)</Text>
    </View>
  );
}

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
        component={AvailableTogglePlaceholder}
        options={{ title: 'Disponible' }}
      />
      <Stack.Screen
        name="NearbyServices"
        component={NearbyServicesPlaceholder}
        options={{ title: 'Cercanos' }}
      />
      <Stack.Screen
        name="ActiveService"
        component={ActiveServicePlaceholder}
        options={{ title: 'Activo' }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
});
