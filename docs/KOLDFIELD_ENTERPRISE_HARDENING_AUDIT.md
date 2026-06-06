# KoldField — Auditoría Enterprise Hardening

**Rama:** `audit/koldfield-enterprise-hardening` (desde `main`)
**Fecha:** 2026-06-06
**Alcance:** auditoría read-only de toda la app KoldField (Expo/React Native). **No se implementó ningún fix.**
**Método:** revisión de código por subsistema (auth/sync, inventario, inicio-de-operación/KM, venta/checkout/pago, geocerca/check-in/mapa, cierre/liquidación) con evidencia `archivo:línea`.

> **Nota de alcance:** Preventa y Consignación **no están en `main`** (viven en PR #18 `feat/koldfield-presale-consignment`). Se auditan en §8 a partir de esa rama. El resto refleja `main`.

## Clasificación de severidad
- **P0** — puede causar pérdida de dinero, inventario negativo, venta/cobro duplicado, cierre incoherente o bloqueo operativo.
- **P1** — datos incoherentes / mala operación, con workaround.
- **P2** — mejora de control/UX.
- **P3** — nice to have.

---

## RESUMEN EJECUTIVO — Top hallazgos

La app está diseñada con **fluidez operativa por encima de la validación**: la mayoría de los controles duros se delegan al backend. Para operación enterprise "a prueba de todo" faltan barreras críticas en el **frontend**. Lo más grave:

1. **No hay descuento local de inventario tras la venta** → en offline, dos rutas/visitas pueden vender el mismo stock (sobreventa). El display sólo se "clampa" a 0, no previene el sobregiro. **(P0)**
2. **El tope de cantidad del carrito usa stock OBSOLETO** capturado al agregar la línea; el `TextInput` acepta cualquier número. **(P0)**
3. **KM inicial y KM final NO existen en toda la app** (ni captura, ni validación, ni distancia). **(P0)**
4. **No se exige el orden de operación** (checklist→KM→aceptar carga→iniciar ruta→…→liquidación); se puede saltar por deep link, mapa o venta fuera de plan. **(P0/P1)**
5. **La liquidación NO se bloquea por items en cola `error`/`dead`** → efectivo esperado fantasma; `confirmRouteLiquidation` sin `operation_id` → posible doble confirmación; acepta **efectivo negativo**. **(P1)**
6. **Sin manejo de 401** (no hay auto-logout ni refresh de sesión); credenciales de servicio hardcodeadas en `_layout`. **(P0/P1)**
7. **El mapa abre venta saltando check-in y geocerca**; la pantalla de venta no valida la fase de visita; permiso de ubicación denegado → check-in con `lat/lon=0`. **(P1)**

---

## ENTREGABLE 1 — Matriz de reglas operativas

| Área | Regla operativa requerida | Existe hoy | Evidencia archivo/ruta | Riesgo | Sev. | Recomendación |
|---|---|---|---|---|---|---|
| Inventario | No vender producto que no trae la unidad | Parcial | `ProductPicker.tsx:235,264` filtra `qty_display<=0`, pero en modo referencia/global (`hasStockData=false/null`) muestra todo | Vender lo que no hay | **P0** | En modo referencia, bloquear confirmación; exigir refresh de stock |
| Inventario | No vender más de lo disponible | Parcial | Tope en picker `ProductPicker.tsx:276`; pero carrito usa `l.stock` estático `useVisitStore.ts:172-178`; `setSaleQtyFromText` sin tope `sale/[stopId].tsx:125-128` | Sobreventa | **P0** | Recalcular tope contra `qty_display` fresco al editar y al confirmar |
| Inventario | Evitar inventario negativo | No (sólo display) | `useProductStore.ts:313-314` `Math.max(0,…)` clampa display, no previene | Sobregiro silencioso | **P0** | Validación dura cant.≤disponible; backend rechazo |
| Inventario | No descontar dos veces / no doble venta offline | No | venta NO llama `updateLocalStock` (`sale/[stopId].tsx:273` sólo recarga) | Doble venta del mismo stock | **P0** | Descuento local optimista tras venta + dependencia de idempotencia backend |
| Inventario | Validar precio/descuento/cantidad/total | No (precio/desc.) | qty filtra `<=0`; precio sólo NaN `salePricing.ts`; descuento sin validar `gfLogisticsContracts.ts:36-48` | Línea de $1M por typo | P1/P2 | Rangos máximos de precio/desc./qty |
| Inicio op. | Orden obligatorio checklist→KM→carga→iniciar→…→liquidación | No | sin máquina de estado de "ruta iniciada"; gates sólo por pantalla | Saltar pasos críticos | **P0** | Estado de readiness + guard global de navegación |
| Inicio op. | KM inicial obligatorio + validado | No existe | grep km/odometer: sin campos en `types/plan.ts`, `unload.tsx`, `cashclose.tsx` | Sin baseline de distancia | **P0** | Capturar KM + foto odómetro al aceptar carga; validar `>0` |
| Cierre | KM final obligatorio, `KM_final>=KM_inicial`, distancia | No existe | `cashclose.tsx` no captura KM | Datos de ruta incoherentes | **P0** | Input KM final + validación + cálculo de distancia |
| Inicio op. | Aceptar carga antes de vender | Parcial | `routeLoadAcceptance.ts:141-143` `canStartSaleWithRouteLoad`; chequeo reactivo en `sale/[stopId].tsx:118-122` | Vender sin recibir carga | P1 | Flag de ruta-iniciada que bloquee visitas |
| Inicio op. | Checklist/foto unidad antes de iniciar | No | `unload.tsx` es fin-de-día; no hay checklist de inicio | Unidad sin verificar | P1 | Pantalla checklist de inicio |
| Sesión | Manejar 401 / sesión expirada | No (REST) | `api.ts:253-258` lanza error genérico; re-auth sólo en `odooSession.ts:246` (call_kw) | Token muerto, fallo silencioso | **P0** | Detección de 401 → logout/refresh |
| Sesión | Credenciales por usuario (auditoría) | No | `_layout.tsx:72,118` credenciales de servicio hardcodeadas | Sin trazabilidad por vendedor | P1 | Credenciales por usuario / env |
| Sesión | Bloquear pantallas profundas sin sesión | Parcial | guard en `_layout.tsx:106-129` (sólo `isAuthenticated`); pantallas no revalidan `employeeId` | UI parcial con sesión rota | P1 | Validación por pantalla de `employeeId` |
| Venta | Bloquear venta sin líneas | Sí | `sale/[stopId].tsx:120-122,179-180` | — | OK | Mantener |
| Venta | Anti doble-tap de confirmación | Sí (memoria) | `useVisitStore.ts:256-259` `lockSaleConfirm`; `sale/[stopId].tsx:155,513` | Re-confirm tras crash (flag no persistido) | P2 | Persistir `saleConfirmed`/opId |
| Pago | Pago idempotente (no doble cobro) | Depende backend | `useSyncStore.ts:177-192` opId=uuid por enqueue; `gfLogisticsContracts.ts:115-151` | Doble pago si backend no deduplica | P1 | Confirmar dedup backend por `operation_id` |
| No venta | Motivo obligatorio | Sí | `nosale/[stopId].tsx:68,93-100,362-368` (motivo+foto) | — | OK | Mantener |
| Check-in | Check-in (GPS+foto) obligatorio antes de vender | No | foto sólo en venta; mapa abre venta directo `map.tsx:97-99` | Venta sin prueba de visita | P1 | Guard de fase en venta; quitar venta directa del mapa |
| Geocerca | Dentro de geocerca para vender | Parcial | `checkin/[stopId].tsx:142-149` (radio 50m `useLocationStore.ts:17`); no se re-checa en venta | Vender lejos | P1/P2 | Re-check antes de confirmar venta |
| Permisos | Ubicación denegada no debe falsear posición | No | `checkin/[stopId].tsx:153-166` enquela `lat/lon=0` | GPS "isla nula" | P1 | Bloquear check-in con coords y permiso denegado |
| Orden visita | Respetar/controlar orden de visita | No | `visitGuards.ts:42` sin chequeo de `route_sequence`; orden sólo UI `route.tsx:78-83` | Sin control de desviación | P2 | Log de desviación / advertencia |
| Liquidación | No liquidar con cola pendiente/fallida | Parcial | `cashcloseGuard.ts:28-33` sólo `pendingCount`; ignora `error`/`dead` `useSyncStore.ts:157` | Efectivo esperado fantasma | **P1** | Bloquear si `error/dead>0` |
| Liquidación | Confirmación idempotente | No | `gfLogistics.ts:818-839` sin `operation_id` | Doble confirmación | **P1** | `operation_id` + dedup backend |
| Liquidación | Efectivo no negativo / no absurdo | No | `cashclose.tsx:85-90` `parseFloat` sin signo; `:436` envía sin validar | Liquidación negativa | P2 | Guard `>=0` + tope |
| Liquidación | Cerrar sólo con stops terminados | No | `cashclose.tsx` no checa estado de stops | Cierre parcial incoherente | P2 | Backend/front: exigir stops done |
| Deep link | No saltar pasos por pantallas internas | No | `_layout.tsx:105-129` sólo auth; `offroute.tsx:114-200` crea venta sin prep | Saltar checklist/carga/check-in | P1 | Guard global de operación |

---

## ENTREGABLE 2 — Matriz de flujos críticos

| Flujo | Pantallas | Servicios/endpoints | Validaciones actuales | Huecos | Riesgo |
|---|---|---|---|---|---|
| Inicio de operación | `(tabs)/route`, `unload`, Home (RouteLoadAcceptanceCard) | `routeLoadAcceptance.ts` (`acceptRouteLoad`) | aceptar carga (reactivo en venta) | sin KM, sin checklist, sin "ruta iniciada", sin orden | **P0** |
| Venta normal | `stop/[id]`, `sale/[id]`, `checkout/[id]` | `gfSalesOps.createSale`, `gfLogisticsContracts` | líneas>0, anti doble-tap, pago obligatorio, foto | stock obsoleto, sin descuento local, sin guard de fase | **P0** |
| Venta fuera de plan | `offroute`, `sale/[id]` | `offrouteSearch`, `offrouteVisit`, `offroutePricing` | búsqueda de entidad | sin validar stock, sin prep, mismo inventario | **P0** |
| Preventa (PR#18) | `presale` | `presale.ts`→`pwa-ruta/presale-create` | carrito local, leads bloqueados, gated | depende de backend; aislada (no toca venta/liquidación) | P2 |
| Consignación (PR#18) | `consignment/[id]` | `consignment.ts`→`pwa-ruta/consignment/{my-active,create,visit,close}` | carrito local, sólo clientes, conteo validado, online-first | respuesta sin folio/importe; cash entra a corte/liquidación (interactúa con P1 de liquidación) | P1 |
| Refill | `refill` | enqueue refill | request-only | no descuenta (correcto), sin confirmación de surtido | P2 |
| Incidente | (en otra rama PR#16) | `odooWrite('gf.route.incident')` | — | depende de política genérica backend | P2 |
| Cierre de ruta | `cashclose` | `gfLogistics`: `fetchRouteReconciliation`, `validateRouteCorte`, `confirmRouteLiquidation` | corte validado por backend, gate de cola pendiente | sin KM, ignora error/dead, sin opId, efectivo negativo, sin chequeo de stops | **P1** |
| Offline/sync | `sync`, todas | `useSyncStore.processQueue`, `saleRetry`, `saleSyncState` | cola persistida, prioridades, DAG, opId por item, retries+backoff | 401/4xx no-retryable→dead en 1 intento; flags no persistidos; sin descuento local | **P0/P1** |

---

## ENTREGABLE 3 — Stock e inventario (profundo)

**1. Dónde se carga** — `useProductStore.ts:104-296`, 3 niveles: (a) `fetchTruckStock(warehouseId, mobileLocationId)` con flag `hasStockData` (commit Sebastián dd78489); (b) `stock.quant` por ubicación (`:163-214`); (c) fallback global legacy (`:218-235`, ~104 productos, muestra warning `ProductPicker.tsx:472-478`).
Campos: `qty_available`, `qty_reserved` (V2), `qty_display = qty_available - qty_reserved` (`:257`).

**2. Dónde se descuenta** — `updateLocalStock` (`useProductStore.ts:308-327`) se llama en **exchange** (`exchange/[stopId].tsx:207-210`) y **unload** (`unload.tsx:58`). **La venta normal NO descuenta local** (`sale/[stopId].tsx:273` sólo `loadProducts`). **(P0)**

**3. Dónde se reserva** — `qty_reserved` se ajusta vía `updateLocalStock`; el carrito de venta no reserva contra stock fresco (usa `l.stock` capturado).

**4. Offline** — sin descuento tras venta + aislamiento offline ⇒ otra unidad/visita ve stock viejo. **Sin detección de conflicto.** **(P0)**

**5. Vender más de lo cargado** — `Math.min(qty, l.stock)` con `l.stock` OBSOLETO (`useVisitStore.ts:172-178`); `setSaleQtyFromText` sin tope (`sale/[stopId].tsx:125-128`); chequeo de stock tardío al confirmar (`:168-176`) que alerta pero el flujo offline puede continuar. **(P0)**

**6. Refill** — `refill.tsx:73-80` request-only, no descuenta (correcto; el almacén surte).

**7. Regalo** — `gift/[stopId].tsx`, `giftPayload.ts:70-76`: **no descuenta local**; depende del backend.

**8. Consignación** — backend baja inventario (`apply_inventory:true`); frontend no descuenta local (PR#18).

**9. Devolución** — `returns/[stopId].tsx` es **stub no funcional** (`:14-34`). Exchange-merma sí suma local (`exchange:210`).

**10. Validaciones frontend** — qty `>0` (filtra), precio sólo NaN, **descuento sin validar**, cantidad sin tope superior real (`maxLength=4` limita caracteres, no valor).

**11. Validaciones backend** — no visibles desde el repo de la app; se asume que Odoo valida. **No confirmado.**

**12. Qué falta para impedir negativo** — frontend: validación dura `Σqty ≤ disponible` antes de enviar; descuento local optimista tras venta; refresh de stock al abrir venta. Backend: rechazo de `qty_available<0` y dedup por `operation_id` (pedir a Sebas confirmación explícita).

---

## ENTREGABLE 4 — Offline / Sync

- **En cola:** `sale_order`, `payment`, `checkin`, `checkout`, `gps`, `nosale`, etc. (`useSyncStore.ts`). Estructura `SyncQueueItem` con `id`(uuid)=`_operationId`, `type`, `payload`, `status(pending|syncing|done|error|dead)`, `retries(0-3)`, `next_retry_at`, `priority(1-3)`, `dependsOn`.
- **Online-only de facto:** preventa y consignación (sin cola, online-first). Liquidación/corte requieren cola vacía.
- **Deberían ser online-only y no lo son del todo:** venta fuera de plan crea venta sin prep; ver §1.
- **Idempotencia:** `operation_id` por item; en venta `lockSaleConfirm` genera opId UNA vez (`useVisitStore.ts:256-259`) y se persiste en la cola; `gfLogisticsContracts.ts:9-14` lo extrae. **Punto débil:** opId se genera en `lockSaleConfirm` pero el flag `saleConfirmed` NO se persiste (`visitPersistence.ts`), así que un crash entre confirmar y checkout puede permitir re-confirmar (con opId nuevo). **(P2)**
- **Retries/backoff:** 2s/8s/30s ±20% (`useSyncStore.ts:256-276`); `MAX_RETRIES=3`→`dead`.
- **Duplicados:** mitigados por opId estable **si el backend deduplica** (confirmar). 
- **Errores permanentes:** patrones retryables sólo `5xx`/network/timeout (`syncFailure.ts`); **401/403/400 → `dead` en 1 intento** (`P1`), sin auto-logout.
- **Conflictos:** inventario sin detección de conflicto offline (P0, §3).
- **Recuperación tras cerrar app:** cola persiste en AsyncStorage; `syncing`→`pending` al rehidratar (`useSyncStore.ts:349`); snapshot de visita se recupera si el stop sigue `in_progress` (`rehydrate.ts:84-95`). `saleConfirmed`/`checkingOut` NO persisten (flags locales).

---

## ENTREGABLE 5 — Plan de hardening por fases

### Fase 1 — P0 / seguridad operativa
1. **Stock:** recalcular tope de qty contra `qty_display` fresco al editar y al confirmar; descuento local optimista tras venta; bloquear confirmación en modo referencia/global sin datos de stock.
2. **Inventario negativo:** validación dura `Σqty ≤ disponible` antes de enviar; pedir a Sebas rechazo backend de negativos + dedup por `operation_id`.
3. **Doble venta offline:** descuento local + idempotencia confirmada backend.
4. **KM:** agregar `km_inicial`/`km_final` (+foto odómetro) a `types/plan.ts`; captura en aceptar-carga y en cashclose; validación `>0` y `final>=inicial`.
5. **Orden de operación:** estado "ruta iniciada" en `useRouteStore`; guard global en `_layout` que bloquee venta/stop si no se completó checklist/KM/carga.
6. **Sesión:** detectar 401 en `postRest`/`postRpc` → logout/refresh; quitar credenciales hardcodeadas.
7. **Liquidación:** bloquear si `errorCount>0 || deadCount>0`; `operation_id` en `confirmRouteLiquidation`; guard `efectivo>=0`.

### Fase 2 — P1 / consistencia operativa
- Guard de fase en `sale`/`gift`/`nosale` (bloquear si `phase!==checked_in` o `currentStopId!==stopId`).
- Quitar "Hacer venta" directo del mapa → enrutar a `stop/[id]` (con guards).
- Bloquear check-in con coords cuando permiso de ubicación está denegado (no `lat/lon=0`).
- Foto obligatoria en check-in.
- Motivos/validaciones de cliente; control/log de desviación de orden de visita.
- KM absurdo (topes), estados de stop consistentes.
- Retryable: tratar 401 como recuperable con refresh; mejorar mensajes de `dead`.

### Fase 3 — UX / robustez
- Indicadores claros de offline/cola; mensajes contextuales de error (401 vs red).
- Recuperación guiada de items `dead` antes de liquidar.
- Persistir `saleConfirmed`/`checkingOut`.
- Distinción visual de stops fuera de plan en el mapa.

---

## ENTREGABLE 6 — Quick wins (bajo riesgo)

| Fix | Archivo | Riesgo que reduce | Esfuerzo | Recomendación |
|---|---|---|---|---|
| Guard `cashCaptured>=0` antes de liquidar | `cashclose.tsx:~436` | Liquidación negativa | XS | Hacer ya |
| Bloquear liquidación si `error/dead>0` | `cashcloseGuard.ts:28-33` | Efectivo fantasma | XS | Hacer ya |
| `operation_id` en `confirmRouteLiquidation` | `gfLogistics.ts:818-839` | Doble confirmación | S | Coordinar dedup con Sebas |
| Tope numérico real de qty en venta | `sale/[stopId].tsx:125-128` | Sobreventa por typo | XS | Hacer ya |
| Re-tope de carrito vs `qty_display` al confirmar | `useVisitStore.ts:172-178` + `sale` | Sobreventa con stock viejo | S | Alto valor |
| Guard de fase en pantalla de venta | `sale/[stopId].tsx` | Venta sin check-in (deep link/mapa) | S | Alto valor |
| Quitar venta directa del mapa | `map.tsx:97-111` | Bypass de check-in/geocerca | XS | Hacer ya |
| Rechazar check-in con `lat/lon=0` (coords+permiso denegado) | `checkin/[stopId].tsx:153-166` | GPS "isla nula" | XS | Hacer ya |
| Validación de rango precio/descuento | `salePricing.ts`/`gfLogisticsContracts.ts` | Línea $1M | S | Recomendado |
| Detección de 401 → logout | `api.ts:253-258` | Sesión muerta silenciosa | M | Coordinar UX |

---

## Lo que debemos pedir a Sebas (backend)
1. **¿El backend valida stock** antes de crear `sale.order` y **rechaza `qty_available<0`?** (clave para P0 de inventario).
2. **¿`operation_id` está realmente activo como dedup** en `sales/create`, `payments/create`, y se necesita en `confirmRouteLiquidation`/consignación?
3. **¿`validate-corte` rechaza diferencias** de inventario o tolera redondeos?
4. **¿Liquidación es idempotente** por `plan_id`? ¿Qué pasa si se confirma dos veces?
5. **Consignación:** serializar `sale_order_id`/folio/importe/`sold_qty` en la respuesta (hoy no vienen).
6. **¿KM/odómetro** debe vivir en el plan o en un modelo aparte? (no existe en frontend).

---

## Apéndice — Preventa / Consignación (PR #18, no en main)
- **Aislamiento (bueno):** ambas usan **carrito local** (no `useVisitStore.saleLines`); preventa NO abre checkout/pago/inventario/liquidación; consignación NO usa carrito de venta.
- **Preventa:** crea cotización `draft`; leads bloqueados; gated por `PRESALE_BACKEND_ENABLED`.
- **Consignación:** contrato real; `payment_method:'cash'` por default que **sí entra a corte/liquidación** (`gf_route_plan_id`) → interactúa con los P1 de liquidación (§Entregable 2). Riesgo: respuesta sin folio/importe.
