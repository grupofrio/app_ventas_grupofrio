import { mexicoDayOf } from '../utils/localDate.ts';
import { recognizeGift } from './giftRecognition.ts';

export interface GiftDuplicateCandidate {
  partnerId: number;
  productIds: number[];
  createdAtMs: number;
}

export const DUPLICATE_GIFT_MESSAGE =
  'Ya registraste este producto como regalo para este cliente hoy. ¿Quieres registrarlo otra vez?';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function giftCandidateFromQueueItem(item: {
  type: string;
  created_at: number;
  payload: unknown;
}): GiftDuplicateCandidate | null {
  if (item.type !== 'gift') return null;
  const payload = asRecord(item.payload);
  const data = asRecord(payload?.data) ?? payload;
  const partnerId = typeof data?.partner_id === 'number' ? data.partner_id : 0;
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const productIds = lines.flatMap((line) => {
    const record = asRecord(line);
    return typeof record?.product_id === 'number' ? [record.product_id] : [];
  });
  if (partnerId <= 0 || productIds.length === 0) return null;
  return { partnerId, productIds, createdAtMs: item.created_at };
}

export function giftCandidateFromOrder(order: {
  is_gift?: unknown;
  client_order_ref?: unknown;
  origin?: unknown;
  lines?: unknown;
  partner_id?: number | null;
  date_order?: string;
  confirmation_date?: string;
}): GiftDuplicateCandidate | null {
  if (!recognizeGift(order)) return null;
  const partnerId = typeof order.partner_id === 'number' ? order.partner_id : 0;
  const lines = Array.isArray(order.lines) ? order.lines : [];
  const productIds = lines.flatMap((line) => {
    const record = asRecord(line);
    const productId = record?.product_id;
    return typeof productId === 'number' ? [productId] : [];
  });
  if (partnerId <= 0 || productIds.length === 0) return null;
  const rawDate = order.confirmation_date || order.date_order || '';
  const createdAtMs = Date.parse(rawDate.includes('T') ? rawDate : rawDate.replace(' ', 'T') + 'Z');
  return {
    partnerId,
    productIds,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
  };
}

export function findDuplicateGift(input: {
  partnerId: number;
  productIds: number[];
  nowMs: number;
  existing: GiftDuplicateCandidate[];
}): boolean {
  const today = mexicoDayOf(input.nowMs);
  const wanted = new Set(input.productIds.filter((id) => id > 0));
  if (wanted.size === 0 || input.partnerId <= 0) return false;
  return input.existing.some((candidate) => {
    if (candidate.partnerId !== input.partnerId) return false;
    if (mexicoDayOf(candidate.createdAtMs) !== today) return false;
    return candidate.productIds.some((productId) => wanted.has(productId));
  });
}
