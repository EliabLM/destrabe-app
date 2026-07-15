import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface StatusBadgeProps {
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#f57c00',
  QUOTED: '#1a73e8',
  ACTIVE: '#4caf50',
  COMPLETED: '#9e9e9e',
  CANCELLED: '#d32f2f',
};

/**
 * Small coloured badge showing a service/quote status.
 */
export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: STATUS_COLORS[status] ?? '#999' },
      ]}
    >
      <Text style={styles.text}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  text: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
