/**
 * stockRollback — rollback GENÉRICO de stock local por delta, independiente del
 * `type` del ítem de la cola (PR-3a). RN-free / node-testable.
 *
 * Problema: unload descuenta stock local optimista pero se encola como
 * `prospection`, así que `rollbackFailedOperation` caía en `default` y NO
 * revertía → stock fantasma permanente al morir el ítem. La solución NO cambia
 * el ruteo (eso es PR-3b): adjunta al payload un `_localStockDelta` explícito
 * con lo que se aplicó localmente, y el rollback lo revierte leyendo ese delta,
 * sin depender del `type`.
 *
 * Convención de `_localStockDelta`: array de { product_id, delta } donde `delta`
 * es la cantidad que se SUMÓ al stock local (unload deduce → delta negativo;
 * una operación que agrega stock → delta positivo). Revertir = aplicar `-delta`.
 */

export interface LocalStockDeltaEntry {
  product_id: number;
  /** Cantidad sumada al stock local (negativa si se descontó). */
  delta: number;
}

/**
 * Construye el `_localStockDelta` a partir de las líneas y el signo aplicado.
 *  - unload (descuenta): sign = -1  → delta negativo.
 *  - una operación que agrega stock: sign = +1.
 * Ignora líneas inválidas o con qty 0 (no dejan rastro que revertir).
 */
export function buildLocalStockDelta(
  lines: Array<{ product_id: number; qty: number }>,
  sign: 1 | -1,
): LocalStockDeltaEntry[] {
  return (Array.isArray(lines) ? lines : [])
    .filter(
      (l) =>
        l && typeof l.product_id === 'number' && Number.isFinite(l.product_id) &&
        typeof l.qty === 'number' && Number.isFinite(l.qty) && l.qty !== 0,
    )
    .map((l) => ({ product_id: l.product_id, delta: sign * l.qty }));
}

/**
 * Dado un payload, devuelve las reversiones a aplicar al stock local
 * ({ product_id, qty } donde qty es lo que hay que SUMAR para revertir).
 * Devuelve `[]` cuando:
 *  - no hay `_localStockDelta` válido (operación que no tocó stock → sin rollback
 *    inventado);
 *  - ya se revirtió antes (`_localStockRolledBack === true`) → IDEMPOTENTE: no
 *    revierte dos veces.
 * Puro: no muta el payload ni toca ningún store.
 */
export function computeLocalStockReversal(
  payload: Record<string, unknown> | null | undefined,
): Array<{ product_id: number; qty: number }> {
  if (!payload || payload._localStockRolledBack === true) return [];
  const raw = payload._localStockDelta;
  if (!Array.isArray(raw)) return [];

  const reversal: Array<{ product_id: number; qty: number }> = [];
  for (const raw_e of raw) {
    const e = raw_e as { product_id?: unknown; delta?: unknown } | null;
    if (
      e && typeof e.product_id === 'number' && Number.isFinite(e.product_id) &&
      typeof e.delta === 'number' && Number.isFinite(e.delta) && e.delta !== 0
    ) {
      reversal.push({ product_id: e.product_id, qty: -e.delta });
    }
  }
  return reversal;
}
