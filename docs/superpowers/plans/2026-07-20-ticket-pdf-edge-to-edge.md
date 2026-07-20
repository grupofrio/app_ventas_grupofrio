# Ticket PDF Edge-to-Edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar el relleno lateral del ticket PDF de 58 mm para que el contenido use todo el ancho del papel, conservando los 4 mm verticales.

**Architecture:** Mantener el flujo existente `SaleTicketSnapshot -> buildSaleTicketHtml -> expo-print` y cambiar solamente el contrato CSS del `body`. Una prueba unitaria acotada al bloque `body` protegerá el margen lateral cero; la verificación final cubrirá tipos, suite completa y render visual del HTML en un PDF de 58 mm.

**Tech Stack:** TypeScript, Node.js test runner, Expo Print, Playwright Chromium para verificación local, Poppler para inspección/render del PDF.

---

### Task 1: Proteger y aplicar el relleno lateral cero

**Files:**
- Modify: `tests/saleTicket.test.ts:53-55`
- Modify: `src/services/saleTicket.ts:192-196`

- [ ] **Step 1: Escribir la prueba que falla**

En `buildSaleTicketHtml creates escaped 58mm receipt markup`, agregar después de la aserción de ancho:

```ts
assert.match(html, /body\s*\{[^}]*padding:\s*4mm 0;/);
```

Esta expresión queda limitada al bloque CSS de `body`, de modo que otro uso accidental de `padding: 4mm 0` no produzca un falso positivo.

- [ ] **Step 2: Ejecutar la prueba específica para comprobar el fallo**

Run:

```bash
node --test --experimental-strip-types tests/saleTicket.test.ts
```

Expected: FAIL en `buildSaleTicketHtml creates escaped 58mm receipt markup`; el HTML actual contiene `padding: 4mm 3mm`.

- [ ] **Step 3: Implementar el cambio mínimo**

En el bloque CSS `body` de `buildSaleTicketHtml`, sustituir:

```css
padding: 4mm 3mm;
```

por:

```css
padding: 4mm 0;
```

No modificar `@page`, `width: 58mm`, la configuración de márgenes de `expo-print` ni la vista previa de React Native.

- [ ] **Step 4: Ejecutar la prueba específica para comprobar que pasa**

Run:

```bash
node --test --experimental-strip-types tests/saleTicket.test.ts
```

Expected: PASS en todas las pruebas de `tests/saleTicket.test.ts`.

- [ ] **Step 5: Confirmar el cambio funcional**

```bash
git add tests/saleTicket.test.ts src/services/saleTicket.ts
git commit -m "fix: remove sale ticket PDF side padding"
```

### Task 2: Verificar la regresión y el render de 58 mm

**Files:**
- Verify: `src/services/saleTicket.ts`
- Verify: `src/services/saleTicketPdf.ts`
- Temporary: `tmp/pdfs/render-sale-ticket.mjs`
- Temporary output: `tmp/pdfs/sale-ticket-edge-to-edge.pdf`
- Temporary output: `tmp/pdfs/sale-ticket-edge-to-edge-1.png`

- [ ] **Step 1: Ejecutar validación estática**

Run:

```bash
npm run typecheck
```

Expected: exit 0, sin errores TypeScript.

- [ ] **Step 2: Ejecutar la suite completa**

Run:

```bash
npm test
```

Expected: exit 0, todas las pruebas aprobadas.

- [ ] **Step 3: Crear un renderizador temporal del HTML real**

Esta comprobación renderiza el HTML producido por `buildSaleTicketHtml` con Chromium; no ejecuta `expo-print`, que requiere el runtime de Expo en un dispositivo o simulador. La limitación debe quedar registrada en el resultado final y la configuración de márgenes de `expo-print` se valida estáticamente mediante el código y las pruebas existentes.

Crear `tmp/pdfs/render-sale-ticket.mjs` con:

```js
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  buildSaleTicketHtml,
  buildSaleTicketSnapshot,
} from '../../src/services/saleTicket.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

await mkdir('tmp/pdfs', { recursive: true });

const snapshot = buildSaleTicketSnapshot({
  saleId: 'sale-edge-check',
  customerName: 'Abarrotes Centro',
  sellerName: 'Vendedor de prueba',
  paymentMethod: 'cash',
  createdAt: '2026-07-20T18:30:00.000Z',
  lines: [
    { productId: 10, productName: 'Bolsa de hielo 5 kg', qty: 2, price: 42.5, weight: 5 },
    { productId: 20, productName: 'Hielo triturado 3 kg', qty: 1, price: 30, weight: 3 },
  ],
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(buildSaleTicketHtml(snapshot), { waitUntil: 'load' });
await page.pdf({
  path: 'tmp/pdfs/sale-ticket-edge-to-edge.pdf',
  width: '58mm',
  height: '160mm',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
await browser.close();
```

- [ ] **Step 4: Generar, medir y renderizar el PDF**

Run:

```bash
NODE_PATH=/Users/sebis/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules /Users/sebis/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types tmp/pdfs/render-sale-ticket.mjs
pdfinfo tmp/pdfs/sale-ticket-edge-to-edge.pdf
pdftoppm -png -f 1 -singlefile tmp/pdfs/sale-ticket-edge-to-edge.pdf tmp/pdfs/sale-ticket-edge-to-edge
```

Expected:

- `pdfinfo` reporta un ancho aproximado de 164.4 puntos, equivalente a 58 mm.
- El PNG no muestra relleno CSS lateral: fondo, divisores y tabla ocupan todo el ancho disponible.
- No hay texto recortado, superpuesto ni ilegible.

- [ ] **Step 5: Inspeccionar visualmente el PNG**

Abrir `tmp/pdfs/sale-ticket-edge-to-edge.png` con el visor de imágenes disponible y verificar alineación, legibilidad y ausencia de defectos. Si Chromium usa el nombre `sale-ticket-edge-to-edge-1.png`, inspeccionar ese archivo en su lugar.

- [ ] **Step 6: Limpiar artefactos temporales y comprobar el alcance final**

Eliminar únicamente `tmp/pdfs/render-sale-ticket.mjs`, `tmp/pdfs/sale-ticket-edge-to-edge.pdf` y el PNG generado. Después ejecutar:

```bash
git status --short
git diff HEAD^ -- src/services/saleTicket.ts tests/saleTicket.test.ts
```

Expected: el commit funcional contiene sólo la aserción del contrato y el cambio `padding: 4mm 3mm` -> `padding: 4mm 0`; los archivos no rastreados preexistentes permanecen intactos.
