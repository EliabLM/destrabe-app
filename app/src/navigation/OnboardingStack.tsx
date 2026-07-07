import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Screen placeholders — real screens created in T10
function RolePickerPlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Choose Role</Text>
      <Text>Role picker screen (T10)</Text>
    </View>
  );
}

function ClientProfilePlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Client Profile</Text>
      <Text>Client profile screen (T10)</Text>
    </View>
  );
}

function OperatorProfilePlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Operator Profile</Text>
      <Text>Operator profile screen (T10)</Text>
    </View>
  );
}

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
        component={RolePickerPlaceholder}
        options={{ title: 'Tu rol' }}
      />
      <Stack.Screen
        name="ClientProfile"
        component={ClientProfilePlaceholder}
        options={{ title: 'Perfil Cliente' }}
      />
      <Stack.Screen
        name="OperatorProfile"
        component={OperatorProfilePlaceholder}
        options={{ title: 'Perfil Operador' }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
});
