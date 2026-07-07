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
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { otpSend } from '../../lib/apiAuth';
import { uiStore } from '../../stores/uiStore';
import type { AuthStackParamList } from '../../navigation/AuthStack';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Phone'>;

export default function PhoneScreen() {
  const nav = useNavigation<Nav>();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    // Basic E.164 validation
    const cleaned = phone.trim();
    if (!/^\+\d{6,15}$/.test(cleaned)) {
      setError('Teléfono debe estar en formato E.164 (ej. +573001234567)');
      return;
    }

    setError(null);
    try {
      await uiStore.getState().withLoading('otpSend', () =>
        otpSend(cleaned),
      );
      nav.navigate('Code', { phoneNumber: cleaned });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Error al enviar código';
      Alert.alert('Error', msg);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.title}>Ingresar</Text>
        <Text style={styles.subtitle}>Ingresa tu número de teléfono</Text>

        <TextInput
          style={styles.input}
          placeholder="+573001234567"
          value={phone}
          onChangeText={(t) => {
            setPhone(t);
            setError(null);
          }}
          keyboardType="phone-pad"
          autoComplete="tel"
          autoFocus
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={styles.button}
          onPress={handleSend}
          disabled={uiStore.getState().loading.has('otpSend')}
        >
          <Text style={styles.buttonText}>Enviar código</Text>
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
    fontSize: 18,
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
