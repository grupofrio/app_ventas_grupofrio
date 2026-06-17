/**
 * Lectura PURA del error `insufficient_stock` que el backend (gf_logistics_ops,
 * B6/B7) devuelve al rechazar una venta por stock. RN-free / node-testable.
 *
 * Contrato backend (PR GrupoVeniu/GrupoFrio#116):
 *   { ok:false, message, data:{ error_code:"insufficient_stock",
 *     lines:[{ product_id, product_name, requested_qty, available_qty }] } }
 * El `data` viaja en `error.data` gracias a unwrapRestResult (aditivo).
 *
 * Tolerante: si el backend aún no manda `data.lines` (endpoint sin desplegar),
 * devuelve `{ lines: [] }` cuando detecta el code, o null si no es este error.
 * NO cambia contrato ni asume campos: solo lee lo que venga.
 */

export interface InsufficientStockLine {
  productId: number | null;
  productName: string;
  requestedQty: number | null;
  availableQty: number | null;
}

export interface InsufficientStockDetail {
  lines: InsufficientStockLine[];
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

function isInsufficientCode(code: unknown, message: unknown): boolean {
  if (typeof code === 'string' && code === 'insufficient_stock') return true;
  // Fallback por mensaje (compat si el code no llega aún).
  return typeof message === 'string' && /insufficient[_ ]?stock|stock insuficiente/i.test(message);
}

/**
 * Devuelve el detalle de insufficient_stock si el error lo es, o null.
 * Lee `error.code`/`error.data.lines`; tolera ausencia de líneas.
 */
export function getInsufficientStockDetail(error: unknown): InsufficientStockDetail | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  const data = (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
  const dataCode = data.error_code;
  if (!isInsufficientCode(e.code ?? dataCode, e.message)) return null;

  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const lines: InsufficientStockLine[] = rawLines
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l) => ({
      productId: num(l.product_id),
      productName: typeof l.product_name === 'string' ? l.product_name : '',
      requestedQty: num(l.requested_qty),
      availableQty: num(l.available_qty),
    }));
  return { lines };
}

/** Texto legible por línea para el alert al vendedor. PURO. */
export function describeInsufficientStock(detail: InsufficientStockDetail): string {
  if (!detail.lines.length) {
    return 'El servidor rechazó la venta por stock insuficiente. Revisa las existencias y ajusta las cantidades.';
  }
  return detail.lines
    .map((l) => {
      const name = l.productName || (l.productId != null ? `#${l.productId}` : 'Producto');
      const req = l.requestedQty != null ? l.requestedQty : '?';
      // Resaltar agotados (disponible 0) de forma inequívoca.
      if (l.availableQty === 0) {
        return `🔴 ${name}: AGOTADO (pediste ${req})`;
      }
      const avail = l.availableQty != null ? l.availableQty : '?';
      return `${name}: pediste ${req}, disponible ${avail}`;
    })
    .join('\n');
}
