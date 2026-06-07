# KoldField — Hardening P1 (EN PAUSA)

**Rama:** `feat/koldfield-hardening-p1` (desde `main`)
**Estado:** ⏸️ **EN PAUSA — NO abrir PR todavía. NO mergear.**

## Depende de PR #19 (hardening P0)
Esta rama **debe esperar** a que se mergee primero el **PR #19**
(`feat/koldfield-hardening-p0`: OperationGate, `session_expired`, guards
críticos P0). Razón: ambas ramas modifican **`app/consignment/[stopId].tsx`**
→ habrá **conflicto de merge**.

No se abre un PR "dependiente de #19" a propósito, para no poner a revisar a
Sebastián código que cambiará tras el rebase.

## Procedimiento cuando #19 esté mergeado
1. `git checkout main && git pull`
2. `git checkout feat/koldfield-hardening-p1`
3. `git rebase main`
4. Resolver conflictos — **principalmente en `app/consignment/[stopId].tsx`**:
   - #19 añade el wrapper `OperationGate` (export default + rename a
     `ConsignmentScreenInner` + import).
   - P1 modifica el **cuerpo** del componente (selector de pago, `handleApiError`
     de sesión expirada, resumen enriquecido, `paymentMethod` en el payload).
   - Combinar ambos: mantener el wrapper de #19 y el cuerpo de P1.
   - Verificar también que `isSessionExpiredError` aproveche el
     `code: 'session_expired'` que #19 agrega en `apiResult.ts`.
5. `npm run typecheck` → debe quedar limpio.
6. `npm test` → debe quedar verde.
7. Si todo está limpio → **abrir PR de P1 contra `main`**.

## Qué incluye esta rama (P1)
- **Selector de método de pago en Consignación** (cash/transfer/card/credit) en
  visita y cierre; default `cash`. `consignmentLogic`: `CONSIGNMENT_PAYMENT_METHODS`,
  `isValidConsignmentPaymentMethod`, `consignmentPaymentLabel`, `computeReturnTotal`.
- **Mejor UX de sesión expirada**: `sessionError.isSessionExpiredError` + acción
  "Volver a iniciar sesión" (logout explícito) en errores de API de consignación.
- **Advertencia de fuera de orden**: `routeOrderLogic.evaluateVisitOrder` +
  confirmación suave en `route.tsx` (no bloquea; log local de desviación).
- **Mejor UX de sync/offline**: `syncStatusCopy.describeSyncQueueState` /
  `describeCloseBlockReason` + banner de estado en `app/sync.tsx`.
- **Resumen mejorado de Consignación**: por línea vendido/cobro/resurtir; visita
  con importe estimado + método; cierre con "a recuperar/devolver" + importe + método.

## Validación al momento de la pausa
- `npm run typecheck` → limpio.
- `npm test` → 96/96 (0 fail).

## Riesgos / pendientes backend
- Los métodos `transfer/card/credit` dependen de que el backend los procese
  (hoy probablemente solo `cash`). Confirmar con Sebas antes de usar en campo.
  (Listado también en `docs/KOLDFIELD_BACKEND_HARDENING_REQUESTS.md` de #19.)
- El log de desviación de orden es **solo local** (no hay endpoint backend).
