import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const saleScreen = readFileSync(
    resolve(REPO_ROOT, 'app/sale/[stopId].tsx'),
    'utf8',
  );

  assert.match(
    saleScreen,
    /createSale\(buildSalesCreatePayload\(payload\)\)/,
    'La venta debe confirmarse directamente contra Odoo antes de avanzar',
  );
  assert.match(
    saleScreen,
    /const operationId = lockSaleConfirm\(\);[\s\S]*?_operationId: operationId/,
    'La venta directa debe enviar operation_id con el idempotency key generado por lockSaleConfirm',
  );
  assert.match(
    saleScreen,
    /if\s*\(!isOnline\)\s*\{[\s\S]*?Alert\.alert\([\s\S]*?Venta requiere conexion/,
    'La venta debe bloquearse cuando no hay conexion en vez de quedar en cola local',
  );
  assert.doesNotMatch(
    saleScreen,
    /enqueue\('sale_order'/,
    'La venta ya no debe entrar a la cola offline sale_order',
  );
  assert.doesNotMatch(
    saleScreen,
    /updateLocalStock\(l\.productId,\s*-l\.qty\)/,
    'La venta no debe reservar/descontar inventario localmente',
  );
  assert.match(
    saleScreen,
    /saveSaleTicketSnapshot/,
    'La confirmacion de venta debe guardar snapshot local del ticket despues de confirmar en Odoo',
  );
  assert.match(
    saleScreen,
    /employeeName/,
    'La venta nueva debe leer el nombre del empleado para imprimir vendedor en el ticket',
  );
  assert.match(
    saleScreen,
    /sellerName:\s*employeeName/,
    'El snapshot del ticket debe guardar el nombre del empleado como vendedor',
  );
  assert.match(
    saleScreen,
    /createSale\(buildSalesCreatePayload\(payload\)\)[\s\S]*?saveSaleTicketSnapshot/,
    'El snapshot del ticket debe guardarse despues de que Odoo acepta la venta',
  );
}

main();
console.log('sale online-only wiring tests: ok');
