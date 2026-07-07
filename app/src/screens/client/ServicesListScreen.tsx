import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { listMyServices } from '../../lib/apiServices';
import type { ServiceItem } from '../../stores/servicesStore';
import type { ClientStackParamList } from '../../navigation/ClientStack';

type Nav = NativeStackNavigationProp<ClientStackParamList, 'ServicesList'>;

export default function ServicesListScreen() {
  const nav = useNavigation<Nav>();
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchServices = useCallback(async () => {
    try {
      const data = await listMyServices();
      setServices(data);
    } catch {
      // silently fail — user can pull-to-refresh
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh on focus so returning from detail/creation shows latest
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchServices();
    }, [fetchServices]),
  );

  const statusColor: Record<string, string> = {
    PENDING: '#f57c00',
    QUOTED: '#1a73e8',
    ACTIVE: '#4caf50',
    COMPLETED: '#9e9e9e',
    CANCELLED: '#d32f2f',
  };

  const renderItem = ({ item }: { item: ServiceItem }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => nav.navigate('ServiceDetail', { serviceId: item.id })}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardType}>
          {item.type === 'BREAKDOWN' ? 'Avería' : 'Transfer'}
        </Text>
        <View
          style={[
            styles.badge,
            { backgroundColor: statusColor[item.status] ?? '#999' },
          ]}
        >
          <Text style={styles.badgeText}>{item.status}</Text>
        </View>
      </View>
      {item.description && (
        <Text style={styles.cardDesc} numberOfLines={2}>
          {item.description}
        </Text>
      )}
      <Text style={styles.cardDate}>
        {item.createdAt
          ? new Date(item.createdAt).toLocaleDateString('es-CL')
          : ''}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={services}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchServices();
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>Aún no tienes servicios</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => nav.navigate('NewService')}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 80 },
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
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  cardDesc: { fontSize: 14, color: '#666', marginBottom: 4 },
  cardDate: { fontSize: 12, color: '#999' },
  emptyText: { fontSize: 16, color: '#999' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1a73e8',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 30 },
});
