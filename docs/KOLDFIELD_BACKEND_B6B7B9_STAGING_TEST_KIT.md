# KoldField — Staging Test Kit B6/B7/B9 (para Sebastián)

Kit ejecutable para validar el backend PR **[GrupoVeniu/GrupoFrio#116](https://github.com/GrupoVeniu/GrupoFrio/pull/116)** (`gf_logistics_ops` 18.0.1.5.0) **sin tocar producción**. Acompaña al spec `KOLDFIELD_BACKEND_HARDENING_B6B7B9_SPEC.md` (veredicto actual: `BLOCKED_PENDING_SAFE_VALIDATION`).

> 🛑 **NO correr esto contra productivo.** El repo despliega directo a prod al mergear. Ejecutar SOLO en staging/copia (Opción A) o local con backup (Opción B). Si por excepción se usa ventana productiva (Opción C), seguir todas las condiciones del spec (backup, datos de prueba, rollback, autorización). Estos casos crean ventas/cierres/liquidaciones reales en la BD donde se corran.
>
> 🔑 **Sin secretos:** este doc usa placeholders (`<API_KEY>`, `<EMPLOYEE_TOKEN>`, etc.). No pegar credenciales reales aquí ni en commits.

---

## 1. Preparación de entorno

1. **Elegir entorno seguro** (ver spec, Opciones A/B/C). Recomendado: build de staging Odoo.sh con copia de BD, o local con backup restaurado.
2. **Desplegar la rama** `feat/koldfield-backend-hardening-b6b7b9` en ese entorno (build de staging Odoo.sh, o `-u gf_logistics_ops` en local). Confirmar versión instalada = **18.0.1.5.0** (`Ajustes → Aplicaciones → GF Logistics Ops`).
3. **Base URL** del entorno de prueba: `<BASE_URL>` (p.ej. `https://grupofrio-staging-XXXX.odoo.com`). **Nunca** la URL productiva.
4. **Token de empleado de prueba** (`X-GF-Employee-Token`): autenticar al vendedor de prueba contra su login móvil y copiar el token de su `gf.employee.mobile.session`. Guardarlo en una variable de entorno local: `export EMPLOYEE_TOKEN=...` (no en el doc).
5. **API key** (si el reverse-proxy la exige además del token): `export API_KEY=...`.

### Transporte (verificado contra el código y el cliente)
- Endpoints Odoo `type="json"`, `auth="public"`; el empleado se resuelve por header **`X-GF-Employee-Token`** (o `employee_token`/`token` en el body).
- El cliente envía el **payload como JSON crudo** (sin envoltura `jsonrpc/params`); el handler lo lee con `request.get_json_data()`.
- La respuesta viene envuelta por Odoo: `{"result": { ... }}`. Los handlers devuelven `{"ok": bool, "message": str, "data": {...}}` (la liquidación devuelve `{ok, message, data}` o `{ok:false, code, message, data}`).
- Plantilla curl:
```bash
curl -sS -X POST "$BASE_URL/<ENDPOINT>" \
  -H "Content-Type: application/json" \
  -H "X-GF-Employee-Token: $EMPLOYEE_TOKEN" \
  -d '<PAYLOAD_JSON>' | python -m json.tool
# La respuesta real del handler está en .result
```

---

## 2. Datos necesarios para staging

Rellenar antes de empezar (con registros de **prueba**, no reales):

| Dato | Placeholder | Cómo obtenerlo | Notas |
|---|---|---|---|
| Empleado/vendedor de prueba | `<EMPLOYEE_ID>` / `<EMPLOYEE_TOKEN>` | `hr.employee` de prueba con sesión móvil | token = `gf.employee.mobile.session` |
| Compañía | `<COMPANY_ID>` | la del plan/vendedor | Glaciem (34) o la que aplique |
| Plan de ruta (para venta/cierre) | `<ROUTE_PLAN_ID>` | `gf.route.plan` de prueba en `in_progress` | una sola por empleado/fecha (si no, mandar `plan_id`) |
| Vehículo/van | `<VEHICLE_ID>` | `_effective_vehicle()` del plan | |
| Almacén móvil | `<WAREHOUSE_ID>` + `<MOBILE_LOCATION_ID>` | `stock.warehouse` de la van y su `lot_stock_id` | **clave para caso #8** |
| Cliente de prueba | `<PARTNER_ID>` | `res.partner` de prueba (no cliente real) | |
| Productos almacenables | `<PRODUCT_OK_ID>`, `<PRODUCT_SHORT_ID>` | `product.product` con `is_storable=true` | uno con stock holgado, otro con stock chico |
| Stock inicial por producto | `<QTY_OK>`, `<QTY_SHORT>` | ajuste de inventario en `<MOBILE_LOCATION_ID>` | p.ej. OK=100, SHORT=3 |
| Método de pago | `cash` | fijo en piloto | |
| operation_id (idempotencia) | `<OP_SALE>`, `<OP_LIQ>` | UUID/string único por intento | reusar el mismo en los retries |
| Plan listo para cierre | `<ROUTE_PLAN_ID>` con KM + reconciliación cuadrada | preparar antes (corte validado) | requisito de `action_close_route` |
| Plan listo para liquidación | mismo plan, corte conciliado | | |
| Producto con stock insuficiente controlado | `<PRODUCT_SHORT_ID>` con `<QTY_SHORT>` | poner stock chico a propósito | para caso #2 |

> **Pre-requisitos de cierre (del código `action_close_route`):** el plan debe estar `in_progress`, tener `reconciliation` con diferencias en 0, y `departure_km`/`arrival_km` válidos (arrival > departure). Prepararlos antes de los casos 4–7.

---

## 3. Payloads de ejemplo (placeholders, sin datos reales)

> Endpoints: venta `/gf/logistics/api/employee/sales/create` · cierre `/pwa-ruta/close-route` · liquidación `/pwa-ruta/liquidacion-confirm`. Todos POST, body JSON crudo, header `X-GF-Employee-Token`.

**P1 — Venta con stock suficiente**
```json
{
  "operation_id": "<OP_SALE_OK>",
  "plan_id": <ROUTE_PLAN_ID>,
  "partner_id": <PARTNER_ID>,
  "warehouse_id": <WAREHOUSE_ID>,
  "mobile_location_id": <MOBILE_LOCATION_ID>,
  "payment_method": "cash",
  "lines": [ { "product_id": <PRODUCT_OK_ID>, "quantity": 2, "discount": 0 } ]
}
```

**P2 — Venta con stock insuficiente** (pide más que `<QTY_SHORT>`)
```json
{
  "operation_id": "<OP_SALE_SHORT>",
  "plan_id": <ROUTE_PLAN_ID>,
  "partner_id": <PARTNER_ID>,
  "warehouse_id": <WAREHOUSE_ID>,
  "mobile_location_id": <MOBILE_LOCATION_ID>,
  "payment_method": "cash",
  "lines": [ { "product_id": <PRODUCT_SHORT_ID>, "quantity": 999, "discount": 0 } ]
}
```

**P3 — Retry de venta** = repetir **exactamente** P1 (mismo `operation_id` `<OP_SALE_OK>`).

**P4 — Cierre de ruta**
```json
{ "plan_id": <ROUTE_PLAN_ID>, "departure_km": <KM_INI>, "arrival_km": <KM_FIN> }
```

**P5 — Retry de cierre** = repetir P4 (mismo `plan_id`, ya cerrado).

**P6 — Liquidación**
```json
{ "plan_id": <ROUTE_PLAN_ID>, "cash_collected": <MONTO>, "force": true, "notes": "staging test" }
```
> `force: true` solo para evitar `difference_warning` en la prueba; en operación real el vendedor decide.

**P7 — Retry de liquidación** = repetir P6 (mismo `plan_id`, ya confirmada).

---

## 4. Los 10 casos paso a paso + evidencia esperada

| # | Caso | Acción | Respuesta esperada (`.result`) | Verificación adicional |
|---|---|---|---|---|
| 1 | Venta stock suficiente | POST P1 | `ok:true`, `data.duplicate:false`, `data.order_id` | `qty_available`/`free_qty` de `<PRODUCT_OK_ID>` en `<MOBILE_LOCATION_ID>` bajó por 2 |
| 2 | Venta stock insuficiente | POST P2 | `ok:false`, `data.error_code:"insufficient_stock"`, `data.lines[0]` con `product_id/product_name/requested_qty/available_qty` | **NO** se creó `sale.order`; stock intacto |
| 3 | Retry de venta | POST P3 (=P1) | `ok:true`, `data.duplicate:true`, **mismo** `order_id` que caso 1 | guard NO se re-evaluó; stock NO bajó de nuevo |
| 4 | Cierre exitoso | POST P4 | `ok:true`, `data.state:"closed"` | picking de retorno generado si aplica |
| 5 | Retry de cierre | POST P5 (=P4) | `ok:true`, `data.already_closed:true` | **sin** segundo picking ni reconversión de leads |
| 6 | Liquidación exitosa | POST P6 | `ok:true`, `data.liquidacion_done_at` seteado | auto-cierre si estaba `in_progress` |
| 7 | Retry de liquidación | POST P7 (=P6) | `ok:true`, `data.already_confirmed:true` | **sin** re-estampar `liquidacion_done_at` ni re-cobrar |
| 8 | `available_qty` = almacén móvil real | inspeccionar `data.lines[].available_qty` del caso 2 | debe igualar el on-hand **de la van** (`<MOBILE_LOCATION_ID>`), no del almacén central | ver query V1 |
| 9 | Sin duplicados / no negativo | tras 3/5/7 + 2 ventas casi simultáneas | a lo sumo 1 venta confirma; inventario nunca < 0 | ver queries V2–V4 |
| 10 | Respuesta app ante `insufficient_stock` | en la app KoldField, intentar la venta del caso 2 | la app muestra detalle por línea y NO confirma offline | evidencia: screenshot app |

### Tabla de evidencia (llenar)

| Caso | Payload | Respuesta (`.result`) | Estado antes | Estado después | PASS/FAIL | Evidencia |
|------|---------|-----------------------|--------------|----------------|-----------|-----------|
| 1 | P1 | | stock OK = `<QTY_OK>` | stock OK = ? | | |
| 2 | P2 | | stock SHORT = `<QTY_SHORT>` | stock SHORT = ? (igual) | | |
| 3 | P3 | | 1 sale.order | 1 sale.order (mismo) | | |
| 4 | P4 | | plan in_progress | plan closed | | |
| 5 | P5 | | plan closed | plan closed (sin cambios) | | |
| 6 | P6 | | sin liquidacion_done_at | con liquidacion_done_at | | |
| 7 | P7 | | liquidacion_done_at=T | liquidacion_done_at=T (igual) | | |
| 8 | (insp) | | — | — | | available_qty vs van |
| 9 | (insp) | | — | — | | counts sin duplicados |
| 10 | app | | — | — | | screenshot |

### Queries de verificación (READ-ONLY — Odoo shell o SQL)
```python
# V1 — disponible en la ubicación de la van (caso #8). Debe coincidir con available_qty.
env['product.product'].browse(<PRODUCT_SHORT_ID>).with_context(location=<MOBILE_LOCATION_ID>).free_qty

# V2 — idempotencia de venta (caso #3/#9): debe ser 1, no 2.
env['sale.order'].search_count([('x_operation_id','=','<OP_SALE_OK>')])

# V3 — pagos no duplicados (caso #9): 1 pago por la venta.
env['account.payment'].search_count([('x_operation_id','like','<OP_SALE_OK>%')])

# V4 — inventario nunca negativo (caso #9) en la ubicación de la van.
[q.quantity for q in env['stock.quant'].search([('location_id','=',<MOBILE_LOCATION_ID>)])]  # ninguno < 0
```
> Estas queries **no modifican** datos. En SQL puro, equivalentes con `SELECT count(*)` sobre `sale_order`/`account_payment` filtrando por `x_operation_id`, y `SELECT quantity FROM stock_quant WHERE location_id=...`.

---

## 5. Criterios GO / NO-GO

- **GO (recién entonces se puede mergear #116 → deploy prod):** casos 1–10 PASS en entorno seguro, **incluidos #8 y #9**; backup + rollback verificados; ventana sin vans en ruta; OK explícito de Sebas.
- **NO-GO:** falla #8 (`available_qty` no corresponde a la van) o #9 (duplicados o inventario negativo en concurrencia); o falta backup; o hay vans activas; o sin autorización.

## 6. Rollback
1. **Código:** `git revert` del merge en `GrupoFrio` → Odoo.sh redepliega `gf_logistics_ops` 18.0.1.4.0 (o re-desplegar el build anterior).
2. **Datos:** si una prueba tocó registros reales (solo posible en Opción C), restaurar el snapshot/backup tomado **antes** de la ventana.
3. **Verificación post-rollback:** versión del módulo = 18.0.1.4.0; smoke read-only de `sales/create`/`close-route`/`liquidacion-confirm` (o RPC de lectura).
4. **Comunicar** a campo si hubo interrupción; registrar incidente.

## 7. Qué hacer si falla #8 o #9
- **Falla #8 (`available_qty` ≠ van):** el guard está consultando `free_qty` en una `location` distinta a la que descuenta la entrega. Revisar que `ctx["warehouse"].lot_stock_id` (almacén resuelto por `_resolve_route_inventory_scope`) sea efectivamente la ubicación de la van; si la entrega sale de otra location/route, ajustar `_check_route_stock` para usar esa misma. → **REQUEST_CHANGES** (cambio mínimo de resolución de location), no mergear.
- **Falla #9 (duplicados o negativo en concurrencia):** TOCTOU — dos ventas pasaron el check antes de confirmar. Endurecer con bloqueo atómico (p.ej. `SELECT ... FOR UPDATE` sobre los `stock.quant` de las líneas, o validar dentro del savepoint con reserva), o configurar el almacén para rechazar negativo en confirm. → **REQUEST_CHANGES**, no mergear hasta resolver.

## 8. Preguntas abiertas (decisión de negocio — no bloquean el kit, sí el alcance futuro)
- **B5 — precios intradía:** ¿los precios de pricelist cambian durante la jornada? Si sí, exponer `pricelist.write_date`/versión para invalidación del caché frontend (campo adicional, no rompe contrato). Confirmar Yamil/Sebas.
- **Idempotencia de consignación visit/close:** el controller de `gf_consignment` **no** deduplica por `operation_id` (gap B9 real). No se tocó en #116; requiere revisar el flujo de pago del modelo `gf_consignment` antes de parchear. Pendiente de decisión/segundo PR.
