/** Prevent operational writes from using an expired or invalid day bundle. */

import { loadCurrentEmployeeDayBundle } from './employeeDayBundle.ts';

// TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation.
// Uses console directly (not src/utils/logger.ts) — see comment in
// src/services/employeeDayBundle.ts for why.
function diagLog(event: string, data: Record<string, unknown>): void {
  console.log(`[DIAG day-bundle] ${event}`, data);
}

export async function assertCurrentEmployeeDayBundleAllowsActions(): Promise<void> {
  const loaded = await loadCurrentEmployeeDayBundle();
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
  if (!loaded || !loaded.access.canRunActions) {
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagLog('gate_blocked', {
      hasBundle: loaded !== null,
      accessMode: loaded?.access.mode ?? null,
    });
    throw new Error('El bundle del día está vencido o no es válido. Renúevalo antes de registrar cambios.');
  }
}
