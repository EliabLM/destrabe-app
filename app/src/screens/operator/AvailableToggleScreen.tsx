import React, { useState } from 'react';
import {
  View,
  Text,
  Switch,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { updateLocation } from '../../lib/apiOnboarding';

/**
 * Demo: toggle available + send mock location.
 * Real GPS deferred to MVP (per design doc).
 */
export default function AvailableToggleScreen() {
  const [available, setAvailable] = useState(false);
  const [toggling, setToggling] = useState(false);

  const handleToggle = async (value: boolean) => {
    setToggling(true);
    try {
      // Demo: mock lat/lng (Santiago centro)
      await updateLocation({
        lastLatitude: -33.4489,
        lastLongitude: -70.6693,
        available: value,
      });
      setAvailable(value);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } }; message?: string };
      const msg =
        error?.response?.data?.message ?? error?.message ?? 'Error al actualizar';
      Alert.alert('Error', msg);
    } finally {
      setToggling(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>Disponibilidad</Text>
        <Text style={styles.description}>
          Activa el interruptor para aparecer como disponible y recibir
          solicitudes de servicios cercanos.
        </Text>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>
              {available ? 'Disponible' : 'No disponible'}
            </Text>
            <Text style={styles.switchHint}>
              {available
                ? 'Recibirás notificaciones de servicios cercanos'
                : 'No aparecerás en la lista de operadores'}
            </Text>
          </View>
          <View style={styles.switchWrap}>
            {toggling ? (
              <ActivityIndicator size="small" color="#1a73e8" />
            ) : (
              <Switch
                value={available}
                onValueChange={handleToggle}
                trackColor={{ false: '#ccc', true: '#4caf50' }}
                thumbColor={available ? '#fff' : '#f4f3f4'}
              />
            )}
          </View>
        </View>

        <Text style={styles.note}>
          Demo: se usa una ubicación fija (Santiago centro). La geolocalización
          real se implementará en MVP.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 8 },
  description: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
    marginBottom: 32,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
  },
  switchLabel: { fontSize: 17, fontWeight: '600', marginBottom: 2 },
  switchHint: { fontSize: 13, color: '#888' },
  switchWrap: { marginLeft: 16 },
  note: {
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
    marginTop: 24,
    lineHeight: 18,
  },
});
