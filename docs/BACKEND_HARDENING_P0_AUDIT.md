# Backend Hardening P0 — Auditoría (referencia del proyecto, lado KoldField)

**Repo:** KoldField · **Rama:** `docs/backend-hardening-p0-audit`
**Origen:** duplicado de la auditoría hecha sobre el backend `GrupoVeniu/GrupoFrio`
(`gf_logistics_ops/controllers/gf_api.py`) en la rama backend `feat/backend-hardening-p0`
(solo documentación, sin cambios de código).
**Referencia complementaria:** `docs/KOLDFIELD_BACKEND_HARDENING_REQUESTS.md` (lado frontend, PR #19).

> **Propósito:** dejar del lado KoldField la verdad actualizada del backend, para no
> volver a partir de suposiciones desactualizadas. La implementación de los módulos
> Odoo la realiza Sebastián (dueño). Aquí solo queda el diagnóstico + plan + tests sugeridos.

---

## Resumen actualizado (lo importante)

1. **Idempotencia de ventas y pagos: YA EXISTE y es robusta.**
   - `_handle_sales_create` exige `operation_id` y deduplica antes de crear, con
     fallback ante `IntegrityError` (gf_api.py L1392-1491).
   - Dedup por `x_operation_id` / `x_kold_operation_id` (`_find_existing_sale_by_operation` L1045-1053).
   - Pago de efectivo: opId derivado `<sale>:cash-payment`, dedup + fallback
     (`_create_cash_payment_for_sale` L1150-1205; `_find_existing_payment_by_operation` L1059).
   - ⇒ La premisa "falta dedup en ventas/pagos" estaba **desactualizada**. **No hay que reimplementarla.**
     (Pendiente menor: confirmar **índice único** en `x_operation_id` para cerrar la carrera bajo concurrencia, no solo `search`.)

2. **Gap P0 real: falta guard DURO de stock antes de `action_confirm`.**
   - `_handle_sales_create` arma líneas y confirma (`action_confirm` L1472) **sin** validar
     `qty <= disponible` por línea. `stock.quant` solo se lee para el catálogo (`truck_stock` L536-603, L1246).
   - Riesgo: sobreventa / inventario negativo de la unidad.
   - Fix: validar contra el scope de unidad/ruta (`_resolve_route_inventory_scope` L1415 → almacén móvil)
     **antes** de confirmar; responder:
     ```json
     { "ok": false, "code": "insufficient_stock",
       "message": "No hay inventario suficiente para Bolsa 5kg. Disponible: 3, solicitado: 5.",
       "data": { "product_id": 10, "available_qty": 3, "requested_qty": 5 } }
     ```

3. **Liquidación: bloquear efectivo negativo.**
   - `_handle_employee_liquidacion_confirm` toma `total_collected = self._as_float(cash_collected_raw)`
     (L3766) **sin** validar signo → acepta negativo.
   - Fix: `if total_collected < 0: ValidationError("El efectivo no puede ser negativo.")`.

4. **Liquidación: responder limpio si ya está confirmada.**
   - Hoy re-escribe `liquidacion_done_at`/notas y reintenta cerrar ruta (L3796-3829); no duplica
     documentos (es `write`), pero no corta.
   - Fix: early-return idempotente si `plan.liquidacion_done_at` ya existe (salvo `force`):
     ```json
     { "ok": true, "code": "already_confirmed", "message": "Liquidación ya confirmada",
       "data": { "plan_id": 987, "liquidacion_done_at": "..." } }
     ```

5. **Close-route: responder `already_closed` limpio al reintentar.**
   - `_handle_close_plan` usa `allow_states` = `published`/`in_progress` (L3685); reintentar sobre una
     ruta ya cerrada devuelve "No se encontró plan" (error confuso, no idempotente).
   - Fix: si el plan ya está `closed`/`reconciled`/`done`, devolver:
     ```json
     { "ok": true, "code": "already_closed", "message": "La ruta ya estaba cerrada",
       "data": { "plan_id": 987, "state": "closed" } }
     ```
   - Verificar además que `action_close_route()` valide KM final, corte y stops pendientes; si no, agregar precondiciones.

6. **KM-update: ya valida bien.**
   - `_handle_km_update` valida `type ∈ {departure, arrival}`, `km > 0` (L3603) y `arrival >= departure` (L3611).
   - Es overwrite por `write` (idempotente de hecho). Opcional (P2): historial / impedir bajar `departure` si `arrival` ya está fijo.

7. **Preventa y Consignación viven en el repo/rama de Sebas — revisar ahí.**
   - En este checkout de `GrupoVeniu/GrupoFrio` (rama `main`): **NO existe `gf_consignment`** ni
     `/pwa-ruta/presale-create` ni `commitment_date`.
   - Su hardening (idempotencia `operation_id`, guard de stock en create/restock, serializar
     `sale_order_id`/folio/`payment_id`/`picking_id`/`sold_qty`/`charged_amount`/`restock_qty`/`returned_qty`,
     bloquear leads en preventa) debe revisarse e implementarse **en el repo/rama donde residan esos módulos**.

8. **Auth / 401: estandarizar `session_expired`.**
   - Rutas `/pwa-ruta/*` usan `auth="public"` (validación manual interna); `/gf/logistics/*` usan `auth_api_key`.
   - Fix: respuesta 401 JSON uniforme con `code:"session_expired"` (el frontend ya lo consume — `apiResult` + `sessionError`).

---

## Tabla de auditoría

| Área | Función (gf_api.py) | Estado | Riesgo | Fix | Prioridad |
|---|---|---|---|---|---|
| Idempotencia venta | `_handle_sales_create` L1392 | ✅ existe | Bajo | Verificar índice único `x_operation_id` | — |
| Idempotencia pago | `_create_cash_payment_for_sale` L1150 | ✅ existe | Bajo | Verificar índice único | — |
| Guard de stock venta | `_handle_sales_create` L1469 | ❌ falta | **Alto** | `insufficient_stock` antes de confirmar | **P0** |
| Inventario negativo | almacén móvil / quants | ⚠️ config | Alto | Bloquear backend + config | **P0** |
| Liquidación efectivo negativo | L3766 | ❌ falta | Medio-Alto | guard `< 0` | **P0/P1** |
| Liquidación ya confirmada | L3744-3835 | ⚠️ no corta | Medio | early-return `already_confirmed` | P1 |
| Close-route reintento | `_handle_close_plan` L3681 | ⚠️ error confuso | Medio | `already_closed` | P1 |
| Close-route validaciones | L3681 | ⚠️ delega | Medio | verificar `action_close_route` (KM/corte/stops) | P1 |
| KM-update | `_handle_km_update` L3589 | ✅ ok | Bajo | opcional historial | P2 |
| Pago negativo (general) | `_handle_payments_create` L1574 | ⚠️ verificar | Medio | confirmar guard `<= 0` | P1 |
| Consignación | `gf_consignment` ausente | ❌ no en repo | — | Sebas (repo propio) | **P0/P1** |
| Preventa | `presale-create` ausente | ❌ no en repo | — | Sebas (repo propio) | P1 |
| Auth 401 | rutas `auth="public"` | ⚠️ uniformar | Bajo-Medio | `code:session_expired` | P1 |

---

## Plan de PRs sugerido (para Sebas, en el repo backend)
- **P0-A — Guards seguros:** efectivo negativo, `already_confirmed`, `already_closed`, 401 uniforme.
- **P0-B — Guard de stock:** validación `qty <= available` por línea antes de `action_confirm` (gap real).
- **P0-C — Consignación:** idempotencia visit/close/create + guard de stock + serializar resultado (en su repo/rama).
- **P0-D — Preventa + Checklist:** idempotencia `operation_id`, no confirmar/picking, `commitment_date`, leads bloqueados; checklist idempotente + foto.

> Recordatorio: Odoo.sh sigue la rama **`GrupoFrio`** → un eventual PR backend va con `--base GrupoFrio`, no `main`.

## Tests contractuales sugeridos
- Venta con stock insuficiente → `insufficient_stock`.
- Venta / pago / preventa / consignación visit / consignación close / close-route **repetidos con el mismo `operation_id`** → sin duplicar.
- KM final < inicial → rechazo (agregar test al guard existente).
- Liquidación con efectivo negativo → rechazo.
- Checklist incompleto → rechazo.
- Sesión inválida → 401 `session_expired`.

## Riesgos abiertos
- `available` debe calcularse del **almacén móvil del plan** (no global).
- Confirmar **índice único** en `x_operation_id` (sale.order + account.payment).
- Preventa/consignación dependen del repo/rama de Sebas.
- No se pudieron ejecutar los tests de Odoo en el entorno de la auditoría.
