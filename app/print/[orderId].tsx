/**
 * Print Ticket screen — Print receipt for a completed order.
 * Note: Bluetooth printer (ESC/POS) requires a custom dev client.
 */

import React from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { loadSaleTicketSnapshot } from '../../src/services/saleTicketStorage';
import {
  SALE_TICKET_CREDIT_NOTE,
  SALE_TICKET_LEGAL_NAME,
  SALE_TICKET_RFC,
  SaleTicketSnapshot,
} from '../../src/services/saleTicket';
import { openSaleTicketPdf } from '../../src/services/saleTicketPdf';
import { formatCurrency } from '../../src/utils/time';

export default function PrintTicketScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [ticket, setTicket] = React.useState<SaleTicketSnapshot | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isOpening, setIsOpening] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    async function loadTicket() {
      setIsLoading(true);
      const snapshot = orderId ? await loadSaleTicketSnapshot(orderId) : null;
      if (mounted) {
        setTicket(snapshot);
        setIsLoading(false);
      }
    }

    void loadTicket();
    return () => {
      mounted = false;
    };
  }, [orderId]);

  async function handleOpenPdf() {
    if (!ticket) return;
    setIsOpening(true);
    try {
      await openSaleTicketPdf(ticket);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo abrir el PDF del ticket.';
      Alert.alert('Ticket PDF', message);
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TopBar title="Imprimir Ticket" showBack />
      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Cargando ticket...</Text>
          </View>
        ) : ticket ? (
          <>
            <View style={styles.ticketPreview}>
              <Text style={styles.ticketHeader}>GRUPO FRIO</Text>
              <Text style={styles.ticketLegalName}>{SALE_TICKET_LEGAL_NAME}</Text>
              <Text style={styles.ticketTaxId}>RFC: {SALE_TICKET_RFC}</Text>
              <View style={styles.divider} />
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Pedido</Text>
                <Text style={styles.ticketValue}>#{ticket.saleId}</Text>
              </View>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Cliente</Text>
                <Text style={styles.ticketValue}>{ticket.customerName}</Text>
              </View>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Vendedor</Text>
                <Text style={styles.ticketValue}>{ticket.sellerName}</Text>
              </View>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Pago</Text>
                <Text style={styles.ticketValue}>{ticket.paymentLabel}</Text>
              </View>
              <View style={styles.divider} />
              {ticket.lines.map((line) => (
                <View key={line.productId} style={styles.ticketLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{line.productName}</Text>
                    <Text style={styles.productMeta}>
                      {line.qty} x {formatCurrency(line.unitPrice)}
                    </Text>
                  </View>
                  <Text style={styles.ticketValue}>{formatCurrency(line.lineTotal)}</Text>
                </View>
              ))}
              <View style={styles.divider} />
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Kg</Text>
                <Text style={styles.ticketValue}>{ticket.totalKg.toFixed(1)} kg</Text>
              </View>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Total</Text>
                <Text style={styles.ticketTotal}>{formatCurrency(ticket.total)}</Text>
              </View>
              {ticket.paymentMethod === 'credit' ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.creditNote}>{SALE_TICKET_CREDIT_NOTE}</Text>
                </>
              ) : null}
            </View>

            <Button
              label="Abrir PDF"
              onPress={handleOpenPdf}
              loading={isOpening}
              fullWidth
              style={{ marginBottom: spacing.lg }}
            />
          </>
        ) : (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Ticket no encontrado</Text>
            <Text style={styles.noticeText}>
              No se encontro el ticket local para el pedido #{orderId ?? '---'}.
            </Text>
          </View>
        )}

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Impresion Bluetooth</Text>
          <Text style={styles.noticeText}>
            El PDF se abre con el visor del sistema. Desde ahi puedes elegir
            imprimir con una impresora Bluetooth compatible con tu dispositivo.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    padding: spacing.lg,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  ticketPreview: {
    backgroundColor: '#FAFAFA',
    borderRadius: radii.button,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  ticketHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 4,
  },
  ticketLegalName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
  },
  ticketTaxId: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: spacing.sm,
    borderStyle: 'dashed',
  },
  ticketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  ticketLabel: {
    fontSize: 13,
    color: '#666',
  },
  ticketValue: {
    fontSize: 13,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  ticketTotal: {
    fontSize: 16,
    color: '#1A1A1A',
    fontWeight: '700',
  },
  ticketLine: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 5,
  },
  creditNote: {
    fontSize: 11,
    color: '#1A1A1A',
    lineHeight: 16,
    textAlign: 'justify',
  },
  productName: {
    fontSize: 12,
    color: '#1A1A1A',
    fontWeight: '600',
  },
  productMeta: {
    fontSize: 11,
    color: '#666',
  },
  notice: {
    backgroundColor: 'rgba(37,99,235,0.08)',
    borderRadius: radii.button,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  noticeText: {
    fontSize: 13,
    color: colors.textDim,
    lineHeight: 20,
  },
});
