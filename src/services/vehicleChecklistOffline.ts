/**
 * Checklist de unidad OFFLINE — helpers puros / RN-free.
 *
 * Política operativa (2026-08-06): un punto reprobado documenta pero NO
 * detiene la salida. Complemento de campo: el checklist debe poder LLENARSE
 * sin señal (zona de carga del CEDIS) — las respuestas se encolan y el
 * cierre viaja con dependsOn cuando regresa la red.
 *
 * Idempotencia natural del contrato: /pwa-ruta/vehicle-check sobreescribe la
 * respuesta del mismo check_id (reintentar no duplica) y
 * /pwa-ruta/vehicle-checklist-complete ya trata already_completed como éxito.
 */

import type { GFVehicleCheck, VehicleCheckAnswer } from '../types/routeStart';

/** Borradores + snapshot de checklist persistidos por plan (sobreviven reinicio). */
export function checklistDraftsStorageKey(planId: number): string {
  return `route:checklistDrafts:${planId}`;
}

export function checklistSnapshotStorageKey(planId: number): string {
  return `route:checklistSnapshot:${planId}`;
}

export interface VehicleCheckQueuePayload {
  check_id: number;
  checklist_id: number;
  plan_id: number;
  answer: VehicleCheckAnswer;
  /** Foto local pendiente: el dispatcher lee el base64 al ENVIAR (no se
   * serializan megabytes en el JSON de la cola). */
  photo_uri?: string;
  photo_filename?: string;
}

export function buildVehicleCheckQueuePayload(input: {
  check: Pick<GFVehicleCheck, 'id' | 'check_type'>;
  checklistId: number;
  planId: number;
  answer: VehicleCheckAnswer;
  photoUri?: string | null;
}): VehicleCheckQueuePayload {
  let answer = input.answer;
  const payload: VehicleCheckQueuePayload = {
    check_id: input.check.id,
    checklist_id: input.checklistId,
    plan_id: input.planId,
    answer,
  };
  if (input.check.check_type === 'photo' && input.photoUri) {
    // La cola NUNCA serializa base64: guarda el URI local y el dispatcher
    // lee la foto del disco al enviar. Si el answer ya traía el base64
    // (fallo online a media petición), se poda aquí.
    const { result_photo: _photo, result_photo_filename: _name, ...rest } =
      answer as Record<string, unknown>;
    answer = rest as VehicleCheckAnswer;
    payload.answer = answer;
    payload.photo_uri = input.photoUri;
    payload.photo_filename = `odometro_${input.check.id}_${Date.now()}.jpg`;
  }
  return payload;
}

/**
 * Proyección optimista de una respuesta encolada sobre la lista local de
 * checks: marca answered y calcula passed con las mismas reglas que el
 * backend (yes_no vs expected_bool; numeric dentro de límites; text/photo
 * cuentan por presencia). El backend sigue siendo la autoridad al sincronizar.
 */
export function applyLocalCheckAnswer(
  checks: GFVehicleCheck[],
  checkId: number,
  answer: VehicleCheckAnswer,
): GFVehicleCheck[] {
  // VehicleCheckAnswer es una unión discriminada por presencia de campo;
  // aquí se lee de forma laxa porque el tipo de check decide qué aplica.
  const fields = answer as {
    result_bool?: boolean;
    result_numeric?: number;
    result_text?: string;
    not_passed_reason?: string;
  };
  return checks.map((check) => {
    if (check.id !== checkId) return check;
    let passed = true;
    if (check.check_type === 'yes_no') {
      const value = fields.result_bool === true;
      passed = check.expected_bool == null ? value : value === check.expected_bool;
    } else if (check.check_type === 'numeric') {
      const n = typeof fields.result_numeric === 'number' ? fields.result_numeric : NaN;
      const hasBounds = !((check.min_value ?? 0) === 0 && (check.max_value ?? 0) === 0);
      passed = Number.isFinite(n)
        && (!hasBounds || ((check.min_value ?? 0) <= n && n <= (check.max_value ?? 0)));
    }
    return {
      ...check,
      answered: true,
      passed,
      result_bool: fields.result_bool ?? check.result_bool,
      result_numeric: fields.result_numeric ?? check.result_numeric,
      result_text: fields.result_text ?? check.result_text,
      not_passed_reason: fields.not_passed_reason ?? check.not_passed_reason,
    };
  });
}

type ChecklistAnswerQueueItem = {
  type: string;
  status: string;
  created_at?: number;
  payload?: Record<string, unknown>;
};

type LatestChecklistAnswer<T> = { item: T; originalIndex: number; createdAt: number };

/**
 * Una nueva respuesta para el mismo check reemplaza a la anterior, incluso
 * cuando la cola no conserva orden cronológico. A igual created_at gana la
 * aparición posterior en la cola, por lo que el orden es (created_at, índice).
 */
function selectLatestChecklistAnswerOps<T extends ChecklistAnswerQueueItem>(queue: T[]): T[] {
  const latestByCheck = new Map<string, LatestChecklistAnswer<T>>();

  queue.forEach((item, originalIndex) => {
    if (item.type !== 'vehicle_check') return;
    const payload = item.payload as { checklist_id?: unknown; check_id?: unknown } | undefined;
    const key = `${String(payload?.checklist_id)}:${String(payload?.check_id)}`;
    const createdAt = typeof item.created_at === 'number' && Number.isFinite(item.created_at)
      ? item.created_at
      : Number.NEGATIVE_INFINITY;
    const current = latestByCheck.get(key);
    if (!current || createdAt > current.createdAt
      || (createdAt === current.createdAt && originalIndex > current.originalIndex)) {
      latestByCheck.set(key, { item, originalIndex, createdAt });
    }
  });

  return [...latestByCheck.values()]
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(({ item }) => item);
}

/**
 * IDs de operaciones de respuesta ENCOLADAS de un checklist, derivados de la
 * COLA (durables: sobreviven salir/volver a la pantalla). El cierre offline
 * depende de esto, no de refs en memoria de la pantalla.
 */
export function collectQueuedChecklistAnswerOps(
  queue: Array<{ id: string } & ChecklistAnswerQueueItem>,
  checklistId: number,
): string[] {
  return selectLatestChecklistAnswerOps(queue)
    .filter((item) => item.payload?.checklist_id === checklistId
      // Sólo estas tres respuestas vigentes pueden completar el cierre.
      && (item.status === 'pending' || item.status === 'syncing' || item.status === 'error'))
    .map((item) => item.id);
}

/** check_ids cuya última respuesta murió en la cola: exigen re-responder. */
export function collectDeadChecklistAnswerCheckIds(
  queue: ChecklistAnswerQueueItem[],
  checklistId: number,
): number[] {
  return selectLatestChecklistAnswerOps(queue)
    .filter((item) => item.status === 'dead' && item.payload?.checklist_id === checklistId)
    .map((item) => Number(item.payload?.check_id) || 0)
    .filter((id) => id > 0);
}

/**
 * IDs terminales de una respuesta concreta. Tras reparar ese punto online se
 * eliminan de forma selectiva, sin tocar otras respuestas ni items vivos.
 */
export function collectDeadChecklistAnswerOpIds(
  queue: Array<{ id: string } & ChecklistAnswerQueueItem>,
  checklistId: number,
  checkId: number,
): string[] {
  return queue
    .filter((item) => item.type === 'vehicle_check'
      && item.status === 'dead'
      && item.payload?.checklist_id === checklistId
      && item.payload?.check_id === checkId)
    .map((item) => item.id);
}

/** ¿Hay un cierre de este checklist ya encolado y no terminado? */
export function hasQueuedChecklistComplete(
  queue: Array<{ type: string; status: string; payload?: Record<string, unknown> }>,
  checklistId: number,
): boolean {
  // Un cierre dead NO cuenta: debe poder reintentarse con un cierre nuevo
  // tras reparar las respuestas.
  return queue.some((item) => item.type === 'vehicle_checklist_complete'
    && item.status !== 'done' && item.status !== 'dead'
    && (item.payload as { checklist_id?: number } | undefined)?.checklist_id === checklistId);
}

/** ¿Todos los puntos requeridos están respondidos (contando encolados)? */
export function areRequiredChecksAnswered(checks: GFVehicleCheck[]): boolean {
  return checks.every((check) => !check.required || check.answered);
}
