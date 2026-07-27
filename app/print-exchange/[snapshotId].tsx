import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { TicketOutputScreen } from '../../src/components/domain/TicketOutputScreen';
import type { ExchangeTicketSnapshot } from '../../src/services/exchangeTicket';
import { loadExchangeTicketSnapshot } from '../../src/services/exchangeTicketStorage';
import { openExchangeTicketPdf } from '../../src/services/exchangeTicketPdf';
import { buildExchangeThermalTicketDocument } from '../../src/services/exchangeThermalTicketDocument';
import { SALE_TICKET_LEGAL_NAME, SALE_TICKET_RFC } from '../../src/services/saleTicket';
import { formatTicketDate } from '../../src/services/saleTicketFormatting';
import { spacing, radii } from '../../src/theme/tokens';

const EXCHANGE_TITLE = 'TICKET DE CAMBIO';

function renderSection(
  title: string,
  lines: ExchangeTicketSnapshot['deliveryLines'],
) {
  if (lines.length === 0) return null;

  return (
    <>
      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>{title}</Text>
      {lines.map((line) => (
        <View key={`${title}-${line.productId}`} style={styles.ticketLine}>
          <Text style={styles.productName}>{line.productName}</Text>
          <Text style={styles.productMeta}>{line.qty}</Text>
        </View>
      ))}
    </>
  );
}

export default function PrintExchangeTicketScreen() {
  const { snapshotId } = useLocalSearchParams<{ snapshotId: string }>();

  return (
    <TicketOutputScreen
      title="Imprimir Ticket de Cambio"
      resourceId={snapshotId}
      showOutputActionsWhenMissing
      notFoundCopy={(resourceId) => (
        <Text style={styles.noticeText}>
          No se encontro el ticket local para el cambio {resourceId ?? '---'}.
        </Text>
      )}
      loadSnapshot={loadExchangeTicketSnapshot}
      openPdf={openExchangeTicketPdf}
      buildThermalDocument={buildExchangeThermalTicketDocument}
      renderPreview={(ticket) => (
        <View style={styles.ticketPreview}>
          <Text style={styles.ticketHeader}>Grupo Frio</Text>
          <Text style={styles.ticketLegalName}>{SALE_TICKET_LEGAL_NAME}</Text>
          <Text style={styles.ticketTaxId}>RFC: {SALE_TICKET_RFC}</Text>
          <Text style={styles.ticketTitle}>{EXCHANGE_TITLE}</Text>
          <View style={styles.divider} />
          <View style={styles.ticketRow}>
            <Text style={styles.ticketLabel}>Folio</Text>
            <Text style={styles.ticketValue}>{ticket.folio}</Text>
          </View>
          <View style={styles.ticketRow}>
            <Text style={styles.ticketLabel}>Cliente</Text>
            <Text style={styles.ticketValue}>{ticket.customerName}</Text>
          </View>
          <View style={styles.ticketRow}>
            <Text style={styles.ticketLabel}>Fecha</Text>
            <Text style={styles.ticketValue}>{formatTicketDate(ticket.createdAt)}</Text>
          </View>
          {renderSection('Entrega', ticket.deliveryLines)}
          {renderSection('Merma', ticket.mermaLines)}
          {ticket.notes ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionTitle}>Notas</Text>
              <Text style={styles.notesValue}>{ticket.notes}</Text>
            </>
          ) : null}
        </View>
      )}
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
  },
  ticketTitle: {
    fontSize: 12,
    color: '#1A1A1A',
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.sm,
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
    paddingVertical: 4,
  },
  ticketLabel: {
    fontSize: 13,
    color: '#666',
  },
  ticketValue: {
    flex: 1,
    fontSize: 13,
    color: '#1A1A1A',
    fontWeight: '500',
    textAlign: 'right',
  },
  sectionTitle: {
    fontSize: 12,
    color: '#1A1A1A',
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  ticketLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  productName: {
    flex: 1,
    fontSize: 12,
    color: '#1A1A1A',
    fontWeight: '600',
  },
  productMeta: {
    fontSize: 12,
    color: '#666',
  },
  notesValue: {
    fontSize: 12,
    color: '#1A1A1A',
    lineHeight: 18,
  },
  noticeText: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 20,
  },
});
