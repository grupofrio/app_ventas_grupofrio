import { SALE_TICKET_BRANDING } from './saleTicketBranding.ts';
import {
  formatQuantityAndUnitPrice,
  formatTicketCurrency,
  formatTicketDate,
  formatTotalKg,
  normalizeSellerName,
} from './saleTicketFormatting.ts';
import type { SalePriceConfirmation } from './salePriceConfirmation.ts';
import {
  PENDING_PRICE_CONFIRMATION_LABEL,
  hasPendingSalePriceConfirmation,
} from './salePricePresentation.ts';

export { SALE_TICKET_DEFAULT_SELLER } from './saleTicketFormatting.ts';

export type SaleTicketPaymentMethod = 'cash' | 'credit' | 'transfer' | 'unknown';

export interface SaleTicketSourceLine {
  productId: number;
  productName: string;
  qty: number;
  price: number;
  priceConfirmation?: SalePriceConfirmation;
  weight: number;
}

export interface BuildSaleTicketSnapshotInput {
  saleId: string;
  odooFolio?: string | null;
  customerName: string;
  sellerName?: string;
  paymentMethod: SaleTicketPaymentMethod;
  paymentLabel?: string;
  createdAt: string;
  lines: SaleTicketSourceLine[];
}

export interface SaleTicketOrderSource {
  id: number;
  name: string;
  operation_id: string;
  partner_name: string;
  amount_total: number;
  kg_total: number;
  confirmation_date: string;
  date_order: string;
  payment_method?: string;
  payment_method_label?: string;
  employee_name?: string;
  lines?: SaleTicketOrderLineSource[];
}

export interface SaleTicketOrderLineSource {
  product_id: number;
  product_name: string;
  quantity: number;
  price_unit: number;
  price_subtotal: number;
  kg_total?: number;
  weight?: number;
}

export interface SaleTicketLine {
  productId: number;
  productName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  priceConfirmation?: SalePriceConfirmation;
  weight: number;
}

export interface SaleTicketSnapshot {
  saleId: string;
  odooFolio: string | null;
  customerName: string;
  sellerName: string;
  paymentMethod: SaleTicketPaymentMethod;
  paymentLabel: string;
  createdAt: string;
  lines: SaleTicketLine[];
  subtotal: number;
  total: number;
  totalKg: number;
  /** True until Odoo returns the authoritative order totals. */
  priceConfirmationPending?: boolean;
}

const SALE_TICKET_LOGO_DATA_URI = `data:image/png;base64,${SALE_TICKET_BRANDING.logoPngBase64}`;
export const ODOO_FOLIO_PENDING_LABEL = 'Pendiente por sincronizar';
export const SALE_TICKET_LEGAL_NAME = SALE_TICKET_BRANDING.legalName;
export const SALE_TICKET_RFC = SALE_TICKET_BRANDING.rfcLabel.replace(/^RFC:\s*/, '');
export const SALE_TICKET_CREDIT_NOTE =
  `Pagare: me obligo a cubrir a favor de Grupo Frio / ${SALE_TICKET_LEGAL_NAME}, RFC ${SALE_TICKET_RFC}, la cantidad total indicada en este ticket. Si no se cubre puntualmente, pagare intereses moratorios conforme a la politica vigente.`;

export function getSaleTicketStorageKey(saleId: string): string {
  return `sale-ticket:${saleId}`;
}

export function normalizeOdooFolio(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function withSaleTicketOdooFolio(
  snapshot: SaleTicketSnapshot,
  value: unknown,
): SaleTicketSnapshot {
  const odooFolio = normalizeOdooFolio(value);
  return odooFolio === null ? snapshot : { ...snapshot, odooFolio };
}

/** Apply only an explicit server-side payment decision to a local ticket. */
export function withSaleTicketServerPayment(
  snapshot: SaleTicketSnapshot,
  input: { paymentMethod: unknown; reviewRequired: unknown },
): SaleTicketSnapshot {
  if (input.paymentMethod !== 'cash' && input.paymentMethod !== 'credit') return snapshot;
  const reviewRequired = input.reviewRequired === true;
  const paymentLabel = input.paymentMethod === 'credit'
    ? (reviewRequired ? 'Crédito · revisar' : 'Crédito')
    : (reviewRequired ? 'Contado · revisar' : 'Efectivo');
  return {
    ...snapshot,
    paymentMethod: input.paymentMethod,
    paymentLabel,
  };
}

export function getSaleTicketFolioPresentation(snapshot: SaleTicketSnapshot): {
  odooFolio: string;
  localReference: string | null;
} {
  const odooFolio = normalizeOdooFolio(snapshot.odooFolio);
  return odooFolio === null
    ? { odooFolio: ODOO_FOLIO_PENDING_LABEL, localReference: snapshot.saleId }
    : { odooFolio, localReference: null };
}

export function buildSaleTicketSnapshot(input: BuildSaleTicketSnapshotInput): SaleTicketSnapshot {
  const lines = input.lines.map((line) => ({
    productId: line.productId,
    productName: line.productName,
    qty: line.qty,
    unitPrice: line.price,
    lineTotal: line.qty * line.price,
    ...(line.priceConfirmation ? { priceConfirmation: line.priceConfirmation } : {}),
    weight: line.weight,
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const totalKg = lines.reduce((sum, line) => sum + line.weight * line.qty, 0);

  return {
    saleId: input.saleId,
    odooFolio: normalizeOdooFolio(input.odooFolio),
    customerName: input.customerName,
    sellerName: normalizeSellerName(input.sellerName),
    paymentMethod: input.paymentMethod,
    paymentLabel: input.paymentLabel?.trim() || getPaymentLabel(input.paymentMethod),
    createdAt: input.createdAt,
    lines,
    subtotal,
    total: subtotal,
    totalKg,
    priceConfirmationPending: hasPendingSalePriceConfirmation(lines),
  };
}

export function buildSaleTicketSnapshotFromOrder(order: SaleTicketOrderSource): SaleTicketSnapshot {
  const saleId = order.operation_id.trim() || `odoo-order-${order.id}`;
  const orderName = order.name.trim() || `#${order.id}`;
  const customerName = order.partner_name.trim() || 'Cliente sin nombre';
  const sellerName = normalizeSellerName(order.employee_name);
  const createdAt = order.confirmation_date.trim() || order.date_order.trim() || new Date().toISOString();
  const paymentMethod = normalizePaymentMethod(order.payment_method);
  const paymentLabel = order.payment_method_label?.trim() || getPaymentLabel(paymentMethod);
  const orderLines = Array.isArray(order.lines)
    ? order.lines.filter((line) => line.quantity > 0)
    : [];

  if (orderLines.length > 0) {
    const totalQty = orderLines.reduce((sum, line) => sum + line.quantity, 0);
    const fallbackUnitWeight = totalQty > 0 ? order.kg_total / totalQty : 0;
    const snapshot = buildSaleTicketSnapshot({
      saleId,
      odooFolio: order.name,
      customerName,
      sellerName,
      paymentMethod,
      paymentLabel,
      createdAt,
      lines: orderLines.map((line) => {
        const unitPrice = line.price_unit || (line.price_subtotal / line.quantity);
        const unitWeight = typeof line.weight === 'number'
          ? line.weight
          : typeof line.kg_total === 'number' && line.quantity > 0
            ? line.kg_total / line.quantity
            : fallbackUnitWeight;

        return {
          productId: line.product_id,
          productName: line.product_name || `Producto ${line.product_id}`,
          qty: line.quantity,
          price: unitPrice,
          weight: unitWeight,
        };
      }),
    });

    return {
      ...snapshot,
      totalKg: order.kg_total || snapshot.totalKg,
    };
  }

  return buildSaleTicketSnapshot({
    saleId,
    odooFolio: order.name,
    customerName,
    sellerName,
    paymentMethod,
    paymentLabel,
    createdAt,
    lines: [{
      productId: order.id,
      productName: `Venta ${orderName}`,
      qty: 1,
      price: order.amount_total,
      weight: order.kg_total,
    }],
  });
}

export function mergeSaleTicketFromOrder(
  current: SaleTicketSnapshot | null,
  order: SaleTicketOrderSource,
): SaleTicketSnapshot {
  const authoritative = buildSaleTicketSnapshotFromOrder(order);
  if (!current) return authoritative;

  const employeeName = order.employee_name?.trim();
  return {
    ...current,
    odooFolio: authoritative.odooFolio ?? current.odooFolio,
    sellerName: employeeName || current.sellerName,
  };
}

export function buildSaleTicketHtml(snapshot: SaleTicketSnapshot): string {
  const folioPresentation = getSaleTicketFolioPresentation(snapshot);
  const rows = snapshot.lines.map((line) => `
    <tr>
      <td class="product" colspan="2">
        <div class="name">${escapeHtml(line.productName)}</div>
        <div class="product-detail">
          ${line.priceConfirmation === 'pending_confirmation'
            ? `<span class="meta">${line.qty} pza · ${PENDING_PRICE_CONFIRMATION_LABEL}</span>`
            : `<span class="meta">${formatQuantityAndUnitPrice(line.qty, line.unitPrice)}</span>
          <span class="amount">${formatTicketCurrency(line.lineTotal)}</span>`}
        </div>
      </td>
    </tr>
  `).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page {
      size: 58mm auto;
      margin: 0;
    }
    * {
      box-sizing: border-box;
    }
    body {
      width: 58mm;
      margin: 0;
      padding: 8px 0;
      color: #111111;
      background: #ffffff;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 14px;
      line-height: 19px;
    }
    .center {
      text-align: center;
    }
    .brand-logo {
      display: block;
      width: 38mm;
      max-width: 100%;
      height: auto;
      margin: 0 auto 8px;
    }
    .muted {
      color: #444444;
    }
    .legal-name {
      font-size: 12px;
      font-weight: 700;
      line-height: 17px;
    }
    .tax-id {
      font-size: 12px;
      line-height: 17px;
      margin-top: 2px;
    }
    .ticket-title {
      font-size: 14px;
      line-height: 19px;
      margin-top: 4px;
    }
    .credit-note {
      font-size: 12px;
      line-height: 17px;
      text-align: justify;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .divider {
      border-top: 1px dashed #111111;
      margin: 8px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 4px 0;
    }
    .row > span:first-child {
      font-size: 12px;
      line-height: 17px;
      font-weight: 700;
      flex: 0 0 auto;
    }
    .row > span:last-child {
      font-size: 14px;
      line-height: 19px;
      text-align: right;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    td {
      padding: 5px 0;
      vertical-align: top;
    }
    .product {
      width: 100%;
    }
    .name {
      font-size: 15px;
      line-height: 20px;
      font-weight: 700;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .product-detail {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 3px;
    }
    .meta {
      color: #444444;
      font-size: 12px;
      line-height: 17px;
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .amount {
      font-size: 15px;
      line-height: 20px;
      text-align: right;
      flex: 0 0 35%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .total {
      font-size: 20px;
      line-height: 26px;
      font-weight: 700;
    }
    .total > span {
      font-size: 20px;
      line-height: 26px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="center">
    <img class="brand-logo" src="${escapeHtml(SALE_TICKET_LOGO_DATA_URI)}" alt="Grupo Frio" />
    <div class="legal-name">${escapeHtml(SALE_TICKET_BRANDING.legalName)}</div>
    <div class="tax-id">${escapeHtml(SALE_TICKET_BRANDING.rfcLabel)}</div>
    <div class="ticket-title">${escapeHtml(SALE_TICKET_BRANDING.title)}</div>
  </div>
  <div class="divider"></div>
  <div class="row"><span>Folio Odoo</span><span>${escapeHtml(folioPresentation.odooFolio)}</span></div>
  ${folioPresentation.localReference === null
    ? ''
    : `<div class="row"><span>Referencia local</span><span>${escapeHtml(folioPresentation.localReference)}</span></div>`}
  <div class="row"><span>Fecha</span><span>${escapeHtml(formatTicketDate(snapshot.createdAt))}</span></div>
  <div class="row"><span>Cliente</span><span><strong>${escapeHtml(snapshot.customerName)}</strong></span></div>
  <div class="row"><span>Vendedor</span><span>${escapeHtml(normalizeSellerName(snapshot.sellerName))}</span></div>
  <div class="row"><span>Pago</span><span>${escapeHtml(snapshot.paymentLabel)}</span></div>
  <div class="divider"></div>
  <table>${rows}</table>
  <div class="divider"></div>
  <div class="row"><span>Subtotal</span><span>${snapshot.priceConfirmationPending ? PENDING_PRICE_CONFIRMATION_LABEL : formatTicketCurrency(snapshot.subtotal)}</span></div>
  <div class="row"><span>Kg</span><span>${formatTotalKg(snapshot.totalKg)}</span></div>
  <div class="row total"><span>Total</span><span>${snapshot.priceConfirmationPending ? PENDING_PRICE_CONFIRMATION_LABEL : formatTicketCurrency(snapshot.total)}</span></div>
  ${snapshot.paymentMethod === 'credit' && !snapshot.priceConfirmationPending ? `
  <div class="divider"></div>
  <div class="credit-note">${escapeHtml(SALE_TICKET_CREDIT_NOTE)}</div>
  ` : ''}
  <div class="divider"></div>
  <div class="center muted">${escapeHtml(SALE_TICKET_BRANDING.footer)}</div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPaymentLabel(paymentMethod: SaleTicketPaymentMethod): string {
  if (paymentMethod === 'cash') return 'Efectivo';
  if (paymentMethod === 'credit') return 'Credito';
  if (paymentMethod === 'transfer') return 'Transferencia';
  return 'No especificado';
}

function normalizePaymentMethod(value: string | undefined): SaleTicketPaymentMethod {
  const normalized = (value ?? '').trim().toLowerCase();
  if (['cash', 'efectivo', 'contado'].includes(normalized)) return 'cash';
  if (['credit', 'credito', 'crédito'].includes(normalized)) return 'credit';
  if (['transfer', 'transferencia', 'bank_transfer'].includes(normalized)) return 'transfer';
  return 'unknown';
}
