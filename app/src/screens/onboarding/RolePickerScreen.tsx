import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getMe } from '../../lib/apiMe';
import { authStore } from '../../stores/authStore';
import type { OnboardingStackParamList } from '../../navigation/OnboardingStack';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'RolePicker'>;

export default function RolePickerScreen() {
  const nav = useNavigation<Nav>();
  const user = authStore((s) => s.user);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkProfile();
  }, []);

  const checkProfile = async () => {
    try {
      const me = await getMe();
      // If operatorProfile already exists, mark profileReady
      if (me.operatorProfile) {
        authStore.getState().setUser(user);
        authStore.setState({ profileReady: true });
        return; // RootStack will re-render to OperatorStack
      }
    } catch {
      // /api/me may fail; continue to manual onboarding
    }
    setLoading(false);
  };

  const role = user?.role ?? 'OPERATOR';

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Verificando perfil...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>Tu rol</Text>
        <Text style={styles.subtitle}>
          Vas a operar como{' '}
          <Text style={styles.roleHighlight}>
            {role === 'OPERATOR' ? 'Operador' : 'Cliente'}
          </Text>
        </Text>

        {role === 'OPERATOR' && (
          <Text style={styles.description}>
            Para comenzar, completa tu perfil de operador con los datos de tu
            vehículo.
          </Text>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            if (role === 'OPERATOR') {
              nav.navigate('OperatorProfile');
            } else {
              nav.navigate('ClientProfile');
            }
          }}
        >
          <Text style={styles.buttonText}>Continuar</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 18, marginBottom: 16 },
  roleHighlight: { fontWeight: 'bold', color: '#1a73e8' },
  description: { fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 20 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  button: {
    backgroundColor: '#1a73e8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
