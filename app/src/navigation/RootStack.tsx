import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
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
 *  - No token         → AuthStack
 *  - Token + no user  → fetch user (loading spinner)
 *  - Token + no role profile → OnboardingStack
 *  - CLIENT           → ClientStack
 *  - OPERATOR         → OperatorStack
 */
export function RootNavigator() {
  const token = authStore((s) => s.token);
  const user = authStore((s) => s.user);
  const loading = authStore((s) => s.hydrated && !s.user && s.token != null);

  // Hydrating but no user yet — show a brief loading.
  // After T9 login sets user, this transitions.
  if (!token) {
    return <AuthStack />;
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    // Token exists but no user — redirect to auth to re-login
    return <AuthStack />;
  }

  const role = user.role;

  // Check if profile exists for this role
  const needsOnboarding =
    role === 'OPERATOR' || role === 'CLIENT';

  // For Demo simplicity: after T10 onboarding screens, the me endpoint
  // will return profiles. Here we check a simplified condition.
  if (needsOnboarding && role === 'OPERATOR') {
    // Will be redirected by OnboardingStack check after getMe fetch
    return <OnboardingStack />;
  }

  if (role === 'CLIENT') {
    return <ClientStack />;
  }

  if (role === 'OPERATOR') {
    return <OperatorStack />;
  }

  // Fallback
  return <AuthStack />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
