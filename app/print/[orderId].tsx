import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { TicketOutputScreen } from '../../src/components/domain/TicketOutputScreen';
import {
  SALE_TICKET_CREDIT_NOTE,
  SALE_TICKET_LEGAL_NAME,
  SALE_TICKET_RFC,
  getSaleTicketFolioPresentation,
} from '../../src/services/saleTicket';
import { openSaleTicketPdf } from '../../src/services/saleTicketPdf';
import { loadSaleTicketSnapshot } from '../../src/services/saleTicketStorage';
import { buildThermalTicketDocument } from '../../src/services/thermalTicketDocument';
import { spacing, radii } from '../../src/theme/tokens';
import { formatCurrency } from '../../src/utils/time';

export default function PrintTicketScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();

  return (
    <TicketOutputScreen
      title="Imprimir Ticket"
      resourceId={orderId}
      printActionLabel="Imprimir en MP210"
      pdfActionLabel="Abrir PDF"
      notFoundCopy={(resourceId) => (
        <Text style={styles.noticeText}>
          No se encontro el ticket local para el pedido #{resourceId ?? '---'}.
        </Text>
      )}
      loadSnapshot={loadSaleTicketSnapshot}
      openPdf={openSaleTicketPdf}
      buildThermalDocument={buildThermalTicketDocument}
      renderPreview={(ticket) => {
        const folioPresentation = getSaleTicketFolioPresentation(ticket);
        return (
          <View style={styles.ticketPreview}>
            <Text style={styles.ticketHeader}>GRUPO FRIO</Text>
            <Text style={styles.ticketLegalName}>{SALE_TICKET_LEGAL_NAME}</Text>
            <Text style={styles.ticketTaxId}>RFC: {SALE_TICKET_RFC}</Text>
            <View style={styles.divider} />
            <View style={styles.ticketRow}>
              <Text style={styles.ticketLabel}>Folio Odoo</Text>
              <Text style={styles.ticketValue}>{folioPresentation.odooFolio}</Text>
            </View>
            {folioPresentation.localReference !== null ? (
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Referencia local</Text>
                <Text style={styles.ticketValue}>{folioPresentation.localReference}</Text>
              </View>
            ) : null}
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
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  ticketPreview: {
    backgroundColor: '#FAFAFA',
    borderRadius: radii.button,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  ticketHeader: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', textAlign: 'center', marginBottom: 4 },
  ticketLegalName: { fontSize: 11, fontWeight: '700', color: '#1A1A1A', textAlign: 'center' },
  ticketTaxId: { fontSize: 11, color: '#666', textAlign: 'center', marginTop: 2, marginBottom: spacing.sm },
  divider: { height: 1, backgroundColor: '#E0E0E0', marginVertical: spacing.sm, borderStyle: 'dashed' },
  ticketRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  ticketLabel: { fontSize: 13, color: '#666' },
  ticketValue: { fontSize: 13, color: '#1A1A1A', fontWeight: '500' },
  ticketTotal: { fontSize: 16, color: '#1A1A1A', fontWeight: '700' },
  ticketLine: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 5 },
  creditNote: { fontSize: 11, color: '#1A1A1A', lineHeight: 16, textAlign: 'justify' },
  productName: { fontSize: 12, color: '#1A1A1A', fontWeight: '600' },
  productMeta: { fontSize: 11, color: '#666' },
  noticeText: { fontSize: 13, color: '#475569', lineHeight: 20 },
});
