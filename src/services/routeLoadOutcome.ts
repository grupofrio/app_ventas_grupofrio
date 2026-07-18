/**
 * routeLoadOutcome — clasificación PURA del resultado de cargar la ruta, para
 * NO confundir un fallo técnico (timeout/red/servidor) con la ausencia real de
 * plan ("No tienes ruta asignada hoy"). PR-2 estado vacío/error de ruta CEDIS.
 *
 * RN-free / node-testable. La UI (route-start) y el store (useRouteStore) solo
 * consumen estos helpers; la decisión de copy/retry vive aquí.
 */

export type RouteLoadStatus =
  | 'ok'
  | 'no_plan'          // el backend dice found:false — ausencia REAL de plan
  | 'timeout'          // la petición excedió el timeout de lectura
  | 'network_error'    // sin red / conexión perdida
  | 'server_error'     // HTTP 5xx / error del servidor
  | 'invalid_response' // el backend respondió algo no decodificable
  | 'access_denied'    // ok:false por acceso denegado / plan reasignado
  | 'stops_error'      // el plan existe pero sus paradas fallaron
  | 'empty_route'      // ruta real sin paradas
  | 'unknown_error';

export interface RouteLoadOutcome {
  status: RouteLoadStatus;
  /** Mensaje operativo del backend, si lo hay (p.ej. motivo de acceso denegado). */
  message: string | null;
}

const TIMEOUT_RE = /tiempo de espera|timed?\s*out|timeout/i;
const INVALID_RE = /respuesta inv[aá]lida|invalid response/i;
const NETWORK_RE = /network request failed|failed to fetch|\bnetwork error\b|internet connection appears to be offline|load failed|connection (?:was )?(?:lost|reset|refused|closed)/i;
const SERVER_RE = /^http 5\d\d\b|internal server error|\bserver error\b|bad gateway|service unavailable|gateway timeout/i;
const ACCESS_RE = /no tienes acceso|acceso denegado|access denied|forbidden|permiso|reasign|reassign|ya no est[aá] disponible/i;

function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const c = (error as { code?: unknown }).code;
    return typeof c === 'string' ? c : null;
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message ?? '';
  return typeof error === 'string' ? error : '';
}

/**
 * Clasifica un error lanzado (por postRest / fetchMyPlan) en un estado.
 * NUNCA devuelve 'no_plan': la ausencia real de plan la determina el caller a
 * partir de `found:false` (plan === null), no de un throw.
 */
export function classifyRouteLoadError(error: unknown): RouteLoadStatus {
  const code = errorCode(error);
  if (code === 'timeout') return 'timeout';
  if (code === 'invalid_response') return 'invalid_response';

  const msg = errorMessage(error);
  if (TIMEOUT_RE.test(msg)) return 'timeout';
  if (INVALID_RE.test(msg)) return 'invalid_response';
  if (NETWORK_RE.test(msg)) return 'network_error';
  if (SERVER_RE.test(msg)) return 'server_error';
  if (ACCESS_RE.test(msg)) return 'access_denied';
  return 'unknown_error';
}

/** ¿El mensaje `ok:false` del backend indica acceso denegado / reasignación? */
export function isAccessDeniedMessage(message: string | null | undefined): boolean {
  return typeof message === 'string' && ACCESS_RE.test(message);
}

/** Extrae un mensaje operativo del backend si es funcional (no técnico crudo). */
export function backendMessageOf(error: unknown): string | null {
  const msg = errorMessage(error).trim();
  if (!msg) return null;
  // No mostramos strings técnicos de timeout/red al operador (usamos copy propio).
  if (TIMEOUT_RE.test(msg) || NETWORK_RE.test(msg) || INVALID_RE.test(msg)) return null;
  return msg;
}

/**
 * Criterio "no plan estándar" (extraído de Home / index.tsx para reusarlo):
 * un `error` string vacío o que dice "sin plan" es ausencia real; cualquier otro
 * mensaje es un error técnico que NO debe leerse como "no tienes ruta".
 */
export function isStandardNoPlanError(error: string | null | undefined): boolean {
  return !error || /sin plan/i.test(error);
}

export function isErrorStatus(status: RouteLoadStatus): boolean {
  return status !== 'ok' && status !== 'no_plan' && status !== 'empty_route';
}

export interface RouteLoadCopy {
  title: string;
  body: string;
  showRetry: boolean;
}

/**
 * Copy diferenciado por estado. `message` (backend) se antepone cuando aporta
 * (p.ej. motivo de acceso denegado). Retry se ofrece en todo salvo empty_route.
 */
export function describeRouteLoad(outcome: RouteLoadOutcome | null): RouteLoadCopy {
  const status = outcome?.status ?? 'no_plan';
  const message = outcome?.message?.trim() || null;

  switch (status) {
    case 'no_plan':
      return {
        title: 'No tienes ruta asignada hoy',
        body: 'Cuando tu supervisor publique tu plan, aquí podrás hacer el checklist, registrar KM y aceptar tu carga.',
        showRetry: true,
      };
    case 'timeout':
      return {
        title: 'No pudimos cargar tu ruta',
        body: 'La conexión tardó demasiado. Verifica el WiFi del CEDIS e intenta de nuevo.',
        showRetry: true,
      };
    case 'network_error':
      return {
        title: 'No pudimos cargar tu ruta',
        body: 'No hay conexión estable. Revisa tu señal e intenta de nuevo.',
        showRetry: true,
      };
    case 'server_error':
      return {
        title: 'No pudimos cargar tu ruta',
        body: message ?? 'El servidor no respondió correctamente. Intenta de nuevo en un momento.',
        showRetry: true,
      };
    case 'invalid_response':
      return {
        title: 'No pudimos cargar tu ruta',
        body: 'La respuesta del servidor no fue válida. Intenta de nuevo.',
        showRetry: true,
      };
    case 'access_denied':
      return {
        title: 'Tu ruta cambió o fue reasignada',
        body: message ?? 'El plan ya no está disponible para ti. Contacta a tu supervisor.',
        showRetry: true,
      };
    case 'stops_error':
      return {
        title: 'No pudimos cargar las paradas de tu ruta',
        body: message ?? 'Tu ruta existe pero no pudimos traer sus paradas. Intenta de nuevo.',
        showRetry: true,
      };
    case 'empty_route':
      return {
        title: 'Ruta sin paradas',
        body: 'Tu ruta no tiene paradas registradas para hoy.',
        showRetry: true,
      };
    case 'ok':
      return { title: '', body: '', showRetry: false };
    case 'unknown_error':
    default:
      return {
        title: 'No pudimos cargar tu ruta',
        body: message ?? 'Ocurrió un error al cargar tu ruta. Intenta de nuevo.',
        showRetry: true,
      };
  }
}
