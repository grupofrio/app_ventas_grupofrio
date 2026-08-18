/**
 * F2.2 — "lint que prohíba fontSize suelto sin preset".
 *
 * No hay ESLint en este proyecto (ni configuración ni dependencia) — este
 * guard sigue el mismo patrón ya establecido en tests/noPrivilegedOdooClient
 * y demás *Wiring.test.mjs: un check de fuente vía node --test, corrido por
 * `npm test`.
 *
 * Ratchet, no big-bang: al momento de escribir este guard, 61 archivos ya
 * usan `fontSize:` suelto en vez de los 16 presets de src/theme/typography.ts
 * (migración real es trabajo de F2.4, pantalla por pantalla). BASELINE los
 * deja pasar por ahora. Cualquier archivo NUEVO, o cualquier archivo que ya
 * se migró y se sacó de BASELINE, debe usar `typography.*` — si aparece
 * `fontSize:` ahí, el guard falla.
 *
 * Al migrar una pantalla en F2.4: quita su ruta de BASELINE en el mismo
 * commit. La lista solo debe achicarse.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const BASELINE = new Set([
  'app/(tabs)/_layout.tsx',
  'app/(tabs)/alerts.tsx',
  'app/(tabs)/inventory.tsx',
  'app/(tabs)/tasks.tsx',
  'app/analytics.tsx',
  'app/checklist/[planId].tsx',
  'app/incident.tsx',
  'app/loyalty/[partnerId].tsx',
  'app/print-exchange/[snapshotId].tsx',
  'app/print/[orderId].tsx',
  'app/profile.tsx',
  'app/ranking.tsx',
  'app/refill-accept.tsx',
  'app/stop/[stopId].tsx',
  'app/sync.tsx',
  'src/components/OperationGate.tsx',
  'src/components/domain/CatalogProductPicker.tsx',
  'src/components/domain/ForecastCard.tsx',
  'src/components/domain/GiftProductPicker.tsx',
  'src/components/domain/ProductPicker.tsx',
  'src/components/domain/RouteActionsMenu.tsx',
  'src/components/domain/RouteLoadAcceptanceCard.tsx',
  'src/components/domain/RouteMap.tsx',
  'src/components/domain/RoutePreparationCard.tsx',
  'src/components/domain/RouteStopPanel.tsx',
  'src/components/domain/ScoreCard.tsx',
  'src/components/domain/StopCard.tsx',
  'src/components/domain/ThermalPrinterPicker.tsx',
  'src/components/domain/TicketOutputScreen.tsx',
  'src/components/ui/AlertBanner.tsx',
  'src/components/ui/CacheStatusBadge.tsx',
  'src/components/ui/CalendarPicker.tsx',
  'src/components/ui/GeoFenceBar.tsx',
  'src/components/ui/KPICard.tsx',
  'src/components/ui/SaveIndicator.tsx',
  'src/components/ui/ScoreRing.tsx',
  'src/components/ui/SyncBar.tsx',
  'src/components/ui/TopBar.tsx',
  'src/shims/react-native-maps.web.tsx',
]);

const SCAN_DIRS = ['app', 'src'];
const SKIP_DIR_NAMES = new Set(['node_modules', '.worktrees', '__tests__']);
const FONT_SIZE_PATTERN = /fontSize\s*:/;

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
}

function main() {
  const files = [];
  for (const dir of SCAN_DIRS) walk(join(root, dir), files);

  const offenders = [];
  for (const absPath of files) {
    const relPath = relative(root, absPath).split('\\').join('/');
    if (BASELINE.has(relPath)) continue;
    const content = readFileSync(absPath, 'utf8');
    if (FONT_SIZE_PATTERN.test(content)) {
      offenders.push(relPath);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Estos archivos usan fontSize suelto y no están en BASELINE (deben usar ` +
    `un preset de src/theme/typography.ts, o si es legítimamente nuevo trabajo ` +
    `de F2.4 sin terminar, agregarlo a BASELINE a propósito): ${offenders.join(', ')}`,
  );

  // BASELINE solo debe achicarse — si un archivo listado ya no existe o ya
  // no tiene fontSize suelto, hay que sacarlo de la lista (no es un error
  // duro: el guard no falla por esto, pero avisa para mantenerla honesta).
  for (const relPath of BASELINE) {
    const absPath = join(root, relPath);
    try {
      const content = readFileSync(absPath, 'utf8');
      if (!FONT_SIZE_PATTERN.test(content)) {
        console.warn(`[noRawFontSizeOutsideBaseline] ${relPath} ya no tiene fontSize suelto — sácalo de BASELINE.`);
      }
    } catch {
      console.warn(`[noRawFontSizeOutsideBaseline] ${relPath} en BASELINE ya no existe — sácalo de la lista.`);
    }
  }

  console.log(`no raw fontSize outside baseline: ok (${BASELINE.size} archivos grandfathered, 0 nuevos)`);
}

main();
