import type { SaleTicketSnapshot } from './saleTicket.ts';
import { SALE_TICKET_CREDIT_NOTE } from './saleTicket.ts';
import { SALE_TICKET_BRANDING } from './saleTicketBranding.ts';
import {
  formatQuantity,
  formatTicketCurrency,
  formatTicketDate,
  normalizeSellerName,
} from './saleTicketFormatting.ts';
import type { ThermalTicketDocument } from './thermalPrinterTypes.ts';

export type { ThermalTicketDocument } from './thermalPrinterTypes.ts';

export function buildThermalTicketDocument(
  snapshot: SaleTicketSnapshot,
): ThermalTicketDocument {
  return {
    schemaVersion: 1,
    branding: {
      logoPngBase64: SALE_TICKET_BRANDING.logoPngBase64,
      logoVersion: SALE_TICKET_BRANDING.version,
      legalName: SALE_TICKET_BRANDING.legalName,
      rfcLabel: SALE_TICKET_BRANDING.rfcLabel,
      title: SALE_TICKET_BRANDING.title,
      footer: SALE_TICKET_BRANDING.footer,
    },
    folio: snapshot.saleId,
    formattedDate: formatTicketDate(snapshot.createdAt),
    customerName: snapshot.customerName,
    sellerName: normalizeSellerName(snapshot.sellerName),
    paymentLabel: snapshot.paymentLabel,
    lines: snapshot.lines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      quantityAndUnitPrice: `${formatQuantity(line.qty)} x ${formatTicketCurrency(line.unitPrice)}`,
      lineTotal: formatTicketCurrency(line.lineTotal),
    })),
    subtotal: formatTicketCurrency(snapshot.subtotal),
    totalKg: `${snapshot.totalKg.toFixed(1)} kg`,
    total: formatTicketCurrency(snapshot.total),
    ...(snapshot.paymentMethod === 'credit'
      ? { creditNote: SALE_TICKET_CREDIT_NOTE }
      : {}),
  };
}
