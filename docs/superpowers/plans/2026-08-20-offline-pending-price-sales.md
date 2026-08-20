# Venta offline con precio pendiente de confirmar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir capturar ventas offline sin caché de precio del cliente, marcando el importe como pendiente hasta que Odoo calcule el resultado autoritativo.

**Architecture:** El selector representará una línea con precio pendiente sin fabricar un importe local. La pantalla y el ticket local proyectarán ese estado, mientras la cola conserva sólo productos/cantidades y el UUID existente. `buildSalesCreatePayload` ya elimina el precio móvil; esa frontera se conserva.

**Tech Stack:** Expo/React Native, TypeScript, Zustand, Node test runner y persistencia cifrada de tickets/cola.

---

### Task 1: Modelar y presentar el precio pendiente en el selector

**Files:**
- Modify: `src/stores/useVisitStore.ts`
- Modify: `src/components/domain/ProductPicker.tsx`
- Test: `tests/productPickerPendingPrice.test.ts`
- Test: `tests/pricelistNoGetRecordsFallback.test.mjs`

- [ ] **Step 1: Write the failing test**

Cubrir un selector abierto offline para un partner sin precio cacheado: las filas quedan seleccionables, crean una línea marcada como pendiente y no generan un importe cero o pretendidamente autorizado. El caso de precio cacheado sigue igual.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/productPickerPendingPrice.test.ts`

Expected: FAIL porque el picker actual deshabilita las filas cuando `!hasAuthorizedPrices`.

- [ ] **Step 3: Implement minimal behavior**

Agregar un estado explícito de confirmación de precio por línea. Sin caché permitida, crear la línea pendiente; retener `null`/pendiente para la presentación, sin usar precio de lista ni `0`. No modificar stock ni la condición de producto ya agregado.

- [ ] **Step 4: Verify focused tests**

Run: `node --test --experimental-strip-types tests/productPickerPendingPrice.test.ts && node tests/pricelistNoGetRecordsFallback.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Stage only Task 1 files and commit `feat(sale): allow pending prices offline`.

### Task 2: Proyectar total y ticket como pendientes

**Files:**
- Modify: `app/sale/[stopId].tsx`
- Modify: `src/services/saleTicket.ts`
- Modify: `src/services/saleTicketStorage.ts`
- Modify: `src/services/pendingOrders.ts`
- Test: `tests/salePendingPricePresentation.test.ts`
- Test: `tests/saleTicket.test.ts`
- Test: `tests/gfLogisticsContracts.test.ts`

- [ ] **Step 1: Write failing tests**

Probar que una línea pendiente muestra subtotal/total/ticket como `Pendiente de confirmar`, nunca `$0`; que la proyección de la cola conserva el marcador; y que el DTO de `sales/create` sigue excluyendo toda autoridad de precio/total mientras conserva producto, cantidad y UUID.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --experimental-strip-types tests/salePendingPricePresentation.test.ts tests/saleTicket.test.ts tests/gfLogisticsContracts.test.ts`

Expected: FAIL porque hoy los totales/tickets sólo conocen valores numéricos.

- [ ] **Step 3: Implement the smallest projection state**

Extender ticket y presentación de cola con un marcador local de confirmación de precio. Si cualquier línea está pendiente, la pantalla sustituye todos los totales monetarios por el mensaje pendiente. Persistir ese marcador con el recovery intent. No alterar cantidad, UUID, ledger, checkout ni dispatcher.

- [ ] **Step 4: Verify focused tests**

Run: `node --test --experimental-strip-types tests/salePendingPricePresentation.test.ts tests/saleTicket.test.ts tests/gfLogisticsContracts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Stage only Task 2 files and commit `fix(sale): show offline prices as pending confirmation`.

### Task 3: Wiring, recovery and regression verification

**Files:**
- Create: `tests/saleOfflinePendingWiring.test.mjs`
- Test: `tests/saleOfflineUx.test.ts`
- Test: `tests/secureSyncTransport.test.ts`

- [ ] **Step 1: Write failing wiring test**

Comprobar que una venta offline sin precio se encola con el UUID original, que el DTO saliente no contiene `price_unit`, y que la UI nunca proclama un monto confirmado.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/saleOfflinePendingWiring.test.mjs`

Expected: FAIL hasta que el estado pendiente recorra picker, venta, ticket y cola.

- [ ] **Step 3: Wire existing recovery path**

Pasar sólo el marcador local mediante el recovery intent existente. No agregar tipo de cola, procesador, endpoint ni fallback backend.

- [ ] **Step 4: Verify affected scope**

Run: `node tests/saleOfflinePendingWiring.test.mjs && node --test --experimental-strip-types tests/saleOfflineUx.test.ts tests/secureSyncTransport.test.ts && npm run typecheck && git diff --check`

Expected: PASS.

- [ ] **Step 5: Run full suite and report baseline separately**

Run: `npm test`

Expected: todos los tests afectados verdes. Si `routeStartAuthoritativeWiring` sigue rojo, reportarlo como mismatch de base ya diagnosticado y no alterar el comportamiento de inicio de ruta.

- [ ] **Step 6: Commit**

Stage only Task 3 files and commit `test(sale): cover pending offline price sync`.
