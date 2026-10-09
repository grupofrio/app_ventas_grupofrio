import type { ExchangeTicketSnapshot } from './exchangeTicket.ts';
import { SALE_TICKET_BRANDING } from './saleTicketBranding.ts';
import { formatQuantity, formatTicketDate, normalizeSellerName } from './saleTicketFormatting.ts';
import type { ThermalTicketDocument } from './thermalPrinterTypes.ts';

const EXCHANGE_TICKET_TITLE = 'TICKET DE CAMBIO';

export function buildExchangeThermalTicketDocument(
  snapshot: ExchangeTicketSnapshot,
): ThermalTicketDocument {
  return {
    schemaVersion: 1,
    ticketKind: 'exchange',
    branding: {
      logoPngBase64: SALE_TICKET_BRANDING.logoPngBase64,
      logoVersion: SALE_TICKET_BRANDING.version,
      legalName: SALE_TICKET_BRANDING.legalName,
      rfcLabel: SALE_TICKET_BRANDING.rfcLabel,
      title: snapshot.operationStatus === 'pending'
        ? `${EXCHANGE_TICKET_TITLE} - PENDIENTE`
        : `${EXCHANGE_TICKET_TITLE} - CONFIRMADO`,
      footer: SALE_TICKET_BRANDING.footer,
    },
    folio: snapshot.folio,
    formattedDate: formatTicketDate(snapshot.createdAt),
    customerName: snapshot.customerName,
    sellerName: normalizeSellerName(snapshot.sellerName),
    ...((snapshot.unitLabel ?? '').trim() ? { unitLabel: snapshot.unitLabel.trim() } : {}),
    ...((snapshot.stopLabel ?? '').trim() ? { stopLabel: snapshot.stopLabel.trim() } : {}),
    paymentLabel: 'No aplica',
    lines: [
      ...snapshot.deliveryLines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantityAndUnitPrice: `Cantidad: ${formatQuantity(line.qty)}`,
        lineTotal: '—',
        sectionLabel: 'ENTREGA' as const,
      })),
      ...snapshot.mermaLines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantityAndUnitPrice: `Cantidad: ${formatQuantity(line.qty)}`,
        lineTotal: '—',
        sectionLabel: 'MERMA' as const,
      })),
    ],
    subtotal: '—',
    totalKg: '—',
    total: 'No aplica',
    exchangeNotes: snapshot.notes,
  };
}
