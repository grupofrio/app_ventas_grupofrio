# KoldField — Backend hardening B6/B7/B9: spec implementable (para Sebas)

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
8. **PR/link:** no aplicable desde este entorno (sin remoto). Este doc es el handoff.
