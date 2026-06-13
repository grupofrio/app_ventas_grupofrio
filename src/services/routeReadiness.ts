/**
 * Perf Fase 2C — readiness de preparación de ruta (gate de salida del CEDIS).
 *
 * Helper PURO / RN-free (node-testable). Decide si el vendedor tiene el MÍNIMO
 * de datos en caché/memoria para salir a ruta y operar offline:
 *   - ruta/stops disponibles,
 *   - productos disponibles,
 *   - precios precargados (best-effort: NO bloquean — el picker cae a
 *     list_price y la venta revalida precio contra backend online-first).
 *
 * Regla: el mínimo bloqueante = ruta + productos. Sin productos no hay nada que
 * vender; sin ruta no hay a quién visitar. Los precios faltantes son ADVERTENCIA
 * (degradación segura), nunca inventan datos. La venta sigue online-first y el
 * backend es la fuente final de verdad de stock/precio.
 */

export type ReadinessBlock = 'ok' | 'partial' | 'missing';

export interface RouteReadinessInput {
  hasPlan: boolean;
  stopsCount: number;
  productCount: number;
  /** Clientes de la ruta que requieren precarga de precios. */
  customersTotal: number;
  customersPrepared: number;
}

export interface RouteReadiness {
  route: ReadinessBlock;
  products: ReadinessBlock;
  prices: ReadinessBlock;
  /** Mínimo bloqueante listo: ruta + productos. */
  minimumReady: boolean;
  /** Todo listo: mínimo + precios completos. */
  fullyReady: boolean;
  /** Etiquetas de lo que falta del MÍNIMO (para mensaje de bloqueo). */
  missing: string[];
  /** Advertencias no bloqueantes (p.ej. precios parciales). */
  warnings: string[];
  /** Motivo de bloqueo si no se puede salir; null si el mínimo está listo. */
  blockReason: string | null;
}

export function computeRouteReadiness(input: RouteReadinessInput): RouteReadiness {
  const route: ReadinessBlock = input.hasPlan && input.stopsCount > 0 ? 'ok' : 'missing';
  const products: ReadinessBlock = input.productCount > 0 ? 'ok' : 'missing';

  let prices: ReadinessBlock;
  if (input.customersTotal <= 0) {
    prices = 'ok'; // nada que precargar
  } else if (input.customersPrepared >= input.customersTotal) {
    prices = 'ok';
  } else if (input.customersPrepared > 0) {
    prices = 'partial';
  } else {
    prices = 'missing';
  }

  const minimumReady = route === 'ok' && products === 'ok';
  const fullyReady = minimumReady && prices === 'ok';

  const missing: string[] = [];
  if (route !== 'ok') missing.push('ruta/clientes');
  if (products !== 'ok') missing.push('productos');

  const warnings: string[] = [];
  if (minimumReady && prices === 'partial') {
    warnings.push('precios incompletos para algunos clientes');
  } else if (minimumReady && prices === 'missing') {
    warnings.push('precios no precargados');
  }

  const blockReason = minimumReady
    ? null
    : `Faltan ${missing.join(' y ')}. Prepara la ruta con WiFi en el CEDIS antes de salir.`;

  return { route, products, prices, minimumReady, fullyReady, missing, warnings, blockReason };
}
