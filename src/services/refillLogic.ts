/**
 * Lógica pura para la pantalla "Solicitar carga" (refill). RN-free, node-testable.
 *
 * Bug corregido: la pantalla mostraba `products.slice(0, 10)` y, como el store
 * ordena por `qty_available` DESCENDENTE, eso dejaba a la vista los 10 productos
 * con MÁS stock (los que menos necesitan recarga) y ocultaba los agotados/bajo
 * stock que justamente hay que pedir. Aquí ordenamos por stock ASCENDENTE (lo
 * agotado primero) y NO recortamos: el filtro de búsqueda alcanza cualquier
 * producto.
 */

export interface RefillProductLike {
  id: number;
  name: string;
  default_code?: string | null;
  qty_available: number;
}

/** Coincidencia difusa: todas las palabras de la query en nombre o código. */
function matchesQuery(product: RefillProductLike, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const haystack = `${product.name ?? ''} ${product.default_code ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/**
 * Filtra por búsqueda y ordena para refill: menor stock primero (agotados y bajo
 * stock arriba), desempatando por nombre para orden estable. Devuelve TODOS los
 * que coinciden (sin cap). Productos con stock inválido se tratan como 0.
 */
export function filterAndSortRefillProducts<T extends RefillProductLike>(
  products: T[],
  query: string,
): T[] {
  const safeQty = (p: T) =>
    typeof p.qty_available === 'number' && Number.isFinite(p.qty_available) ? p.qty_available : 0;
  return products
    .filter((p) => p && typeof p.id === 'number')
    .filter((p) => matchesQuery(p, query))
    .slice() // no mutar el array del store
    .sort((a, b) => {
      const d = safeQty(a) - safeQty(b);
      if (d !== 0) return d;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });
}

export interface RefillPayloadInput {
  warehouseId: number | null;
  lines: Array<{ productId: number; qty: number }>;
  notes: string;
  operationId: string;
  timestampMs: number;
}

/**
 * Construye el payload de la solicitud de refill que se encola en el sync queue.
 * Incluye `operation_id` estable para que el backend pueda deduplicar reintentos
 * / doble-tap (campo adicional; un backend que lo ignore no se rompe). La cola
 * de sync ya añade su propio `_operationId` por ítem; este `operation_id` es a
 * nivel de intento del vendedor.
 */
export function buildRefillPayload(input: RefillPayloadInput): {
  type: 'refill';
  model: 'van.refill.request';
  warehouse_id: number | null;
  operation_id: string;
  lines: Array<{ product_id: number; qty: number }>;
  notes: string;
  timestamp: number;
} {
  return {
    type: 'refill',
    model: 'van.refill.request',
    warehouse_id: input.warehouseId,
    operation_id: input.operationId,
    lines: input.lines.map((l) => ({ product_id: l.productId, qty: l.qty })),
    notes: input.notes,
    timestamp: input.timestampMs,
  };
}
