/**
 * Señales de confianza operativa (BLD-20260617-TRUST-SIGNALS).
 *
 * Helpers PUROS / RN-free (node-testables). Objetivo: que el vendedor en campo
 * entienda SIEMPRE cuándo un dato es definitivo, referencial, viejo o incompleto
 * — y que nunca vea información engañosa (p.ej. una distancia ficticia "999m" o
 * un precio de caché que parezca confirmado).
 *
 * No bloquean ningún flujo: solo describen estado para la UI.
 */

// formatCurrency inline (mismo formato que utils/time.formatCurrency). Se inlinea
// a propósito para mantener este módulo sin imports cross-module y poder correr
// los tests puros bajo el runner de node (ESM sin resolución de extensiones).
function formatCurrency(amount: number): string {
  const safe = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
  return `$${safe.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Precio / stock referencial ───────────────────────────────────────────────

export type TrustTone = 'confirmed' | 'reference';
export interface SourceTrust {
  tone: TrustTone;
  label: string;
}

/**
 * Confianza del precio mostrado. Sin conexión cae a list_price de caché
 * (referencial). En línea, el precio del pricelist del cliente es confirmado;
 * sin pricelist es "precio lista" (en vivo pero no específico del cliente).
 */
export function describePriceTrust(input: {
  isOnline: boolean;
  hasCustomPrice: boolean;
}): SourceTrust {
  if (!input.isOnline) return { tone: 'reference', label: 'Precio referencial' };
  if (input.hasCustomPrice) return { tone: 'confirmed', label: 'Precio cliente' };
  return { tone: 'confirmed', label: 'Precio lista' };
}

/**
 * Confianza del stock mostrado. Sin conexión = caché (referencial). En línea,
 * solo es "de tu unidad" cuando el backend marcó hasStockData===true (truck
 * stock real); si es false/null la lista es inventario global (referencial).
 */
export function describeStockTrust(input: {
  isOnline: boolean;
  hasStockData: boolean | null;
}): SourceTrust {
  if (!input.isOnline) return { tone: 'reference', label: 'Stock referencial' };
  if (input.hasStockData !== true) return { tone: 'reference', label: 'Stock referencial' };
  return { tone: 'confirmed', label: 'Stock de tu unidad' };
}

/**
 * Banner combinado para ProductPicker/carrito. Devuelve null cuando todo es
 * confirmado (no satura). Aclara, no bloquea.
 */
export function describeCatalogTrustBanner(input: {
  isOnline: boolean;
  hasStockData: boolean | null;
  hasCustomPrices: boolean;
}): string | null {
  if (!input.isOnline) {
    return 'Sin conexión: precios y stock son REFERENCIALES (última sincronización). Odoo los confirma al sincronizar.';
  }
  const reasons: string[] = [];
  if (input.hasStockData !== true) reasons.push('stock referencial (inventario global, puede no reflejar tu unidad)');
  if (!input.hasCustomPrices) reasons.push('precio de lista (no específico del cliente)');
  if (reasons.length === 0) return null;
  return `Datos referenciales: ${reasons.join(' · ')}.`;
}

// ── Freshness de preparación / caché ─────────────────────────────────────────

export type FreshnessTone = 'ok' | 'warn' | 'stale';
export interface FreshnessInfo {
  label: string;
  stale: boolean;
  tone: FreshnessTone;
}

/** "menos de 1 min" | "N min" | "N h" | "N h M min". */
export function humanizeElapsedMs(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  if (totalMin < 1) return 'menos de 1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Antigüedad de los datos preparados. Advierte si son de otro día o muy viejos.
 * `staleAfterMs` por defecto 2 h.
 */
export function describeDataFreshness(input: {
  preparedAtMs: number | null;
  nowMs: number;
  staleAfterMs?: number;
}): FreshnessInfo {
  if (input.preparedAtMs == null) {
    return { label: 'Sin preparar', stale: true, tone: 'warn' };
  }
  const elapsed = Math.max(0, input.nowMs - input.preparedAtMs);
  const human = humanizeElapsedMs(elapsed);
  if (!isSameLocalDay(input.preparedAtMs, input.nowMs)) {
    return {
      label: `Preparada hace ${human} (otro día) — actualiza antes de salir`,
      stale: true,
      tone: 'stale',
    };
  }
  const staleAfter = input.staleAfterMs ?? 2 * 60 * 60 * 1000;
  if (elapsed >= staleAfter) {
    return {
      label: `Preparada hace ${human} — verifica precios y stock`,
      stale: true,
      tone: 'warn',
    };
  }
  return { label: `Preparada hace ${human}`, stale: false, tone: 'ok' };
}

// ── Geo (sin distancia ficticia) ─────────────────────────────────────────────

export type GeoTone = 'ok' | 'far' | 'unknown' | 'low_accuracy';
export interface GeoStatus {
  tone: GeoTone;
  label: string;
  withinRange: boolean;
  distanceKnown: boolean;
  distanceMeters: number | null;
}

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

/**
 * Estado de geo-cerca SIN inventar distancia. Si no hay geo del cliente o no hay
 * fix de GPS → "no disponible" (nunca 999m). Si la precisión es baja → se avisa.
 */
export function describeGeoStatus(input: {
  locStatus: string; // 'ready' | 'loading' | 'denied' | 'unavailable' | 'error'
  hasClientGeo: boolean;
  distanceMeters: number | null;
  accuracyMeters?: number | null;
  withinThresholdMeters?: number;
  lowAccuracyMeters?: number;
}): GeoStatus {
  const threshold = input.withinThresholdMeters ?? 50;
  const lowAcc = input.lowAccuracyMeters ?? 100;

  if (!input.hasClientGeo) {
    return {
      tone: 'unknown',
      label: '📍 Ubicación del cliente no disponible',
      withinRange: false,
      distanceKnown: false,
      distanceMeters: null,
    };
  }
  if (input.locStatus !== 'ready' || input.distanceMeters == null) {
    const reason =
      input.locStatus === 'denied' ? 'permiso de ubicación denegado'
      : input.locStatus === 'unavailable' ? 'GPS no disponible'
      : input.locStatus === 'error' ? 'error de GPS'
      : 'obteniendo ubicación…';
    return {
      tone: 'unknown',
      label: `📍 Ubicación no disponible (${reason})`,
      withinRange: false,
      distanceKnown: false,
      distanceMeters: null,
    };
  }

  const dist = formatDistance(input.distanceMeters);
  const within = input.distanceMeters <= threshold;
  if (input.accuracyMeters != null && input.accuracyMeters > lowAcc) {
    return {
      tone: 'low_accuracy',
      label: `📍 Precisión GPS baja (±${Math.round(input.accuracyMeters)}m) · aprox. ${dist}`,
      withinRange: within,
      distanceKnown: true,
      distanceMeters: input.distanceMeters,
    };
  }
  if (within) {
    return {
      tone: 'ok',
      label: `📍 GPS verificado · Estás a ${dist} (máx ${threshold}m) ✓`,
      withinRange: true,
      distanceKnown: true,
      distanceMeters: input.distanceMeters,
    };
  }
  return {
    tone: 'far',
    label: `📍 Fuera de rango: ${dist}. Acércate a <${threshold}m`,
    withinRange: false,
    distanceKnown: true,
    distanceMeters: input.distanceMeters,
  };
}

// ── Razones de bloqueo (disabled states) ─────────────────────────────────────

/** Razón por la que "Confirmar venta" está bloqueado, o null si se puede. */
export function describeSaleConfirmBlock(input: {
  hasLines: boolean;
  hasStock: boolean;
  photoTaken: boolean;
  paymentSelected: boolean;
  hasPlaza: boolean;
  hasWarehouse: boolean;
  routeLoadAccepted: boolean;
}): string | null {
  if (!input.hasLines) return null; // sin líneas no se muestra hint (igual que hoy)
  if (!input.hasStock) return '⚠️ Ajusta cantidades al stock disponible';
  if (!input.photoTaken) return '📸 Toma la foto de entrega';
  if (!input.paymentSelected) return '💰 Selecciona método de pago';
  if (!input.hasPlaza) return '📍 Configura la plaza del empleado';
  if (!input.hasWarehouse) return '🏬 Configura el almacén del empleado';
  if (!input.routeLoadAccepted) return '📦 Acepta la carga pendiente de la ruta';
  return null;
}

/** Razón por la que "Reintentar" (Sync) está bloqueado, o null si se puede. */
export function describeRetryBlock(input: {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
}): string | null {
  if (input.isSyncing) return 'Sincronizando…';
  if (!input.isOnline) return 'Sin conexión: el reintento se hará automáticamente al reconectar.';
  if (input.pendingCount === 0) return 'No hay operaciones pendientes por reintentar.';
  return null;
}

// ── Diferencia de liquidación (monto claro) ──────────────────────────────────

export type CashDiffKind = 'cuadra' | 'falta' | 'sobra';
export interface CashDifference {
  hasDiff: boolean;
  kind: CashDiffKind;
  amount: number; // absoluto
  label: string;
  action: string;
}

/** Diferencia de efectivo con monto exacto y acción esperada. */
export function describeCashDifference(input: {
  captured: number;
  expected: number;
}): CashDifference {
  const captured = Number.isFinite(input.captured) ? input.captured : 0;
  const expected = Number.isFinite(input.expected) ? input.expected : 0;
  const diff = captured - expected;
  const amount = Math.abs(diff);
  const detail = `Capturado ${formatCurrency(captured)} · esperado ${formatCurrency(expected)}`;

  // Redondeo a centavos para evitar ruido de punto flotante.
  if (Math.round(amount * 100) === 0) {
    return { hasDiff: false, kind: 'cuadra', amount: 0, label: `El efectivo cuadra. ${detail}.`, action: '' };
  }
  if (diff < 0) {
    return {
      hasDiff: true,
      kind: 'falta',
      amount,
      label: `Faltan ${formatCurrency(amount)}. ${detail}.`,
      action: 'Cuenta de nuevo el efectivo; confirma con diferencia solo si el faltante es real.',
    };
  }
  return {
    hasDiff: true,
    kind: 'sobra',
    amount,
    label: `Sobran ${formatCurrency(amount)}. ${detail}.`,
    action: 'Verifica el conteo; confirma con diferencia solo si el sobrante es real.',
  };
}
