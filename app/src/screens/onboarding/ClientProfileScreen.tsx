import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authStore } from '../../stores/authStore';

/**
 * Client onboarding — minimal confirmation.
 * ClientProfile is lazy-created on first service (backend).
 */
export default function ClientProfileScreen() {
  const user = authStore((s) => s.user);

  const handleContinue = () => {
    // Mark profile ready → RootStack re-renders to ClientStack
    authStore.setState({ profileReady: true });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>¡Bienvenido!</Text>
        <Text style={styles.subtitle}>
          Estás registrado como cliente{user?.phone ? ` (${user.phone})` : ''}.
        </Text>
        <Text style={styles.description}>
          Tu perfil se creará automáticamente cuando solicites tu primer
          servicio.
        </Text>

        <TouchableOpacity style={styles.button} onPress={handleContinue}>
          <Text style={styles.buttonText}>Ir al inicio</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#333', marginBottom: 16 },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#1a73e8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
