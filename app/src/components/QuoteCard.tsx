import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { QuoteItem } from '../lib/apiQuotes';

interface QuoteCardProps {
  quote: QuoteItem;
  serviceStatus: string;
  onAccept?: (quoteId: string) => void;
  accepting?: boolean;
}

/** Reusable card for displaying a quote with accept action. */
export default function QuoteCard({
  quote,
  serviceStatus,
  onAccept,
  accepting,
}: QuoteCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.amount}>
          ${quote.amount.toLocaleString('es-CL')}
        </Text>
        {quote.estimatedMinutes && (
          <Text style={styles.time}>~{quote.estimatedMinutes} min</Text>
        )}
      </View>

      {quote.operator && (
        <Text style={styles.operatorInfo}>
          {quote.operator.truckType} · {quote.operator.licensePlate}
          {quote.operator.rating != null
            ? ` · ⭐ ${quote.operator.rating.toFixed(1)}`
            : ''}
        </Text>
      )}

      {quote.note && <Text style={styles.note}>{quote.note}</Text>}

      {serviceStatus === 'QUOTED' && onAccept && (
        <TouchableOpacity
          style={styles.acceptBtn}
          onPress={() => onAccept(quote.id)}
          disabled={accepting}
        >
          <Text style={styles.acceptBtnText}>
            {accepting ? 'Aceptando...' : 'Aceptar'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  amount: { fontSize: 22, fontWeight: 'bold', color: '#1a73e8' },
  time: { fontSize: 14, color: '#666' },
  operatorInfo: { fontSize: 13, color: '#555', marginBottom: 4 },
  note: { fontSize: 13, color: '#888', fontStyle: 'italic', marginBottom: 8 },
  acceptBtn: {
    backgroundColor: '#4caf50',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  acceptBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
