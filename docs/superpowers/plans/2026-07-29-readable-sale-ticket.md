# Readable Sale Ticket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MP210 sale ticket substantially easier to read, with neutral sans-serif typography, larger measured text, deliberate wrapping, and matching PDF/preview hierarchy while preserving the existing ticket data contract.

**Architecture:** Keep `SaleTicketSnapshot` and `ThermalTicketDocument` unchanged. Update the native Android layout to use fixed, testable typography constants and a two-row product block; update the native renderer to use Android `sans-serif`; update the HTML/PDF and React Native preview to mirror the same hierarchy; verify the three outputs with focused tests before the full suite. Preserve the current `ARGB_8888` drawing intermediate and packed `MonochromeRaster` output because that is the existing native print contract.

**Tech Stack:** TypeScript, React Native/Expo Print, Kotlin Android renderer, JUnit, Node test scripts, TypeScript compiler.

---

### Task 1: Lock the readable MP210 layout with failing tests

**Files:**
- Modify: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketLayoutTest.kt`
- Test: existing `ThermalTicketLayoutTest` layout, wrapping, amount, credit, and long-text cases

- [ ] **Step 1: Update the constants test to the approved sizes**

Change the expected values to body `32/40`, secondary `26/34`, total `44/54`, and minimum amount `24`, while keeping width `384`, max height `6_000`, and inset/logo limits unchanged.

- [ ] **Step 2: Add a failing product hierarchy test**

Add a test that lays out a normal product and asserts the product name uses body bold `32/40`, the quantity/price uses secondary `26/34`, and the amount is right-aligned with an amount size no smaller than `24`.

Add a primary-field test that asserts a fitting Cliente row uses a bold `26/34` label and normal `32/40` value, and that a long value keeps those same styles when stacked.

- [ ] **Step 3: Add a failing product overflow test**

Add a test with a long `quantityAndUnitPrice` and a long amount. Assert the measured rule `leftWidth + 12 px + amountWidth <= 368 px`, that the quantity/price wraps before the amount moves to its own right-aligned row, that all text is preserved, and that no command exceeds the final layout height. Add a separate too-wide-code-point case expecting the existing explicit `invalid_ticket` error.

- [ ] **Step 4: Run the focused Android test to verify the new assertions fail**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*ThermalTicketLayoutTest'`

Expected: FAIL because the current constants, Space Mono-era amount minimum, and product row behavior still use the old layout.

### Task 2: Implement the readable MP210 renderer and layout

**Files:**
- Modify: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt`
- Modify: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketRenderer.kt`
- Modify: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketLayoutTest.kt`
- Modify: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketRendererTest.kt`
- Modify: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/DiagnosticTicketFactoryTest.kt`

- [ ] **Step 1: Replace the thermal typography constants**

Set the public layout constants to body `32/40`, secondary `26/34`, total `44/54`, and minimum amount `24`. Set section spacing to `12`, internal label/product spacing to `6`, and retain the 384 px width and 6,000 px maximum height. Define the product amount style as total-bold `44/54` initially, reducing in 2 px steps to `24` while measuring the complete left/right pair with a 12 px gap.

- [ ] **Step 2: Implement the product two-row layout**

Render the product name full-width in body bold. Attempt a second row with `quantityAndUnitPrice` on the left, `lineTotal` on the right, and a 12 px gap. Fit the amount from its requested style down to the minimum in 2 px steps. If the pair does not fit, render the quantity/price full-width with word/code-point wrapping, then render the amount below right-aligned. If the amount still cannot fit at 24 px, wrap it right-aligned at word/code-point boundaries; only a single code point wider than the available width remains an explicit `invalid_ticket`. Preserve all text and never truncate.

- [ ] **Step 3: Keep primary fields readable and stack long values**

Change `addLabelValue` to receive separate `labelStyle` and `valueStyle` arguments. Use bold 26/34 labels and normal 32/40 values for Folio, Fecha, Cliente, Vendedor, and Pago. Keep same-line rendering only when the measured pair fits; otherwise render the label and wrapped value as separate rows.

- [ ] **Step 4: Switch the Android font provider to system sans-serif**

Replace packaged Space Mono asset loading with `Typeface.create("sans-serif", Typeface.NORMAL)` and `Typeface.create("sans-serif", Typeface.BOLD)`. Keep the `FontProvider` seam so renderer tests can inject fake typefaces. Add a renderer test that checks both returned typefaces have family name `sans-serif` and differ by boldness. Keep the ARGB_8888 drawing intermediate and packed `MonochromeRaster` output; do not change Bluetooth transport, bitmap width, monochrome conversion, or ticket document schema.

- [ ] **Step 5: Update old assertions and run focused Android tests**

Update tests that explicitly mention 20/26, 18/23, 28/34, or minimum 16, including `ThermalTicketRendererTest.kt` and `DiagnosticTicketFactoryTest.kt`; keep their raster assertions against the packed `MonochromeRaster` and ARGB intermediate. Add explicit assertions for width 384, packed bytes, and the 6,000 px rejection. Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*ThermalTicketLayoutTest' --tests '*ThermalTicketRendererTest' --tests '*DiagnosticTicketFactoryTest'`.

Expected: PASS, including wrapping, credit-note height, long accented text, deterministic cash/credit layout, and the new product hierarchy/overflow cases.

### Task 3: Make PDF and React Native preview match the readable hierarchy

**Files:**
- Modify: `src/services/saleTicket.ts`
- Modify: `src/services/saleTicketPdf.ts`
- Create: `src/services/saleTicketPdfHeight.ts`
- Modify: `app/print/[orderId].tsx`
- Modify: `tests/saleTicket.test.ts`
- Create: `tests/saleTicketPdf.test.ts`
- Modify: `tests/saleTicketBranding.test.mjs`
- Modify: `tests/saleTicketWiring.test.mjs`

- [ ] **Step 1: Add failing HTML assertions**

Extend the sale-ticket tests to require `Arial` as the first PDF family, no `monospace`, the approved font sizes/line heights, 58 mm width, zero margins, word wrapping, and the two-row product structure. Preserve escaped names, credit note, payment label, and CDMX-formatted date.

- [ ] **Step 2: Update the ticket HTML styles and hierarchy**

Use `Arial, Helvetica, sans-serif`; set body to `14/19`, secondary metadata to `12/17`, product names to `15/20` bold, amounts to `15/20`, and total to `20/26` bold. Increase block spacing to 8 px, use a full-width product name row, and keep quantity/price left with amount right. Add `overflow-wrap: anywhere`/`word-break: break-word` where long values need it. Keep fiscal/legal content secondary.

- [ ] **Step 3: Make PDF height reserve wrapping deterministically**

Export a pure `getSaleTicketPdfHeight(snapshot)` helper from `saleTicketPdfHeight.ts` and re-export it from `saleTicketPdf.ts`; have `createSaleTicketPdf` pass its result to `printToFileAsync`. Keep 164-point width and zero margins, and reserve 330 base points + 58 points per line + 18 points per estimated extra wrapped row, plus 90 points for credit. For every variable field use `max(1, ceil(text.length / 26)) - 1` as the extra-row count; include product name, quantity/price, line total, customer, seller, and credit-note text. Add focused tests with exact numeric expected heights for cash, credit, long names, and long quantity/amount values.

- [ ] **Step 4: Update the preview styles**

Set preview body/value styles to `16/22`, labels/metadata to `14/19`, product names to `16/21` bold, amounts to `16/22`, and total to `22/28` bold. Add vertical product spacing and ensure long text wraps instead of clipping. Add the currently omitted Fecha, Subtotal, ticket title, and footer so the preview includes the complete shared ticket content. Bind Fecha through `formatTicketDate(ticket.createdAt)`, Subtotal through `formatTicketCurrency(ticket.subtotal)`, the title/footer through `SALE_TICKET_BRANDING`, and line metadata/amounts through the same `formatQuantityAndUnitPrice`, `formatTicketCurrency`, and `formatTotalKg` helpers used by `buildThermalTicketDocument`. Keep the existing shared document used by the print button.

- [ ] **Step 5: Run focused TypeScript/Node tests**

Run: `node --test --experimental-strip-types tests/saleTicket.test.ts tests/saleTicketBranding.test.mjs tests/saleTicketWiring.test.mjs`

Expected: PASS with branding, escaping, credit/effective payment labels, date CDMX, height reservation, and print wiring preserved.

### Task 4: Verify cross-output data preservation and finish safely

**Files:**
- Modify: `tests/thermalTicketDocument.test.ts`
- Modify: `tests/saleTicketWiring.test.mjs`
- Modify: `tests/saleTicket.test.ts` only if a focused regression needs a fixture adjustment
- Verify: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketLayoutTest.kt`

- [ ] **Step 1: Add a shared-data preservation regression test**

Build a credit snapshot with accented customer/seller/product values, folio, CDMX date, subtotal, kilograms, total, and credit note. Assert the thermal document preserves every field and the HTML contains the same displayed values. Add source-level preview regressions asserting concrete bindings for formatted Fecha, Subtotal, title, footer, credit note, all line metadata/amounts, and the shared payment label. The HTML and thermal-document tests remain the value-level regression for the shared snapshot; the preview wiring test protects the React Native field bindings.

- [ ] **Step 2: Run the full project verification**

Run: `npm test`

Expected: PASS for the JavaScript/TypeScript test suite.

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest`

Expected: PASS for all Android unit tests.

- [ ] **Step 3: Inspect the final diff and worktree**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only the intended readability files are newly modified, while pre-existing user changes remain untouched.

- [ ] **Step 4: Manually inspect representative ticket output**

Review one cash ticket and one credit ticket in the print preview, plus a long customer/product and large amount fixture. Confirm the main text is readable, the long values wrap, the credit note is present only for credit, and the total remains visually dominant.

- [ ] **Step 5: Commit the implementation as one focused change**

Stage only the readability implementation and its tests, then commit with `git commit -m "feat: improve sale ticket readability"`. Do not stage unrelated pre-existing changes.
