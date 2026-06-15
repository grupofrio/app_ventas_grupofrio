# KoldField — Backend hardening B6/B7/B9: spec implementable (para Sebas)

> ## 🛑 NO MERGEAR — VEREDICTO ACTUAL: `BLOCKED_PENDING_SAFE_VALIDATION` (2026-06-12)
> **El repo `GrupoVeniu/GrupoFrio` despliega DIRECTO a PRODUCTIVO al mergear** (Odoo.sh rama `GrupoFrio`). **No existe staging separado.** Por lo tanto, **mergear #116 = desplegar a producción**, y este PR toca **stock/inventario, cierre de ruta, liquidación y dinero**.
> El PR se ve **técnicamente correcto** (ver "Revisión técnica"), pero **NO debe mergearse** hasta validarlo en un **entorno seguro** (staging/copia) o una **ventana controlada autorizada**. Esto **supersede** el veredicto previo `APPROVE_FOR_STAGING` (que asumía un staging inexistente). Ver "Validación segura: Opciones A/B/C", "Plan de rollback" y "Criterios go/no-go" al final.

**Tipo:** especificación técnica fundamentada en el código real. **No es código desplegable desde este entorno** (ver "Blocker de entorno").
**Dueño de implementación/deploy:** Sebastián (módulos Odoo, Odoo.sh rama `GrupoFrio`).
**Origen:** bloqueantes B6/B7/B9 del plan Fase 2 (`KOLDFIELD_PERFORMANCE_FASE2_CEDIS_CACHE_PLAN.md` §5) y `KOLDFIELD_BACKEND_HARDENING_REQUESTS.md`.

> **Blocker de entorno (por qué spec y no PR):** desde el entorno de trabajo (`C:\…\gfsc`) **no hay repo git ni remoto** del backend; existen **copias divergentes y no canónicas** de `gf_logistics_ops` (`GrupoFrio/` ≈3994 líneas de `gf_api.py` vs `GrupoFrio-operativo/` ≈5167 líneas vs stub en `backend/modules/` vs `tmp/_refs/`). La fuente de verdad vive en **Odoo.sh (`GrupoFrio`)**, dominio de Sebastián. Editar un snapshot local que (a) puede estar desfasado y (b) no se puede desplegar ni PR-ear desde aquí, sobre módulos que afectan **dinero e inventario en producción**, sería inseguro. Por eso se entrega un spec aplicable directamente, citando métodos/archivos reales. **Decisión de negocio pendiente → documentado y detenido** (regla del goal).

---

## Hito 1 — Endpoints auditados (código real)

Ref. principal: `GrupoFrio-operativo/gf_logistics_ops/controllers/gf_api.py` (copia más reciente en disco) y `GrupoFrio-operativo/gf_consignment/controllers/consignment_api.py`.

| Flujo | Endpoint | Handler | Idempotencia HOY | Stock guard HOY |
|---|---|---|---|---|
| Venta | `POST /gf/logistics/api/employee/sales/create` | `_handle_sales_create` (gf_api.py:1531) | **Sí** (operation_id) | **No** |
| Pago efectivo | (dentro de venta) | `_create_cash_payment_for_sale` (gf_api.py:1174) | **Sí** (`<op>:cash-payment`) | n/a |
| Preventa | `/…/presale-create` | `_handle_presale_create` (gf_api.py:1596) | **Sí** | n/a (draft) |
| Consignación crear | `POST /pwa-ruta/consignment/create` | consignment_api.py:146 | revisar | aplica `apply_inventory` |
| Consignación visita | `POST /pwa-ruta/consignment/visit` | consignment_api.py:188 | revisar (`operation_id`) | backend recalcula |
| Consignación cierre | `POST /pwa-ruta/consignment/close` | consignment_api.py:209 | revisar (`operation_id`) | backend recalcula |
| Cierre de ruta | `POST /pwa-ruta/close-route` | `pwa_ruta_close_route` → `action_close_route` (gf_route_plan.py:1086) | **Guard de estado** (no idempotente-éxito) | n/a |
| Liquidación | `POST /pwa-ruta/liquidacion-confirm` (+ `/…/liquidacion/confirm`) | gf_api.py (rutas ~3673/3677) | revisar | n/a |
| KM | `POST /pwa-ruta/km-update` | — | reescribe (plan,type) | n/a |

**Hallazgos clave (verificados en código):**
1. **Idempotencia de venta/pago: YA EXISTE y es robusta.** `_get_operation_id` (acepta `operation_id`/`_operationId`/`x_operation_id`/`x_client_op_uuid`), `_find_existing_sale_by_operation` (busca por `x_operation_id`/`x_kold_operation_id`), `_find_duplicate_sale` (ventana temporal `created_at_ms`±`window_seconds`), `_run_with_retryable_savepoint(attempts=5)` + fallback `IntegrityError` que devuelve la venta existente con `duplicate=True`. → **No re-implementar; ya cumple B3 para venta/pago.**
2. **Stock guard en venta: AUSENTE.** `_handle_sales_create` crea y `action_confirm()` sin validar `qty_available`/disponible en la ubicación móvil ni devolver `insufficient_stock`. El frontend es *advisory* (revalida `qty_display`), pero dos ventas concurrentes/offline pueden sobrevender. → **Gap real B6/B7.**
3. **Cierre de ruta: guard de estado, NO idempotente-éxito.** `action_close_route` hace `if rec.state != "in_progress": raise UserError("Solo puedes cerrar una ruta en progreso.")`. Previene doble cierre, pero un **retry tras cierre exitoso con red caída** recibe `UserError` (la app lo muestra como fallo) en vez de éxito idempotente. También valida reconciliación + km. → **Gap B9 (idempotencia-éxito).**
4. **Liquidación/corte:** confirmar si `liquidacion-confirm`/`corte-confirm` aceptan/usan `operation_id` o deduplican por `plan_id`. → **Verificar B9.**

---

## Hito 2 — Stock guard duro + contrato `insufficient_stock` (B6/B7)

**Dónde:** en `_handle_sales_create`, **antes** de `_create_and_confirm_sale()` (gf_api.py:1567), y simétricamente en consignación `create` (que ya baja inventario con `apply_inventory=True`).

**Diseño (sin romper contrato):**
1. Resolver la ubicación de origen real de la unidad: el `stock.warehouse`/`stock.location` del `route_plan`/empleado (ya hay `mobile_location_id` en el plan; el módulo resuelve almacén en `_resolve_company`/contexto de la venta).
2. Para cada línea, calcular disponible **fresco** en esa ubicación: `free_qty` (= `qty_available - reserved`) del `product.product` con `with_context(location=<mobile_location_id or warehouse.lot_stock_id>)`. Usar `free_qty` (no `virtual_available`, que incluye entrantes futuros).
3. Si alguna línea pide `qty > disponible` → **no crear la venta**; devolver respuesta de error estructurada (abajo). No permitir que el resultado deje inventario negativo.
4. Mantener compatibilidad: si por decisión de negocio se permite vender en negativo para ciertos productos (p.ej. servicios/`type != 'product'`), excluirlos del guard.

**Contrato de respuesta `insufficient_stock` (final propuesto):**
```json
{
  "success": false,
  "error_code": "insufficient_stock",
  "message": "Stock insuficiente para 2 producto(s).",
  "operation_id": "<el enviado>",
  "lines": [
    { "product_id": 123, "product_name": "Barra de Hielo 5kg",
      "requested_qty": 10.0, "available_qty": 4.0 },
    { "product_id": 456, "product_name": "Cup 300ml",
      "requested_qty": 6.0,  "available_qty": 0.0 }
  ]
}
```
- `error_code` estable en `snake_case` para que el frontend lo detecte sin parsear `message`.
- `available_qty` = disponible fresco real en la ubicación de la unidad al momento del intento.
- `product_name` = `product_id.display_name` (siempre presente en Odoo).
- Devolver con el `_response(False, …)` existente + estos campos extra (campos adicionales = compatibles; un cliente viejo los ignora).
- **Idempotencia preservada:** el chequeo de stock va **después** del short-circuit de `_find_existing_sale_by_operation` (gf_api.py:1543). Si la venta ya existe (retry), se devuelve `duplicate=True` **sin** re-evaluar stock (la venta ya consumió inventario). El guard solo aplica a creación nueva.

**Frontend (ya preparado, no cambia):** `saleStockValidation.findFreshStockIssues` bloquea local; al recibir `insufficient_stock` la app puede mapear `lines` a un detalle "quita X de Y". (Ese consumo es trabajo posterior frontend, fuera de este spec.)

---

## Hito 3 — Idempotencia de cierre/liquidación (B9)

**Objetivo:** un retry de una operación ya confirmada debe devolver **éxito idempotente** (no `UserError`), sin duplicar cierre/pagos/movimientos.

**3.1 `action_close_route` / `pwa_ruta_close_route`:**
- Antes del guard que lanza, agregar short-circuit idempotente:
  ```python
  if rec.state in ("closed", "reconciled", "done"):
      return {"ok": True, "already_closed": True,
              "state": rec.state, "plan_id": rec.id,
              "message": "Ruta ya cerrada."}
  ```
  Colocar **antes** de `if rec.state != "in_progress": raise UserError(...)`, para que el retry tras cierre exitoso sea éxito, pero un estado inesperado (p.ej. `draft`) siga siendo error claro.
- Mantener todas las validaciones actuales (reconciliación, km) para el cierre real.
- Opcional pero recomendado: aceptar `operation_id` del payload y, si se reintenta el mismo, garantizar misma respuesta.

**3.2 `liquidacion-confirm` / `corte-confirm`:**
- Verificar el handler; si confirma sobre un estado ya `confirmado/validado`, devolver éxito idempotente equivalente (no re-cobrar, no re-generar asientos).
- El frontend ya envía `operation_id` estable por intento (`liquidation-<plan>-<ts>-<rand>`, mismo id en el retry "force"). Si el modelo de liquidación tiene/añade `x_operation_id`, deduplicar por él; si no, deduplicar por `plan_id` + estado.

**3.3 No duplicar:** todas las creaciones (pagos, pickings, asientos) ya cubiertas por operation_id en venta/pago; para cierre/liquidación, el short-circuit por estado evita el doble efecto.

---

## Hito 4 — Precios intradía (B5)

**Pregunta de negocio (requiere confirmación de Sebas/Yamil):** ¿los precios de lista/pricelist (`product.pricelist.item`) cambian **dentro** de la jornada operativa?

- **Si NO cambian intradía (caso esperado):** el caché de jornada del frontend (TTL 10 h, `CUSTOMER_PRICE_CACHE_TTL_MS`) es seguro tal cual. No se requiere cambio backend. *Documentar la garantía operativa.*
- **Si SÍ pueden cambiar:** proponer **versión/`write_date`** consultable de pricelist para invalidación:
  - exponer `pricelist.write_date` (o un `version` incremental) en la respuesta de `pricing/by_partner`;
  - el frontend compararía la versión al re-preparar/online y purgaría el caché si cambió (trabajo frontend posterior, no rompe el caché actual: campo adicional, compatible).
  - **No** se cambia el contrato actual; solo se **agrega** `pricelist_version`/`write_date`.
- **Regla de seguridad ya vigente:** la venta es *online-first* y el backend reevalúa precio al confirmar (`_create_koldfield_sale_order` resuelve pricelist server-side). El caché de precios es solo display → un precio intradía cambiado **no** se cobra mal: el backend manda.

---

## Hito 5 — Validación / casos de prueba

**Tests del repo backend:** existen carpetas `tests/` en `gf_logistics_ops` y `gf_consignment` (Odoo `TransactionCase`). Agregar (en el repo canónico, por Sebas):

1. **Venta con stock suficiente** → `success=True`, venta confirmada, inventario baja.
2. **Venta con stock insuficiente** → `success=False`, `error_code="insufficient_stock"`, `lines` con `product_id/requested_qty/available_qty/product_name`; **no** se crea `sale.order`; inventario intacto.
3. **Retry de venta** (mismo `operation_id`) → segunda llamada `duplicate=True`, **una sola** `sale.order`, **un solo** `account.payment`, inventario baja **una** vez.
4. **Retry de cierre** (ruta ya `closed`) → `ok=True, already_closed=True`; sin segundo movimiento/asiento.
5. **Retry de liquidación** (ya confirmada) → éxito idempotente; sin doble cobro/asiento.
6. **Venta concurrente** (dos requests, stock para una) → una `success`, otra `insufficient_stock`; nunca inventario negativo (validar con savepoint/lock).

**Casos manuales (si no hay infra de test desplegable):** mismos 6, vía Postman/cliente contra staging Odoo.

---

## Entregables del goal — resumen

1. **Rama backend:** N/A desde este entorno (sin git/remoto; ver Blocker). Implementación va en Odoo.sh `GrupoFrio` (Sebas).
2. **Endpoints auditados:** tabla Hito 1 (fundamentada en `gf_api.py`/`consignment_api.py`/`gf_route_plan.py`).
3. **Cambios propuestos:** Hito 2 (stock guard + contrato), Hito 3 (idempotencia-éxito de cierre/liquidación), Hito 4 (precios).
4. **Tests:** Hito 5 (6 casos).
5. **Contrato `insufficient_stock`:** definido (Hito 2).
6. **Idempotencia final:** venta/pago YA OK; cierre/liquidación → short-circuit por estado (+`operation_id` si aplica).
7. **Riesgos:** (a) copias divergentes → aplicar SOLO sobre el canónico de Odoo.sh; (b) cambios afectan dinero/inventario en prod → revisión de Sebas + staging obligatorio; (c) `free_qty` por ubicación móvil debe resolver la `location` correcta (mismo origen que baja la venta) — validar; (d) B5 requiere confirmación de negocio.
8. **PR/link:** backend PR **[GrupoVeniu/GrupoFrio#116](https://github.com/GrupoVeniu/GrupoFrio/pull/116)** (base `GrupoFrio`). Este doc = handoff (app PR #36).

---

## Revisión técnica (reviewer independiente) — 2026-06-12

**Veredicto: `APPROVE_FOR_STAGING`.** Diff limitado a B6/B7/B9 (3 archivos: manifest +1, controller +110, test nuevo); bump `18.0.1.4.0 → 18.0.1.5.0` verificado; `py -m py_compile` OK; `test_route_hardening_b6b7b9_contract.py` PASA. No se encontró bug que requiera cambios de código.

**Confirmaciones:**
- **Stock guard** usa `ctx["warehouse"].lot_stock_id` (mismo almacén que arma la venta), `free_qty` con `with_context(location=…)`, solo `is_storable`, y corre **después** del short-circuit `_find_existing_sale_by_operation` → un retry de venta ya creada **no** se re-evalúa.
- **Contrato `insufficient_stock`** completo por línea (`product_id/product_name/requested_qty/available_qty`) vía `_response(False, …)` (patrón existente, campos adicionales = compatibles).
- **Idempotencia venta/pago por `operation_id`:** intacta (no se modificó ese código).
- **Cierre:** con `plan_id` (lo que envía la app) se resuelve el plan exacto; el retry tras cierre exitoso devuelve `already_closed` sin re-ejecutar. La ampliación de `allow_states` no causa mis-selección: por fecha está acotado al día y `len(matched)>1` lanza "Envía plan_id" en vez de elegir mal.
- **Liquidación:** short-circuit por `liquidacion_done_at` antes de re-estampar/auto-cerrar.

**Riesgos / límites (no bloquean staging, validar ahí):**
1. **TOCTOU concurrente:** dos ventas simultáneas para el mismo producto con stock para una sola podrían pasar ambas el check antes de confirmar. El guard reduce drásticamente el sobregiro pero no es un lock atómico; la barrera final dura sigue dependiendo de la config de Odoo (almacén que rechace negativo) o de la reserva en `action_confirm`. → Caso de staging #9; si se requiere atomicidad total, es un endurecimiento posterior (lock/SELECT FOR UPDATE).
2. **`lot_stock_id` vs ubicación real de descuento:** asume que el origen del picking de entrega = `lot_stock_id` del almacén móvil. Validar con el almacén/van real (caso #8).
3. **Liquidación en estado `done`:** el lookup de liquidación no incluye `done` (igual que antes); si un admin lleva el plan a `done`, un retry de liquidación no short-circuita. Edge pre-existente, no regresión.
4. **B5 precios intradía** y **idempotencia de consignación visit/close**: pendientes (abajo / Hito 4).

---

## Checklist de staging para Sebastián (almacén móvil real)

> Probar en staging con un plan/ruta real y su almacén móvil. Marcar cada caso.

- [ ] **1. Venta con stock suficiente** → `ok:true`, venta confirmada, `qty_available` baja en la ubicación de la unidad.
- [ ] **2. Venta con stock insuficiente** → `ok:false`, `data.error_code="insufficient_stock"`, `data.lines[]` con `product_id/product_name/requested_qty/available_qty`; **no** se crea `sale.order`; inventario intacto.
- [ ] **3. Retry de venta** (mismo `operation_id`) → 2ª respuesta `duplicate:true`, **una sola** `sale.order` y **un solo** `account.payment`; el guard NO se re-evalúa.
- [ ] **4. Cierre de ruta exitoso** → `ok:true`, `state:"closed"`, picking de retorno generado si aplica.
- [ ] **5. Retry de cierre** (mismo plan ya cerrado) → `ok:true`, `data.already_closed:true`, **sin** segundo picking ni reconversión de leads.
- [ ] **6. Liquidación exitosa** → `ok:true`, `liquidacion_done_at` seteado; auto-cierre si `in_progress`.
- [ ] **7. Retry de liquidación** (ya confirmada) → `ok:true`, `data.already_confirmed:true`, **sin** re-estampar ni re-cobrar.
- [ ] **8. `available_qty` = almacén móvil real** → comparar el `available_qty` devuelto contra el on-hand real de la van (no del almacén central). Confirmar que `lot_stock_id` es el origen del picking de entrega.
- [ ] **9. Sin pagos/movimientos duplicados** → tras retries de 3/5/7, revisar que no haya `account.payment`, `stock.move` ni asientos duplicados. Probar también 2 ventas casi simultáneas (concurrencia) → a lo sumo una confirma; inventario nunca negativo.
- [ ] **10. Respuesta app ante `insufficient_stock`** → la app KoldField muestra el detalle por línea y permite ajustar; la venta NO se confirma offline.

**Si los 10 pasan en un entorno seguro:** recién entonces se puede mergear a `GrupoFrio`. **Si 8 o 9 fallan:** REQUEST_CHANGES (ajustar resolución de `location` o añadir lock atómico) antes de merge.

> ⚠️ **Importante:** estos 10 casos ejecutan ventas/cierres/liquidaciones reales. **NO correrlos en productivo** sin entorno seguro o ventana controlada autorizada (ver Opciones abajo). El veredicto "APPROVE_FOR_STAGING" de la sección anterior queda **superado por `BLOCKED_PENDING_SAFE_VALIDATION`** porque no existe staging separado y el merge despliega directo a prod.

---

## ⚠️ El repo despliega DIRECTO a productivo

`GrupoVeniu/GrupoFrio` (rama `GrupoFrio`) está integrado con Odoo.sh: **mergear a `GrupoFrio` despliega a producción automáticamente.** No hay un paso de staging intermedio por defecto. Como #116 modifica **inventario, cierre de ruta, liquidación y flujo de dinero**, un deploy sin validar puede **bloquear ventas en campo**, **descuadrar cortes/liquidaciones** o **corromper inventario** de toda la flota. → **NO MERGE hasta validación segura.**

## Validación segura — Opciones (de más a menos segura)

### Opción A (recomendada) — Staging / copia de BD en Odoo.sh
- Levantar la rama `feat/koldfield-backend-hardening-b6b7b9` en un **build de staging de Odoo.sh** (o una **copia de la BD productiva**) — Odoo.sh permite ramas staging con copia de datos.
- Usar **ruta/van/productos/cliente de prueba** (o datos clonados); no afectar registros reales.
- Correr los **10 casos** del checklist + verificar #8 (`lot_stock_id`) y #9 (duplicados/concurrencia).
- **Ventaja:** datos realistas, cero riesgo a producción. **Requiere:** que Odoo.sh tenga el slot de staging disponible.

### Opción B — Entorno local / dev
- Restaurar un **backup reciente** de la BD en una instancia Odoo 18 local/dev (o contenedor).
- Instalar/actualizar `gf_logistics_ops` 18.0.1.5.0; correr la suite de tests del módulo (`TransactionCase`) + los 10 casos manuales con datos clonados.
- **Ventaja:** aislamiento total, permite tests automatizados de Odoo. **Requiere:** infra local + tiempo de setup; los datos pueden divergir de prod.

### Opción C — Ventana controlada en productivo (SOLO si A y B no son viables)
**Requiere autorización explícita de Yamil y Sebas.** Condiciones mínimas obligatorias:
- **Fuera de horario operativo** (ninguna van en ruta activa).
- **Backup completo de la BD inmediatamente antes** (Odoo.sh snapshot).
- Usar **empleado/ruta/cliente/productos de PRUEBA dedicados**, nunca registros reales de clientes.
- **Stock pequeño y controlado** en una ubicación de prueba.
- **Plan de rollback escrito y probado** (abajo) + **observador técnico presente** (Sebas) durante toda la ventana.
- Revertir inmediatamente ante cualquier desviación.

## Plan de rollback
1. **Código:** revertir el merge en `GrupoFrio` (`git revert <merge_sha>` + push) → Odoo.sh redepliega la versión previa (`gf_logistics_ops` 18.0.1.4.0). Alternativa: re-desplegar el build anterior desde el historial de Odoo.sh.
2. **Datos (si una prueba alteró registros reales):** restaurar el **snapshot/backup** tomado antes de la ventana (Opción C). Por eso el backup previo es obligatorio.
3. **Verificación post-rollback:** confirmar que `sales/create`, `close-route` y `liquidacion-confirm` responden como antes (smoke con la app o RPC de solo lectura); confirmar versión del módulo = 18.0.1.4.0.
4. **Comunicación:** avisar a vendedores en campo si hubo interrupción; registrar incidente.

## Criterios go / no-go
- **GO (mergear):** los 10 casos pasan en entorno seguro (A o B), **incluidos #8 y #9**; backup/rollback verificados; ventana sin vans activas; OK explícito de Sebas.
- **NO-GO:** falla #8 (`available_qty` no corresponde al almacén móvil real) o #9 (duplicados o inventario negativo en concurrencia) → REQUEST_CHANGES. Tampoco mergear si no hay backup reciente, si hay vans en ruta, o sin autorización.
