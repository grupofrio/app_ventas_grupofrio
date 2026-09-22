/** Prevent operational writes from using an expired or invalid day bundle. */

import { loadCurrentEmployeeDayBundle } from './employeeDayBundle.ts';

export type DayBundleActionBlockReason = 'missing' | 'expired' | 'invalid';

export class DayBundleActionBlockedError extends Error {
  readonly reason: DayBundleActionBlockReason;

  constructor(reason: DayBundleActionBlockReason) {
    super(describeDayBundleActionBlock({ reason }).message);
    this.name = 'DayBundleActionBlockedError';
    this.reason = reason;
  }
}

export function describeDayBundleActionBlock(
  error: Pick<DayBundleActionBlockedError, 'reason'>,
): { title: string; message: string; canRefresh: true } {
  switch (error.reason) {
    case 'expired':
      return {
        title: 'Datos del día vencidos',
        message: 'Los datos del día vencieron. Actualízalos antes de registrar cambios.',
        canRefresh: true,
      };
    case 'invalid':
      return {
        title: 'Datos del día no disponibles',
        message: 'Los datos guardados no se pudieron validar. Actualízalos antes de registrar cambios.',
        canRefresh: true,
      };
    case 'missing':
      return {
        title: 'Datos del día no disponibles',
        message: 'Este dispositivo aún no tiene los datos del día. Prepáralos antes de registrar cambios.',
        canRefresh: true,
      };
  }
}

// TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation.
// Uses console directly (not src/utils/logger.ts) — see comment in
// src/services/employeeDayBundle.ts for why.
function diagLog(event: string, data: Record<string, unknown>): void {
  console.log(`[DIAG day-bundle] ${event}`, data);
}

export async function assertCurrentEmployeeDayBundleAllowsActions(): Promise<void> {
  let loaded: Awaited<ReturnType<typeof loadCurrentEmployeeDayBundle>>;
  try {
    loaded = await loadCurrentEmployeeDayBundle();
  } catch (error) {
    diagLog('gate_blocked', {
      hasBundle: false,
      reason: 'invalid',
      message: error instanceof Error ? error.message : String(error),
    });
    throw new DayBundleActionBlockedError('invalid');
  }
  // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
  diagLog('gate_check', {
    hasBundle: loaded !== null,
    operationalDate: loaded?.record.bundle.operational_date ?? null,
    expiresAt: loaded?.record.bundle.expires_at ?? null,
    nowMs: Date.now(),
    accessMode: loaded?.access.mode ?? null,
    canRead: loaded?.access.canRead ?? null,
    canRunActions: loaded?.access.canRunActions ?? null,
    canStartRoute: loaded?.access.canStartRoute ?? null,
  });
  if (!loaded) {
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagLog('gate_blocked', {
      hasBundle: false,
      reason: 'missing',
    });
    throw new DayBundleActionBlockedError('missing');
  }
  if (!loaded.access.canRunActions) {
    // A loaded bundle without write permission is intentionally treated as
    // expired. The access evaluator is the single source of that decision.
    diagLog('gate_blocked', {
      hasBundle: true,
      accessMode: loaded.access.mode,
      reason: 'expired',
    });
    throw new DayBundleActionBlockedError('expired');
  }
}
