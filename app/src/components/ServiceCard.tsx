import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ServiceItem } from '../stores/servicesStore';
import StatusBadge from './StatusBadge';

interface ServiceCardProps {
  service: ServiceItem;
  onPress: (service: ServiceItem) => void;
}

/** Reusable card for displaying a service in a list. */
export default function ServiceCard({ service, onPress }: ServiceCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(service)}>
      <View style={styles.header}>
        <Text style={styles.type}>
          {service.type === 'BREAKDOWN' ? 'Avería' : 'Transfer'}
        </Text>
        <StatusBadge status={service.status} />
      </View>

      {service.description && (
        <Text style={styles.desc} numberOfLines={2}>
          {service.description}
        </Text>
      )}

      <Text style={styles.coords}>
        {service.originLat.toFixed(4)}, {service.originLng.toFixed(4)}
      </Text>

      {service.createdAt && (
        <Text style={styles.date}>
          {new Date(service.createdAt).toLocaleDateString('es-CL')}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  type: { fontSize: 16, fontWeight: '600' },
  desc: { fontSize: 14, color: '#666', marginBottom: 4 },
  coords: { fontSize: 12, color: '#999', fontFamily: 'monospace', marginBottom: 2 },
  date: { fontSize: 12, color: '#bbb' },
});
