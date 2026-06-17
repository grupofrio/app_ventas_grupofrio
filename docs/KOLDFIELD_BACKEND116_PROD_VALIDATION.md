# KoldField — Validación de integración con backend #116 (productivo)

**Fecha:** 2026-06-17 · **Commit app base:** `685f5c7` (main) + fix `fix/koldfield-backend116-integration`
**Ambiente backend:** productivo (grupofrio.odoo.com) con PR GrupoVeniu/GrupoFrio#116 desplegado (informado por Sebastián).
**Alcance:** validación **de contrato en código** (ejecutable y segura) + **runbook E2E** para correr con datos de prueba coordinados. **No se tocó backend ni contratos API.**

> ⚠️ **Las pruebas E2E (Hito 3) NO se ejecutaron en esta sesión.** Crean ventas/pagos/inventario REALES en producción y requieren: datos de prueba autorizados (ruta/van/cliente/producto/stock conocido), ventana sin operación real, y coordinación con Sebas/Yamil. Las reglas prohíben afectar caja/inventario real sin confirmación, y no hay APK/emulador para drivear la app autónomamente. Se entregan como runbook reproducible con criterios PASS/FAIL.

## Hito 2 — Validación de contrato #116 en código (PASS)

| Contrato #116 | Qué espera/hace la app | Código | Estado |
|---|---|---|---|
| `error_code: insufficient_stock` | `getInsufficientStockDetail` detecta por `error.code` o `data.error_code` (+ fallback por mensaje) | `insufficientStock.ts:31-46` | ✅ |
| `data.lines[]` con `requested_qty`, `available_qty`, `product_name` | parsea cada línea tolerante (números/strings) | `insufficientStock.ts:48-57` | ✅ |
| `available_qty = 0` → “AGOTADO” | `describeInsufficientStock` marca “🔴 AGOTADO (pediste N)” | `insufficientStock.ts:66-72` | ✅ |
| envelope `ok:false` + `data` propagado al error | `unwrapRestResult` adjunta `err.code` + `err.data` | `apiResult.ts` (test `insufficientStock.test.ts`) | ✅ |
| venta NO se marca confirmada si rechazo | `unlockSaleConfirm()` + `return` antes de marcar; carrito intacto; refresca inventario | `sale/[stopId].tsx:370-386` | ✅ |
| retry con mismo `operation_id` (no duplica) | `enqueue` fija `payload._operationId=id` estable; `rearmSaleOrderForRetry` reusa id; `buildSalesCreatePayload` envía `operation_id` | `useSyncStore.ts:205`, `saleRetry.ts`, `gfLogisticsContracts.ts` | ✅ |
| stock guard / almacén móvil real | la app NO descuenta stock local en pedido offline (S1); el backend valida y descuenta al confirmar | `useSyncStore` rollback sale_order = no-op | ✅ (delegado a #116) |
| cierre `already_closed` (idempotente) | **FIX**: `closeRoute` trata `already_closed` como éxito (no error falso en retry) | `routeClose.ts` + `idempotentResponse.ts` | ✅ (corregido aquí) |
| liquidación `already_confirmed` (idempotente) | **FIX**: `confirmRouteLiquidation` trata `already_confirmed` como éxito | `gfLogistics.ts:893-916` + `idempotentResponse.ts` | ✅ (corregido aquí) |
| guards cierre/liquidación bloquean con pendientes | `cashcloseGuard`/`routeCloseGuard` bloquean con pending/error/dead | sin cambios | ✅ |

### Bug de app encontrado y corregido
**Reintento idempotente de cierre/liquidación se mostraba como error falso.** `closeRoute` y `confirmRouteLiquidation` usan `postRest`, que **lanza** en `ok:false`. Si el backend #116 responde `already_closed`/`already_confirmed` con `ok:false`, la app mostraba “No se pudo cerrar la ruta” / “No se pudo liquidar” aunque el backend YA lo había aplicado (p.ej. reintento tras red intermitente que sí llegó al servidor). 

**Fix (mínimo, sin tocar contrato):** helper puro `idempotentResponse.ts` (`isAlreadyClosedResponse`/`isAlreadyConfirmedResponse`, por code o mensaje); ambos servicios tratan esos códigos como **éxito idempotente**. Robusto tanto si el backend los manda `ok:true+code` (ya funcionaba) como `ok:false` (antes fallaba). No corrompe datos: el backend ya es idempotente; esto solo corrige la UX del retry.

## Hito 3 — Runbook E2E (PENDIENTE de ejecución coordinada)

**Pre-requisitos (coordinar con Sebas/Yamil):** ruta/van de prueba autorizada · cliente de prueba · producto almacenable con stock conocido en el almacén móvil · usuario vendedor de prueba · método de pago de prueba · ventana sin operación real · build QA instalable (tag actual app + fix).

| # | Caso | Pasos | PASS si | FAIL si |
|---|------|-------|---------|---------|
| T1 | Venta stock suficiente | Vender ≤ disponible online | App: “Venta enviada”; no queda en Sync; sale.order en Odoo | Queda pendiente / error |
| T2 | Venta stock insuficiente | Vender > disponible | Alert lista producto, pediste vs disponible; si available=0 “🔴 AGOTADO”; venta NO confirmada; carrito intacto | Marca confirmada / pierde carrito / sin detalle |
| T3 | Retry misma venta | Forzar reintento (mismo operation_id) | Backend deduplica; 1 sola sale.order/pago/picking; app sin doble estado | Duplica en Odoo o doble estado app |
| T4 | Pedido offline pendiente | Modo avión → guardar pedido → checkout → reconectar | Checkout avanza; Sync muestra pendiente con cliente/total; al reconectar envía si hay stock; si no, error visible | Se cuelga / marca confirmado offline / duplica |
| T5 | Cierre ruta retry | Cerrar ruta; reintentar el cierre | 2º intento responde `already_closed`; app muestra “Ruta cerrada” (no error) | App muestra “No se pudo cerrar” |
| T6 | Liquidación retry | Confirmar liquidación; reintentar | 2º intento responde `already_confirmed`; app lo trata como confirmada (sin error falso) | App muestra “No se pudo liquidar” |

> T5/T6 validan precisamente el fix de esta sesión. T1–T4 validan el contrato ya soportado. **Registrar en este doc**: endpoint, payload (sin datos sensibles), respuesta backend, estado mostrado en app, screenshot/log, PASS/FAIL.

### Harness ejecutable (para correr en la ventana coordinada)
`scripts/e2e/backend116_validation.mjs` automatiza T1–T3 (y T5/T6 si hay plan de prueba) a nivel API, con aserciones del contrato #116 e idempotencia. **No es parte del bundle ni del suite**; es herramienta de QA. **Dry-run por defecto** (no toca la red); muta solo con `--run`. ⚠️ Con `--run` crea ventas/cierre/liquidación REALES → usar SOLO con datos de prueba autorizados y ventana sin operación real.

```bash
# 1) dry-run: valida config sin red
node scripts/e2e/backend116_validation.mjs
# 2) ejecución real (coordinada con Sebas/Yamil):
KF_BASE_URL=https://grupofrio.odoo.com \
KF_BARCODE=<vendedor_prueba> KF_PIN=<pin> \
KF_PARTNER_ID=<cliente_prueba> KF_PRODUCT_ID=<producto> KF_AVAIL_QTY=<stock_conocido> \
KF_WAREHOUSE_ID=<van> KF_PLAN_ID=<plan_prueba> KF_TESTS=T1,T2,T3,T5,T6 \
node scripts/e2e/backend116_validation.mjs --run
```
Salida: PASS/FAIL por test + resumen. T3 imprime los ids de ambas respuestas para confirmar que NO se duplicó la `sale.order` (verificar también en Odoo). **Sin secretos hardcodeados** (todo por env).

> NOTA HONESTA: en esta sesión el harness se validó en **dry-run** (sintaxis + sin red). T1–T6 con `--run` contra producción **no se ejecutaron** (faltan credenciales/datos de prueba autorizados y confirmación para crear transacciones reales).

## Hito 7 — Validación app

- **typecheck:** ✅ exit 0
- **tests:** ✅ 128/128 (incluye `idempotentResponse.test.ts`)

## Veredictos

- **GO / NO-GO APK QA:** **GO.** Contrato #116 soportado en código; idempotencia de cierre/liquidación corregida; typecheck/test limpios. La APK de QA es justamente el vehículo para ejecutar T1–T6.
- **GO / NO-GO producción controlada:** **CONDICIONAL — GO tras pasar T1–T6** en la ventana de prueba coordinada. No promover a producción amplia hasta que las 6 pruebas E2E den PASS contra el backend #116 productivo. El código de la app está listo; falta la evidencia E2E real (no ejecutable de forma segura/autónoma aquí).

## Decisión sobre el Hito 3 (E2E)

**2026-06-17 — Yamil decidió DIFERIR la ejecución E2E (T1–T6) a Sebas** en una ventana coordinada, usando el harness ya entregado. Se acepta como entregable de esta sesión: contrato #116 validado en código (PASS), fix de idempotencia (PR #54), runbook y harness ejecutable. La ejecución real de T1–T6 con datos de prueba autorizados queda como tarea operativa pendiente (no bloqueante para APK QA; sí requisito para el GO de producción controlada).

## Riesgos restantes

1. **Envoltura exacta de `already_closed`/`already_confirmed` no confirmada empíricamente.** El fix es robusto a `ok:true+code` y a `ok:false`; aun así, conviene confirmar con Sebas el shape exacto y, si difiere (p.ej. code distinto), ajustar el needle (el helper ya tiene fallback por mensaje).
2. **E2E no ejecutado** → el “GO producción” depende de T1–T6.
3. **Supervisor real** sigue pendiente (telemetría backend), fuera del alcance de #116.
4. Sin coordinación de datos de prueba, no se deben correr T1–T6 contra rutas reales activas.
