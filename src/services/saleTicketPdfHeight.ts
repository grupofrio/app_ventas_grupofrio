import type { SaleTicketSnapshot } from './saleTicket.ts';
import { SALE_TICKET_CREDIT_NOTE } from './saleTicket.ts';
import {
  formatQuantityAndUnitPrice,
  formatTicketCurrency,
  formatTotalKg,
  normalizeSellerName,
} from './saleTicketFormatting.ts';

const BASE_TICKET_HEIGHT_POINTS = 330;
const LINE_HEIGHT_POINTS = 58;
const CREDIT_NOTE_HEIGHT_POINTS = 90;
const ESTIMATED_CHARS_PER_LINE = 26;
const EXTRA_WRAPPED_ROW_HEIGHT_POINTS = 18;

export function getSaleTicketPdfHeight(snapshot: SaleTicketSnapshot): number {
  const variableFields = [
    snapshot.customerName,
    normalizeSellerName(snapshot.sellerName),
    ...snapshot.lines.flatMap((line) => [
      line.productName,
      formatQuantityAndUnitPrice(line.qty, line.unitPrice),
      formatTicketCurrency(line.lineTotal),
    ]),
    formatTicketCurrency(snapshot.subtotal),
    formatTotalKg(snapshot.totalKg),
    formatTicketCurrency(snapshot.total),
    ...(snapshot.paymentMethod === 'credit' ? [SALE_TICKET_CREDIT_NOTE] : []),
  ];
  const extraWrappedRows = variableFields.reduce(
    (total, value) => total + Math.max(1, Math.ceil(value.length / ESTIMATED_CHARS_PER_LINE)) - 1,
    0,
  );
  const creditNoteHeight = snapshot.paymentMethod === 'credit' ? CREDIT_NOTE_HEIGHT_POINTS : 0;
  return BASE_TICKET_HEIGHT_POINTS
    + snapshot.lines.length * LINE_HEIGHT_POINTS
    + extraWrappedRows * EXTRA_WRAPPED_ROW_HEIGHT_POINTS
    + creditNoteHeight;
}
