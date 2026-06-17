# KoldField — QA Refill (Solicitar carga)

**Rama:** `fix/koldfield-refill-products-operation-id`
**Base:** `main` @ `c6db3fa`.
**Alcance:** corregir que la pantalla "Solicitar carga" mostraba solo 10 productos (ocultando agotados) y agregar `operation_id` idempotente al envío. **Frontend-only; sin backend; campo `operation_id` adicional compatible.**

## Causa del bug
`app/refill.tsx` hacía `const refillableProducts = products.slice(0, 10)`. `useProductStore` ordena por `qty_available` **descendente**, así que el `slice(0,10)` mostraba los **10 productos con MÁS stock** (los que menos necesitan recarga) y **ocultaba los agotados/bajo stock** — justo los que el vendedor debe pedir. No había razón de negocio; era un cap MVP. Además el payload encolado no incluía `operation_id`, por lo que un doble-tap / reintento podía generar solicitudes duplicadas.

## Cambios
1. **`src/services/refillLogic.ts`** (NUEVO, puro): `filterAndSortRefillProducts(products, query)` — ordena por **menor stock primero** (agotados arriba), filtra por nombre/código, **sin cap**; `buildRefillPayload(...)` — incluye `operation_id`.
2. **`app/refill.tsx`**:
   - Eliminado `slice(0,10)` → lista **completa**, **virtualizada (FlatList)** y **buscable** (search con debounce 300 ms, patrón Fase 1).
   - Orden **menor stock primero**; los agotados se marcan "· Agotado" en rojo.
   - Contador "N de M" en el encabezado.
   - `operation_id` estable por intento (`useRef`, se regenera tras envío exitoso) + **guard de doble-tap** (`submitting`) + botón con `loading`.
   - Estados de carga/error/sin-coincidencias en `ListEmptyComponent`; `RefreshControl` preservado.
3. **`tests/refillLogic.test.ts`** (NUEVO): lista no se limita a 10; agotados visibles y primeros; búsqueda alcanza cualquier producto; no muta el store; payload con `operation_id`; retry reusa `operation_id`.

## Pruebas manuales
- [ ] **Ruta con >10 productos:** abrir "Solicitar carga" → se ven **todos** (scroll virtualizado), no solo 10. Contador "N de M" correcto.
- [ ] **Productos agotados:** aparecen **arriba** con etiqueta "· Agotado" (rojo); se pueden pedir.
- [ ] **Productos con stock bajo:** ordenados antes que los de mucho stock.
- [ ] **Búsqueda:** escribir nombre/código filtra (debounced); alcanza productos fuera del top inicial.
- [ ] **Envío de refill:** agregar cantidades, "Enviar Solicitud" → encola y vuelve; payload con `operation_id`, `warehouse_id`, `lines[{product_id,qty}]`, `notes`.
- [ ] **Doble-tap:** presionar rápido 2 veces → una sola solicitud (guard `submitting` + mismo `operation_id` durante el intento).
- [ ] **Retry / reapertura del mismo borrador:** el `operation_id` se mantiene hasta un envío exitoso; tras enviar, una nueva solicitud usa un id nuevo.
- [ ] **Validación de payload:** sin productos → alerta "Sin productos"; no encola.
- [ ] **Sin productos / error de carga:** muestra mensaje + "Reintentar"; offline encola la solicitud (la cola sincroniza al reconectar).
- [ ] **Celular bajo perfil:** FlatList virtualiza (initialNumToRender 12); escribir en búsqueda no traba el input.

## Pruebas automáticas (node)
- `tests/refillLogic.test.ts` — ver arriba. **typecheck limpio; tests 119/119.**

## Riesgos / notas
- `operation_id` es un **campo adicional**; un backend que lo ignore no se rompe. La cola de sync ya añade su propio `_operationId` por ítem; este `operation_id` es a nivel de intento del vendedor (el backend de `van.refill.request` puede deduplicar por él cuando lo soporte — coordinar con Sebas, fuera de alcance de este PR).
- No se tocó el endpoint ni el contrato del backend.
- `removeClippedSubviews` en FlatList: comportamiento estándar; si en algún Android viejo se viera un row en blanco al hacer scroll muy rápido, se puede desactivar (no observado).

## Fuera de alcance
Backend `van.refill.request` (dedup por `operation_id`), cola offline de regalo, placeholder Lealtad, 2D-2 imágenes.
