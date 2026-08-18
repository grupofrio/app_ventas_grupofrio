import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../app/nosale/[stopId].tsx', import.meta.url), 'utf8');
assert.match(screen, /useEmployeeDayBundleStore/);
assert.doesNotMatch(screen, /NO_SALE_REASONS|const COMPETITORS/);
assert.match(screen, /persistOpenNoSaleIntent/);
assert.match(screen, /validateNoSaleCapture/);
assert.match(screen, /Especifica la causa/);
assert.match(screen, /supervisor/);
assert.doesNotMatch(screen, /await reportIncident\s*\(/);
console.log('no sale reasons tests: ok');
