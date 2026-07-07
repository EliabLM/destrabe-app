import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createService } from '../../lib/apiServices';
import type { ClientStackParamList } from '../../navigation/ClientStack';

type Nav = NativeStackNavigationProp<ClientStackParamList, 'NewService'>;

type ServiceType = 'BREAKDOWN' | 'TRANSFER';

export default function NewServiceScreen() {
  const nav = useNavigation<Nav>();
  const [type, setType] = useState<ServiceType>('BREAKDOWN');
  const [description, setDescription] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [originLat, setOriginLat] = useState('');
  const [originLng, setOriginLng] = useState('');
  const [destLat, setDestLat] = useState('');
  const [destLng, setDestLng] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    originLat.trim().length > 0 &&
    originLng.trim().length > 0 &&
    (type !== 'TRANSFER' ||
      (destLat.trim().length > 0 && destLng.trim().length > 0));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await createService({
        type,
        originLat: parseFloat(originLat),
        originLng: parseFloat(originLng),
        destLat: type === 'TRANSFER' ? parseFloat(destLat) : undefined,
        destLng: type === 'TRANSFER' ? parseFloat(destLng) : undefined,
        description: description.trim() || undefined,
        photoUrl: photoUrl.trim() || undefined,
      });
      nav.goBack();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? err?.message ?? 'Error al crear servicio';
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
          <Text style={styles.title}>Nuevo Servicio</Text>

          {/* Type picker */}
          <Text style={styles.label}>Tipo de servicio</Text>
          <View style={styles.typeRow}>
            <TouchableOpacity
              style={[
                styles.typeBtn,
                type === 'BREAKDOWN' && styles.typeBtnActive,
              ]}
              onPress={() => setType('BREAKDOWN')}
            >
              <Text
                style={[
                  styles.typeBtnText,
                  type === 'BREAKDOWN' && styles.typeBtnTextActive,
                ]}
              >
                Avería
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.typeBtn,
                type === 'TRANSFER' && styles.typeBtnActive,
              ]}
              onPress={() => setType('TRANSFER')}
            >
              <Text
                style={[
                  styles.typeBtnText,
                  type === 'TRANSFER' && styles.typeBtnTextActive,
                ]}
              >
                Transfer
              </Text>
            </TouchableOpacity>
          </View>

          {/* Origin — TextInput fallback (MapboxPicker in T13) */}
          <Text style={styles.label}>Origen *</Text>
          <Text style={styles.hint}>
            Ingresa las coordenadas del lugar donde necesitas asistencia.
          </Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <TextInput
                style={styles.input}
                placeholder="Latitud"
                value={originLat}
                onChangeText={setOriginLat}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <TextInput
                style={styles.input}
                placeholder="Longitud"
                value={originLng}
                onChangeText={setOriginLng}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          {/* Destination — only for TRANSFER */}
          {type === 'TRANSFER' && (
            <>
              <Text style={styles.label}>Destino *</Text>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={styles.input}
                    placeholder="Latitud"
                    value={destLat}
                    onChangeText={setDestLat}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={styles.input}
                    placeholder="Longitud"
                    value={destLng}
                    onChangeText={setDestLng}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </>
          )}

          <Text style={styles.label}>Descripción</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe el problema..."
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>Foto (URL)</Text>
          <TextInput
            style={styles.input}
            placeholder="https://..."
            value={photoUrl}
            onChangeText={setPhotoUrl}
            keyboardType="url"
            autoCapitalize="none"
          />

          <TouchableOpacity
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Solicitar</Text>
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
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 4, color: '#333' },
  hint: { fontSize: 13, color: '#999', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: '#fafafa',
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', marginBottom: 8 },
  typeRow: { flexDirection: 'row', marginBottom: 20, gap: 12 },
  typeBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  typeBtnActive: {
    backgroundColor: '#1a73e8',
    borderColor: '#1a73e8',
  },
  typeBtnText: { fontSize: 16, color: '#333', fontWeight: '500' },
  typeBtnTextActive: { color: '#fff' },
  button: {
    backgroundColor: '#1a73e8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
