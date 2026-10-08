/**
 * Reprint list for cambios. Ventas only projects sale orders; confirmed and
 * pending exchange tickets live in the local snapshot index.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { colors, radii, spacing } from '../src/theme/tokens';
import { fonts, typography } from '../src/theme/typography';
import { formatTicketDate } from '../src/services/saleTicketFormatting';
import { listExchangeTicketSnapshots } from '../src/services/exchangeTicketStorage';
import type { ExchangeTicketSnapshot } from '../src/services/exchangeTicket';

export default function ExchangesScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<ExchangeTicketSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      setTickets(await listExchangeTicketSnapshots());
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadTickets();
  }, [loadTickets]));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Cambios" showBack />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {loading ? (
          <Text style={styles.emptyText}>Cargando cambios…</Text>
        ) : tickets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Todavía no hay cambios para reimprimir</Text>
            <Text style={styles.emptyText}>
              Cuando registres un cambio, el ticket queda aquí para imprimirlo de nuevo.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {tickets.map((ticket) => {
              const pending = ticket.operationStatus === 'pending';
              return (
                <TouchableOpacity
                  key={ticket.snapshotId}
                  style={styles.card}
                  accessibilityRole="button"
                  accessibilityLabel={`Reimprimir cambio ${ticket.folio}`}
                  onPress={() => router.push(`/print-exchange/${ticket.snapshotId}` as never)}
                >
                  <View style={styles.row}>
                    <Text style={styles.folio}>{ticket.folio}</Text>
                    <Text style={[styles.status, pending ? styles.statusPending : styles.statusConfirmed]}>
                      {pending ? 'Pendiente de sincronizar' : 'Confirmado'}
                    </Text>
                  </View>
                  <Text style={styles.customer}>{ticket.customerName}</Text>
                  <Text style={styles.meta}>{formatTicketDate(ticket.createdAt)}</Text>
                  <Text style={styles.hint}>Toca para reimprimir</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  list: { gap: 8 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
  },
  folio: { ...typography.body, fontFamily: fonts.bodyBold, fontWeight: '700', flex: 1 },
  status: { ...typography.dimSmall, fontFamily: fonts.bodyBold, fontWeight: '700' },
  statusPending: { color: colors.warning },
  statusConfirmed: { color: colors.success },
  customer: { ...typography.body, marginTop: 4 },
  meta: { ...typography.dim, marginTop: 2 },
  hint: {
    ...typography.dimSmall,
    color: colors.primary,
    fontFamily: fonts.bodyBold,
    fontWeight: '700',
    marginTop: 8,
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 20,
    alignItems: 'center',
  },
  emptyTitle: {
    ...typography.body,
    fontFamily: fonts.bodyBold,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyText: {
    ...typography.dim,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
});
