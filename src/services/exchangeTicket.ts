import { SALE_TICKET_BRANDING } from './saleTicketBranding.ts';
import { formatQuantity, formatTicketDate } from './saleTicketFormatting.ts';

export interface ExchangeTicketSourceLine {
  productId: number;
  productName?: string;
  qty: number;
}

export interface ExchangeTicketLine {
  productId: number;
  productName: string;
  qty: number;
}

export interface BuildExchangeTicketSnapshotInput {
  snapshotId: string;
  exchangeName: string;
  exchangeId: number | null;
  customerName: string;
  createdAt: string;
  deliveryLines: ExchangeTicketSourceLine[];
  mermaLines: ExchangeTicketSourceLine[];
  notes?: string | null;
  operationStatus?: 'pending' | 'confirmed';
}

export interface ExchangeTicketSnapshot {
  snapshotId: string;
  folio: string;
  exchangeName: string;
  exchangeId: number | null;
  customerName: string;
  createdAt: string;
  deliveryLines: ExchangeTicketLine[];
  mermaLines: ExchangeTicketLine[];
  notes: string;
  operationStatus: 'pending' | 'confirmed';
}

const EXCHANGE_TICKET_TITLE = 'TICKET DE CAMBIO';

export function getExchangeTicketStorageKey(snapshotId: string): string {
  return `exchange-ticket:${snapshotId}`;
}

export function buildExchangeTicketSnapshot(
  input: BuildExchangeTicketSnapshotInput,
): ExchangeTicketSnapshot {
  const exchangeName = normalizeExchangeName(input.exchangeName);
  const exchangeId = typeof input.exchangeId === 'number' && Number.isFinite(input.exchangeId)
    ? input.exchangeId
    : null;

  return {
    snapshotId: input.snapshotId,
    folio: buildVisibleFolio(input.snapshotId, exchangeName, exchangeId),
    exchangeName,
    exchangeId,
    customerName: normalizeCustomerName(input.customerName),
    createdAt: input.createdAt,
    deliveryLines: normalizeLines(input.deliveryLines),
    mermaLines: normalizeLines(input.mermaLines),
    notes: normalizeNotes(input.notes),
    operationStatus: input.operationStatus
      ?? (exchangeName.toUpperCase().startsWith('PENDIENTE/') ? 'pending' : 'confirmed'),
  };
}

export function buildExchangeTicketHtml(snapshot: ExchangeTicketSnapshot): string {
  const deliverySection = buildSection('PRODUCTO ENTREGADO', snapshot.deliveryLines);
  const mermaSection = buildSection('PRODUCTO RECOGIDO / MERMA', snapshot.mermaLines);
  const notesSection = snapshot.notes
    ? `<div class="notes"><strong>Notas:</strong> ${escapeHtml(snapshot.notes)}</div>`
    : '';
  const statusLabel = snapshot.operationStatus === 'pending'
    ? 'PENDIENTE DE SINCRONIZACIÓN'
    : 'CONFIRMADO POR ODOO';
  const footerMessage = snapshot.operationStatus === 'pending'
    ? 'Cambio pendiente; no repetir la operación'
    : 'Cambio registrado correctamente';

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
    .muted {
      color: #444444;
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
    .section-title {
      font-weight: 700;
      margin: 2px 0 4px;
    }
    .line {
      margin: 1px 0;
      word-break: break-word;
    }
    .line-name {
      font-weight: 700;
    }
    .line-qty {
      color: #444444;
    }
    .notes {
      margin-top: 4px;
      word-break: break-word;
    }
    .success {
      text-align: center;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="center">
    <img class="brand-logo" src="${escapeHtml(`data:image/png;base64,${SALE_TICKET_BRANDING.logoPngBase64}`)}" alt="Grupo Frio" />
    <div class="legal-name">${escapeHtml(SALE_TICKET_BRANDING.legalName)}</div>
    <div class="tax-id">${escapeHtml(SALE_TICKET_BRANDING.rfcLabel)}</div>
    <div class="muted">${escapeHtml(EXCHANGE_TICKET_TITLE)}</div>
  </div>
  <div class="divider"></div>
  <div class="row"><span>Folio</span><span>${escapeHtml(snapshot.folio)}</span></div>
  <div class="row"><span>Fecha</span><span>${escapeHtml(formatTicketDate(snapshot.createdAt))}</span></div>
  <div class="row"><span>Estado</span><span>${escapeHtml(statusLabel)}</span></div>
  <div>Cliente:</div>
  <div><strong>${escapeHtml(snapshot.customerName)}</strong></div>
  <div class="divider"></div>
  ${deliverySection}
  ${mermaSection}
  ${notesSection}
  <div class="divider"></div>
  <div class="success">${escapeHtml(footerMessage)}</div>
</body>
</html>`;
}

/**
 * "Nuevo" is the placeholder Odoo returns when the CAM sequence is missing.
 * A real folio (CAM/2026/xxxxx, or any other non-placeholder name) wins.
 */
export function isPlaceholderExchangeName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.toLowerCase() === 'nuevo';
}

export function buildVisibleFolio(
  snapshotId: string,
  exchangeName: string,
  exchangeId: number | null,
): string {
  const trimmedName = exchangeName.trim();
  if (!isPlaceholderExchangeName(trimmedName)) return trimmedName;
  if (exchangeId !== null && Number.isFinite(exchangeId) && exchangeId > 0) {
    return `CAMBIO-${exchangeId}`;
  }
  return `CAMBIO-${snapshotId.slice(0, 8)}`;
}

function isReusableExchangeName(value: string): boolean {
  const trimmed = value.trim();
  if (isPlaceholderExchangeName(trimmed)) return false;
  return !trimmed.toUpperCase().startsWith('PENDIENTE/');
}

/**
 * Recompute the visible folio from the name and id already stored.
 * Older tickets saved the placeholder "Nuevo" as the folio itself.
 */
export function refreshExchangeTicketFolio(snapshot: ExchangeTicketSnapshot): ExchangeTicketSnapshot {
  const folio = buildVisibleFolio(snapshot.snapshotId, snapshot.exchangeName, snapshot.exchangeId);
  if (folio === snapshot.folio) return snapshot;
  return { ...snapshot, folio };
}

/**
 * A later server response can replace a local reference. A replay that still
 * says "Nuevo" must not erase a real folio already stored on the ticket.
 */
export function applyExchangeServerIdentity(
  snapshot: ExchangeTicketSnapshot,
  identity: { exchangeName: string; exchangeId: number | null },
): ExchangeTicketSnapshot {
  const incomingName = identity.exchangeName.trim();
  const incomingId = typeof identity.exchangeId === 'number'
    && Number.isFinite(identity.exchangeId)
    && identity.exchangeId > 0
    ? identity.exchangeId
    : snapshot.exchangeId;
  const chosenName = isReusableExchangeName(incomingName)
    ? incomingName
    : (isReusableExchangeName(snapshot.exchangeName) ? snapshot.exchangeName : incomingName);

  return {
    ...snapshot,
    exchangeName: chosenName,
    exchangeId: incomingId,
    folio: buildVisibleFolio(snapshot.snapshotId, chosenName, incomingId),
    operationStatus: 'confirmed',
  };
}

export function orderExchangeTicketsForReprint(
  snapshots: ExchangeTicketSnapshot[],
): ExchangeTicketSnapshot[] {
  return [...snapshots].sort((left, right) => {
    const byDate = right.createdAt.localeCompare(left.createdAt);
    if (byDate !== 0) return byDate;
    return right.snapshotId.localeCompare(left.snapshotId);
  });
}

function normalizeExchangeName(value: string): string {
  return value.trim();
}

function normalizeCustomerName(value: string): string {
  const normalized = value.trim();
  return normalized || 'Cliente sin nombre';
}

function normalizeNotes(value?: string | null): string {
  return value?.trim() ?? '';
}

function normalizeLines(lines: ExchangeTicketSourceLine[]): ExchangeTicketLine[] {
  return lines.map((line) => ({
    productId: line.productId,
    productName: line.productName?.trim() || `Producto ${line.productId}`,
    qty: line.qty,
  }));
}

function buildSection(title: string, lines: ExchangeTicketLine[]): string {
  if (lines.length === 0) return '';

  const rows = lines.map((line) => `
    <div class="line">
      <span class="line-name">${escapeHtml(line.productName)}</span>
      <span class="line-qty"> × ${escapeHtml(formatQuantity(line.qty))}</span>
    </div>
  `).join('');

  return `
  <div class="section-title">${escapeHtml(title)}</div>
  ${rows}
  <div class="divider"></div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
