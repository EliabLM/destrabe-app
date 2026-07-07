import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Screen placeholders — real screens created in T9
function PhonePlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Phone Login</Text>
      <Text>Phone input screen (T9)</Text>
    </View>
  );
}

function CodePlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Verify Code</Text>
      <Text>OTP verification screen (T9)</Text>
    </View>
  );
}

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
        component={PhonePlaceholder}
        options={{ title: 'Ingresar' }}
      />
      <Stack.Screen
        name="Code"
        component={CodePlaceholder}
        options={{ title: 'Código' }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
});
