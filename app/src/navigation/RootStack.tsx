import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { authStore } from '../stores/authStore';
import { AuthStack } from './AuthStack';
import { OnboardingStack } from './OnboardingStack';
import { ClientStack } from './ClientStack';
import { OperatorStack } from './OperatorStack';

function LoadingScreen() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
    </View>
  );
}

/**
 * RootNavigator conditionally renders the correct stack
 * based on authStore state:
 *  - No token              → AuthStack
 *  - Token + no user       → loading
 *  - Token + user + no profile → OnboardingStack
 *  - CLIENT (profile ready) → ClientStack
 *  - OPERATOR (profile ready) → OperatorStack
 */
export function RootNavigator() {
  const token = authStore((s) => s.token);
  const user = authStore((s) => s.user);
  const profileReady = authStore((s) => s.profileReady);
  const loading = authStore((s) => s.hydrated && s.token != null && !s.user);

  if (!token) {
    return <AuthStack />;
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <AuthStack />;
  }

  if (!profileReady) {
    return <OnboardingStack />;
  }

  if (user.role === 'CLIENT') {
    return <ClientStack />;
  }

  if (user.role === 'OPERATOR') {
    return <OperatorStack />;
  }

  return <AuthStack />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
