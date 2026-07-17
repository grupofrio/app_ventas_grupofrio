/**
 * PR-1 — Despertadores de la cola de Sync (decisión PURA / RN-free).
 *
 * `connectivity.ts` (NetInfo + AppState) y `useSyncStore` (timer de backoff)
 * son la capa de cableado con React Native; TODA la decisión de "¿cuándo
 * despertar la cola?" vive aquí para poder probarse con node:test sin RN.
 *
 * Tres despertadores, tres helpers:
 *   1. Foreground / reconexión  → `hasEligibleWorkNow` + `shouldWakeOnNetTransition`
 *   2. Vencimiento del backoff   → `nextWakeDelayMs`
 *
 * La protección contra ciclos concurrentes NO vive aquí: la da el guard
 * `if (!isOnline || isSyncing) return` de `processQueue`. Estos helpers solo
 * deciden CUÁNDO invocar processQueue; nunca envían nada por su cuenta.
 */

import type { SyncQueueItem } from '../types/sync';

/** Snapshot tri-estado de NetInfo (isConnected / isInternetReachable). */
export interface NetSnapshot {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

/**
 * "Potencialmente online": hay enlace y la alcanzabilidad NO es explícitamente
 * false. `null` (desconocido) NO descarta estar online — así no perdemos el
 * despertar inicial en el arranque, cuando NetInfo aún no ha sondeado.
 */
export function isPotentiallyOnline(s: NetSnapshot): boolean {
  return s.isConnected === true && s.isInternetReachable !== false;
}

/**
 * ¿Esta transición de NetInfo debe despertar la cola?
 *
 * Dispara SOLO cuando el estado NUEVO es potencialmente-online Y representa una
 * mejora relevante, para no hacer loop en cada evento duplicado:
 *  - venía de offline duro (sin enlace, o reachability === false), o
 *  - la alcanzabilidad se CONFIRMA (null/false → true) aunque el enlace ya
 *    estuviera arriba. Este segundo caso es el "online fantasma": estábamos
 *    marcados online con reachability null, un ítem falló y quedó en backoff;
 *    cuando la señal real vuelve (reachable → true) hay que re-despertar, cosa
 *    que un flanco booleano offline→online se perdía.
 *
 * No cambia la semántica global de `isOnline` (eso afectaría gating de UI fuera
 * de alcance); solo decide el disparo del sync.
 */
export function shouldWakeOnNetTransition(prev: NetSnapshot, next: NetSnapshot): boolean {
  if (!isPotentiallyOnline(next)) return false;
  if (!isPotentiallyOnline(prev)) return true;
  if (next.isInternetReachable === true && prev.isInternetReachable !== true) return true;
  return false;
}

/**
 * ¿Está listo AHORA para procesarse? Espeja `isReady` de `processQueue`:
 *  - pending → listo, o
 *  - error con retries < MAX y backoff vencido (o sin next_retry_at).
 */
export function isEligibleNow(
  item: Pick<SyncQueueItem, 'status' | 'retries' | 'next_retry_at'>,
  now: number,
  maxRetries: number,
): boolean {
  if (item.status === 'pending') return true;
  if (item.status === 'error' && item.retries < maxRetries) {
    return item.next_retry_at == null || item.next_retry_at <= now;
  }
  return false;
}

/** ¿Hay algún ítem elegible ahora mismo? (foreground/reconexión → processQueue). */
export function hasEligibleWorkNow(
  queue: Array<Pick<SyncQueueItem, 'status' | 'retries' | 'next_retry_at'>>,
  now: number,
  maxRetries: number,
): boolean {
  return queue.some((i) => isEligibleNow(i, now, maxRetries));
}

type EligibleFields = Pick<SyncQueueItem, 'status' | 'retries' | 'next_retry_at'>;
type DepFields = Pick<SyncQueueItem, 'id' | 'status' | 'dependsOn'>;

/**
 * ¿Este ítem se procesaría con PROGRESO ahora mismo? = elegible ahora Y con sus
 * dependencias satisfechas. Excluir un `pending` con dependencia insatisfecha es
 * lo que evita el busy-loop del re-drenaje post-ciclo: ese pending nunca cambia
 * de estado, así que re-drenar en bucle no avanzaría nada.
 */
export function hasImmediateDrainableWork(
  queue: Array<EligibleFields & DepFields>,
  now: number,
  maxRetries: number,
  depsSatisfied: (item: DepFields, queue: DepFields[]) => boolean,
): boolean {
  return queue.some((i) => isEligibleNow(i, now, maxRetries) && depsSatisfied(i, queue));
}

export type PostCycleAction = 'drain_now' | 'schedule_wake' | 'idle';

/**
 * Decisión al TERMINAR un ciclo de processQueue:
 *  - 'drain_now'     → queda trabajo elegible con deps satisfechas (p.ej. un
 *                      pending encolado durante el ciclo): re-drenar ya.
 *  - 'schedule_wake' → solo quedan errores en backoff futuro: armar el timer.
 *  - 'idle'          → nada pendiente: limpiar cualquier timer.
 * Pura para poder probar la lógica sin cablear todo processQueue.
 */
export function decidePostCycleAction(
  queue: Array<EligibleFields & DepFields>,
  now: number,
  maxRetries: number,
  depsSatisfied: (item: DepFields, queue: DepFields[]) => boolean,
): PostCycleAction {
  if (hasImmediateDrainableWork(queue, now, maxRetries, depsSatisfied)) return 'drain_now';
  if (nextWakeDelayMs(queue, { maxRetries, now }) != null) return 'schedule_wake';
  return 'idle';
}

export interface PostCycleParams {
  /** true si el ciclo cayó en el catch de processQueue (throw INESPERADO). */
  hadUnhandledCycleError: boolean;
  queue: Array<EligibleFields & DepFields>;
  now: number;
  maxRetries: number;
  depsSatisfied: (item: DepFields, queue: DepFields[]) => boolean;
}

/**
 * Decisión post-ciclo endurecida contra el re-drenaje automático tras un error
 * INESPERADO del ciclo (P1 + P2 de Codex).
 *
 * Si el ciclo cayó en `catch` por un throw determinístico ANTES de que ningún
 * ítem cambie de estado (p.ej. en `computeProcessingOrder`, un helper o el
 * logger), la cola conserva exactamente el mismo trabajo "elegible":
 *  - `drain_now` haría `setTimeout(0)` → re-entra → re-lanza → loop instantáneo
 *    (P1 original).
 *  - `schedule_wake` tampoco es seguro: si además hay un ítem `error` con
 *    backoff ya vencido, el throw ocurre antes de procesarlo, sus `retries`
 *    NUNCA avanzan hacia `dead`, y el timer re-armaría cada ~minDelay (250 ms)
 *    un loop sostenido de timers/logs (P2 del re-review).
 *
 * Por eso, tras un error inesperado la política es **idle duro**: no re-drenar,
 * no agendar timer. La cola queda a la espera de un evento EXTERNO — foreground,
 * reconexión, enqueue nuevo o reintento manual — y el error queda logueado
 * (`cycle_unhandled_error`) para diagnóstico.
 *
 * Sin error, mantiene la lógica normal (`drain_now` incluido).
 */
export function decidePostCycleActionAfterCycle(params: PostCycleParams): PostCycleAction {
  const { hadUnhandledCycleError, queue, now, maxRetries, depsSatisfied } = params;
  if (hadUnhandledCycleError) return 'idle';
  return decidePostCycleAction(queue, now, maxRetries, depsSatisfied);
}

export interface WakeDelayOpts {
  maxRetries: number;
  now: number;
  /** piso del delay para que un ítem ya vencido dispare pronto sin busy-loop */
  minDelayMs?: number;
  /** techo defensivo (el backoff real nunca pasa de ~30s) */
  maxDelayMs?: number;
}

/**
 * Delay (ms) hasta que el ítem-en-error más próximo esté listo para reintentar,
 * acotado a [minDelayMs, maxDelayMs]. Los vencidos / sin next_retry_at colapsan
 * a minDelayMs. Devuelve `null` cuando NO hay nada que agendar.
 *
 * Solo considera ítems en `error` (retries acotados → 0..MAX), nunca `pending`:
 * incluir pending arriesgaría un busy-loop si un pending queda bloqueado por
 * dependencia. Pending se despierta por evento (enqueue / reconexión / AppState).
 */
export function nextWakeDelayMs(
  queue: Array<Pick<SyncQueueItem, 'status' | 'retries' | 'next_retry_at'>>,
  opts: WakeDelayOpts,
): number | null {
  const { maxRetries, now, minDelayMs = 250, maxDelayMs = 60000 } = opts;
  let soonest: number | null = null;
  for (const i of queue) {
    if (i.status === 'error' && i.retries < maxRetries) {
      const due = i.next_retry_at ?? 0;
      if (soonest === null || due < soonest) soonest = due;
    }
  }
  if (soonest === null) return null;
  const raw = soonest - now;
  return Math.max(minDelayMs, Math.min(maxDelayMs, raw));
}
