import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * F3.3 — operation_id idempotente en no-venta (antes no tenía NINGUNO — hoy
 * duplica incidente/checkout si el reintento automático llega después de un
 * fallo ambiguo) y estabilidad del id en cambio/consignación/preventa (antes
 * generaban uno NUEVO en cada intento, invalidando cualquier dedupe del
 * backend en un reintento manual).
 *
 * Nota: el backend NO deduplica todavía por operation_id en no-venta/incidentes
 * (pendiente B1.3 del plan) — esto deja el frontend listo para cuando lo haga.
 */
const root = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function main() {
  // ── nosale: durable encrypted intent + single-flight + checkout operation_id ──
  const nosale = read('app/nosale/[stopId].tsx');
  assert(/persistOpenNoSaleIntent/.test(nosale),
    'no-venta debe persistir operation_id cifrado antes de mutar');
  assert(/createSaleConfirmationSingleFlight/.test(nosale),
    'no-venta debe bloquear doble-tap con single-flight');
  assert(/!singleFlightRef\.current\.tryAcquire\(\)/.test(nosale),
    'no-venta debe adquirir single-flight al guardar');
  assert(!/await reportIncident\(/.test(nosale),
    'no-venta canónica no debe llamar reportIncident (checkout es la autoridad)');
  assert(/checkOut\(\s*\n\s*checkoutPayload\.stop_id,[\s\S]{0,400}operationId,\s*\n\s*\);/.test(nosale),
    'la llamada online a checkOut debe mandar el operation_id estable');
  assert(/enqueue\(\s*\n\s*'checkout',[\s\S]{0,200}operation_id: operationId,/.test(nosale),
    'el checkout encolado debe llevar el mismo operation_id que el intento online');
  assert(!/enqueue\('no_sale'/.test(nosale),
    'el flujo nuevo no encola sync type no_sale (histórico se mantiene en dispatcher)');

  // ── gfLogistics: reportIncident/checkOut aceptan y mandan operation_id ──
  const gfLogistics = read('src/services/gfLogistics.ts');
  assert(/export async function reportIncident\([\s\S]{0,200}operationId\?: string \| null,/.test(gfLogistics),
    'reportIncident debe aceptar un operationId opcional');
  assert(/export async function checkOut\([\s\S]{0,600}operationId\?: string \| null,/.test(gfLogistics),
    'checkOut debe aceptar un operationId opcional');

  // ── useSyncStore: el dispatcher reenvía operation_id desde el payload ──
  const syncStore = read('src/stores/useSyncStore.ts');
  assert(/case 'no_sale':[\s\S]{0,800}payload\.operation_id as string \| undefined,/.test(syncStore),
    'el dispatcher de no_sale histórico debe reenviar operation_id desde el item encolado');
  assert(/case 'checkout':[\s\S]{0,600}payload\.operation_id as string \| undefined,/.test(syncStore),
    'el dispatcher de checkout debe reenviar operation_id desde el item encolado');

  // ── exchange: idempotency_key estable, no uno nuevo por intento ──
  const exchange = read('app/exchange/[stopId].tsx');
  assert(/const idempotencyKeyRef = useRef<string \| null>\(null\)/.test(exchange),
    'cambio debe mantener un idempotency_key estable vía ref');
  assert(/idempotencyKeyRef\.current = null; \/\/ siguiente cambio = nueva key/.test(exchange),
    'el key de cambio se regenera solo tras un envío exitoso');

  // ── presale: operationId estable ──
  const presale = read('app/presale.tsx');
  assert(/const operationIdRef = useRef<string \| null>\(null\)/.test(presale),
    'preventa debe mantener un operationId estable vía ref');
  assert(/operationIdRef\.current = null; \/\/ siguiente preventa = nuevo id/.test(presale),
    'el id de preventa se regenera solo tras un envío exitoso');

  // ── consignment: visita y cierre mantienen keys estables e independientes ──
  const consignment = read('app/consignment/[stopId].tsx');
  assert(/const visitOperationIdRef = useRef<string \| null>\(null\)/.test(consignment),
    'consignación debe mantener un operationId estable para VISITA');
  assert(/const closeOperationIdRef = useRef<string \| null>\(null\)/.test(consignment),
    'consignación debe mantener un operationId estable e independiente para CIERRE');
  assert(/visitOperationIdRef\.current = null; \/\/ siguiente visita = nuevo id/.test(consignment),
    'el id de visita se regenera solo tras esa visita tener éxito');
  assert(/closeOperationIdRef\.current = null; \/\/ siguiente cierre = nuevo id/.test(consignment),
    'el id de cierre se regenera solo tras ese cierre tener éxito');

  console.log('operation_id idempotency wiring tests: ok');
}

main();
