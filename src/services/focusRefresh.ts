/**
 * Pure helper para evitar refetch redundante en useFocusEffect. RN-free.
 *
 * Las pantallas de ruta/home re-disparan loadPlan al recuperar foco (volver de
 * un cliente). loadPlan ya une llamadas concurrentes al refresh activo, pero igual
 * conviene NO re-pedir si los datos son muy recientes. Esta función decide si
 * vale la pena refetch según `lastSync`:
 *   - nunca cargado (null) → sí (primera carga),
 *   - cargado hace >= minIntervalMs → sí (refrescar),
 *   - cargado hace poco → no (evita el fetch redundante del focus rápido).
 * El refresh manual (pull-to-refresh / force) NO usa esto y siempre recarga.
 */
export function shouldRefetchOnFocus(
  lastSync: number | null | undefined,
  now: number,
  minIntervalMs = 8000,
): boolean {
  if (lastSync == null) return true;
  return now - lastSync >= minIntervalMs;
}
