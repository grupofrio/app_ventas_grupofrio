import longSaleData from '../../fixtures/mp210-long-sale-ticket.json' with { type: 'json' };

import { SALE_TICKET_BRANDING } from './saleTicketBranding.ts';
import type { ThermalTicketDocument } from './thermalPrinterTypes.ts';

export function buildLongSaleThermalTicketFixture(): ThermalTicketDocument {
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
    folio: longSaleData.folio,
    formattedDate: longSaleData.formattedDate,
    customerName: longSaleData.customerName,
    sellerName: longSaleData.sellerName,
    paymentLabel: longSaleData.paymentLabel,
    lines: longSaleData.lines.map((line) => ({ ...line })),
    subtotal: longSaleData.subtotal,
    totalKg: longSaleData.totalKg,
    total: longSaleData.total,
    creditNote: longSaleData.creditNote,
  };
}
