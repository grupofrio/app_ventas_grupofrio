import type { ExchangeTicketSnapshot } from './exchangeTicket.ts';
import { SALE_TICKET_BRANDING } from './saleTicketBranding.ts';
import { formatQuantity, formatTicketDate } from './saleTicketFormatting.ts';
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
      title: EXCHANGE_TICKET_TITLE,
      footer: SALE_TICKET_BRANDING.footer,
    },
    folio: snapshot.folio,
    formattedDate: formatTicketDate(snapshot.createdAt),
    customerName: snapshot.customerName,
    sellerName: 'No aplica',
    paymentLabel: 'No aplica',
    lines: [
      ...snapshot.deliveryLines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantityAndUnitPrice: formatQuantity(line.qty),
        lineTotal: 'No aplica',
        sectionLabel: 'ENTREGA' as const,
      })),
      ...snapshot.mermaLines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantityAndUnitPrice: formatQuantity(line.qty),
        lineTotal: 'No aplica',
        sectionLabel: 'MERMA' as const,
      })),
    ],
    subtotal: '—',
    totalKg: '—',
    total: 'No aplica',
    exchangeNotes: snapshot.notes,
  };
}
