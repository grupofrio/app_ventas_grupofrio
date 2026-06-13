/**
 * Pure helper para la persistencia de la cola de sync. RN-free, unit-testable.
 *
 * Define QUÉ items se persisten: todo menos los 'done' (evita crecimiento
 * ilimitado del JSON en AsyncStorage). Garantiza que pending/error/dead/syncing
 * NUNCA se descartan → la cola no pierde operaciones al persistir.
 */
export function selectPersistableQueue<T extends { status: string }>(queue: T[]): T[] {
  return queue.filter((i) => i.status !== 'done');
}
