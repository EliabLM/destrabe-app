import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getNearbyServices } from '../../lib/apiServices';
import { createQuote } from '../../lib/apiQuotes';
import type { ServiceItem } from '../../stores/servicesStore';

const MOCK_LAT = -33.4489;
const MOCK_LNG = -70.6693;

export default function NearbyServicesScreen() {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(
    null,
  );
  const [amount, setAmount] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [note, setNote] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNearby = useCallback(async () => {
    try {
      const data = await getNearbyServices(MOCK_LAT, MOCK_LNG, 5);
      setServices(data);
    } catch {
      // ignore polling errors
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling every 10s
  useEffect(() => {
    fetchNearby();
    pollingRef.current = setInterval(fetchNearby, 10000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchNearby]);

  const handleCreateQuote = async () => {
    if (!selectedService || !amount) return;
    setQuoteLoading(true);
    try {
      await createQuote(selectedService.id, {
        amount: parseFloat(amount),
        estimatedMinutes: estimatedMinutes
          ? parseInt(estimatedMinutes, 10)
          : undefined,
        note: note.trim() || undefined,
      });
      setSelectedService(null);
      setAmount('');
      setEstimatedMinutes('');
      setNote('');
      Alert.alert('Cotización enviada', 'El cliente podrá ver tu propuesta.');
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.message ??
        'Error al crear cotización';
      Alert.alert('Error', msg);
    } finally {
      setQuoteLoading(false);
    }
  };

  const renderService = ({ item }: { item: ServiceItem }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        setSelectedService(item);
        setAmount('');
        setEstimatedMinutes('');
        setNote('');
      }}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardType}>
          {item.type === 'BREAKDOWN' ? 'Avería' : 'Transfer'}
        </Text>
        <Text style={styles.cardStatus}>{item.status}</Text>
      </View>
      {item.description && (
        <Text style={styles.cardDesc} numberOfLines={2}>
          {item.description}
        </Text>
      )}
      <Text style={styles.cardCoords}>
        {item.originLat.toFixed(4)}, {item.originLng.toFixed(4)}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Servicios Cercanos</Text>
      <Text style={styles.subtitle}>
        Servicios PENDING en tu área (actualizado cada 10s)
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={services}
          renderItem={renderService}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                No hay servicios cercanos en este momento
              </Text>
            </View>
          }
        />
      )}

      {/* Quote creation modal */}
      <Modal
        visible={selectedService != null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedService(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Cotizar Servicio</Text>

            <TextInput
              style={styles.input}
              placeholder="Monto *"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />

            <TextInput
              style={styles.input}
              placeholder="Minutos estimados"
              value={estimatedMinutes}
              onChangeText={setEstimatedMinutes}
              keyboardType="number-pad"
            />

            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Nota (opcional)"
              value={note}
              onChangeText={setNote}
              multiline
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setSelectedService(null)}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  !amount && styles.submitBtnDisabled,
                ]}
                onPress={handleCreateQuote}
                disabled={!amount || quoteLoading}
              >
                {quoteLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Cotizar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', padding: 16, paddingBottom: 4 },
  subtitle: {
    fontSize: 13,
    color: '#888',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardType: { fontSize: 16, fontWeight: '600' },
  cardStatus: { fontSize: 12, color: '#f57c00', fontWeight: '600' },
  cardDesc: { fontSize: 14, color: '#666', marginBottom: 4 },
  cardCoords: { fontSize: 12, color: '#999', fontFamily: 'monospace' },
  emptyText: { fontSize: 15, color: '#999', textAlign: 'center', marginTop: 40 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 20 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: '#fafafa',
  },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 16, color: '#666' },
  submitBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#1a73e8',
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
