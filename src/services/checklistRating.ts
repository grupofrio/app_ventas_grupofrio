export type ChecklistRating = 'bien' | 'regular' | 'mal';

export const CHECKLIST_RATING_OPTIONS: Array<{ value: ChecklistRating; label: string }> = [
  { value: 'bien', label: 'Bien' },
  { value: 'regular', label: 'Regular' },
  { value: 'mal', label: 'Mal' },
];

const RATING_FLAGS = [
  'rating_v2',
  'vehicle_checklist_rating_v2',
  'checklist_rating_v2',
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function sourceEnablesRating(source: Record<string, unknown>): boolean {
  if (RATING_FLAGS.some((key) => source[key] === true)) return true;
  return source.checklist_rating_mode === 'v2';
}

/** v2 stays off unless the server explicitly turns the flag on. */
export function isChecklistRatingV2(...sources: unknown[]): boolean {
  for (const source of sources) {
    const record = asRecord(source);
    if (!record) continue;
    if (sourceEnablesRating(record)) return true;
    const nested = [record.settings, record.checklist, record.data, record.plan];
    if (nested.some((entry) => {
      const child = asRecord(entry);
      return child ? sourceEnablesRating(child) : false;
    })) return true;
  }
  return false;
}

export function parseChecklistRating(value: unknown): ChecklistRating | null {
  if (value === 'bien' || value === 'regular' || value === 'mal') return value;
  return null;
}

export function ratingToResultBool(rating: ChecklistRating): boolean {
  return rating === 'bien';
}
