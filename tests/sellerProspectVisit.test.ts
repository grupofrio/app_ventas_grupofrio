import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const saleScreen = readFileSync(resolve('app/sale/[stopId].tsx'), 'utf8');
const newProspectScreen = readFileSync(resolve('app/newcustomer.tsx'), 'utf8');
const postvisitScreen = readFileSync(resolve('app/postvisit/[stopId].tsx'), 'utf8');
const offrouteScreen = readFileSync(resolve('app/offroute.tsx'), 'utf8');
const pinMap = readFileSync(resolve('src/components/domain/ProspectPinMap.tsx'), 'utf8');

function testScreensKeepTheSellerBoundaries() {
  assert.match(saleScreen, /Prospecto no vendible/);
  assert.match(newProspectScreen, /ProspectPinMap/);
  assert.match(newProspectScreen, /Guardar y abrir visita/);
  assert.match(newProspectScreen, /\/checkin\/\$\{virtualStopId\}/);
  assert.match(
    newProspectScreen,
    /const openVisit = \(\) => router\.replace\(`\/checkin\/\$\{virtualStopId\}` as never\);\s*openVisit\(\);/,
    'saving a prospect must open the visit even if the alert is dismissed',
  );
  assert.match(
    newProspectScreen,
    /if \(!visitOpened\) setSaving\(false\);/,
    'Guardar must stay disabled after the visit opens so it cannot create a second prospect',
  );
  assert.doesNotMatch(
    newProspectScreen,
    /buildProspectionPayload\(form, \{ latitude, longitude \}\)/,
  );
  assert.match(postvisitScreen, /customerSaleRoute\(/);
  assert.match(postvisitScreen, /Dejar el pin aquí/);
  assert.match(postvisitScreen, /Convertir a cliente/);
  assert.match(offrouteScreen, /Nuevo prospecto/);
  assert.match(offrouteScreen, /tienda nueva no se registra aquí/i);
  assert.match(pinMap, /\}, \[focusToken\]\);/);
  assert.doesNotMatch(
    pinMap,
    /\}, \[center, focusToken\]\);/,
    'the camera must not recenter on every parent render after the pin is placed',
  );
}

async function main() {
  const flow = await import(
    new URL('../src/services/sellerProspectVisit.ts', import.meta.url).pathname
  );
  const payload = await import(
    new URL('../src/services/postvisitPayload.ts', import.meta.url).pathname
  );

  assert.equal(flow.isUsableCoordinate(0, 0), false);
  assert.equal(flow.isUsableCoordinate(19.4, -99.1), true);
  assert.equal(flow.pinFromRecord(19.4, -99.1)?.latitude, 19.4);
  assert.equal(flow.pinFromRecord(null, null), null);

  assert.equal(flow.prospectPhoneOrNull(''), null);
  assert.equal(flow.prospectPhoneOrNull('5512345678'), '+525512345678');
  assert.equal(flow.customerSaleRoute(42), '/sale/42');

  const missingPhone = flow.convertBlockers({
    phone: '',
    pinPlaced: true,
    leadId: 9,
    stopId: 100,
  });
  assert.deepEqual(missingPhone, ['phone']);

  const missingPin = flow.convertBlockers({
    phone: '5512345678',
    pinPlaced: false,
    leadId: 9,
    stopId: 100,
  });
  assert.deepEqual(missingPin, ['pin']);
  assert.match(flow.convertBlockMessage('pin'), /no guarda el GPS/);

  const plannedWithoutLead = flow.convertBlockers({
    phone: '5512345678',
    pinPlaced: true,
    leadId: null,
    stopId: 4333,
  });
  assert.deepEqual(plannedWithoutLead, []);

  const visitWaitingForSync = flow.convertBlockers({
    phone: '5512345678',
    pinPlaced: true,
    leadId: null,
    pendingLeadOperationId: 'op-1',
    stopId: -10,
  });
  assert.deepEqual(visitWaitingForSync, ['lead_pending']);

  const rejected = flow.prepareTodayProspectVisit({
    form: { nombre: 'Abarrotes Norte', telefono: '5512345678', direccion: '', giro: '', notas: '' },
    pin: null,
    localCustomerId: 50,
  });
  assert.equal(rejected.ok, false);

  const prepared = flow.prepareTodayProspectVisit({
    form: {
      nombre: 'Abarrotes Norte',
      telefono: '5512345678',
      direccion: 'Calle 1',
      giro: '',
      notas: '',
    },
    pin: { latitude: 19.43, longitude: -99.13 },
    localCustomerId: 50,
    pendingLeadOperationId: 'op-1',
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.visit.payload._source, 'nuevo_lead_ruta');
  assert.equal(prepared.visit.payload.latitude, 19.43);
  assert.equal(prepared.visit.payload.longitude, -99.13);
  assert.equal(prepared.visit.payload.phone, '+525512345678');
  assert.equal(prepared.visit.virtualStop.entityType, 'lead');
  assert.equal(prepared.visit.virtualStop.customerLatitude, 19.43);
  assert.equal(prepared.visit.virtualStop.phone, '+525512345678');
  assert.equal(prepared.visit.virtualStop.pendingLeadOperationId, 'op-1');
  assert.equal(prepared.visit.virtualStop.customerId, 50);

  const stops = [{
    id: -8,
    customer_id: 50,
    customer_name: 'Abarrotes Norte',
    state: 'in_progress' as const,
    source_model: 'gf.route.stop' as const,
    _pendingLeadOperationId: 'op-1',
    _leadId: null,
  }];
  const patches = flow.pendingLeadVisitPatches(stops as never, 'op-1', 77);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].patch._leadId, 77);
  assert.equal(patches[0].patch._pendingLeadOperationId, null);
  assert.equal(flow.readCreatedLeadId({ id: 77 }), 77);
  assert.equal(flow.readCreatedLeadId({ id: 0 }), null);

  const saved = payload.buildPostvisitPayload({
    stop: {
      id: 4333,
      customer_name: 'Lead Plaza',
      _entityType: 'lead',
      _leadId: 51,
    },
    form: {
      contactName: 'Ana',
      phone: '5512345678',
      email: '',
      competitor: '',
      freezer: 'no',
      interestLevel: 'low',
      notes: '',
    },
    stageId: 15,
    pin: { latitude: 20.1, longitude: -103.3 },
    street: 'Puerta 2',
    vat: 'XAXX010101000',
  });
  assert.equal(saved.latitude, 20.1);
  assert.equal(saved.longitude, -103.3);
  assert.equal(saved.street, 'Puerta 2');
  assert.equal(saved.vat, 'XAXX010101000');

  const withoutPin = payload.buildPostvisitPayload({
    stop: {
      id: 4333,
      customer_name: 'Lead Plaza',
      _entityType: 'lead',
      _leadId: 51,
    },
    form: {
      contactName: '',
      phone: '',
      email: '',
      competitor: '',
      freezer: 'no',
      interestLevel: 'low',
      notes: '',
    },
    stageId: 15,
    pin: null,
  });
  assert.equal('latitude' in withoutPin, false);
  assert.equal('longitude' in withoutPin, false);

  testScreensKeepTheSellerBoundaries();
  console.log('seller prospect visit tests: ok');
}

void main();
