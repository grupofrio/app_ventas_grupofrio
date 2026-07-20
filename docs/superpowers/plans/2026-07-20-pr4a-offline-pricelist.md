# PR-4a Offline Pricelist Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirmar y encolar ventas sin conexión sin ejecutar `getPartnerPricelistId`, reutilizando únicamente una tarifa explícita o confirmada en caché y preservando el comportamiento online.

**Architecture:** Extraer la selección de tarifa y la decisión de resolver a un servicio puro sin dependencias de React Native. La pantalla leerá primero la caché local, consultará el resolvedor existente solo si la decisión lo permite y mantendrá intactos el ítem crudo de cola y el builder REST usado durante la sincronización.

**Tech Stack:** TypeScript, React Native/Expo Router, Zustand, Node.js `--test --experimental-strip-types`, assertions estructurales `.mjs`.

---

## Límites y estructura de archivos

- Crear `src/services/salePricelistDecision.ts`: tipos, normalización compatible con el predicado actual y decisión pura parada/caché/conectividad.
- Crear `tests/salePricelistDecision.test.ts`: matriz unitaria completa de la decisión.
- Modificar `app/sale/[stopId].tsx`: integrar la decisión y encerrar la única llamada a `getPartnerPricelistId` en su guard.
- Modificar `tests/offlineSaleWiring.test.mjs`: proteger estructuralmente el guard offline y la lectura posterior de caché online.
- Modificar `tests/gfLogisticsContracts.test.ts`: caracterizar que `pricelist_id: null` permanece en el payload fuente pero se omite del contrato REST.

No modificar `src/services/pricelist.ts`, `src/services/pricelistCache.ts`, `src/stores/useSyncStore.ts`, el esquema de cola, stock, idempotencia, UI ni backend.

Durante la ejecución usar `@superpowers:test-driven-development`. Antes de declarar terminado usar `@superpowers:verification-before-completion` y `@superpowers:requesting-code-review`. Para integrar o limpiar la rama usar `@superpowers:finishing-a-development-branch`.

### Task 1: Fijar el límite cola → REST para una tarifa nula

**Files:**

- Modify: `tests/gfLogisticsContracts.test.ts:8-122,167-184`
- Verify: `src/services/gfLogisticsContracts.ts:61-87`

- [ ] **Step 1: Agregar la prueba contractual de caracterización**

Agregar después de `testSalesPayloadOmitsVirtualStopAndEmptyOptionals`:

```ts
function testSalesPayloadOmitsNullPricelistWithoutMutatingQueuedPayload(module: ContractsModule) {
  const queuedPayload: Record<string, unknown> = {
    operation_id: 'sale-offline-uuid-1',
    partner_id: 52738,
    warehouse_id: 8,
    pricelist_id: null,
    lines: [
      { product_id: 987, quantity: 2 },
    ],
  };

  const actual = module.buildSalesCreatePayload(queuedPayload);

  assert.equal(queuedPayload.pricelist_id, null);
  assert.equal('pricelist_id' in actual, false);
  assert.deepEqual(actual, {
    operation_id: 'sale-offline-uuid-1',
    partner_id: 52738,
    warehouse_id: 8,
    lines: [
      { product_id: 987, quantity: 2, discount: 0 },
    ],
  });
}
```

Invocarla en `main()` después de `testSalesPayloadOmitsVirtualStopAndEmptyOptionals(module)`:

```ts
  testSalesPayloadOmitsNullPricelistWithoutMutatingQueuedPayload(module);
```

- [ ] **Step 2: Ejecutar la caracterización**

Run:

```bash
node --test --experimental-strip-types tests/gfLogisticsContracts.test.ts
```

Expected: PASS. Esta prueba documenta comportamiento existente; no requiere cambio productivo.

- [ ] **Step 3: Confirmar que el builder no se movió al momento de encolar**

Run:

```bash
rg -n "enqueue\('sale_order'|buildSalesCreatePayload\(payload" 'app/sale/[stopId].tsx' src/stores/useSyncStore.ts
```

Expected: la pantalla encola el payload crudo y `processSyncItem` aplica `buildSalesCreatePayload` al despachar `sale_order`.

- [ ] **Step 4: Commit**

```bash
git add tests/gfLogisticsContracts.test.ts
git commit -m "test: lock null pricelist sales contract"
```

### Task 2: Crear la decisión pura de tarifa

**Files:**

- Create: `tests/salePricelistDecision.test.ts`
- Create: `src/services/salePricelistDecision.ts`

- [ ] **Step 1: Escribir la prueba unitaria fallida**

Crear `tests/salePricelistDecision.test.ts`:

```ts
import assert from 'node:assert/strict';

interface SalePricelistDecisionModule {
  decideSalePricelist: (input: {
    isOnline: boolean;
    stopPricelistId: number | null;
    cachedPricelistId: number | null;
  }) => {
    pricelistId: number | null;
    shouldResolvePartnerPricelist: boolean;
  };
}

function run(module: SalePricelistDecisionModule) {
  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: false,
      stopPricelistId: 81,
      cachedPricelistId: 90,
    }),
    { pricelistId: 81, shouldResolvePartnerPricelist: false },
  );

  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: true,
      stopPricelistId: 81,
      cachedPricelistId: null,
    }),
    { pricelistId: 81, shouldResolvePartnerPricelist: false },
  );

  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: false,
      stopPricelistId: null,
      cachedPricelistId: 90,
    }),
    { pricelistId: 90, shouldResolvePartnerPricelist: false },
  );

  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: false,
      stopPricelistId: null,
      cachedPricelistId: null,
    }),
    { pricelistId: null, shouldResolvePartnerPricelist: false },
  );

  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: true,
      stopPricelistId: null,
      cachedPricelistId: 90,
    }),
    { pricelistId: 90, shouldResolvePartnerPricelist: true },
  );

  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: true,
      stopPricelistId: null,
      cachedPricelistId: null,
    }),
    { pricelistId: null, shouldResolvePartnerPricelist: true },
  );

  for (const invalidId of [0, -1, Number.NaN]) {
    assert.deepEqual(
      module.decideSalePricelist({
        isOnline: false,
        stopPricelistId: invalidId,
        cachedPricelistId: invalidId,
      }),
      { pricelistId: null, shouldResolvePartnerPricelist: false },
    );
  }
}

async function main() {
  const module = await import(
    // @ts-ignore -- Node executes this TypeScript module directly in the test runner.
    new URL('../src/services/salePricelistDecision.ts', import.meta.url).pathname
  ) as SalePricelistDecisionModule;

  run(module);
  console.log('sale pricelist decision tests: ok');
}

void main();
```

- [ ] **Step 2: Ejecutar la prueba y comprobar que falla por el módulo ausente**

Run:

```bash
node --test --experimental-strip-types tests/salePricelistDecision.test.ts
```

Expected: FAIL con `ERR_MODULE_NOT_FOUND` para `src/services/salePricelistDecision.ts`.

- [ ] **Step 3: Implementar la mínima decisión pura**

Crear `src/services/salePricelistDecision.ts`:

```ts
export interface SalePricelistDecisionInput {
  isOnline: boolean;
  stopPricelistId: number | null;
  cachedPricelistId: number | null;
}

export interface SalePricelistDecision {
  pricelistId: number | null;
  shouldResolvePartnerPricelist: boolean;
}

function asPositivePricelistId(value: number | null): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

export function decideSalePricelist(
  input: SalePricelistDecisionInput,
): SalePricelistDecision {
  const stopPricelistId = asPositivePricelistId(input.stopPricelistId);
  if (stopPricelistId !== null) {
    return {
      pricelistId: stopPricelistId,
      shouldResolvePartnerPricelist: false,
    };
  }

  return {
    pricelistId: asPositivePricelistId(input.cachedPricelistId),
    shouldResolvePartnerPricelist: input.isOnline,
  };
}
```

- [ ] **Step 4: Ejecutar la prueba unitaria y verificar verde**

Run:

```bash
node --test --experimental-strip-types tests/salePricelistDecision.test.ts
```

Expected: PASS con `sale pricelist decision tests: ok`.

- [ ] **Step 5: Verificar tipos del servicio**

Run:

```bash
npm run typecheck
```

Expected: PASS, sin diagnósticos TypeScript.

- [ ] **Step 6: Commit**

```bash
git add src/services/salePricelistDecision.ts tests/salePricelistDecision.test.ts
git commit -m "feat: add sale pricelist decision"
```

### Task 3: Proteger la resolución remota en la pantalla de venta

**Files:**

- Modify: `tests/offlineSaleWiring.test.mjs:9-34`
- Modify: `app/sale/[stopId].tsx:25-31,265-287`
- Verify: `tests/saleConfirmFeedback.test.mjs:53-64`

- [ ] **Step 1: Agregar las aserciones de cableado que deben fallar**

Agregar después de los imports de `tests/offlineSaleWiring.test.mjs` un extractor de bloques que respete llaves anidadas:

```js
function extractBracedBlockAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `no se encontro el marcador: ${marker}`);

  const openBraceIndex = source.indexOf('{', markerIndex + marker.length);
  assert.notEqual(openBraceIndex, -1, `no se encontro el bloque de: ${marker}`);

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex + 1, index);
    }
  }

  throw new Error(`bloque sin cierre para: ${marker}`);
}
```

Después de obtener `sale` y antes de las aserciones de venta online, agregar:

```js
// PR-4a: la confirmación offline decide la tarifa solo con datos locales.
assert(
  sale.includes("from '../../src/services/salePricelistDecision'"),
  'venta debe importar la decisión pura de tarifa',
);
assert.match(
  sale,
  /const pricelistDecision = decideSalePricelist\(\{[\s\S]*?isOnline,[\s\S]*?stopPricelistId,[\s\S]*?cachedPricelistId,[\s\S]*?\}\);/,
  'venta debe decidir con conectividad, tarifa de parada y cache local',
);
const resolverGuardBody = extractBracedBlockAfter(
  sale,
  'if (pricelistDecision.shouldResolvePartnerPricelist)',
);
const resolverCalls = sale.match(/\bgetPartnerPricelistId\s*\(/g) ?? [];
assert.equal(
  resolverCalls.length,
  1,
  'debe existir una sola llamada al resolvedor de tarifa',
);
assert.equal(
  (resolverGuardBody.match(/\bgetPartnerPricelistId\s*\(/g) ?? []).length,
  1,
  'la unica llamada al resolvedor debe quedar dentro del guard de la decision',
);
assert.match(
  resolverGuardBody,
  /\bawait\s+getPartnerPricelistId\([\s\S]*?const resolvedPricelistId = peekResolvedPartnerPricelistId\([\s\S]*?pricelistId =/,
  'online debe releer la tarifa segura de cache despues de resolver',
);
```

- [ ] **Step 2: Ejecutar la prueba de cableado y comprobar que falla**

Run:

```bash
node --test --experimental-strip-types tests/offlineSaleWiring.test.mjs
```

Expected: FAIL con `venta debe importar la decisión pura de tarifa`.

- [ ] **Step 3: Importar la decisión en la pantalla**

Agregar después del import de `pricelist` en `app/sale/[stopId].tsx`:

```ts
import { decideSalePricelist } from '../../src/services/salePricelistDecision';
```

- [ ] **Step 4: Reemplazar el bloque de resolución previa al payload**

Conservar `effectiveCompanyId` y la normalización actual de `stopPricelistId`. Reemplazar desde `let pricelistId: number | null;` hasta el cierre del `catch` por:

```ts
    const cachedPricelistId = peekResolvedPartnerPricelistId(
      salePartnerId,
      { companyId: effectiveCompanyId },
    );
    const pricelistDecision = decideSalePricelist({
      isOnline,
      stopPricelistId,
      cachedPricelistId,
    });
    let pricelistId = pricelistDecision.pricelistId;
    try {
      if (pricelistDecision.shouldResolvePartnerPricelist) {
        await getPartnerPricelistId(salePartnerId, { companyId: effectiveCompanyId });
        const resolvedPricelistId = peekResolvedPartnerPricelistId(
          salePartnerId,
          { companyId: effectiveCompanyId },
        );
        pricelistId =
          typeof resolvedPricelistId === 'number' && resolvedPricelistId > 0
            ? resolvedPricelistId
            : null;
      }
    } catch (error) {
      setSaleSubmitting(false);
      unlockSaleConfirm();
      const message = error instanceof Error ? error.message : 'No se pudo resolver la lista de precios.';
      Alert.alert('Venta rechazada', message);
      return;
    }
```

No mover la rama `if (!isOnline)`, `enqueue('sale_order', payload)`, `buildSalesCreatePayload`, `operationId` ni el manejo del `catch`.

- [ ] **Step 5: Ejecutar las pruebas focalizadas**

Run:

```bash
node --test --experimental-strip-types tests/salePricelistDecision.test.ts tests/offlineSaleWiring.test.mjs tests/saleConfirmFeedback.test.mjs tests/gfLogisticsContracts.test.ts
```

Expected: PASS en los cuatro archivos; `offline sale wiring tests: ok`, `sale confirm feedback tests: ok`, `sale pricelist decision tests: ok` y `gf logistics contracts tests: ok`.

- [ ] **Step 6: Verificar tipos**

Run:

```bash
npm run typecheck
```

Expected: PASS, sin diagnósticos TypeScript.

- [ ] **Step 7: Commit**

```bash
git add 'app/sale/[stopId].tsx' tests/offlineSaleWiring.test.mjs
git commit -m "fix: skip partner pricelist resolver offline"
```

### Task 4: Verificación integral y revisión

**Files:**

- Verify: `src/services/salePricelistDecision.ts`
- Verify: `app/sale/[stopId].tsx`
- Verify: `tests/salePricelistDecision.test.ts`
- Verify: `tests/offlineSaleWiring.test.mjs`
- Verify: `tests/gfLogisticsContracts.test.ts`

- [ ] **Step 1: Ejecutar nuevamente la selección focalizada**

Run:

```bash
node --test --experimental-strip-types tests/salePricelistDecision.test.ts tests/offlineSaleWiring.test.mjs tests/saleConfirmFeedback.test.mjs tests/gfLogisticsContracts.test.ts
```

Expected: 4 archivos pasan, 0 fallos.

- [ ] **Step 2: Ejecutar la suite completa**

Run:

```bash
npm test
```

Expected: 150 pruebas pasan, 0 fallos. La línea base tenía 149 y se agregó `salePricelistDecision.test.ts`.

- [ ] **Step 3: Ejecutar TypeScript y revisar formato del diff**

Run:

```bash
npm run typecheck
git diff --check main...HEAD
```

Expected: ambos comandos terminan con código 0 y sin diagnósticos.

- [ ] **Step 4: Auditar el alcance del diff**

Run:

```bash
git diff --stat main...HEAD
git diff main...HEAD -- src/services/salePricelistDecision.ts 'app/sale/[stopId].tsx' tests/salePricelistDecision.test.ts tests/offlineSaleWiring.test.mjs tests/gfLogisticsContracts.test.ts
```

Expected: además de la especificación y este plan, solo aparecen los cinco archivos funcionales/de prueba enumerados; no hay cambios de stock, idempotencia, cola, backend ni UI.

- [ ] **Step 5: Validar manualmente el flujo offline en un dispositivo o simulador preparado**

Run:

```bash
npm start
```

En una sesión con ruta y cliente cargados:

1. Abrir una parada, agregar producto, método de pago y foto.
2. Activar modo avión antes de confirmar.
3. Confirmar el pedido.
4. Verificar que aparece `Pedido guardado` sin espera de RPC, que existe un `sale_order` pendiente y que no aparece actividad/error del resolvedor de tarifa.
5. Si la parada no tiene tarifa explícita ni caché confirmada, inspeccionar el ítem y comprobar `pricelist_id: null`.

Expected: la venta se encola localmente y la pantalla continúa sin intentar resolver la tarifa por red. Si no hay dispositivo/sesión preparada, registrar esta validación como pendiente de campo; no sustituirla con una afirmación no verificada.

- [ ] **Step 6: Solicitar revisión de código independiente**

Invocar `@superpowers:requesting-code-review` con la especificación, este plan, el rango `main...HEAD` y la evidencia de pruebas. Corregir cualquier hallazgo crítico o importante y repetir la verificación afectada.

- [ ] **Step 7: Confirmar estado final de la rama**

Run:

```bash
git status --short --branch
git log --oneline --decorate main..HEAD
```

Expected: rama `codex/pr4a-offline-pricelist`, sin cambios funcionales pendientes; historial con commits pequeños de contrato, decisión e integración, además de documentación.
