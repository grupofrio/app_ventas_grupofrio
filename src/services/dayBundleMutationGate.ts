/** Prevent operational writes from using an expired or invalid day bundle. */

import { loadCurrentEmployeeDayBundle } from './employeeDayBundle.ts';

export async function assertCurrentEmployeeDayBundleAllowsActions(): Promise<void> {
  const loaded = await loadCurrentEmployeeDayBundle();
  if (!loaded || !loaded.access.canRunActions) {
    throw new Error('El bundle del día está vencido o no es válido. Renúevalo antes de registrar cambios.');
  }
}
