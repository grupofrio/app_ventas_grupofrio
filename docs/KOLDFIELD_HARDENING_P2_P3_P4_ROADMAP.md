# KoldField — Roadmap de Hardening P2 / P3 / P4

**Rama:** `docs/koldfield-hardening-p2-p3-p4-roadmap` (desde `main` `9e225c4`)
**Estado:** 📋 **Roadmap — sin implementación.** Derivado del estado real de `main` + auditoría V2.
**Base:** `docs/KOLDFIELD_ENTERPRISE_HARDENING_AUDIT_V2.md` (rama `audit/koldfield-enterprise-hardening-v2`) y `docs/KOLDFIELD_BACKEND_HARDENING_REQUESTS.md`.

---

## 1. Resumen ejecutivo

P0 y P1 ya están **mayormente cerrados** (PR #18/#19/#20/#21 mergeados; **PR #22 pendiente de merge**). La app tiene: guards de readiness (`OperationGate`), idempotencia de venta persistida, liquidación endurecida, calendario de preventa, consignación cash-only con manejo de sesión, y advertencia de orden de visita.

Lo que **queda** ya **no bloquea la operación**: son barreras de *control/trazabilidad* (P2), *UX/productividad* (P3) y *observabilidad/refinamiento* (P4). Una parte importante **depende del backend de Sebas** (el frontend solo puede mitigar): rechazo de inventario negativo, serialización de consignación, validaciones duras de cierre.

> **Bloqueo previo a P2:** mergear **PR #22** (lista respeta orden de visita + `fetchActive` 401). Hasta entonces, esos 2 fixes P1 no están en `main`.

La clasificación propuesta por el objetivo (P2 control/trazabilidad, P3 UX, P4 observabilidad) **coincide** con los residuales de la auditoría V2 — se adopta.

---

## 2. Qué quedó cerrado en P0/P1

| Hallazgo / mejora | Estado actual | PR | Sigue pendiente | Evidencia |
|---|---|---|---|---|
| P0-2 venta duplicada en crash (persistir `saleConfirmed`/opId) | ✅ Resuelto | #19 | — | `visitPersistence.ts`, `useVisitStore` |
| P0-3 liquidación (error/dead + opId + efectivo≥0) | ✅ Resuelto | #19 | — | `cashcloseGuard.ts`, `gfLogistics.ts`, `cashclose.tsx` |
| P0-4 salto de flujo / deep-link (OperationGate + mapa→/stop) | ✅ Resuelto | #19 | — | `src/components/OperationGate.tsx`, `map.tsx` |
| P0-1 doble venta offline | ⚠️ Parcial | #19 | **Sí (backend)** | `saleStockValidation.ts` revalida stock fresco al confirmar; **NO** hay descuento local (deliberado) → barrera real = backend rechaza negativos |
| L tope de carrito obsoleto | ✅ Resuelto | #19 | — | `saleStockValidation.findFreshStockIssues` |
| S check-in con `lat/lon=0` | ✅ Resuelto | #19 | — | `checkin/[stopId].tsx` |
| W manejo de 401 (mensaje) | ⚠️ Parcial | #19/#21/#22 | Sí (global) | `apiResult.ts` (mensaje), re-login solo en consignación |
| Preventa: calendario de fecha | ✅ Resuelto | #20 | — | `CalendarPicker`, `calendarLogic` |
| Consignación: pago | ✅ cash-only | #21 + `9e225c4` | — | `ConsignmentPaymentMethod='cash'` |
| Consignación: sesión expirada (mutaciones) | ✅ Resuelto | #21 | — | `consignment/[stopId].tsx` `handleApiError` |
| Consignación: sesión expirada (`fetchActive`) | ⏳ En #22 | #22 | **Pendiente merge** | `consignment/[stopId].tsx` `fetchActive` |
| Orden de visita: aviso (panel/mapa) | ✅ Resuelto | #21 | — | `routeOrderLogic`, `route.tsx handleOpenClient` |
| Orden de visita: aviso desde **lista** | ⏳ En #22 | #22 | **Pendiente merge** | `route.tsx` tarjeta → `handleOpenClient` |
| Sync/offline: copy de estado | ✅ Resuelto | #21 | — | `syncStatusCopy.ts`, `sync.tsx` |

---

## 3. Qué queda pendiente (resumen)

- **Pendiente de merge:** PR #22 (2 fixes P1).
- **Frontend P2:** credenciales por usuario, devoluciones (stub), tope de regalo, validación de stock en consignación-create/offroute/gift, tope superior de KM, re-check de geocerca en venta, re-login global, retry de sesión en sync, prechequeo de cierre.
- **Frontend P3:** acceso a stops sin coords, claridad modo-referencia, reducción de fricción.
- **Frontend P4:** telemetría/dashboards (desviaciones, fallos de sync, sesiones, KM), feature flags centralizados, alertas de cola muerta/diferencias.
- **Backend (Sebas):** rechazo de inventario negativo, guard de stock duro, serialización de consignación, `already_confirmed`/`already_closed`, endpoint de devoluciones, 401 uniforme, persistencia de desviaciones.

---

## 4. Matriz P2 — Control operativo y trazabilidad

| Prioridad | Área | Mejora | Por qué importa | Archivos probables | Backend requerido | Riesgo | Esfuerzo | Recomendación |
|---|---|---|---|---|---|---|---|---|
| P2 | Auth/Trazabilidad | Quitar credenciales de servicio hardcodeadas → por usuario/secure config | Sin esto no hay trazabilidad por vendedor y hay riesgo de fuga | `app/_layout.tsx:72,118`, `odooSession.ts` | Sí (token/credencial por empleado) | Medio-Alto | M | Coordinar con Sebas antes; alto valor de auditoría |
| P2 | Inventario | Implementar **devoluciones** (hoy stub) | Sin devoluciones no se cierra el ciclo de inventario | `app/returns/[stopId].tsx` (39 líneas, stub) | Sí (endpoint returns) | Medio | M | Requiere contrato backend; documentar primero |
| P2 | Inventario | Tope de cantidad en **regalo** vs stock | Evita regalar más de lo disponible | `app/gift/[stopId].tsx`, reusar `saleStockValidation` | Parcial (backend valida) | Bajo | S | Quick win frontend |
| P2 | Inventario | Validar stock en **consignación-create** y **offroute** | Evita error confuso de backend / sobre-consignar | `consignment/[stopId].tsx`, `consignmentLogic.ts`, `offroute.tsx` | Backend = barrera real | Bajo-Medio | S | Reusar `findFreshStockIssues` |
| P2 | KM | Tope superior de KM (absurdos) | KM incoherente ensucia distancia/auditoría | `routeStartLogic.ts:41-44`, `route-start.tsx`, `route-close.tsx` | No | Bajo | S | Quick win |
| P2 | Geocerca | Re-check de geocerca al confirmar venta | Evita vender lejos si se entró por ruta no-canónica | `sale/[stopId].tsx`, `useLocationStore` | No | Bajo | S | Coherente con OperationGate |
| P2 | Cierre | Prechequeo en UI: stops terminados + corte validado antes de cerrar | Evita cierre parcial incoherente | `route-close.tsx`, `cashclose.tsx` | Backend = enforcement duro | Medio | M | Frontend avisa; backend bloquea |
| P2 | Auth | Re-login global ante `session_expired` (no solo consignación) | Vendedor no queda atrapado en ninguna pantalla | `sessionError.ts` (existe) + pantallas operativas | No | Bajo-Medio | M | Extender patrón ya probado |
| P2 | Sync | 401/sesión → reintento con re-auth (no `dead` en 1 intento) | Evita perder operación por 401 transitorio | `syncFailure.ts`, `useSyncStore.ts` | Backend 401 uniforme | Medio | M | Cuidado: no tocar lógica central sin tests |

---

## 5. Matriz P3 — UX avanzada y productividad

| Prioridad | Área | Mejora | Por qué importa | Archivos probables | Backend requerido | Riesgo | Esfuerzo | Recomendación |
|---|---|---|---|---|---|---|---|---|
| P3 | Mapa/Ruta | Acceso claro a **stops sin coordenadas** (FAB "Sin GPS" / contador) | Hoy quedan "de segunda" en vista mapa | `route.tsx`, `RouteStopPanel.tsx` | No | Bajo | S | Mejora de descubrimiento |
| P3 | Inventario | Claridad en **modo referencia** (0-stock visible pero no vendible) | El vendedor ve productos que no puede agregar | `ProductPicker.tsx` | No | Bajo | S | Etiqueta "solo referencia" |
| P3 | UX general | Estados de error/vacío más claros; reducir taps | Productividad de campo | varias pantallas | No | Bajo | M | Iterativo, no romper flujos |
| P3 | Consignación | Pulir resumen (importe/método/devolución) y confirmaciones | Claridad de cobro | `consignment/[stopId].tsx` | No | Bajo | S | Sobre lo ya hecho en #21 |

---

## 6. Matriz P4 — Observabilidad, analítica y refinamiento enterprise

| Prioridad | Área | Mejora | Por qué importa | Archivos probables | Backend requerido | Riesgo | Esfuerzo | Recomendación |
|---|---|---|---|---|---|---|---|---|
| P4 | Telemetría | Persistir/serializar **desviaciones de orden** (hoy solo log local) | Permite medir cumplimiento de ruta | `routeOrderLogic.ts`, `logger`, endpoint nuevo | Sí (endpoint) | Bajo | M | Hoy queda en `logInfo` local |
| P4 | Métricas | Telemetría estructurada: fallos de sync, sesiones expiradas, KM, dead-queue | Visibilidad operativa enterprise | `logger`, `useSyncStore`, monitoring | Sí (ingesta) | Bajo | M | Definir esquema con Sebas |
| P4 | Config | Feature flags centralizados (`PRESALE_BACKEND_ENABLED`, `CONSIGNMENT_BACKEND_CONFIRMED`) | Hoy son consts dispersas | `presale.ts`, `consignment.ts`, nuevo `featureFlags.ts` | Opcional (remote config) | Bajo | S | Centralizar primero local |
| P4 | Alertas | Alertas de items `dead` en cola y diferencias de liquidación | Detección proactiva | `sync.tsx`, monitoring | Sí (canal alerta) | Bajo | M | Tras telemetría |
| P4 | Diagnóstico | Pantalla de diagnóstico ampliada (estado readiness, KM, cola) | Soporte en campo | `app/profile.tsx`/nuevo | No | Bajo | M | Útil para piloto |

---

## 7. Dependencias backend (Sebas)

Items del roadmap que **no se cierran solo en frontend** (ver `KOLDFIELD_BACKEND_HARDENING_REQUESTS.md` y `BACKEND_HARDENING_P0_AUDIT.md`):
1. **Rechazo de inventario negativo** + guard de stock duro (cierra P0-1 y consignación/offroute/gift de verdad).
2. **Serialización de consignación** (`sale_order_id`, folio, `payment_id`, `picking_id`, `sold_qty`, `charged_amount`, `returned_qty`).
3. **Endpoint de devoluciones** (P2 returns).
4. **`already_confirmed` / `already_closed`** en liquidación/close-route + validaciones de cierre.
5. **401 uniforme `session_expired`** (habilita re-login global limpio).
6. **Endpoint/ingesta de telemetría** (P4: desviaciones, métricas).
7. **Credencial/token por empleado** (P2 trazabilidad).
> Nota: la idempotencia por `operation_id` en ventas/pagos **ya existe** en backend (ver auditoría backend).

---

## 8. Orden recomendado de implementación

0. **Mergear PR #22** (desbloquea P1 en main).
1. **P2 quick wins frontend** (sin backend): tope de regalo, tope superior de KM, validación de stock en consignación-create/offroute, re-check de geocerca. → 1 rama acotada.
2. **P2 con dependencia backend ligera**: re-login global, prechequeo de cierre en UI. → tras confirmar contrato.
3. **P2 mayores**: credenciales por usuario, devoluciones. → requieren backend; documentar+coordinar.
4. **P3 UX** (independiente, bajo riesgo): stops sin coords, modo referencia, claridad. → rama separada.
5. **P4 observabilidad**: feature flags centralizados (frontend) primero; luego telemetría/alertas con backend.

---

## 9. Quick wins (bajo riesgo, frontend puro)

| Fix | Archivo | Esfuerzo | Riesgo |
|---|---|---|---|
| Tope de cantidad en regalo vs stock | `gift/[stopId].tsx` | S | Bajo |
| Tope superior de KM (absurdos) | `routeStartLogic.ts`, `route-start/close` | S | Bajo |
| Validación de stock en consignación-create | `consignment/[stopId].tsx` | S | Bajo |
| Re-check de geocerca al confirmar venta | `sale/[stopId].tsx` | S | Bajo |
| Feature flags centralizados | nuevo `featureFlags.ts` | S | Bajo |
| FAB "Sin GPS" en mapa | `route.tsx` | S | Bajo |

---

## 10. Riesgos de mezclar demasiado en un PR

- **P2 control** y **P3 UX** mezclan reglas operativas con cosmética → difícil de revisar/aprobar; sepáralos.
- Tocar **sync queue** (retry de sesión) junto a otros fixes arriesga regresiones en caja/cierre → PR aislado con tests.
- Cambios que **dependen de backend** (devoluciones, negativos, serialización) NO deben ir en el mismo PR que quick wins frontend: bloquearían el merge esperando a Sebas.
- Regla: **un PR = una intención** (control / UX / observabilidad), pequeño y testeado, como #19/#21/#22.

---

## 11. Siguiente rama recomendada

**`feat/koldfield-hardening-p2-control-traceability`** — solo los **quick wins P2 frontend-puros** (tope de regalo, tope de KM, validación de stock en consignación/offroute, re-check de geocerca). Acotada, sin backend, testeable. **No crear aún** hasta: (a) mergear PR #22, (b) tu confirmación de alcance.
