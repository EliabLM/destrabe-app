import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createOperatorProfile } from '../../lib/apiOnboarding';
import { authStore } from '../../stores/authStore';

export default function OperatorProfileScreen() {
  const [truckType, setTruckType] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [available, setAvailable] = useState(false);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    truckType.trim().length > 0 && licensePlate.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await createOperatorProfile({
        truckType: truckType.trim(),
        licensePlate: licensePlate.trim(),
        photoUrl: photoUrl.trim() || undefined,
        available,
        lastLatitude: latitude ? parseFloat(latitude) : undefined,
        lastLongitude: longitude ? parseFloat(longitude) : undefined,
      });
      // Profile created → RootStack re-renders to OperatorStack
      authStore.setState({ profileReady: true });
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.message ??
        'Error al crear perfil';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Perfil de Operador</Text>
          <Text style={styles.subtitle}>
            Completa los datos de tu vehículo para comenzar.
          </Text>

          <Text style={styles.label}>Tipo de vehículo *</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej. Camión plano, Grúa, etc."
            value={truckType}
            onChangeText={setTruckType}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Patente *</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej. ABC123"
            value={licensePlate}
            onChangeText={setLicensePlate}
            autoCapitalize="characters"
          />

          <Text style={styles.label}>Foto del vehículo (URL)</Text>
          <TextInput
            style={styles.input}
            placeholder="https://..."
            value={photoUrl}
            onChangeText={setPhotoUrl}
            keyboardType="url"
            autoCapitalize="none"
          />

          <View style={styles.switchRow}>
            <Text style={styles.label}>Disponible</Text>
            <Switch
              value={available}
              onValueChange={setAvailable}
              trackColor={{ false: '#ccc', true: '#4caf50' }}
            />
          </View>

          <Text style={styles.sectionTitle}>Ubicación (opcional)</Text>
          <Text style={styles.hint}>
            Ingresa tus coordenadas actuales para aparecer en servicios
            cercanos.
          </Text>

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Latitud</Text>
              <TextInput
                style={styles.input}
                placeholder="-33.456"
                value={latitude}
                onChangeText={setLatitude}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Longitud</Text>
              <TextInput
                style={styles.input}
                placeholder="-70.648"
                value={longitude}
                onChangeText={setLongitude}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Crear perfil</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 4, color: '#333' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: '#fafafa',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 8,
    color: '#333',
  },
  hint: { fontSize: 13, color: '#999', marginBottom: 12 },
  row: { flexDirection: 'row', marginBottom: 8 },
  button: {
    backgroundColor: '#1a73e8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
