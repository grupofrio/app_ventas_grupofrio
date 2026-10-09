export const GIFT_TICKET_TITLE = 'Ticket de regalo';
export const GIFT_PAYMENT_LABEL = 'Sin cobro';

export interface GiftRecognitionLine {
  discount?: unknown;
  price_subtotal?: unknown;
}

export interface GiftRecognitionSource {
  is_gift?: unknown;
  client_order_ref?: unknown;
  origin?: unknown;
  lines?: GiftRecognitionLine[] | unknown;
}

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function lineIsGift(line: GiftRecognitionLine): boolean {
  const discount = typeof line.discount === 'number' && Number.isFinite(line.discount)
    ? line.discount
    : null;
  const subtotal = typeof line.price_subtotal === 'number' && Number.isFinite(line.price_subtotal)
    ? line.price_subtotal
    : null;
  if (discount !== null && discount >= 100) return true;
  return discount !== null && discount > 0 && subtotal === 0;
}

/**
 * A movement is a gift only with an explicit server flag, a GIFT reference,
 * a REGALO origin, or a full discount. Amount 0 alone is not enough.
 */
export function recognizeGift(source: GiftRecognitionSource | null | undefined): boolean {
  if (!source) return false;
  if (source.is_gift === true) return true;
  if (source.is_gift === false) return false;
  if (asTrimmed(source.client_order_ref).toUpperCase().startsWith('GIFT:')) return true;
  if (/REGALO/i.test(asTrimmed(source.origin))) return true;
  if (!Array.isArray(source.lines) || source.lines.length === 0) return false;
  return source.lines.every((line) => line && typeof line === 'object' && lineIsGift(line));
}
