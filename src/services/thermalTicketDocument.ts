import type { SaleTicketSnapshot } from './saleTicket.ts';
import {
  SALE_TICKET_CREDIT_NOTE,
  getSaleTicketFolioPresentation,
} from './saleTicket.ts';
import { SALE_TICKET_BRANDING } from './saleTicketBranding.ts';
import {
  formatQuantityAndUnitPrice,
  formatTicketCurrency,
  formatTicketDate,
  formatTotalKg,
  normalizeSellerName,
} from './saleTicketFormatting.ts';
import type { ThermalTicketDocument } from './thermalPrinterTypes.ts';
import { PENDING_PRICE_CONFIRMATION_LABEL } from './salePricePresentation.ts';

export type { ThermalTicketDocument } from './thermalPrinterTypes.ts';

export function buildThermalTicketDocument(
  snapshot: SaleTicketSnapshot,
): ThermalTicketDocument {
  const folioPresentation = getSaleTicketFolioPresentation(snapshot);

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
    folio: folioPresentation.odooFolio,
    ...(folioPresentation.localReference === null
      ? {}
      : { localReference: folioPresentation.localReference }),
    formattedDate: formatTicketDate(snapshot.createdAt),
    customerName: snapshot.customerName,
    sellerName: normalizeSellerName(snapshot.sellerName),
    paymentLabel: snapshot.paymentLabel,
    lines: snapshot.lines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      quantityAndUnitPrice: line.priceConfirmation === 'pending_confirmation'
        ? `${line.qty} pza · ${PENDING_PRICE_CONFIRMATION_LABEL}`
        : formatQuantityAndUnitPrice(line.qty, line.unitPrice),
      lineTotal: line.priceConfirmation === 'pending_confirmation'
        ? PENDING_PRICE_CONFIRMATION_LABEL
        : formatTicketCurrency(line.lineTotal),
    })),
    subtotal: snapshot.priceConfirmationPending
      ? PENDING_PRICE_CONFIRMATION_LABEL
      : formatTicketCurrency(snapshot.subtotal),
    totalKg: formatTotalKg(snapshot.totalKg),
    total: snapshot.priceConfirmationPending
      ? PENDING_PRICE_CONFIRMATION_LABEL
      : formatTicketCurrency(snapshot.total),
    ...(snapshot.paymentMethod === 'credit' && !snapshot.priceConfirmationPending
      ? { creditNote: SALE_TICKET_CREDIT_NOTE }
      : {}),
  };
}
