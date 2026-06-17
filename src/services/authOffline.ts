/**
 * Sesión offline (BLD-20260617-OFFLINE-LOGIN). Helpers PUROS / RN-free.
 *
 * Política de seguridad (no se relaja):
 *  - NO se permite iniciar sesión NUEVA sin conexión (requiere validar barcode+PIN
 *    contra Odoo).
 *  - SÍ se reutiliza una sesión YA guardada localmente: al abrir la app,
 *    rehydrateAuth restaura el estado del empleado desde AsyncStorage SIN red
 *    (token + datos persistidos en login previo). Esta es la única vía offline.
 *
 * `isRestorableSession` centraliza qué cuenta como sesión local válida para
 * restaurar (misma regla que usaba rehydrateAuth inline): requiere employeeId y
 * warehouseId — sin ellos, inventario/ruta fallarían en silencio.
 */

export interface RestorableSessionCheck {
  ok: boolean;
  reason: 'ok' | 'no_session' | 'incomplete';
}

export function isRestorableSession(saved: unknown): RestorableSessionCheck {
  if (!saved || typeof saved !== 'object') {
    return { ok: false, reason: 'no_session' };
  }
  const s = saved as Record<string, unknown>;
  const hasEmployee = typeof s.employeeId === 'number' && s.employeeId > 0;
  const hasWarehouse = typeof s.warehouseId === 'number' && s.warehouseId > 0;
  if (!hasEmployee || !hasWarehouse) {
    return { ok: false, reason: 'incomplete' };
  }
  return { ok: true, reason: 'ok' };
}

/**
 * Aviso en la pantalla de login según conectividad. Honesto: sin conexión no se
 * puede iniciar sesión nueva, pero una sesión previa se restaura sola al abrir
 * la app. Devuelve null si hay conexión (no satura).
 */
export function describeLoginOfflineNotice(isOnline: boolean): string | null {
  if (isOnline) return null;
  return 'Sin conexión: para iniciar sesión por primera vez necesitas internet. Si ya habías entrado en este dispositivo, tu sesión se restaura sola al abrir la app.';
}
