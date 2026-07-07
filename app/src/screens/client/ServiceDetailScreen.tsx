import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type {
  ClientStackParamList,
} from '../../navigation/ClientStack';
import { getService, updateServiceStatus } from '../../lib/apiServices';
import { listQuotes, acceptQuote } from '../../lib/apiQuotes';
import type { QuoteItem } from '../../lib/apiQuotes';
import type { ServiceItem } from '../../stores/servicesStore';

type Nav = NativeStackNavigationProp<ClientStackParamList, 'ServiceDetail'>;
type Route = RouteProp<ClientStackParamList, 'ServiceDetail'>;

export default function ServiceDetailScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { serviceId } = route.params;

  const [service, setService] = useState<ServiceItem | null>(null);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const shouldPoll =
    service?.status === 'PENDING' || service?.status === 'QUOTED';

  const fetchServiceAndQuotes = useCallback(async () => {
    try {
      const [svc, qs] = await Promise.all([
        getService(serviceId),
        listQuotes(serviceId),
      ]);
      setService(svc);
      setQuotes(qs);
    } catch {
      // silently ignore polling errors
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  // Initial fetch
  useEffect(() => {
    fetchServiceAndQuotes();
  }, [fetchServiceAndQuotes]);

  // Polling every 5s while service is PENDING or QUOTED
  useEffect(() => {
    if (shouldPoll) {
      pollingRef.current = setInterval(() => {
        fetchServiceAndQuotes();
      }, 5000);
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [shouldPoll, fetchServiceAndQuotes]);

  const handleAccept = async (quoteId: string) => {
    setAcceptingId(quoteId);
    try {
      await acceptQuote(quoteId);
      Alert.alert('¡Cotización aceptada!', 'El operador está en camino.', [
        { text: 'OK', onPress: () => nav.goBack() },
      ]);
    } catch (err: any) {
      if (err?.response?.status === 409) {
        Alert.alert(
          'Ya no disponible',
          'El servicio ya no está disponible para aceptar cotizaciones.',
          [{ text: 'OK', onPress: () => fetchServiceAndQuotes() }],
        );
      } else {
        Alert.alert('Error', err?.message ?? 'Error al aceptar cotización');
      }
    } finally {
      setAcceptingId(null);
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
          <Text style={styles.emptyText}>Servicio no encontrado</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.serviceType}>
          {service.type === 'BREAKDOWN' ? 'Avería' : 'Transfer'}
        </Text>
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.badge,
              {
                backgroundColor:
                  service.status === 'ACTIVE'
                    ? '#4caf50'
                    : service.status === 'COMPLETED'
                      ? '#9e9e9e'
                      : '#1a73e8',
              },
            ]}
          >
            <Text style={styles.badgeText}>{service.status}</Text>
          </View>
        </View>
      </View>

      {service.description && (
        <Text style={styles.desc}>{service.description}</Text>
      )}

      <Text style={styles.sectionTitle}>Cotizaciones</Text>

      {quotes.length === 0 && shouldPoll && (
        <View style={styles.pollingBox}>
          <ActivityIndicator size="small" color="#1a73e8" />
          <Text style={styles.pollingText}>
            Esperando cotizaciones de operadores...
          </Text>
        </View>
      )}

      <FlatList
        data={quotes}
        renderItem={({ item }) => (
          <View style={styles.quoteCard}>
            <View style={styles.quoteRow}>
              <Text style={styles.quoteAmount}>
                ${item.amount.toLocaleString('es-CL')}
              </Text>
              {item.estimatedMinutes && (
                <Text style={styles.quoteTime}>
                  ~{item.estimatedMinutes} min
                </Text>
              )}
            </View>
            {item.operator && (
              <Text style={styles.quoteOperator}>
                {item.operator.truckType} · {item.operator.licensePlate}
                {item.operator.rating != null
                  ? ` · ⭐ ${item.operator.rating.toFixed(1)}`
                  : ''}
              </Text>
            )}
            {item.note && (
              <Text style={styles.quoteNote}>{item.note}</Text>
            )}
            {service.status === 'QUOTED' && (
              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={() => handleAccept(item.id)}
                disabled={acceptingId === item.id}
              >
                {acceptingId === item.id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.acceptBtnText}>Aceptar</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !shouldPoll ? (
            <Text style={styles.emptyText}>Sin cotizaciones</Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  serviceType: { fontSize: 20, fontWeight: 'bold' },
  badgeRow: { flexDirection: 'row' },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  desc: { padding: 16, fontSize: 15, color: '#555', backgroundColor: '#fff' },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    padding: 16,
    paddingBottom: 8,
    color: '#333',
  },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  quoteCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  quoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  quoteAmount: { fontSize: 22, fontWeight: 'bold', color: '#1a73e8' },
  quoteTime: { fontSize: 14, color: '#666' },
  quoteOperator: { fontSize: 13, color: '#555', marginBottom: 4 },
  quoteNote: { fontSize: 13, color: '#888', fontStyle: 'italic', marginBottom: 8 },
  acceptBtn: {
    backgroundColor: '#4caf50',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  acceptBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  pollingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  pollingText: { fontSize: 14, color: '#666' },
  emptyText: { fontSize: 15, color: '#999', textAlign: 'center', marginTop: 24 },
});
