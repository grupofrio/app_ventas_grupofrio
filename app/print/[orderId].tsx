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
import { SALE_TICKET_BRANDING } from '../../src/services/saleTicketBranding';
import { openSaleTicketPdf } from '../../src/services/saleTicketPdf';
import { loadSaleTicketSnapshot } from '../../src/services/saleTicketStorage';
import { buildThermalTicketDocument } from '../../src/services/thermalTicketDocument';
import { spacing, radii } from '../../src/theme/tokens';
import {
  formatQuantityAndUnitPrice,
  formatTicketCurrency,
  formatTicketDate,
  formatTotalKg,
} from '../../src/services/saleTicketFormatting';

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
            <Text style={styles.ticketTitle}>{SALE_TICKET_BRANDING.title}</Text>
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
              <Text style={styles.ticketLabel}>Fecha</Text>
              <Text style={styles.ticketValue}>{formatTicketDate(ticket.createdAt)}</Text>
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
                <View style={styles.ticketProductBlock}>
                  <Text style={styles.productName}>{line.productName}</Text>
                  <View style={styles.ticketProductMetaRow}>
                    <Text style={styles.productMeta}>
                      {formatQuantityAndUnitPrice(line.qty, line.unitPrice)}
                    </Text>
                    <Text style={styles.ticketAmount}>{formatTicketCurrency(line.lineTotal)}</Text>
                  </View>
                </View>
              </View>
            ))}
            <View style={styles.divider} />
            <View style={styles.ticketRow}>
              <Text style={styles.ticketLabel}>Subtotal</Text>
              <Text style={styles.ticketValue}>{formatTicketCurrency(ticket.subtotal)}</Text>
            </View>
            <View style={styles.ticketRow}>
              <Text style={styles.ticketLabel}>Kg</Text>
              <Text style={styles.ticketValue}>{formatTotalKg(ticket.totalKg)}</Text>
            </View>
            <View style={styles.ticketRow}>
              <Text style={styles.ticketLabel}>Total</Text>
              <Text style={styles.ticketTotal}>{formatTicketCurrency(ticket.total)}</Text>
            </View>
            {ticket.paymentMethod === 'credit' ? (
              <>
                <View style={styles.divider} />
                <Text style={styles.creditNote}>{SALE_TICKET_CREDIT_NOTE}</Text>
              </>
            ) : null}
            <View style={styles.divider} />
            <Text style={styles.ticketFooter}>{SALE_TICKET_BRANDING.footer}</Text>
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
  ticketHeader: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 4,
  },
  ticketLegalName: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
  },
  ticketTaxId: {
    fontSize: 14,
    lineHeight: 19,
    color: '#666',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  ticketTitle: {
    fontSize: 16,
    lineHeight: 22,
    color: '#1A1A1A',
    textAlign: 'center',
    marginTop: 4,
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
    gap: spacing.sm,
    paddingVertical: 6,
  },
  ticketLabel: {
    fontSize: 14,
    lineHeight: 19,
    color: '#666',
    fontWeight: '700',
  },
  ticketValue: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 22,
    color: '#1A1A1A',
    fontWeight: '500',
    textAlign: 'right',
  },
  ticketTotal: {
    fontSize: 22,
    lineHeight: 28,
    color: '#1A1A1A',
    fontWeight: '700',
  },
  ticketLine: {
    paddingVertical: 8,
  },
  ticketProductBlock: {
    width: '100%',
  },
  ticketProductMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: 4,
  },
  ticketAmount: {
    flex: 0.35,
    fontSize: 16,
    lineHeight: 22,
    color: '#1A1A1A',
    textAlign: 'right',
    flexWrap: 'wrap',
  },
  creditNote: {
    fontSize: 14,
    lineHeight: 19,
    color: '#1A1A1A',
    textAlign: 'justify',
  },
  productName: {
    fontSize: 16,
    lineHeight: 21,
    color: '#1A1A1A',
    fontWeight: '600',
    flexWrap: 'wrap',
  },
  productMeta: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: '#666',
    flexWrap: 'wrap',
  },
  ticketFooter: {
    fontSize: 14,
    lineHeight: 19,
    color: '#666',
    textAlign: 'center',
  },
  noticeText: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 20,
  },
});
