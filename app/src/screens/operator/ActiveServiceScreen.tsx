import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { updateServiceStatus } from '../../lib/apiServices';
import type { ServiceItem } from '../../stores/servicesStore';

export default function ActiveServiceScreen() {
  const [service, setService] = useState<ServiceItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  const fetchActive = useCallback(async () => {
    try {
      // For Demo simplicity: we fetch all services and find the ACTIVE one.
      // In MVP this would be a dedicated endpoint.
      const { listMyServices } = await import('../../lib/apiServices');
      const all = await listMyServices();
      const active = all.find((s) => s.status === 'ACTIVE') ?? null;
      setService(active);
    } catch {
      setService(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchActive();
    }, [fetchActive]),
  );

  const handleComplete = async () => {
    if (!service) return;
    setCompleting(true);
    try {
      await updateServiceStatus(service.id, 'COMPLETED');
      Alert.alert('Servicio completado', 'Gracias por tu trabajo.', [
        { text: 'OK', onPress: () => fetchActive() },
      ]);
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
      if (error?.response?.status === 409) {
        Alert.alert(
          'Pago pendiente',
          'El pago debe confirmarse antes de completar el servicio.',
        );
      } else {
        const msg =
          error?.response?.data?.message ??
          error?.message ??
          'Error al completar servicio';
        Alert.alert('Error', msg);
      }
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!service) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            No tienes un servicio activo en este momento.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>Servicio Activo</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Tipo</Text>
            <Text style={styles.value}>
              {service.type === 'BREAKDOWN' ? 'Avería' : 'Transfer'}
            </Text>
          </View>

          {service.description && (
            <View style={styles.row}>
              <Text style={styles.label}>Descripción</Text>
              <Text style={styles.value}>{service.description}</Text>
            </View>
          )}

          <View style={styles.row}>
            <Text style={styles.label}>Ubicación</Text>
            <Text style={styles.value}>
              {service.originLat.toFixed(4)}, {service.originLng.toFixed(4)}
            </Text>
          </View>

          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{service.status}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.completeBtn}
          onPress={handleComplete}
          disabled={completing}
        >
          {completing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.completeBtnText}>Marcar completado</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  inner: { flex: 1, padding: 24 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    color: '#888',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  value: { fontSize: 16, color: '#333' },
  statusBadge: {
    backgroundColor: '#4caf50',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
    marginTop: 8,
  },
  statusText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  completeBtn: {
    backgroundColor: '#1a73e8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 24,
  },
  completeBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  emptyText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
