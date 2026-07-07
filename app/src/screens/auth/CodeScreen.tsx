import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { otpVerify } from '../../lib/apiAuth';
import { getMe } from '../../lib/apiMe';
import { authStore } from '../../stores/authStore';
import { uiStore } from '../../stores/uiStore';
import type { AuthStackParamList } from '../../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Code'>;

export default function CodeScreen({ route }: Props) {
  const { phoneNumber } = route.params;
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Ingresa el código de 6 dígitos');
      return;
    }

    setError(null);
    try {
      await uiStore.getState().withLoading('otpVerify', async () => {
        const res = await otpVerify(phoneNumber, trimmed);

        // Map verify response to AuthUser shape
        const user = {
          id: res.user.id,
          phone: res.user.phoneNumber ?? phoneNumber,
          role: res.user.role as 'CLIENT' | 'OPERATOR' | 'ADMIN',
        };

        // Persist token + user in authStore
        await authStore.getState().login(res.token, user);

        // Fetch full profile to drive navigation
        try {
          await getMe();
        } catch {
          // /api/me may fail if the token is fresh; ignore — RootStack
          // will still show correct navigator based on user.role.
        }
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Código inválido';
      Alert.alert('Error', msg);
      setCode('');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.title}>Código de verificación</Text>
        <Text style={styles.subtitle}>
          Ingresa el código de 6 dígitos enviado a {phoneNumber}
        </Text>

        <TextInput
          style={styles.input}
          placeholder="123456"
          value={code}
          onChangeText={(t) => {
            setCode(t);
            setError(null);
          }}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={styles.button}
          onPress={handleVerify}
          disabled={uiStore.getState().loading.has('otpVerify')}
        >
          <Text style={styles.buttonText}>Verificar</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 14,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 12,
  },
  error: { color: '#d32f2f', marginBottom: 8 },
  button: {
    backgroundColor: '#1a73e8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
