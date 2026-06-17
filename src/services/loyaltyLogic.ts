/**
 * Lógica PURA de Lealtad (RN-free, node-testable). Separada de `loyalty.ts`
 * (que importa odooRpc) para poder probar el parseo/presentación en node.
 *
 * Datos = campos de res.partner (gf_partner_loyalty): x_loyalty_level
 * (bronce/plata/oro), x_loyalty_streak (semanas), x_last_order_week (ISO week).
 */

export type LoyaltyLevel = 'bronce' | 'plata' | 'oro';

export interface PartnerLoyalty {
  partnerId: number;
  name: string;
  level: LoyaltyLevel | null;
  streakWeeks: number;
  lastOrderWeek: number | null;
}

export const PARTNER_LOYALTY_FIELDS = [
  'id', 'name', 'x_loyalty_level', 'x_loyalty_streak', 'x_last_order_week',
];

const VALID_LEVELS: LoyaltyLevel[] = ['bronce', 'plata', 'oro'];

function toIntOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** Parsea un registro res.partner a PartnerLoyalty. PURO. null si inválido. */
export function parsePartnerLoyalty(raw: unknown): PartnerLoyalty | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = toIntOrNull(r.id);
  if (id == null || id <= 0) return null;
  const rawLevel = typeof r.x_loyalty_level === 'string' ? r.x_loyalty_level : '';
  const level = VALID_LEVELS.includes(rawLevel as LoyaltyLevel) ? (rawLevel as LoyaltyLevel) : null;
  return {
    partnerId: id,
    name: typeof r.name === 'string' ? r.name : '',
    level,
    streakWeeks: toIntOrNull(r.x_loyalty_streak) ?? 0,
    lastOrderWeek: toIntOrNull(r.x_last_order_week),
  };
}

/** true si el cliente tiene algún dato de lealtad que mostrar. PURO. */
export function hasLoyaltyData(loyalty: PartnerLoyalty | null): boolean {
  if (!loyalty) return false;
  return loyalty.level != null || loyalty.streakWeeks > 0;
}

export interface LoyaltyLevelInfo {
  label: string;
  emoji: string;
  /** Siguiente nivel a alcanzar, o null si es el máximo. */
  next: string | null;
}

/** Presentación de nivel (label/emoji/siguiente). PURO. */
export function describeLoyaltyLevel(level: LoyaltyLevel | null): LoyaltyLevelInfo {
  switch (level) {
    case 'oro':
      return { label: 'Oro', emoji: '🥇', next: null };
    case 'plata':
      return { label: 'Plata', emoji: '🥈', next: 'Oro' };
    case 'bronce':
      return { label: 'Bronce', emoji: '🥉', next: 'Plata' };
    default:
      return { label: 'Sin nivel', emoji: '⭐', next: 'Bronce' };
  }
}
