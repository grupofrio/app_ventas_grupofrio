import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const gps = read('src/services/gps.ts');
const checkin = read('app/checkin/[stopId].tsx');
const checkout = read('app/checkout/[stopId].tsx');
const noSale = read('app/nosale/[stopId].tsx');

assert.match(
  gps,
  /export async function ensureForegroundLocationPermission/,
  'GPS service must expose a contextual foreground permission request',
);
assert.match(
  gps,
  /requestForegroundPermissionsAsync\(\)/,
  'foreground permission helper must show the native Android permission prompt',
);
assert.match(
  checkin,
  /await ensureForegroundLocationPermission\(\)/,
  'check-in must request foreground location permission when the screen needs GPS',
);
assert.match(
  checkin,
  /Linking\.openSettings\(\)/,
  'permanently denied permission must offer a direct path to Android app settings',
);
assert.match(
  checkin,
  /canCheckIn[\s\S]{0,240}hasValidFix/,
  'distance override may bypass the geofence but must not bypass having a real GPS fix',
);
assert.match(
  checkin,
  /!gpsLoading\s*&&\s*\(!hasValidFix\s*\|\|\s*\(!isWithinFence\s*&&\s*hasCustomerCoords\)\)/,
  'the permission/retry action must remain visible whenever there is no GPS fix',
);

const checkinHandler = checkin.match(/async function handleCheckIn\(\)[\s\S]*?\n  function handleOpenLocation/)?.[0] ?? '';
assert.match(checkinHandler, /await publishGpsPointNow\(/);
assert.ok(
  checkinHandler.indexOf('await publishGpsPointNow(') < checkinHandler.indexOf('await checkIn('),
  'check-in must publish a fresh GPS point before asking Odoo to validate check-in',
);

const checkoutHandler = checkout.match(/async function handleCheckout\([\s\S]*?\n  \/\/ F1\.10/)?.[0] ?? '';
assert.match(checkoutHandler, /await publishGpsPointNow\(/);
assert.ok(
  checkoutHandler.indexOf('await publishGpsPointNow(') < checkoutHandler.indexOf('await checkOut('),
  'check-out must publish a fresh GPS point before asking Odoo to validate check-out',
);

const noSaleHandler = noSale.match(/async function handleSave\(\)[\s\S]*?\n  const notesLabel/)?.[0] ?? '';
assert.match(noSaleHandler, /await publishGpsPointNow\(/);
assert.ok(
  noSaleHandler.indexOf('await publishGpsPointNow(') < noSaleHandler.indexOf('await checkOut('),
  'no-sale checkout must publish a fresh GPS point before asking Odoo to validate check-out',
);

console.log('visit GPS preflight wiring tests: ok');
