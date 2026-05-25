# Editar Contacto Cliente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar edicion de datos de contacto del cliente desde la pantalla de parada.

**Architecture:** La UI vive en una nueva ruta Expo `app/customer/[partnerId].tsx`, abierta desde `app/stop/[stopId].tsx`. La construccion de payload y validacion vive en un helper pequeno bajo `src/services/customerContactUpdate.ts`. El estado local de la ruta se parchea con `useRouteStore.patchStop`, y la sincronizacion reutiliza `useSyncStore.enqueue('customer_update', ...)`.

**Tech Stack:** Expo Router, React Native, Zustand, Node test runner con `--experimental-strip-types`.

---

### Task 1: Modelo local y payload

**Files:**
- Modify: `src/types/plan.ts`
- Create: `src/services/customerContactUpdate.ts`
- Test: `tests/customerContactUpdate.test.ts`

- [ ] Escribir prueba fallida para normalizar `name`, `contact_name`, `phone`, `mobile`, `email` y rechazar nombre vacio.
- [ ] Ejecutar `node --test --experimental-strip-types tests/customerContactUpdate.test.ts` y confirmar fallo por modulo faltante.
- [ ] Implementar tipos opcionales en `GFStop` y helper de payload.
- [ ] Ejecutar la prueba y confirmar pass.

### Task 2: Pantalla de edicion

**Files:**
- Create: `app/customer/[partnerId].tsx`
- Modify: `app/stop/[stopId].tsx`
- Test: `tests/customerEditFrontendWiring.test.mjs`

- [ ] Escribir prueba fallida que confirme que `app/stop/[stopId].tsx` navega a `/customer/[partnerId]` con `stopId`.
- [ ] Escribir prueba fallida que confirme que la nueva pantalla encola `customer_update`.
- [ ] Ejecutar la prueba y confirmar fallo.
- [ ] Implementar boton "Editar cliente" en la tarjeta del cliente.
- [ ] Implementar pantalla con formulario y guardado.
- [ ] Ejecutar la prueba y confirmar pass.

### Task 3: Verificacion

**Files:**
- Existing test suite

- [ ] Ejecutar `npm test`.
- [ ] Ejecutar `npm run typecheck`.
- [ ] Revisar `git diff --check`.
