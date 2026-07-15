import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { initPayment, getPaymentStatus } from '../../lib/apiPayments';
import type { ClientStackParamList } from '../../navigation/ClientStack';

type Nav = NativeStackNavigationProp<ClientStackParamList, 'Payment'>;
type Route = RouteProp<ClientStackParamList, 'Payment'>;

type PaymentState =
  | 'idle'
  | 'initiating'
  | 'browser'
  | 'polling'
  | 'confirmed'
  | 'failed'
  | 'timeout';

const POLL_INTERVAL = 3000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const STATUS_MSGS: Record<PaymentState, string> = {
  idle: '',
  initiating: 'Iniciando pago...',
  browser: 'Completa el pago en el navegador...',
  polling: 'Verificando estado del pago...',
  confirmed: '✅ Pago confirmado con éxito',
  failed: '❌ El pago falló',
  timeout: '⏰ Pago pendiente, revisa más tarde',
};

export default function PaymentScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { serviceId, paymentId } = route.params;

  const [state, setState] = useState<PaymentState>('idle');
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const pollPayment = () => {
    startTimeRef.current = Date.now();
    setState('polling');

    // Timeout after 5 minutes
    timeoutRef.current = setTimeout(() => {
      stopPolling();
      setState('timeout');
    }, TIMEOUT_MS);

    pollTimerRef.current = setInterval(async () => {
      try {
        const payment = await getPaymentStatus(serviceId);
        if (!payment) return;

        if (payment.status === 'CONFIRMED') {
          stopPolling();
          setState('confirmed');
        } else if (
          payment.status === 'FAILED' ||
          payment.status === 'CANCELLED'
        ) {
          stopPolling();
          setState('failed');
        }
        // else keep polling
      } catch {
        // ignore polling errors
      }
    }, POLL_INTERVAL);
  };

  const handlePay = async () => {
    setState('initiating');
    setError(null);
    try {
      const result = await initPayment(paymentId);
      if (!result.redirectUrl) {
        setError('No se pudo obtener la URL de pago');
        setState('idle');
        return;
      }

      // Open the MP sandbox in the system browser
      setState('browser');
      await WebBrowser.openBrowserAsync(result.redirectUrl);

      // Browser closed — start polling
      pollPayment();
    } catch (err: unknown) {
      const error = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      const msg =
        error?.response?.data?.message ??
        error?.message ??
        'Error al iniciar pago';
      setError(msg);
      setState('idle');
    }
  };

  const handleGoBack = () => {
    nav.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>Pago</Text>

        {state === 'idle' && (
          <>
            <Text style={styles.description}>
              Presiona "Pagar" para abrir MercadoPago y completar la
              transacción.
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity style={styles.button} onPress={handlePay}>
              <Text style={styles.buttonText}>Pagar</Text>
            </TouchableOpacity>
          </>
        )}

        {(state === 'initiating' ||
          state === 'browser' ||
          state === 'polling') && (
          <View style={styles.statusBox}>
            <ActivityIndicator size="large" color="#1a73e8" />
            <Text style={styles.statusText}>{STATUS_MSGS[state]}</Text>
          </View>
        )}

        {state === 'confirmed' && (
          <View style={styles.statusBox}>
            <Text style={styles.confirmedIcon}>✅</Text>
            <Text style={styles.statusText}>{STATUS_MSGS.confirmed}</Text>
            <TouchableOpacity style={styles.button} onPress={handleGoBack}>
              <Text style={styles.buttonText}>Volver</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'failed' && (
          <View style={styles.statusBox}>
            <Text style={styles.failedIcon}>❌</Text>
            <Text style={styles.statusText}>{STATUS_MSGS.failed}</Text>
            <TouchableOpacity style={styles.button} onPress={handlePay}>
              <Text style={styles.buttonText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'timeout' && (
          <View style={styles.statusBox}>
            <Text style={styles.timeoutIcon}>⏰</Text>
            <Text style={styles.statusText}>{STATUS_MSGS.timeout}</Text>
            <TouchableOpacity style={styles.button} onPress={handlePay}>
              <Text style={styles.buttonText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 16 },
  description: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
    lineHeight: 22,
  },
  error: { color: '#d32f2f', marginBottom: 12 },
  statusBox: { alignItems: 'center', gap: 16 },
  statusText: { fontSize: 18, color: '#333', textAlign: 'center' },
  confirmedIcon: { fontSize: 48, marginBottom: 8 },
  failedIcon: { fontSize: 48, marginBottom: 8 },
  timeoutIcon: { fontSize: 48, marginBottom: 8 },
  button: {
    backgroundColor: '#1a73e8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 200,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
