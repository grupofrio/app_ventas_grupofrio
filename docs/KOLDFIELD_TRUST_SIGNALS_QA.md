# KoldField — QA: señales de confianza operativa

**Rama:** `feat/koldfield-trust-signals-ux` · **Base:** `main` @ `4d02952`
**Objetivo:** que el vendedor entienda SIEMPRE cuándo un dato es definitivo, referencial, viejo o incompleto, y que nunca vea información engañosa. UX-only: no backend, no contrato API, no bloquea flujos.

Todo se concentra en un helper puro testeable: `src/services/trustSignals.ts`.

## Hito 1 — Precio / stock referencial

- **`describePriceTrust`**: sin conexión → "Precio referencial"; en línea con pricelist → "Precio cliente"; en línea sin pricelist → "Precio lista".
- **`describeStockTrust`**: sin conexión o `hasStockData !== true` → "Stock referencial"; en línea con stock real → "Stock de tu unidad".
- **`describeCatalogTrustBanner`**: banner único (null si todo confirmado). Sin conexión: "Sin conexión: precios y stock son REFERENCIALES (última sincronización). Odoo los confirma al sincronizar."
- **Pantallas:** `ProductPicker` (banner reemplaza el viejo "Inventario global"; infoBar muestra "Precio referencial" sin conexión) y `sale/[stopId]` (nota bajo el TOTAL sin conexión + marca "· ref." por línea).

## Hito 2 — Freshness de preparación

- **`describeDataFreshness`**: "Preparada hace X min/h"; si > 2 h → "verifica precios y stock" (stale); si otro día → "(otro día) — actualiza antes de salir"; sin preparar → "Sin preparar".
- **`humanizeElapsedMs`**: "menos de 1 min" / "N min" / "N h" / "N h M min".
- **Pantalla:** `RoutePreparationCard` añade "· Preparada hace X" y una línea ⚠️ ámbar cuando los datos están viejos/otro día.

## Hito 3 — Geo (sin distancia ficticia)

- **`describeGeoStatus`**: nunca inventa distancia. Sin geo de cliente → "Ubicación del cliente no disponible"; sin fix de GPS → "Ubicación no disponible (obteniendo…/denegado/GPS no disponible)"; precisión > 100 m → "Precisión GPS baja (±Nm)"; dentro de rango → verde; fuera → rojo con distancia real.
- **Pantalla:** `stop/[stopId]` + `GeoFenceBar` (ahora presentacional por `tone`/`label`). Se elimina el `?? 999`: el botón principal muestra "🔴 Fuera de rango (Xm)" solo si la distancia es conocida; si no, "🔴 Ubicación no disponible". El **gate de visita** (`isGeoOk`) no cambia.

## Hito 4 — Razones de bloqueo (disabled states)

- **`describeSaleConfirmBlock`**: razón única y priorizada (stock → foto → pago → plaza → almacén → carga). Reemplaza la concatenación inline en `sale/[stopId]`.
- **`describeRetryBlock`**: en `sync.tsx`, explica por qué "Reintentar" está deshabilitado (sincronizando / sin conexión / sin pendientes).
- **Ya existían y se mantienen:** `cashclose` (`describeLiquidationButtonBlock`/`describeBlockingReason`) y `route-close` (`describeCloseSyncBlock`) muestran el motivo bajo el botón. **Checkout** ya muestra banner/alert cuando la venta no sincronizó.

## Hito 5 — Diferencia de liquidación

- **`describeCashDifference`**: monto exacto + si falta/sobra + acción esperada. Ejemplo: "Faltan $50.00. Capturado $950.00 · esperado $1,000.00. / Cuenta de nuevo el efectivo…".
- **Pantalla:** `cashclose` antepone esta explicación al mensaje del backend en el Alert de `difference_warning` (antes solo mostraba el texto del backend).

## Pruebas automáticas (node)

`tests/trustSignals.test.ts` cubre: precio referencial visible, stock referencial visible, banner combinado, freshness (fresco/viejo/otro día/sin preparar + humanize), geo sin "999" (sin geo/sin fix/denegado/ok/fuera/precisión baja), razones de bloqueo (venta + retry, con orden de prioridad) y diferencia de liquidación (falta/sobra/cuadra con monto). **typecheck limpio; tests 126/126.**

## Riesgos / notas

- `formatCurrency` se inlinea en `trustSignals.ts` (mismo formato que `utils/time`) para mantener el módulo sin imports cross-module y poder correr los tests puros bajo el runner de node. Si cambia el formato global, actualizar ambos.
- "Precio referencial" se marca por estado de conexión; un precio de pricelist cacheado y reciente también se rotula referencial sin conexión (conservador a propósito: mejor sub-confiar que sobre-confiar).
- No se tocó la lógica de gating de geo/venta/liquidación: solo lo que ve el vendedor.
