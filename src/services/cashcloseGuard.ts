/**
 * Pure guard for cash close / liquidation confirmation.
 *
 * The "Confirm Liquidation" button is intentionally NOT in the UI yet
 * (backend deploy of /pwa-ruta/liquidacion-confirm is being validated).
 * When it is added, it MUST stay disabled while there is anything pending
 * to sync — otherwise vendors would lock their corte while sales/payments
 * are still queued offline and that would create cobranza phantom diffs.
 *
 * This helper is exported so the future "Confirm Liquidation" button and
 * the current "Sincronizar pendientes" card share the same predicate.
 */

export interface CashCloseGuardInput {
  pendingCount: number;
  isSyncing: boolean;
  liquidationAvailable: boolean;
  /**
   * P0-3 (hardening): items en estado `error`/`dead` representan ventas/pagos
   * que NO llegaron al backend. Liquidar con ellos genera efectivo esperado
   * fantasma (corte que no cuadra). Deben bloquear la liquidación igual que
   * los `pending`. Opcionales (default 0) para compatibilidad de llamadas.
   */
  errorCount?: number;
  deadCount?: number;
}

/**
 * Returns true ONLY when:
 *   - no items pending / error / dead in the sync queue,
 *   - no sync cycle currently running,
 *   - the liquidation summary is loaded (i.e. backend reachable).
 *
 * Any of these false → the user must not be allowed to confirm liquidation.
 */
export function canConfirmLiquidation(input: CashCloseGuardInput): boolean {
  if (input.pendingCount > 0) return false;
  if ((input.errorCount ?? 0) > 0) return false;
  if ((input.deadCount ?? 0) > 0) return false;
  if (input.isSyncing) return false;
  if (!input.liquidationAvailable) return false;
  return true;
}

/**
 * Human-readable reason why confirmation is blocked. Returns null when
 * the guard would allow confirmation. UI uses this to label the disabled
 * button/card.
 */
export function describeBlockingReason(input: CashCloseGuardInput): string | null {
  if (input.pendingCount > 0) {
    return `Hay ${input.pendingCount} operacion(es) pendientes por sincronizar.`;
  }
  const failed = (input.errorCount ?? 0) + (input.deadCount ?? 0);
  if (failed > 0) {
    return `Hay ${failed} operacion(es) con error sin sincronizar. Resuélvelas antes de liquidar.`;
  }
  if (input.isSyncing) {
    return 'Sincronizando…';
  }
  if (!input.liquidationAvailable) {
    return 'No se pudo cargar la liquidación.';
  }
  return null;
}

/**
 * Razón por la que el botón "Confirmar liquidación" está deshabilitado, o null
 * si está habilitado. Espeja exactamente las condiciones de habilitación de la
 * pantalla (corte confirmado + sin pendientes/errores + liquidación cargada),
 * para que un botón gris SIEMPRE explique por qué — el reporte de campo era que
 * "no funciona" cuando en realidad estaba disabled sin explicación.
 *
 * Orden de prioridad pensado para guiar al vendedor al siguiente paso.
 */
export interface LiquidationButtonState {
  alreadyConfirmed: boolean;
  corteConfirmed: boolean;
  liquidationAvailable: boolean;
  pendingCount: number;
  errorCount?: number;
  deadCount?: number;
  isSyncing: boolean;
}

export function describeLiquidationButtonBlock(s: LiquidationButtonState): string | null {
  if (s.alreadyConfirmed) return null; // ya confirmada → no se muestra el botón
  if (!s.liquidationAvailable) {
    return 'La liquidación no está disponible. Reintenta la carga de Cobranza / Liquidación.';
  }
  if (s.pendingCount > 0) {
    return `Hay ${s.pendingCount} operación(es) pendientes por sincronizar.`;
  }
  const failed = (s.errorCount ?? 0) + (s.deadCount ?? 0);
  if (failed > 0) {
    return `Hay ${failed} operación(es) con error sin sincronizar. Resuélvelas antes de liquidar.`;
  }
  if (s.isSyncing) return 'Sincronizando…';
  if (!s.corteConfirmed) {
    return 'Primero confirma el corte de unidades (botón "Confirmar corte" arriba).';
  }
  return null;
}
