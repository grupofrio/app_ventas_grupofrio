# KoldField — Auditoría Enterprise Hardening V2

**Rama:** `audit/koldfield-enterprise-hardening-v2` (desde `main` actualizado, HEAD `8ae5fe9`)
**Fecha:** 2026-06-06
**Reemplaza:** `docs/KOLDFIELD_ENTERPRISE_HARDENING_AUDIT.md` (V1, desactualizada — se hizo antes de mergear route-start, KM, checklist, route-close, mapa, preventa, consignación, incidentes).
**Método:** re-auditoría read-only por subsistema con evidencia `archivo:línea`. **No se implementó ningún fix.**

## Severidad
- **P0** — dinero / inventario negativo / cobro o venta duplicada / cierre incoherente / bloqueo operativo.
- **P1** — datos incoherentes u operación incorrecta (con workaround).
- **P2** — control/UX. **P3** — mejora.

---

## 1. Resumen ejecutivo

`main` mejoró sustancialmente desde la V1: **KM inicial/final, checklist, aceptación de carga y cierre de ruta ya existen, están validados, persistidos y rehidratados** (route-start/route-close/checklist + `routeKm.ts`/`useRouteStartStore`). El "estado del jefe de ruta" (readiness checklist→KM→carga→iniciar) **se exige en el hub** de inicio. Preventa y Consignación están **bien aisladas** (carrito local, online-first, sin contaminar venta/liquidación).

**Pero la app NO está lista para operación enterprise sin endurecer 4 frentes P0**, todos heredados o estructurales:
1. **Inventario:** la venta normal **no descuenta stock local** → en offline se puede vender el mismo stock dos veces; el tope del carrito usa stock obsoleto; no hay prevención dura de negativos. **El backend no está confirmado que valide stock/negativos.**
2. **Idempotencia de venta:** `saleConfirmed`/`saleOperationId` **no se persisten** → un crash entre confirmar y encolar puede generar **venta duplicada** (nuevo `operation_id`).
3. **Liquidación:** confirma con items `error`/`dead` en cola (efectivo fantasma), **sin `operation_id`** (doble confirmación) y **acepta efectivo negativo** → cierre financiero incoherente/duplicado.
4. **Salto de flujo:** **no hay guard global**; `/sale`, `/consignment`, `/checkout`, `/route-close` se abren directo (deep link / nav) **sin validar readiness ni fase de visita**; el `app/map.tsx` standalone ofrece "Hacer venta" saltando check-in/geocerca.

**Nivel de riesgo:** **Medio-alto.** **Apto para piloto controlado** (con vendedores supervisados y conexión estable), **NO para operación enterprise "a prueba de todo"** hasta cerrar los P0.

---

## 2. Comparativo contra auditoría anterior (V1)

| Hallazgo V1 | Estado actual | Evidencia | Comentario |
|---|---|---|---|
| KM inicial/final inexistentes | **Resuelto** | `route-start.tsx:165-195`, `route-close.tsx:221-278`, `routeStartLogic.ts:41-44,59-68`, `routeKm.ts:18-44`, `useRouteStartStore.ts:89-130` | Capturado, validado `>0`, `final>=inicial`, distancia, persistido y rehidratado. Falta tope superior (absurdos). |
| Orden de operación no forzado | **Parcial** | hub `route-start.tsx:160-163`, `useRouteStartStore.ts:108-120` (readyToStart=checklist+KM+carga) | Se exige en el hub, **pero no hay guard global** que impida saltarlo. |
| Salto por deep link/mapa/offroute | **Vigente** | `_layout.tsx:105-129` (solo auth); `/sale`,`/stop`,`/checkout`,`/consignment`,`/route-close` sin guard de readiness | P0/P1. |
| Aceptar carga solo reactivo en venta | **Parcial** | hard gate en hub; reactivo en `sale/[stopId].tsx:118-122`; **ausente** en checkout/nosale/consignación | — |
| Sin descuento local tras venta (doble venta offline) | **Vigente (P0)** | `sale/[stopId].tsx:273` solo `loadProducts`; `updateLocalStock` existe (`useProductStore.ts:308-327`) pero no se llama | Crítico. |
| Tope de carrito con stock obsoleto | **Vigente (P1)** | `ProductPicker.tsx:284` captura `stock=qty_display`; `useVisitStore.ts:172-178` `Math.min(qty,l.stock)`; `sale:125-128` sin tope | — |
| Inventario negativo solo clampa display | **Parcial (P2)** | `useProductStore.ts:257,314` `Math.max(0,…)` | No previene sobre-reserva. |
| Modo referencia muestra 0-stock | **Parcial (P2)** | `ProductPicker.tsx:232-242` (muestra), `:271` bloquea selección | Por diseño (catálogo). |
| Regalos sin validar qty / devoluciones stub | **Vigente (P1)** | `gift/[stopId].tsx:268-276` sin tope; `returns/[stopId].tsx` stub | — |
| Venta fuera de plan sin validar stock | **Vigente (P1)** | `offroute.tsx:114-228` | Hereda K/L. |
| Sin manejo de 401 | **Vigente (P1)** | `api.ts:257-258`, re-auth solo `odooSession.ts:246` (call_kw) | — |
| Credenciales de servicio hardcodeadas | **Vigente (P1)** | `_layout.tsx:72,118` | — |
| 401/4xx → dead en 1 intento | **Parcial (P1)** | `syncFailure.ts:1-18` solo 5xx/red/timeout | — |
| Liquidación no bloquea por error/dead | **Vigente (P1)** | `cashcloseGuard.ts:28-32` solo `pendingCount` | Money. |
| `confirmRouteLiquidation` sin operation_id | **Vigente (P1)** | `gfLogistics.ts:818-838` | Doble confirmación. |
| Efectivo negativo aceptado | **Vigente (P1)** | `cashclose.tsx:85-90,436` | — |
| Cerrar con stops sin terminar | **Vigente (P1)** | `route-close.tsx:144`, `routeClose.ts:38-52` | Backend rechaza, sin idempotencia. |
| Regla efectivo esperado (`expected_payments.cash.total`) | **Resuelto** | `gfLogistics.ts:686-689` | Correcto. |
| Mapa abría venta directa | **Vigente (P1)** | `app/map.tsx:97-99,108,195` `openSale`→`/sale`; vs `route.tsx:121` correcto `/stop` | Standalone map saltea hub. |
| Venta sin guard de fase | **Vigente (P1)** | `sale/[stopId].tsx` y `consignment/[stopId].tsx` sin `deriveVisitGuard` de entrada | Concurrencia/visita sin check-in. |
| Ubicación denegada → lat/lon=0 | **Vigente (P2)** | `checkin/[stopId].tsx:153-166` | GPS "isla nula". |
| Foto opcional en check-in | **Resuelto (diseño)** | foto obligatoria en venta `sale:120,440-465` y no-venta `nosale:68` | Check-in es prueba de ubicación. |
| Orden de visita no forzado | **Parcial (P2)** | `routeMapLogic.selectNextStop` correcto; sin bloqueo/log de desviación | — |
| Offroute como pines normales | **Resuelto** | virtual `id<0` excluidos `routeMapLogic.ts:40`, `map.tsx:44-46` | — |
| `saleConfirmed`/opId no persistidos | **Vigente (P1→P0)** | `useVisitStore.ts:87-88,256-264`, no en `visitPersistence.ts` | Riesgo de venta duplicada en crash. |
| Cola persiste / crash recovery | **Resuelto** | `useSyncStore.ts:343-361` (syncing→pending), `rehydrate.ts:41,46` | — |

---

## 3. Matriz de riesgos actual

| Área | Riesgo | Sev. | Evidencia | Impacto | Recomendación |
|---|---|---|---|---|---|
| Inventario | Venta no descuenta stock local → doble venta offline | **P0** | `sale/[stopId].tsx:273` | Sobreventa / inventario negativo | `updateLocalStock` tras venta + confirmar dedup/stock backend |
| Venta/Sync | `saleConfirmed`/`saleOperationId` no persistidos → venta duplicada en crash | **P0** | `useVisitStore.ts:87-88,256-264` vs `visitPersistence.ts` | Cobro/venta duplicada | Persistir flag+opId; restaurar en rehidratación |
| Liquidación | Confirma con `error`/`dead` en cola; sin `operation_id`; efectivo negativo | **P0** | `cashcloseGuard.ts:28-32`, `gfLogistics.ts:818-838`, `cashclose.tsx:85-90` | Cierre incoherente/duplicado | Bloquear error/dead; opId; guard `>=0` |
| Flujo | Sin guard global; `/sale`,`/consignment`,`/checkout`,`/route-close` directos sin readiness/fase; `map.tsx` venta directa | **P0/P1** | `_layout.tsx:105-129`, `sale/[stopId].tsx` (sin guard), `map.tsx:97-99` | Operar sin check-in/checklist/KM/carga; visitas concurrentes | Guard global readiness + guard de fase en venta/consignación; quitar venta directa de `map.tsx` |
| Inventario | Tope de carrito con stock obsoleto | P1 | `useVisitStore.ts:172-178`, `ProductPicker.tsx:284`, `sale:125-128` | Sobreventa multi-dispositivo | Re-validar contra `qty_display` fresco al confirmar |
| Inventario | Regalos sin tope; devoluciones stub | P1 | `gift/[stopId].tsx:268-276`, `returns/[stopId].tsx` | Regalar > disponible; sin devoluciones | Tope qty en regalo; implementar devoluciones |
| Inventario | Venta fuera de plan sin validar stock | P1 | `offroute.tsx:114-228` | Sobreventa | Validar stock en offroute |
| Inventario | Consignación crea sin validar stock disponible | P2 | `consignmentLogic.ts:78-83` | Error confuso de backend | Validar qty≤stock antes de enviar |
| Inventario | Negativo solo clampado en display | P2 | `useProductStore.ts:257,314` | Sobre-reserva oculta | Validación dura `Σqty≤disponible` |
| Auth | Sin manejo de 401 (REST) | P1 | `api.ts:257-258` | Sesión muerta silenciosa | Detectar 401→logout/refresh |
| Auth | Credenciales de servicio hardcodeadas | P1 | `_layout.tsx:72,118` | Sin trazabilidad / fuga | Mover a config segura/por usuario |
| Sync | 401/4xx → dead en 1 intento | P1 | `syncFailure.ts:1-18` | Pérdida de operación por 401 transitorio | Distinguir sesión-expirada→reintento con re-auth |
| Cierre | Cerrar con stops sin terminar / corte no validado en UI | P1 | `route-close.tsx:144`, `cashclose.tsx:407-429` | Cierre parcial; corte solo backend | Exigir stops done + corte validado antes de cerrar |
| Cierre | Estado medio-cerrado si 500/timeout en `closeRoute`/liquidación | P1 | `route-close.tsx:141-157`, `gfLogistics.ts:841` | Ruta atorada | opId + recarga de plan tras error |
| Geocerca | Ubicación denegada → check-in `lat/lon=0` | P2 | `checkin/[stopId].tsx:153-166,299-301` | GPS falso | Bloquear check-in con coords + permiso denegado |
| Geocerca | Geocerca no re-chequeada en venta (si se entra por deep link) | P2 | `sale/[stopId].tsx` sin re-check | Vender lejos | Re-check al confirmar venta |
| Ruta | Orden de visita no forzado / sin log de desviación | P2 | `visitGuards.ts:42`, `map.tsx:97-99` | Sin control de secuencia | Log/alerta de desviación |
| Mapa | Stops sin coordenadas poco accesibles en vista mapa | P2 | `route.tsx:71,79,214` | Fricción operativa | FAB "Sin GPS" / forzar lista |
| KM | Sin tope superior (absurdos) | P2 | `routeStartLogic.ts:41-44` (solo `>0`) | KM absurdo | Tope superior |

---

## 4. P0 reales actuales

### P0-1 — Doble venta offline por falta de descuento local
- **Descripción:** tras confirmar venta normal sólo se recarga el catálogo (`sale/[stopId].tsx:273`); **no** se llama `updateLocalStock`. El tope del carrito usa `l.stock` capturado al agregar.
- **Por qué P0:** en offline, dos visitas/dispositivos ven el mismo stock → venta del mismo inventario dos veces → inventario negativo / pérdida.
- **Reproducción:** offline, vender 10/15 de un SKU en visita A; visita B (o segunda unidad) ve 15 y vende 12; ambas sincronizan → 22 vendidas de 15.
- **Fix:** `updateLocalStock(-qty)` tras venta exitosa + re-validar carrito contra `qty_display` fresco. **Requiere backend:** confirmar que rechaza `qty_available<0` y deduplica por `operation_id`.

### P0-2 — Venta duplicada por idempotencia no persistida
- **Descripción:** `saleConfirmed` y `saleOperationId` viven sólo en memoria (`useVisitStore.ts:87-88,256-264`); `visitPersistence.ts` no los guarda.
- **Por qué P0:** crash entre confirmar y encolar → al reabrir, flag/opId reinician → el vendedor re-confirma → **nuevo `operation_id`** → el backend no puede deduplicar → venta/cobro duplicado.
- **Reproducción:** confirmar venta → matar app antes de que se persista la cola → reabrir → re-confirmar.
- **Fix:** persistir `saleConfirmed`+`saleOperationId` en el snapshot y restaurarlos en rehidratación. (Frontend; no requiere backend.)

### P0-3 — Cierre/liquidación financieramente incoherente o duplicado
- **Descripción:** `canConfirmLiquidation` sólo bloquea por `pendingCount` (`cashcloseGuard.ts:28-32`), **ignora `error`/`dead`**; `confirmRouteLiquidation` **sin `operation_id`** (`gfLogistics.ts:818-838`); `parseCashInput` acepta **negativos** (`cashclose.tsx:85-90`).
- **Por qué P0:** liquidar con pagos muertos = efectivo esperado fantasma; doble-tap/retry = doble confirmación; efectivo negativo = liquidación corrupta.
- **Reproducción:** dejar un `payment` en `dead` → liquidar (no bloquea); o doble-tap "Confirmar liquidación" en red lenta; o teclear "-5000".
- **Fix:** bloquear si `error/dead>0`; `operation_id` en liquidación (coordinar dedup backend); guard `cash>=0`.

### P0-4 — Salto de flujo (sin guard global) + venta sin check-in
- **Descripción:** `_layout.tsx:105-129` sólo valida auth; `/sale`,`/consignment`,`/checkout`,`/route-close` se abren directo sin readiness ni fase; `app/map.tsx:97-99,108,195` ofrece "Hacer venta" → `/sale` saltando el hub `/stop` (que sí tiene guards en `route.tsx:121`).
- **Por qué P0:** permite vender sin checklist/KM/carga/check-in/geocerca y abrir visitas concurrentes → datos operativos incoherentes; viola el modelo del jefe de ruta.
- **Reproducción:** abrir `app/map.tsx` → pin → "Hacer venta"; o deep link/back-nav a `/sale/123` sin check-in.
- **Fix:** guard global de readiness en `_layout`/`(tabs)/_layout`; `deriveVisitGuard` de entrada en `/sale` y `/consignment`; quitar "Hacer venta" directo de `map.tsx` (enrutar a `/stop`). **Nota:** confirmar si `app/map.tsx` standalone sigue siendo alcanzable o es legado vs el `RouteMap` de `route.tsx`.

---

## 5. Inventario y stock

- **Venta normal:** picker filtra `qty_display<=0` y cap inicial (`ProductPicker.tsx:235,276`); carrito cap a `l.stock` **obsoleto** (`useVisitStore.ts:172-178`); confirmación alerta tardía (`sale:168-176`) pero **no descuenta local** (`:273`). **(P0/P1)**
- **Regalos:** `gift/[stopId].tsx:268-276` sin tope vs disponible; no descuenta local. **(P1)**
- **Consignación:** `create` no valida stock disponible (`consignmentLogic.ts:78-83`); backend baja inventario (`apply_inventory:true`). **(P2)**
- **Refill:** request-only sin tope (`refill.tsx:52-65`) — aceptable (almacén surte). **(P2)**
- **Offline:** sin detección de conflicto; sin descuento local ⇒ doble venta. **(P0)**
- **Devoluciones:** `returns/[stopId].tsx` **stub no funcional**. **(P1)**
- **Validación frontend/backend:** frontend es **advisory**; **no confirmado** que el backend rechace negativos o valide stock al crear `sale.order`. **Pedir a Sebas.**

---

## 6. Offline / sync

- **Robusto:** cola persistida en AsyncStorage; `syncing→pending` al rehidratar (`useSyncStore.ts:343-361`); prioridades (negocio/media/telemetría); `operation_id` por item; retries+backoff; snapshot de visita restaurado con chequeo de fecha/empleado.
- **Encolado (offline-capaz):** `sale_order, checkin, checkout, payment, no_sale, collection, refill, unload, transfer, customer_*, prospection, offroute_visit_close, photo, gps`.
- **Online-only (correcto, NO encolados):** preventa, consignación, KM, checklist, route-close, liquidación. **(Resuelto)**
- **No robusto:**
  - `saleConfirmed`/`saleOperationId` no persistidos → duplicado en crash. **(P0, ver P0-2)**
  - 401/403/4xx → `dead` en 1 intento (`syncFailure.ts`) sin re-auth. **(P1)**
  - Sin descuento local de inventario → conflicto offline. **(P0)**
- **Bloqueo de cierre:** la liquidación se bloquea por `pending` pero **no** por `error`/`dead`. **(P0, ver P0-3)**
- **Idempotencia nuevos flujos:** preventa/consignación generan `operation_id` local (online-first, ok); KM/checklist/route-close confían en idempotencia backend por `plan_id`/recurso — **confirmar con Sebas**.

---

## 7. Deep links / salto de flujo

**Pantallas abribles directo (sin guard de readiness/fase):**
- `/stop/[id]` — `deriveVisitGuard` valida fase de visita pero **no** readiness de ruta (`stop/[stopId].tsx:105-113`).
- `/sale/[id]` — **sin** guard de fase; sólo chequeo reactivo de carga (`sale/[stopId].tsx:118-122`).
- `/consignment/[id]` — **sin** guard de fase; sólo online-first (`consignment/[stopId].tsx:76`).
- `/checkout/[id]` — **sin** guard.
- `/route-close` — **sin** guard de readiness (espera KM final).
- `app/map.tsx` — "Hacer venta" directo a `/sale` (`:97-99,108,195`).

**Guards existentes:** sólo auth en `_layout.tsx:105-129`; `route.tsx:121` enruta a `/stop` (correcto); `sale` chequea carga (reactivo); `stop` chequea fase.
**Guards faltantes:** (1) guard global de readiness (checklist+KM+carga+ruta iniciada) antes de venta/visita; (2) `deriveVisitGuard` de entrada en `/sale` y `/consignment`; (3) eliminar venta directa de `map.tsx`; (4) extender gate de carga a checkout/nosale/consignación.

---

## 8. Plan de hardening

### Fase 1 — P0 (críticos y seguros)
1. **Inventario:** `updateLocalStock(-qty)` tras venta exitosa + re-validar carrito vs `qty_display` fresco al confirmar (P0-1).
2. **Idempotencia venta:** persistir `saleConfirmed`+`saleOperationId` y restaurarlos (P0-2).
3. **Liquidación:** bloquear si `error/dead>0`; `operation_id` en `confirmRouteLiquidation`; guard `cash>=0` (P0-3).
4. **Guard de flujo:** guard global de readiness + `deriveVisitGuard` en `/sale` y `/consignment`; quitar venta directa de `map.tsx` (P0-4).

### Fase 2 — P1 (consistencia operativa)
- Tope de carrito vs stock fresco (L); tope qty en regalos + implementar devoluciones (O); validar stock en offroute (P) y en consignación-create.
- 401 → logout/refresh (W); credenciales por usuario (X); 401 transitorio → reintento con re-auth (Y).
- Cerrar sólo con stops terminados + corte validado en UI (I); recuperar estado tras 500 en close/liquidación (new).
- Bloquear check-in con coords + permiso denegado (S); re-check de geocerca al confirmar venta.

### Fase 3 — UX y telemetría
- Tope superior de KM (absurdos); log/alerta de desviación de orden de visita (U); FAB "Sin GPS" en mapa; mensajes contextuales de error (401 vs red); indicadores claros de cola/offline.

---

## 9. Quick wins

| Fix | Archivo | Riesgo reducido | Esfuerzo | Riesgo de cambio |
|---|---|---|---|---|
| Guard `cash>=0` antes de liquidar | `cashclose.tsx:~436` | Liquidación negativa | XS | Bajo |
| Bloquear liquidación si `error/dead>0` | `cashcloseGuard.ts:28-32` | Efectivo fantasma | XS | Bajo |
| Tope numérico real de qty en venta | `sale/[stopId].tsx:125-128` | Sobreventa por typo | XS | Bajo |
| Quitar "Hacer venta" directo del mapa | `map.tsx:97-99,108,195` | Bypass check-in/geocerca | XS | Bajo (UX) |
| Rechazar check-in `lat/lon=0` con coords+permiso denegado | `checkin/[stopId].tsx:153-166,299-301` | GPS falso | XS | Bajo |
| Persistir `saleConfirmed`+opId | `useVisitStore.ts`+`visitPersistence.ts` | Venta duplicada en crash | S | Medio |
| `deriveVisitGuard` de entrada en `/sale` y `/consignment` | `sale`, `consignment` | Venta sin check-in / concurrente | S | Medio |
| `updateLocalStock(-qty)` tras venta | `sale/[stopId].tsx:~261-273` | Doble venta offline | S | Medio (probar) |
| Tope superior de KM | `routeStartLogic.ts:41-44` | KM absurdo | XS | Bajo |
| Tope qty en regalos | `gift/[stopId].tsx:268-276` | Regalar > disponible | XS | Bajo |

---

## 10. Preguntas para Sebas / backend (solo las que bloquean fixes)
1. **¿El backend valida stock y rechaza `qty_available<0`** al crear `sale.order`/consignación? (decide si el descuento local del frontend es defensa o única barrera — P0-1).
2. **¿`operation_id` deduplica de verdad** en `sales/create` y `payments/create`? Si sí, P0-2 se cubre persistiendo el opId; si no, riesgo mayor.
3. **¿`confirmRouteLiquidation` es idempotente por `plan_id`** o necesita `operation_id`? (P0-3).
4. **¿`close-route` rechaza si hay stops sin terminar / corte no validado / KM faltante**, y es idempotente ante retry? (P1 cierre).
5. **¿KM-update / checklist son idempotentes** por `plan_id`/recurso? (confirmar antes de no agregar opId).
6. **Consignación:** ¿serializar `sale_order_id`/folio/importe/`sold_qty` en la respuesta? (hoy no vienen; afecta UX, no bloquea).

---

## Apéndice — Estado verificado de Preventa / Consignación (en `main`)
**Preventa** (`presale.ts`/`presale.tsx`): `PRESALE_BACKEND_ENABLED=true`, endpoint `pwa-ruta/presale-create`; crea cotización draft; **no** abre checkout/pago/inventario/liquidación; leads bloqueados (`PRESALE_LEAD_SUPPORTED=false`); carrito local; fecha validada; `operation_id`; offline **bloquea**; vive en **menú general** de ruta. **Sin contaminación. ✅**
**Consignación** (`consignment.ts`/`[stopId].tsx`): `CONSIGNMENT_BACKEND_CONFIRMED=true`, endpoints reales; **solo clientes** (no leads), **dentro de `/stop/[id]`**, no en menú general; `create` con `apply_inventory:true`+`route_plan_id`/`mobile_location_id` (advierte si faltan ambos); `price_unit` del precio cliente; visit/close con `counts`+`payment_method:'cash'`+`operation_id` (no `method`); online-first bloquea offline; no usa carrito de venta; no simula éxito. **Riesgos:** sin guard de fase de entrada (P1, ver P0-4); sin validación de stock al crear (P2); el cobro `cash` entra a corte/liquidación vía `route_plan_id` → interactúa con P0-3. **Sin contaminación de venta normal. ✅**
