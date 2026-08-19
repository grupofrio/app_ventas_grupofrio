/**
 * Pure helpers for the single-save vehicle checklist flow.
 *
 * The screen validates locally, then submits each changed/unsubmitted answer
 * via existing submitVehicleCheck, and only then completes. No batch BE endpoint.
 */

import type { GFVehicleCheck, VehicleCheckAnswer } from '../types/routeStart';
import { buildYesNoVehicleCheckAnswer } from './vehicleChecklistLogic.ts';

export interface ChecklistDraft {
  bool?: boolean;
  numeric?: string;
  text?: string;
  reason?: string;
  photoUri?: string;
  queued?: boolean;
}

export interface MissingRequiredCheck {
  id: number;
  sequence: number;
  name: string;
}

export type DraftsMap = Record<number, ChecklistDraft | undefined>;

export function getChecklistDraft(
  drafts: DraftsMap,
  checkId: number,
): ChecklistDraft | undefined {
  return drafts[checkId];
}

function parseDraftNumeric(draft: ChecklistDraft | undefined): number | null {
  const n = parseFloat(draft?.numeric ?? '');
  return Number.isFinite(n) ? n : null;
}

/** A draft currently holds a locally valid answer for this check type. */
export function draftHasValidAnswer(
  check: Pick<GFVehicleCheck, 'check_type'>,
  draft: ChecklistDraft | undefined,
): boolean {
  if (!draft) return false;
  if (check.check_type === 'yes_no') return draft.bool != null;
  if (check.check_type === 'numeric') return parseDraftNumeric(draft) != null;
  if (check.check_type === 'text') return !!(draft.text || '').trim();
  if (check.check_type === 'photo') return !!draft.photoUri;
  return false;
}

/**
 * Required item is satisfied locally when it is already answered on the
 * server, queued offline, or the current draft is a valid answer.
 */
export function isCheckSatisfiedLocally(
  check: Pick<GFVehicleCheck, 'answered' | 'check_type' | 'required' | 'result_photo_url'>,
  draft: ChecklistDraft | undefined,
): boolean {
  if (draft?.queued) return true;
  if (check.answered) return true;
  if (check.check_type === 'photo' && check.result_photo_url) return true;
  return draftHasValidAnswer(check, draft);
}

/** Whether this check still needs a network/queue submit from the current draft. */
export function checkNeedsSubmit(
  check: GFVehicleCheck,
  draft: ChecklistDraft | undefined,
): boolean {
  if (!draft || draft.queued) return false;
  if (check.check_type === 'photo') return !!draft.photoUri;
  if (!draftHasValidAnswer(check, draft)) return false;
  if (!check.answered) return true;

  if (check.check_type === 'yes_no') {
    return draft.bool != null && draft.bool !== check.result_bool;
  }
  if (check.check_type === 'numeric') {
    const n = parseDraftNumeric(draft);
    return n != null && n !== check.result_numeric;
  }
  if (check.check_type === 'text') {
    return (draft.text || '').trim() !== (check.result_text || '');
  }
  return false;
}

export function collectMissingRequiredChecks(
  checks: GFVehicleCheck[],
  drafts: DraftsMap,
): MissingRequiredCheck[] {
  return checks
    .filter((check) => check.required && !isCheckSatisfiedLocally(check, getChecklistDraft(drafts, check.id)))
    .map((check) => ({ id: check.id, sequence: check.sequence, name: check.name }));
}

export function formatMissingRequiredChecks(missing: MissingRequiredCheck[]): string {
  if (missing.length === 0) return '';
  const listed = missing
    .map((item) => `${item.sequence}. ${item.name}`)
    .join('\n');
  return `Responde todos los puntos obligatorios antes de guardar:\n${listed}`;
}

/**
 * Local validation for the single-save action. Callers MUST NOT mutate the
 * network when `ok` is false.
 */
export function validateRequiredChecklistDrafts(
  checks: GFVehicleCheck[],
  drafts: DraftsMap,
): { ok: boolean; missing: MissingRequiredCheck[] } {
  const missing = collectMissingRequiredChecks(checks, drafts);
  return { ok: missing.length === 0, missing };
}

export function collectUnsubmittedChecks(
  checks: GFVehicleCheck[],
  drafts: DraftsMap,
): GFVehicleCheck[] {
  return checks.filter((check) => checkNeedsSubmit(check, getChecklistDraft(drafts, check.id)));
}

export type BuildDraftAnswerResult =
  | { ok: true; answer: VehicleCheckAnswer }
  | { ok: false; error: string };

export function buildAnswerFromDraft(input: {
  check: GFVehicleCheck;
  draft: ChecklistDraft;
  photoBase64?: string | null;
  photoOnline?: boolean;
}): BuildDraftAnswerResult {
  const { check, draft } = input;

  if (check.check_type === 'yes_no') {
    if (draft.bool == null) {
      return { ok: false, error: 'Selecciona Sí o No.' };
    }
    return {
      ok: true,
      answer: buildYesNoVehicleCheckAnswer({
        value: draft.bool,
        expected: check.expected_bool,
        reason: draft.reason,
      }),
    };
  }

  if (check.check_type === 'numeric') {
    const n = parseDraftNumeric(draft);
    if (n == null) {
      return { ok: false, error: 'Captura un número.' };
    }
    return { ok: true, answer: { result_numeric: n } };
  }

  if (check.check_type === 'text') {
    const t = (draft.text || '').trim();
    if (!t) {
      return { ok: false, error: 'Escribe una respuesta.' };
    }
    return { ok: true, answer: { result_text: t } };
  }

  if (check.check_type === 'photo') {
    if (!draft.photoUri) {
      return { ok: false, error: 'Toma la foto antes de guardar este punto.' };
    }
    if (input.photoOnline) {
      if (!input.photoBase64) {
        return { ok: false, error: 'No se pudo leer la foto. Tómala de nuevo.' };
      }
      return {
        ok: true,
        answer: {
          result_photo: input.photoBase64,
          result_photo_filename: `odometro_${check.id}_${Date.now()}.jpg`,
        },
      };
    }
    // Offline: URI stays on the queue payload; dispatcher reads base64 later.
    return { ok: true, answer: { result_photo: '' } };
  }

  return { ok: false, error: `Este punto (${check.check_type}) no se puede responder en esta versión.` };
}
