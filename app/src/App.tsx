import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { authStore } from './stores/authStore';
import { RootNavigator } from './navigation/RootStack';
import { loadEnv } from './lib/env';
import { EnvErrorScreen } from './screens/EnvErrorScreen';
import './lib/useMapbox';

export default function App() {
  const hydrated = authStore((s) => s.hydrated);
  const [envState] = useState(() => loadEnv());

  useEffect(() => {
    authStore.getState().hydrate();
  }, []);

  if (!envState.ok) {
    return (
      <SafeAreaProvider>
        <EnvErrorScreen message={envState.missing} />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
