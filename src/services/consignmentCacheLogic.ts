/**
 * Perf Fase 2D-1 — lógica PURA del caché de consignaciones (RN-free).
 *
 * Separada del wiring (`consignmentCache.ts`, que toca AsyncStorage/stores) para
 * poder probarla en el node test runner, igual que `pricelistCache` vs
 * `pricelist` o `routePreparationLogic` vs el store.
 */

import type { ActiveConsignment } from '../types/consignment';

/**
 * contextKey determinista. Inline (mismo algoritmo que `persistentCache`
 * `buildContextKey`) para que este módulo PURO sea self-contained y cargue en
 * el node test runner sin imports extensionless. null/undefined → '-'.
 */
function buildContextKey(parts: Array<string | number | null | undefined>): string {
  return parts.map((p) => (p === null || p === undefined ? '-' : String(p))).join('|');
}

/** TTL holgado del sobre (jornada). La invalidación primaria es la contextKey. */
export const CONSIGNMENT_CACHE_TTL_MS = 14 * 60 * 60 * 1000;

/** Payload en disco: mapa partnerId(string) → consignación de lectura. */
export type ConsignmentCachePayload = Record<string, ActiveConsignment>;

/** Forma mínima del contexto de jornada que afecta la clave de caché. */
export interface ConsignmentContextLike {
  dayKey: string;
  employeeId: number | null;
  companyId: number | null;
}

/** contextKey de jornada: día + empleado + empresa (no por-cliente: el cliente
 *  es la clave del mapa). Un cambio de día/vendedor/empresa invalida todo. */
export function buildConsignmentsContextKey(ctx: ConsignmentContextLike): string {
  return buildContextKey([ctx.dayKey, ctx.employeeId, ctx.companyId]);
}

/** Selecciona la consignación de un cliente desde el payload. Defensivo. */
export function selectConsignment(
  payload: unknown,
  partnerId: number,
): ActiveConsignment | null {
  if (!payload || typeof payload !== 'object') return null;
  const map = payload as Record<string, unknown>;
  const c = map[String(partnerId)];
  if (!c || typeof c !== 'object') return null;
  const obj = c as ActiveConsignment;
  if (typeof obj.id !== 'number' || !Array.isArray(obj.lines)) return null;
  return obj;
}

/** Devuelve una copia del payload con la consignación del cliente upsert-eada.
 *  Si `consignment` es null, elimina la entrada (cliente ya sin consignación). */
export function upsertConsignment(
  payload: unknown,
  partnerId: number,
  consignment: ActiveConsignment | null,
): ConsignmentCachePayload {
  const base: ConsignmentCachePayload =
    payload && typeof payload === 'object' ? { ...(payload as ConsignmentCachePayload) } : {};
  const key = String(partnerId);
  if (consignment) {
    base[key] = consignment;
  } else {
    delete base[key];
  }
  return base;
}

/**
 * Regla única (testable) de si se permiten mutaciones de consignación
 * (create/visit/close). Solo con conexión: el backend es la fuente de verdad y
 * no hay cola offline para consignación. El caché es exclusivamente de lectura.
 */
export function canMutateConsignment(isOnline: boolean): boolean {
  return isOnline === true;
}
