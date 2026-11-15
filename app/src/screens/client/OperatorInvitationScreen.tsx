import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  redeemAndRefreshOperator,
  refreshOperatorFromServer,
} from '../../lib/operatorInvitation';

/** El token solo vive en memoria del componente, se limpia al salir o tras cualquier intento. */
export default function OperatorInvitationScreen() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const navigation = useNavigation();
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => setToken(''));
    return () => {
      unsubscribe();
      setToken('');
    };
  }, [navigation]);

  const submit = async () => {
    const value = token.trim();
    setToken('');
    setBusy(true);
    try {
      await redeemAndRefreshOperator(value);
      // RootNavigator muestra el perfil operador, no se cambia el rol desde UI.
    } catch {
      Alert.alert(
        'No se pudo completar',
        'Verifica tu invitación o intenta actualizar el estado.',
      );
    } finally {
      setBusy(false);
    }
  };
  const sync = async () => {
    setToken('');
    setBusy(true);
    try {
      await refreshOperatorFromServer();
    } catch {
      Alert.alert(
        'Sin confirmación',
        'Sigue como cliente; intenta de nuevo cuando vuelva la conexión.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.container}>
      <Text>
        Para ser operador necesitas una invitación enviada por un administrador
        a tu teléfono verificado.
      </Text>
      <TextInput
        accessibilityLabel="Token de invitación"
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="Token de invitación"
        editable={!busy}
        style={styles.input}
      />
      {busy ? (
        <ActivityIndicator />
      ) : (
        <Button
          title="Canjear invitación"
          onPress={() => void submit()}
          disabled={!/^[0-9a-f]{64}$/.test(token.trim())}
        />
      )}
      <Button
        title="Actualizar estado tras un canje"
        onPress={() => void sync()}
        disabled={busy}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 24, gap: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
});
