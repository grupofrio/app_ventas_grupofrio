/**
 * KoldField — Harness E2E de validación del backend #116 (T1–T6).
 *
 * ⚠️ CREA REGISTROS REALES (ventas/pagos/cierre/liquidación) cuando se corre con
 * `--run`. Por defecto es DRY-RUN: imprime el plan y valida la config SIN red.
 * Ejecutar SOLO contra datos de prueba autorizados (cliente/producto/ruta/van de
 * prueba) y en ventana sin operación real, coordinado con Sebas/Yamil.
 *
 * No es parte del bundle de la app ni del suite de tests. Es una herramienta de
 * QA para correr en la ventana de validación. NO toca backend ni contratos:
 * solo llama los endpoints existentes que usa la app y verifica el contrato #116.
 *
 * Uso:
 *   node scripts/e2e/backend116_validation.mjs            # dry-run (default)
 *   node scripts/e2e/backend116_validation.mjs --run      # ejecuta (crea reales)
 *
 * Config por variables de entorno (NO hardcodear secretos):
 *   KF_BASE_URL      base Odoo (ej. https://grupofrio.odoo.com)
 *   KF_DB            base de datos Odoo (opcional; algunos despliegues la infieren)
 *   KF_BARCODE       código del vendedor de PRUEBA
 *   KF_PIN           PIN del vendedor de PRUEBA
 *   (o) KF_API_KEY + KF_EMP_TOKEN  para saltarse el login
 *   KF_PARTNER_ID    cliente de PRUEBA
 *   KF_PRODUCT_ID    producto almacenable de PRUEBA
 *   KF_AVAIL_QTY     stock conocido del producto en el almacén móvil
 *   KF_WAREHOUSE_ID  almacén/van (opcional)
 *   KF_PLAN_ID       plan de ruta de PRUEBA (para T5/T6; opcional)
 *   KF_TESTS         lista coma-separada de tests a correr (default: T1,T2,T3)
 *                    T5/T6 (cierre/liquidación) solo si KF_PLAN_ID y se incluyen.
 */

const BASE = (process.env.KF_BASE_URL || '').replace(/\/+$/, '');
const DB = process.env.KF_DB || null;
const RUN = process.argv.includes('--run');
const GF_BASE = 'gf/logistics/api/employee';
const PWA = 'pwa-ruta';

const cfg = {
  barcode: process.env.KF_BARCODE || '',
  pin: process.env.KF_PIN || '',
  apiKey: process.env.KF_API_KEY || '',
  empToken: process.env.KF_EMP_TOKEN || '',
  partnerId: num(process.env.KF_PARTNER_ID),
  productId: num(process.env.KF_PRODUCT_ID),
  availQty: num(process.env.KF_AVAIL_QTY),
  warehouseId: num(process.env.KF_WAREHOUSE_ID),
  planId: num(process.env.KF_PLAN_ID),
  tests: (process.env.KF_TESTS || 'T1,T2,T3').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
};

function num(v) { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : null; }
function opId(tag) { return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function log(...a) { console.log(...a); }

function requireConfig(keys) {
  const missing = keys.filter((k) => !cfg[k] && cfg[k] !== 0);
  if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
}

async function login() {
  if (cfg.apiKey) { log('· Usando KF_API_KEY provisto (sin login).'); return; }
  requireConfig(['barcode', 'pin']);
  const res = await fetch(`${BASE}/api/employee-sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', params: { barcode: cfg.barcode, pin: cfg.pin, db: DB } }),
  });
  const j = await res.json();
  const r = j?.result;
  if (!r?.api_key) throw new Error(`Login falló: ${r?.message || JSON.stringify(j?.error || j)}`);
  cfg.apiKey = r.api_key;
  cfg.empToken = r.gf_employee_token || '';
  log('· Login OK (vendedor de prueba).');
}

async function post(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Api-Key'] = cfg.apiKey;
  if (cfg.empToken) { headers['X-GF-Employee-Token'] = cfg.empToken; headers['X-GF-Token'] = cfg.empToken; }
  const res = await fetch(`${BASE}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  const env = parsed?.result ?? parsed;
  return {
    httpOk: res.ok,
    ok: env?.ok !== false,
    code: env?.code ?? env?.data?.error_code,
    message: env?.message,
    data: env?.data ?? null,
  };
}

function salePayload(qty, operationId) {
  return {
    operation_id: operationId,
    partner_id: cfg.partnerId,
    lines: [{ product_id: cfg.productId, quantity: qty, discount: 0 }],
    ...(cfg.warehouseId ? { warehouse_id: cfg.warehouseId } : {}),
    payment_method: 'cash',
    note: 'E2E #116 prueba (autorizada)',
  };
}

const results = [];
function record(id, pass, detail) { results.push({ id, pass, detail }); log(`  ${pass ? 'PASS' : 'FAIL'} ${id}: ${detail}`); }

async function T1() {
  requireConfig(['partnerId', 'productId', 'availQty']);
  const qty = Math.max(1, Math.floor(cfg.availQty / 2) || 1);
  const r = await post(`${GF_BASE}/sales/create`, salePayload(qty, opId('t1')));
  record('T1', r.ok && r.httpOk, `venta ${qty}u (≤ disponible) → ok=${r.ok} code=${r.code ?? '-'} ${r.message ?? ''}`);
}

async function T2() {
  requireConfig(['partnerId', 'productId', 'availQty']);
  const qty = cfg.availQty + 1000;
  const r = await post(`${GF_BASE}/sales/create`, salePayload(qty, opId('t2')));
  const lines = Array.isArray(r.data?.lines) ? r.data.lines : [];
  const hasDetail = lines.some((l) => l && (l.available_qty !== undefined || l.requested_qty !== undefined));
  const isInsuf = (r.code === 'insufficient_stock') || /insufficient[_ ]?stock|stock insuficiente/i.test(r.message || '');
  record('T2', !r.ok && isInsuf, `venta ${qty}u (> disponible) → ok=${r.ok} code=${r.code ?? '-'} lines_detalle=${hasDetail} (${lines.map((l)=>`${l.product_name||l.product_id}:${l.requested_qty}/${l.available_qty}`).join(', ')})`);
}

async function T3() {
  requireConfig(['partnerId', 'productId', 'availQty']);
  const qty = Math.max(1, Math.floor(cfg.availQty / 4) || 1);
  const id = opId('t3');
  const r1 = await post(`${GF_BASE}/sales/create`, salePayload(qty, id));
  const r2 = await post(`${GF_BASE}/sales/create`, salePayload(qty, id)); // mismo operation_id
  const id1 = r1.data?.sale_order_id ?? r1.data?.id ?? r1.data?.name;
  const id2 = r2.data?.sale_order_id ?? r2.data?.id ?? r2.data?.name;
  const sameOrNoDup = r2.ok && (id1 == null || id2 == null || String(id1) === String(id2));
  record('T3', sameOrNoDup, `retry mismo operation_id → r1=${id1 ?? '?'} r2=${id2 ?? '?'} (debe NO duplicar). Verificar en Odoo 1 sola sale.order.`);
}

async function T5() {
  if (!cfg.planId) { record('T5', false, 'KF_PLAN_ID no provisto — saltado'); return; }
  const r1 = await post(`${PWA}/close-route`, { plan_id: cfg.planId });
  const r2 = await post(`${PWA}/close-route`, { plan_id: cfg.planId }); // retry
  const idem = (r2.code === 'already_closed') || /already[_ ]?closed|ya .*cerrad/i.test(r2.message || '') || r2.ok;
  record('T5', r1.ok && idem, `cierre 1=${r1.ok} retry → ok=${r2.ok} code=${r2.code ?? '-'} (debe already_closed/idempotente)`);
}

async function T6() {
  if (!cfg.planId) { record('T6', false, 'KF_PLAN_ID no provisto — saltado'); return; }
  const id = opId('t6');
  const r1 = await post(`${GF_BASE}/liquidacion/confirm`, { plan_id: cfg.planId, cash_collected: 0, operation_id: id, force: true });
  const r2 = await post(`${GF_BASE}/liquidacion/confirm`, { plan_id: cfg.planId, cash_collected: 0, operation_id: id, force: true });
  const idem = (r2.code === 'already_confirmed') || /already[_ ]?confirmed|ya .*confirmad/i.test(r2.message || '') || r2.ok;
  record('T6', r1.ok && idem, `liquidación 1=${r1.ok} retry → ok=${r2.ok} code=${r2.code ?? '-'} (debe already_confirmed/idempotente)`);
}

const REGISTRY = { T1, T2, T3, T5, T6 };

async function main() {
  log('=== KoldField E2E #116 ===');
  if (!BASE) throw new Error('Falta KF_BASE_URL');
  log(`Base: ${BASE} · tests: ${cfg.tests.join(',')} · modo: ${RUN ? 'RUN (crea registros reales)' : 'DRY-RUN'}`);
  if (!RUN) {
    log('\nDRY-RUN: no se llama a la red. Validando config…');
    log(`  partnerId=${cfg.partnerId} productId=${cfg.productId} availQty=${cfg.availQty} warehouseId=${cfg.warehouseId ?? '-'} planId=${cfg.planId ?? '-'}`);
    log('  auth: ' + (cfg.apiKey ? 'API_KEY provisto' : (cfg.barcode && cfg.pin ? 'barcode+pin' : 'FALTA (KF_BARCODE/KF_PIN o KF_API_KEY)')));
    log('\nPara ejecutar de verdad (crea ventas/cierre/liquidación REALES de prueba):');
    log('  node scripts/e2e/backend116_validation.mjs --run');
    log('\nT5/T6 requieren KF_PLAN_ID de un plan de prueba cerrable.');
    return;
  }
  await login();
  for (const t of cfg.tests) {
    const fn = REGISTRY[t];
    if (!fn) { log(`· ${t}: desconocido, saltado`); continue; }
    log(`\n▶ ${t}`);
    try { await fn(); } catch (e) { record(t, false, `excepción: ${e instanceof Error ? e.message : e}`); }
  }
  const pass = results.filter((r) => r.pass).length;
  log(`\n=== Resultado: ${pass}/${results.length} PASS ===`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exitCode = 2; });
