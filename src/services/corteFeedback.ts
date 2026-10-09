export interface CorteFeedbackError {
  message?: string;
  details?: unknown;
  data?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function pushErrorLines(target: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    target.push(value.trim());
    return;
  }
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      target.push(entry.trim());
      continue;
    }
    const record = asRecord(entry);
    if (!record) continue;
    const message = typeof record.message === 'string'
      ? record.message
      : typeof record.error === 'string'
        ? record.error
        : '';
    if (message.trim()) target.push(message.trim());
  }
}

export function collectCorteErrorLines(error: CorteFeedbackError): string[] {
  const lines: string[] = [];
  const details = asRecord(error.details);
  const data = asRecord(error.data);
  const nestedDetails = asRecord(data?.details);
  pushErrorLines(lines, details?.errors);
  pushErrorLines(lines, data?.errors);
  pushErrorLines(lines, nestedDetails?.errors);
  const unique: string[] = [];
  for (const line of lines) {
    if (!unique.includes(line)) unique.push(line);
  }
  return unique;
}

export function formatCorteFailureMessage(error: CorteFeedbackError, fallback: string): string {
  const headline = error.message?.trim() || fallback;
  const details = collectCorteErrorLines(error);
  if (details.length === 0) return headline;
  return [headline, ...details].join('\n');
}

export function corteAdjustmentWasIgnored(result: {
  message?: string | null;
  ignored_manual_qty?: unknown;
  manual_qty_applied?: unknown;
  data?: unknown;
} | null | undefined): boolean {
  if (!result) return false;
  const data = asRecord(result.data);
  const ignored = result.ignored_manual_qty ?? data?.ignored_manual_qty;
  if (typeof ignored === 'number' && ignored > 0) return true;
  const applied = result.manual_qty_applied ?? data?.manual_qty_applied;
  if (applied === false) return true;
  const message = `${result.message ?? ''} ${typeof data?.message === 'string' ? data.message : ''}`;
  return /no se guardaron cantidades/i.test(message);
}

export function corteAdjustmentTitle(result: {
  message?: string | null;
  ignored_manual_qty?: unknown;
  manual_qty_applied?: unknown;
  data?: unknown;
} | null | undefined): string {
  return corteAdjustmentWasIgnored(result) ? 'No se guardaron cantidades' : 'Ajustes guardados';
}
