# KoldField — Solicitudes de hardening al backend (Sebas)

**Contexto:** la rama `feat/koldfield-hardening-p0` implementa los fixes P0 **frontend** del audit V2 (`docs/KOLDFIELD_ENTERPRISE_HARDENING_AUDIT_V2.md`). Varios P0 sólo quedan **completamente cerrados con cambios en backend** (módulos Odoo, propiedad de Sebas). Este documento lista esas solicitudes para un PR separado del backend.

> El frontend ya manda lo necesario o quedó preparado de forma compatible (campos extra que un backend que ignora desconocidos no rompe). Cada punto indica qué hace hoy el frontend y qué falta del lado servidor.

---

## 1. Validación dura de stock en `/sales/create`
- **Pedido:** rechazar la creación de `sale.order` cuando alguna línea pide `quantity > qty_available` de la unidad/ruta.
- **Por qué:** el frontend es *advisory*; revalida contra stock fresco al confirmar (`saleStockValidation.findFreshStockIssues`), pero en offline/concurrencia dos ventas pueden pasar el check local. El backend debe ser la barrera dura.
- **Frontend hoy:** bloquea qty inválida y qty > `qty_display` fresco antes de enviar.

## 2. Rechazo de inventario negativo
- **Pedido:** nunca permitir que `qty_available` quede < 0 tras una venta/consignación/regalo.
- **Por qué:** el frontend sólo "clampa" el display a 0; no previene el sobregiro real.

## 3. Idempotencia real por `operation_id`
- **Pedido:** deduplicar por `operation_id` en:
  - `sales/create` (ventas),
  - `payments/create` (pagos),
  - `liquidacion/confirm` (ver punto 4),
  - consignación `create`/`visit`/`close` (si aplica).
- **Por qué:** el frontend genera y **persiste** `operation_id` (P0-2) y lo reenvía en reintentos/crash. Sin dedup backend, un reintento tras un 200-con-red-caída duplica la operación.
- **Frontend hoy:** venta persiste `saleConfirmed`+`saleOperationId` y reusa el mismo id; consignación/preventa mandan `operation_id`.
- **Pregunta bloqueante:** ¿`operation_id` ya deduplica en `sales/create` y `payments/create`? (define si el P0-2 queda 100% cerrado o sólo mitigado).

## 4. `confirmRouteLiquidation` idempotente
- **Pedido:** que `liquidacion/confirm` sea idempotente por `plan_id` **o** por el `operation_id` que ahora envía el frontend.
- **Por qué:** evita doble confirmación por doble-tap/retry.
- **Frontend hoy:** envía `operation_id` ESTABLE por intento (`liquidation-<plan>-<ts>-<rand>`, mismo id para el reintento "force"). Es un campo extra compatible.
- **Pregunta bloqueante:** ¿el endpoint acepta/usa `operation_id`, o debo confiar sólo en dedup por `plan_id`?

## 5. `close-route` idempotente + validaciones de cierre
- **Pedido:** que `close-route` sea idempotente ante retry y rechace cerrar si:
  - falta **KM final**,
  - el **corte no está validado**,
  - la **liquidación no está confirmada**,
  - hay **stops pendientes/in_progress**.
- **Por qué:** el frontend exige KM final y readiness, pero no chequea stops pendientes ni el orden corte→liquidación→cierre de forma dura; un 500/timeout puede dejar la ruta medio-cerrada.

## 6. `km-update` idempotente por plan/type
- **Pedido:** idempotencia por (`plan_id`, `type`) en `km-update` (departure/arrival).
- **Por qué:** el frontend no manda `operation_id` aquí (online-first); confiamos en que reescribir el mismo (plan,type) sea idempotente.
- **Pregunta:** ¿lo es?

## 7. `checklist` idempotente por plan/check
- **Pedido:** idempotencia por (`plan_id`, `check_id`) al responder checks; un re-submit no debe duplicar respuestas ni revertir estado `completed`.
- **Pregunta:** ¿lo es?

## 8. Consignación: serializar resultado de venta/pago/picking
- **Pedido:** que `create`/`visit`/`close` devuelvan en `data`:
  - `sale_order_id`, folio/nombre de la venta,
  - `payment_id`,
  - `picking_id`,
  - importe cobrado,
  - `sold_qty` explícito.
- **Por qué:** hoy la app muestra sólo el **preliminar** + el `message` del backend; el vendedor no ve el folio/importe real generado. (UX; no bloquea operación.)

## 9. Auth / 401: criterio de sesión expirada
- **Pedido:** definir el criterio/última palabra para token expirado:
  - ¿status 401 estándar en endpoints REST cuando el `X-GF-Employee-Token` expira?
  - ¿hay refresh, o el cliente debe forzar re-login?
- **Por qué:** el frontend ahora muestra mensaje claro de "Sesión expirada" en 401 (`apiResult` → `code:'session_expired'`), pero **no** hace logout automático (sería refactor mayor de auth). Necesitamos el criterio backend para implementar logout/refresh correctamente en una fase posterior.

---

## Resumen de qué queda cerrado vs pendiente-backend
| P0 | Frontend (esta rama) | Cierre depende de backend |
|---|---|---|
| P0-1 inventario | Revalida stock fresco + bloquea qty inválida/over | **Sí** (puntos 1, 2) |
| P0-2 venta duplicada | Persiste + reusa `operation_id`/`saleConfirmed` | Parcial (punto 3: dedup real) |
| P0-3 liquidación | Bloquea error/dead, `operation_id`, efectivo≥0 | Parcial (punto 4: dedup) |
| P0-4 salto de flujo | Guard global de readiness + sin venta directa en mapa | No (cerrado en frontend) |
