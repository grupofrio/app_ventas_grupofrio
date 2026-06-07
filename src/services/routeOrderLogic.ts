/**
 * Route visit-order helpers (P1). Pure, testable. No RN, no network.
 *
 * No bloquea la operación: sólo detecta cuando el vendedor abre un cliente que
 * NO es el siguiente recomendado (por route_sequence) para mostrar una
 * advertencia suave y permitir continuar. El "siguiente" reusa selectNextStop
 * (routeMapLogic) para no duplicar la regla.
 */

import type { GFStop } from '../types/plan';

const bySeq = (a: GFStop, b: GFStop) => (a.route_sequence || 0) - (b.route_sequence || 0);

/**
 * Siguiente cliente recomendado: primer in_progress, si no, primer pending, por
 * route_sequence. Misma regla que routeMapLogic.selectNextStop (replicada aquí
 * para mantener este helper autónomo y unit-testable sin imports runtime).
 */
function pickNextStop(stops: GFStop[]): GFStop | null {
  const inProgress = stops.filter((s) => s.state === 'in_progress').sort(bySeq);
  if (inProgress.length > 0) return inProgress[0];
  const pending = stops.filter((s) => s.state === 'pending').sort(bySeq);
  return pending[0] ?? null;
}

export interface VisitOrderEvaluation {
  /** true → el cliente seleccionado no es el siguiente recomendado. */
  outOfOrder: boolean;
  /** El siguiente cliente recomendado (por secuencia), o null. */
  nextStop: GFStop | null;
  /** El cliente seleccionado, o null si no existe. */
  selected: GFStop | null;
}

const OPEN_STATES = new Set(['pending', 'in_progress']);

/**
 * Evalúa si abrir `selectedStopId` es una desviación del orden recomendado.
 *
 * outOfOrder es true SÓLO cuando:
 *   - el seleccionado existe y está pendiente/en curso (no completado),
 *   - tiene route_sequence (>0),
 *   - hay un "siguiente" recomendado distinto del seleccionado.
 * Clientes completados o sin secuencia nunca se marcan como desviación.
 */
export function evaluateVisitOrder(
  stops: GFStop[],
  selectedStopId: number,
): VisitOrderEvaluation {
  const selected = stops.find((s) => s.id === selectedStopId) ?? null;
  const nextStop = pickNextStop(stops);

  if (!selected || !nextStop) {
    return { outOfOrder: false, nextStop, selected };
  }
  if (selected.id === nextStop.id) {
    return { outOfOrder: false, nextStop, selected };
  }
  // No marcar desviación para clientes ya cerrados/visitados o sin secuencia.
  if (!OPEN_STATES.has(selected.state)) {
    return { outOfOrder: false, nextStop, selected };
  }
  if (!selected.route_sequence || selected.route_sequence <= 0) {
    return { outOfOrder: false, nextStop, selected };
  }
  return { outOfOrder: true, nextStop, selected };
}
