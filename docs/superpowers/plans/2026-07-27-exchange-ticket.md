# Ticket de cambio de producto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generar un ticket de cambio independiente después de un cambio confirmado, con cliente y movimientos, disponible en PDF e impresión MP210.

**Architecture:** El flujo de cambio conservará una clave de idempotencia local, construirá un snapshot durable después del éxito de Odoo y navegará a una ruta de salida por `snapshotId`. El HTML/PDF y el documento térmico compartirán el mismo snapshot; el renderer nativo añadirá una rama `exchange` compatible con los tickets de venta existentes. La pantalla de salida reutilizará el control de permisos, selección Bluetooth, compuerta de impresión y confirmación de reimpresión actuales.

**Tech Stack:** Expo Router, React Native, TypeScript, `node:test`, AsyncStorage mediante la capa de persistencia, `expo-print`, `expo-sharing`, módulo Expo/Kotlin de impresora térmica MP210.

---

## Mapa de archivos

### Nuevos archivos

- `src/services/exchangeTicket.ts`: tipos del snapshot, normalización, folio, construcción y HTML escapado.
- `src/services/exchangeTicketStorage.ts`: clave `exchange-ticket:<snapshotId>` y guardado/carga estrictos.
- `src/services/exchangeTicketPdf.ts`: creación y apertura/compartición del PDF de 58 mm.
- `src/services/exchangeThermalTicketDocument.ts`: adapta un snapshot al contrato térmico `ticketKind: 'exchange'`.
- `src/services/thermalPrinter.ts`: conservar `ticketKind`, `exchangeNotes` y `sectionLabel` en la capa de snapshot antes de enviarlos al módulo nativo.
- `src/components/domain/TicketOutputScreen.tsx`: pantalla genérica de salida que concentra carga, preview, PDF, MP210, permisos y reimpresión.
- `app/print-exchange/[snapshotId].tsx`: wrapper de ruta para cargar snapshots de cambio y configurar `TicketOutputScreen`.
- `tests/exchangeTicket.test.ts`: snapshot, folio, cantidades, secciones y HTML.
- `tests/exchangeThermalTicketDocument.test.ts`: payload térmico de cambio y campos neutros.
- `tests/thermalPrinterService.test.ts`: snapshot del servicio conserva los campos exchange.
- `tests/exchangeTicketWiring.test.mjs`: wiring de submit, guardado, navegación y ruta de salida.
- `tests/exchangeTicketStorage.test.ts`: clave y propagación de errores de guardado/carga.

### Archivos modificados

- `app/exchange/[stopId].tsx`: conservar `idempotencyKey`, construir snapshot solo después del éxito, guardar con `storeSaveStrict` y navegar o volver al check-in según el resultado.
- `app/print/[orderId].tsx`: convertir la pantalla de venta en un wrapper/adaptador de `TicketOutputScreen` sin cambiar el ticket visible ni su comportamiento.
- `src/services/thermalPrinterTypes.ts`: añadir `ticketKind`, `exchangeNotes` y `sectionLabel` opcionales/compatibles.
- `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterRecords.kt`: aceptar y validar el tipo `exchange`, notas y etiquetas de sección; venta sigue siendo el default.
- `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt`: dibujar el layout de cambio sin pago, subtotal, kilogramos ni total; conservar exactamente la rama de venta.
- `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketLayoutTest.kt`: casos de layout exchange y regresión sale.
- `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalPrinterModuleTest.kt`: validación del record exchange y rechazo de tipos/etiquetas inválidos.
- `tests/thermalTicketDocument.test.ts`: ampliar regresiones de compatibilidad si el tipo térmico cambia.

## Task 1: Construir el dominio y almacenamiento del ticket

**Files:**
- Create: `src/services/exchangeTicket.ts`
- Create: `src/services/exchangeTicketStorage.ts`
- Create: `tests/exchangeTicket.test.ts`
- Create: `tests/exchangeTicketStorage.test.ts`
- Modify: `src/persistence/storage.ts` only if una prueba demuestra que hace falta una exportación; preferir `storeSaveStrict` existente.

- [ ] **Step 1: Write the failing domain tests**

Agregar pruebas para que `buildExchangeTicketSnapshot`:

```ts
test('builds a stable change snapshot with separate delivery and merma lines', () => {
  const snapshot = buildExchangeTicketSnapshot({
    snapshotId: 'idempotency-123',
    exchangeName: '',
    exchangeId: null,
    customerName: 'Abarrotes La Esperanza',
    createdAt: '2026-07-27T20:35:00.000Z',
    deliveryLines: [{ productId: 10, productName: 'Coca Cola 600 ml', qty: 2 }],
    mermaLines: [{ productId: 11, productName: 'Agua 1 L', qty: 1 }],
    notes: 'Envases dañados',
  });

  assert.equal(snapshot.snapshotId, 'idempotency-123');
    assert.equal(snapshot.folio, 'CAMBIO-idempote');
  assert.equal(snapshot.deliveryLines[0].quantity, 2);
  assert.equal(snapshot.mermaLines[0].quantity, 1);
});
```

  Cubrir también: preferencia `exchangeName` sobre `exchangeId`, fallback de folio, cliente/producto vacíos (`Cliente sin nombre` y `Producto <id>`), cantidades enteras y decimales, secciones vacías, notas vacías, fecha local `es-MX` y escape HTML de `<script>`/`&`.

- [ ] **Step 2: Run the domain tests and verify RED**

Run: `node --experimental-strip-types --test tests/exchangeTicket.test.ts`  
Expected: FAIL porque el módulo y sus funciones aún no existen.

- [ ] **Step 3: Implement the minimal domain module**

Implementar `ExchangeTicketLine`, `ExchangeTicketSnapshot` y un input con `snapshotId`, datos de respuesta del backend y líneas fuente `{ productId, productName?: string, qty: number }`. La resolución desde `productMap` ocurrirá en la pantalla de cambio antes de llamar al builder; el builder seguirá aplicando `Cliente sin nombre` y `Producto <id>` si recibe valores vacíos. Además:

- `buildExchangeTicketSnapshot(input)` con `snapshotId` como identidad y `folio` separado.
- `formatQuantity` reutilizado desde `saleTicketFormatting.ts` para cantidades.
- `buildExchangeTicketHtml(snapshot)` con branding, `formatTicketDate` para fecha local `es-MX`, secciones condicionales, notas condicionales, mensaje final y escape HTML.
- `getExchangeTicketStorageKey(snapshotId)`.

No incluir precios, pago, subtotales, totales o historial.

- [ ] **Step 4: Run the domain tests and verify GREEN**

Run: `node --experimental-strip-types --test tests/exchangeTicket.test.ts`  
Expected: PASS.

- [ ] **Step 5: Write failing storage tests**

Verificar que `saveExchangeTicketSnapshot` use `storeSaveStrict` con `exchange-ticket:<snapshotId>`, que `loadExchangeTicketSnapshot` devuelva el snapshot y que un rechazo de AsyncStorage se propague al caller.

- [ ] **Step 6: Run storage tests and verify RED**

Run: `node --experimental-strip-types --test tests/exchangeTicketStorage.test.ts`  
Expected: FAIL porque el wrapper no existe.

- [ ] **Step 7: Implement strict storage wrapper**

Usar `storeSaveStrict` para guardar y `storeLoad` para leer. No cambiar el comportamiento global de `storeSave`; el ticket debe ser el único flujo que necesita detectar el fallo posterior a la confirmación.

- [ ] **Step 8: Run both domain/storage tests**

Run: `node --experimental-strip-types --test tests/exchangeTicket.test.ts tests/exchangeTicketStorage.test.ts`  
Expected: PASS.

- [ ] **Step 9: Commit the domain slice**

```bash
git add src/services/exchangeTicket.ts src/services/exchangeTicketStorage.ts tests/exchangeTicket.test.ts tests/exchangeTicketStorage.test.ts
git commit -m "feat: add exchange ticket snapshot"
```

## Task 2: Añadir PDF y documento térmico TypeScript

**Files:**
- Create: `src/services/exchangeTicketPdf.ts`
- Create: `src/services/exchangeThermalTicketDocument.ts`
- Create: `tests/exchangeThermalTicketDocument.test.ts`
- Modify: `src/services/thermalPrinterTypes.ts`
- Modify: `src/services/thermalPrinter.ts`
- Test: `tests/thermalPrinterService.test.ts`
- Modify: `tests/thermalTicketDocument.test.ts` only for compatibility assertions if needed.

- [ ] **Step 1: Write the failing thermal document tests**

Probar que `buildExchangeThermalTicketDocument(snapshot)` devuelve `schemaVersion: 1`, `ticketKind: 'exchange'`, branding canónico con título `TICKET DE CAMBIO`, folio separado, cliente, notas, `sectionLabel` por línea y valores neutros `paymentLabel: 'No aplica'`, `subtotal: '—'`, `totalKg: '—'`, `total: 'No aplica'`. Probar que no se mezclan líneas de entrega y merma y que las cantidades usan `formatQuantity`.

- [ ] **Step 2: Run the thermal document tests and verify RED**

Run: `node --experimental-strip-types --test tests/exchangeThermalTicketDocument.test.ts`  
Expected: FAIL porque el tipo/costructor exchange aún no existe.

- [ ] **Step 3: Extend the TypeScript thermal contract compatibly**

Añadir campos opcionales al documento y línea térmica para no romper documentos de venta:

```ts
ticketKind?: 'sale' | 'exchange';
exchangeNotes?: string;
sectionLabel?: 'ENTREGA' | 'MERMA';
```

Dejar venta como `ticketKind` ausente o `sale`. Crear `buildExchangeThermalTicketDocument` con el payload exacto de la especificación.

Actualizar `snapshotTicketLine` y `snapshotThermalTicketDocument` en `thermalPrinter.ts` para validar y copiar los campos exchange sin aceptar tipos desconocidos. Añadir una prueba donde el documento exchange llega al mock nativo con `ticketKind`, `sectionLabel` y `exchangeNotes` intactos.

- [ ] **Step 4: Implement PDF creation/opening**

Crear `createExchangeTicketPdf` y `openExchangeTicketPdf` siguiendo `saleTicketPdf.ts`, usando `Print.printToFileAsync`, ancho de 164 puntos/58 mm, altura calculada por cantidad de líneas y notas, márgenes en cero y `Sharing.shareAsync` con MIME PDF. El HTML debe provenir exclusivamente de `buildExchangeTicketHtml`.

- [ ] **Step 5: Run the TypeScript tests and verify GREEN**

Run: `node --experimental-strip-types --test tests/exchangeThermalTicketDocument.test.ts tests/thermalTicketDocument.test.ts`  
Expected: PASS, incluyendo regresiones de venta.

- [ ] **Step 6: Commit the TypeScript output slice**

```bash
git add src/services/exchangeTicketPdf.ts src/services/exchangeThermalTicketDocument.ts src/services/thermalPrinterTypes.ts tests/exchangeThermalTicketDocument.test.ts tests/thermalTicketDocument.test.ts
git commit -m "feat: add exchange ticket pdf and thermal payload"
```

## Task 3: Extender el renderer Android para tickets de cambio

**Files:**
- Modify: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterRecords.kt`
- Modify: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt`
- Modify: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketLayoutTest.kt`
- Modify: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalPrinterModuleTest.kt`
- Modify: `tests/thermalPrinterModuleWiring.test.mjs` only if the boundary contract needs an explicit exchange assertion.

- [ ] **Step 1: Write failing Android validation/layout tests**

Agregar un record exchange válido con branding, una línea `ENTREGA`, una línea `MERMA`, notas y campos neutros. Verificar que el layout contiene título, cliente, ambas etiquetas, cantidades y notas, pero no contiene `Pago:`, `Subtotal:`, `Kilogramos:` ni `Total:`. Agregar casos que rechacen `ticketKind` desconocido y una línea exchange sin `sectionLabel` válida.

- [ ] **Step 2: Generate the Android project only when needed**

El proyecto `android/` es un artefacto generado/ignorado en este worktree. Si `android/` no existe, ejecutar desde la raíz `npx expo prebuild --platform android --no-install`; no usar `--clean` para preservar cualquier proyecto nativo local existente.

- [ ] **Step 3: Run Android tests and verify RED**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest`  
Expected: los tests nuevos fallan porque el record/layout aún no conoce el tipo exchange; los tests existentes deben seguir compilando.

- [ ] **Step 4: Add compatible native record fields and validation**

En `ThermalTicketDocumentRecord` y `ThermalTicketLineRecord`, agregar los campos opcionales. En `toDomain`/normalización:

- `ticketKind` ausente se convierte en `sale`.
- Solo `sale` y `exchange` son válidos.
- Para `exchange`, cada línea requiere `sectionLabel` `ENTREGA` o `MERMA`.
- `exchangeNotes` es opcional y respeta el límite largo existente.
- Los campos de venta siguen validándose para conservar el contrato actual, aunque el layout exchange los ignore.

- [ ] **Step 5: Add the exchange branch to `ThermalTicketLayout`**

Mantener el layout actual sin cambios funcionales para `sale`. Para `exchange`, dibujar branding, título, folio, fecha, cliente, divider, cada sección agrupada, nombre, cantidad, notas, pie y padding. No invocar las filas de pago/subtotal/kilogramos/total en esa rama.

- [ ] **Step 6: Run Android tests and verify GREEN**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest`  
Expected: PASS para los tests nuevos y existentes.

- [ ] **Step 7: Run JS native wiring tests**

Run: `node --experimental-strip-types --test tests/thermalPrinterModuleWiring.test.mjs tests/thermalPrinterModuleTypes.test.ts`  
Expected: PASS.

- [ ] **Step 8: Commit the native slice**

```bash
git add src/services/thermalPrinter.ts tests/thermalPrinterService.test.ts modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterRecords.kt modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketLayoutTest.kt modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalPrinterModuleTest.kt tests/thermalPrinterModuleWiring.test.mjs
git commit -m "feat: render exchange tickets on mp210"
```

## Task 4: Extraer la salida reusable y agregar la ruta de cambio

**Files:**
- Create: `src/components/domain/TicketOutputScreen.tsx`
- Create: `app/print-exchange/[snapshotId].tsx`
- Modify: `app/print/[orderId].tsx`
- Create/modify: `tests/exchangeTicketWiring.test.mjs` as needed for route contracts.

- [ ] **Step 1: Write the failing route/output wiring tests**

Verificar que existe `app/print-exchange/[snapshotId].tsx`, carga `loadExchangeTicketSnapshot`, configura `openExchangeTicketPdf` y `buildExchangeThermalTicketDocument`, y que el wrapper de venta sigue usando `loadSaleTicketSnapshot`, `openSaleTicketPdf` y `buildThermalTicketDocument`. Verificar que la nueva pantalla conserva `Imprimir en MP210`, `Abrir PDF`, `ThermalPrinterPicker` y los estados de permiso/reimpresión.

- [ ] **Step 2: Run wiring test and verify RED**

Run: `node --test tests/exchangeTicketWiring.test.mjs`  
Expected: FAIL porque la ruta y el componente genérico aún no existen.

- [ ] **Step 3: Extract the shared ticket output screen**

Mover a `TicketOutputScreen` la lógica común de `app/print/[orderId].tsx`: selección persistente de impresora, permisos Android, estados `permission/connecting/sending`, `OutputToken`, `createOutputGate`, retry seguro, `ThermalPrinterPicker` y mensajes de error. Recibir por props el loader del snapshot, título, mensaje de no encontrado, renderer de preview, builder térmico y opener PDF.

No cambiar textos ni comportamiento del adaptador de venta durante la extracción.

- [ ] **Step 4: Implement the exchange route wrapper and preview**

La ruta leerá `snapshotId`, cargará el snapshot y pasará al componente una preview que muestre branding `GRUPO FRIO`, título `TICKET DE CAMBIO`, cliente, folio, fecha formateada con `formatTicketDate` en zona local `es-MX`, entregas, mermas y notas. Si falta el snapshot, mostrará `Ticket no encontrado` con el `snapshotId` y no habilitará acciones de salida.

- [ ] **Step 5: Run output/wiring tests and verify GREEN**

Run: `node --test tests/exchangeTicketWiring.test.mjs tests/thermalPrinterUiWiring.test.mjs tests/saleTicketWiring.test.mjs`  
Expected: PASS sin regresiones del flujo de tickets de venta.

- [ ] **Step 6: Commit the output screen slice**

```bash
git add src/components/domain/TicketOutputScreen.tsx 'app/print-exchange/[snapshotId].tsx' 'app/print/[orderId].tsx' tests/exchangeTicketWiring.test.mjs
git commit -m "feat: add exchange ticket output screen"
```

## Task 5: Conectar el submit del cambio con el ticket

**Files:**
- Modify: `app/exchange/[stopId].tsx`
- Modify: `tests/exchangeTicketWiring.test.mjs`
- Modify: `tests/exchangeFrontendWiring.test.mjs` if assertions need to cover the post-success route.

- [ ] **Step 1: Extend the failing submit wiring tests**

Agregar assertions para que `handleSubmit`:

- genere `const idempotencyKey = makeIdempotencyKey()` antes de llamar `createExchange`;
- pase la misma clave al payload;
- use la respuesta y los nombres del `productMap` para construir el snapshot;
- llame `saveExchangeTicketSnapshot` solo después de `createExchange` exitoso;
- navegue a `/print-exchange/<snapshotId>` después de guardar;
- ante error de guardado muestre que el cambio sí se registró, no deje un reintento ambiguo y vuelva a check-in;
- mantenga el stock local y manejo de errores backend existentes.

- [ ] **Step 2: Run the wiring tests and verify RED**

Run: `node --test tests/exchangeTicketWiring.test.mjs tests/exchangeFrontendWiring.test.mjs`  
Expected: FAIL porque el submit actual navega directamente a check-in y no guarda snapshot.

- [ ] **Step 3: Implement the success path**

En `handleSubmit`, declarar antes del `try` un fallback `registeredMessage = 'Cambio procesado'`, guardar la clave de idempotencia antes del `try`, pasarla a `createExchange` y copiar inmediatamente `response.user_message` a `registeredMessage`. Convertir explícitamente cada `{ product_id, qty }` de `deliveryPayloadLines`/`mermaPayloadLines` a `{ productId, productName: productMap.get(product_id)?.name, qty }` antes de construir el snapshot; el builder aplica los fallbacks de nombre. Construir el snapshot con `response.data.exchange_name`, `response.data.exchange_id`, `currentStop.customer_name`, esas líneas fuente, `notes` y `new Date().toISOString()`.

Mantener un `try/catch` separado para la llamada backend y otro `try/catch` alrededor de `saveExchangeTicketSnapshot`: el primer catch conserva el comportamiento actual `Cambio no registrado` y deja el formulario según las reglas actuales; el segundo catch solo ocurre después de una respuesta exitosa y usa la ruta segura de ticket no preparado.

- [ ] **Step 4: Implement the strict-save failure path**

Si el guardado lanza, mostrar una alerta con el texto equivalente a `Cambio registrado, pero no se pudo preparar el ticket. No repitas el cambio.` y reemplazar a `/checkin/[stopId]` con `exchangeMessage: registeredMessage`, que fue conservado inmediatamente después de la respuesta exitosa. No liberar el formulario para un segundo submit ni navegar a la ruta de ticket inexistente.

- [ ] **Step 5: Implement the successful navigation**

Después de guardar correctamente, reemplazar a `/print-exchange/[snapshotId]`, pasando únicamente la identidad local estable. La pantalla de check-in se conserva como navegación de regreso del botón back.

- [ ] **Step 6: Run wiring tests and verify GREEN**

Run: `node --test tests/exchangeTicketWiring.test.mjs tests/exchangeFrontendWiring.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit the exchange flow slice**

```bash
git add 'app/exchange/[stopId].tsx' tests/exchangeTicketWiring.test.mjs tests/exchangeFrontendWiring.test.mjs
git commit -m "feat: generate exchange ticket after confirmation"
```

## Task 6: Verificación completa y entrega

**Files:**
- Modify only if verification reveals a defect in the files above.

- [ ] **Step 1: Run focused TypeScript tests**

Run: `node --experimental-strip-types --test tests/exchangeTicket.test.ts tests/exchangeTicketStorage.test.ts tests/exchangeThermalTicketDocument.test.ts tests/thermalTicketDocument.test.ts`  
Expected: PASS.

- [ ] **Step 2: Run focused wiring tests**

Run: `node --test tests/exchangeTicketWiring.test.mjs tests/exchangeFrontendWiring.test.mjs tests/thermalPrinterUiWiring.test.mjs tests/saleTicketWiring.test.mjs`  
Expected: PASS.

- [ ] **Step 3: Run the complete JavaScript suite**

Run: `npm test`  
Expected: exit code 0 and todos los tests PASS.

- [ ] **Step 4: Run TypeScript typecheck**

Run: `npm run typecheck`  
Expected: exit code 0 sin errores TypeScript.

- [ ] **Step 5: Run Android unit tests**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest`  
Expected: exit code 0, incluyendo validación del renderer exchange y regresiones sale.

- [ ] **Step 6: Inspect the final diff and status**

Run: `git diff --stat && git status --short`  
Expected: solo cambios pendientes del ticket y archivos de pruebas/documentación; conservar sin tocar los archivos no relacionados ya presentes en el worktree.

- [ ] **Step 7: Commit any final verification-only fixes**

Si los pasos anteriores requieren un ajuste, ejecutar pruebas focalizadas nuevamente y crear un commit separado con el fix. No declarar finalización sin evidencia fresca de `npm test`, `npm run typecheck` y las pruebas Android disponibles.
