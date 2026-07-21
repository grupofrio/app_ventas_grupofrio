import { SALE_TICKET_BRANDING } from './saleTicketBranding.ts';

export type SaleTicketPaymentMethod = 'cash' | 'credit' | 'transfer' | 'unknown';

export interface SaleTicketSourceLine {
  productId: number;
  productName: string;
  qty: number;
  price: number;
  weight: number;
}

export interface BuildSaleTicketSnapshotInput {
  saleId: string;
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
  weight: number;
}

export interface SaleTicketSnapshot {
  saleId: string;
  customerName: string;
  sellerName: string;
  paymentMethod: SaleTicketPaymentMethod;
  paymentLabel: string;
  createdAt: string;
  lines: SaleTicketLine[];
  subtotal: number;
  total: number;
  totalKg: number;
}

const SALE_TICKET_LOGO_DATA_URI = `data:image/png;base64,${SALE_TICKET_BRANDING.logoPngBase64}`;
export const SALE_TICKET_LEGAL_NAME = SALE_TICKET_BRANDING.legalName;
export const SALE_TICKET_RFC = SALE_TICKET_BRANDING.rfcLabel.replace(/^RFC:\s*/, '');
export const SALE_TICKET_DEFAULT_SELLER = 'Vendedor no especificado';
export const SALE_TICKET_CREDIT_NOTE =
  `Pagare: me obligo a cubrir a favor de Grupo Frio / ${SALE_TICKET_LEGAL_NAME}, RFC ${SALE_TICKET_RFC}, la cantidad total indicada en este ticket. Si no se cubre puntualmente, pagare intereses moratorios conforme a la politica vigente.`;

export function getSaleTicketStorageKey(saleId: string): string {
  return `sale-ticket:${saleId}`;
}

export function buildSaleTicketSnapshot(input: BuildSaleTicketSnapshotInput): SaleTicketSnapshot {
  const lines = input.lines.map((line) => ({
    productId: line.productId,
    productName: line.productName,
    qty: line.qty,
    unitPrice: line.price,
    lineTotal: line.qty * line.price,
    weight: line.weight,
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const totalKg = lines.reduce((sum, line) => sum + line.weight * line.qty, 0);

  return {
    saleId: input.saleId,
    customerName: input.customerName,
    sellerName: normalizeSellerName(input.sellerName),
    paymentMethod: input.paymentMethod,
    paymentLabel: input.paymentLabel?.trim() || getPaymentLabel(input.paymentMethod),
    createdAt: input.createdAt,
    lines,
    subtotal,
    total: subtotal,
    totalKg,
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

export function buildSaleTicketHtml(snapshot: SaleTicketSnapshot): string {
  const rows = snapshot.lines.map((line) => `
    <tr>
      <td class="item">
        <div class="name">${escapeHtml(line.productName)}</div>
        <div class="meta">${formatQuantity(line.qty)} x ${formatTicketCurrency(line.unitPrice)}</div>
      </td>
      <td class="amount">${formatTicketCurrency(line.lineTotal)}</td>
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
      padding: 4mm 0;
      color: #111111;
      background: #ffffff;
      font-family: monospace;
      font-size: 10px;
      line-height: 1.3;
    }
    .center {
      text-align: center;
    }
    .brand-logo {
      display: block;
      width: 38mm;
      max-width: 100%;
      height: auto;
      margin: 0 auto 3px;
    }
    .muted {
      color: #444444;
    }
    .legal-name {
      font-size: 9px;
      font-weight: 700;
      line-height: 1.2;
      margin-top: 2px;
    }
    .tax-id {
      font-size: 9px;
      line-height: 1.2;
      margin-top: 1px;
    }
    .credit-note {
      font-size: 8px;
      line-height: 1.25;
      text-align: justify;
    }
    .divider {
      border-top: 1px dashed #111111;
      margin: 6px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      margin: 2px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    td {
      padding: 3px 0;
      vertical-align: top;
    }
    .item {
      width: 70%;
      padding-right: 4px;
    }
    .name {
      font-weight: 700;
      word-break: break-word;
    }
    .meta {
      color: #444444;
      font-size: 9px;
    }
    .amount {
      text-align: right;
      white-space: nowrap;
      width: 30%;
    }
    .total {
      font-size: 13px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="center">
    <img class="brand-logo" src="${escapeHtml(SALE_TICKET_LOGO_DATA_URI)}" alt="Grupo Frio" />
    <div class="legal-name">${escapeHtml(SALE_TICKET_BRANDING.legalName)}</div>
    <div class="tax-id">${escapeHtml(SALE_TICKET_BRANDING.rfcLabel)}</div>
    <div class="muted">${escapeHtml(SALE_TICKET_BRANDING.title)}</div>
  </div>
  <div class="divider"></div>
  <div class="row"><span>Folio</span><span>${escapeHtml(snapshot.saleId)}</span></div>
  <div class="row"><span>Fecha</span><span>${escapeHtml(formatTicketDate(snapshot.createdAt))}</span></div>
  <div>Cliente:</div>
  <div><strong>${escapeHtml(snapshot.customerName)}</strong></div>
  <div class="row"><span>Vendedor</span><span>${escapeHtml(normalizeSellerName(snapshot.sellerName))}</span></div>
  <div class="row"><span>Pago</span><span>${escapeHtml(snapshot.paymentLabel)}</span></div>
  <div class="divider"></div>
  <table>${rows}</table>
  <div class="divider"></div>
  <div class="row"><span>Subtotal</span><span>${formatTicketCurrency(snapshot.subtotal)}</span></div>
  <div class="row"><span>Kg</span><span>${snapshot.totalKg.toFixed(1)} kg</span></div>
  <div class="row total"><span>Total</span><span>${formatTicketCurrency(snapshot.total)}</span></div>
  ${snapshot.paymentMethod === 'credit' ? `
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

function formatQuantity(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
}

function normalizeSellerName(value: string | undefined): string {
  const normalized = (value ?? '').trim();
  return normalized || SALE_TICKET_DEFAULT_SELLER;
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

function formatTicketCurrency(amount: number): string {
  const safe = typeof amount === 'number' && !Number.isNaN(amount) ? amount : 0;
  return `$${safe.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTicketDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
