# MP210 Bluetooth Thermal Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print each saved sale ticket directly from KOLD Field to the paired MP210 over Android Bluetooth Classic, as a deterministic 384-dot raster, while retaining PDF fallback and requiring explicit confirmation after any potentially partial transmission.

**Architecture:** Keep `SaleTicketSnapshot` as the domain source, build a shared presentation DTO in TypeScript, and pass that DTO through an optional local Expo module. Kotlin renders the DTO with packaged fonts into a 384-pixel monochrome bitmap, encodes conservative ESC/POS raster bands, and writes them through a cancellable RFCOMM/SPP transport. The generated `/android` directory remains ignored; all native source and permission configuration live in the tracked local module.

**Tech Stack:** Expo SDK 52, React Native 0.76, TypeScript, Expo Modules API, Kotlin, Android Bluetooth Classic/RFCOMM, Android Canvas, ESC/POS, AsyncStorage, Node test runner, JUnit/Robolectric, Android instrumentation tests.

---

## Required references and working rules

- Approved design: `docs/superpowers/specs/2026-07-21-mp210-bluetooth-thermal-printing-design.md`
- Expo local modules: <https://docs.expo.dev/modules/get-started/>
- Expo config plugins: <https://docs.expo.dev/config-plugins/plugins/>
- Android Bluetooth permissions: <https://developer.android.com/develop/connectivity/bluetooth/bt-permissions>
- Android `BluetoothSocket`: <https://developer.android.com/reference/android/bluetooth/BluetoothSocket>
- Work only in `.worktrees/mp210-bluetooth-printing` on `codex/mp210-bluetooth-printing`.
- Do not edit or force-add generated `/android` or `/ios` files.
- Use `@superpowers:test-driven-development` for every behavior change, `@superpowers:systematic-debugging` for unexpected failures, and `@superpowers:verification-before-completion` before each completion claim.
- The physical MP210 test is a release gate. Automated success alone does not prove the printer accepts SPP or `GS v 0`.

## File structure

### Shared ticket data and app services

- Create `assets/grupofrio-ticket-logo.png` — high-contrast raster derived from the current canonical SVG.
- Create `scripts/embed-sale-ticket-logo.mjs` — deterministic PNG-to-TypeScript base64 generator with `--check` mode.
- Create `scripts/verify-thermal-printer-android.mjs` — post-Prebuild generated-manifest verifier.
- Create `src/generated/saleTicketLogo.ts` — generated base64 constant; never hand-edit.
- Create `src/services/saleTicketBranding.ts` — shared legal name, RFC, title, footer, logo, and branding version.
- Create `src/services/saleTicketFormatting.ts` — shared date, currency, quantity, and seller formatting.
- Create `src/services/thermalPrinterTypes.ts` — DTOs, device/result/error types, and error codes.
- Create `src/services/thermalTicketDocument.ts` — pure `SaleTicketSnapshot` to `ThermalTicketDocument` transformation.
- Create `src/services/thermalTicketFixtures.ts` — debug-only real-sale fixture guaranteed to render above 65,536 raster bytes.
- Create `fixtures/mp210-long-sale-ticket.json` — single cross-language long-sale fixture consumed by TypeScript and Kotlin tests.
- Create `src/services/thermalPrinterSelection.ts` — versioned selected-printer persistence and validation.
- Create `src/services/thermalPrinter.ts` — permission, native-module, serialization, selection, and error orchestration.
- Modify `src/services/saleTicket.ts` — consume shared branding/formatting and keep PDF output equivalent.
- Modify `src/persistence/storage.ts` — add the thermal-printer selection key.

### Local Expo module

- Create `modules/thermal-printer/expo-module.config.json` — Android module registration.
- Create `modules/thermal-printer/app.plugin.js` — exact Bluetooth permission generation.
- Create `modules/thermal-printer/index.ts` — public optional binding.
- Create `modules/thermal-printer/src/ThermalPrinterModule.ts` — `requireOptionalNativeModule` boundary.
- Create `modules/thermal-printer/android/build.gradle` — Expo module and test configuration.
- Create `modules/thermal-printer/android/src/main/AndroidManifest.xml` — library permissions.
- Create `modules/thermal-printer/android/src/main/assets/fonts/SpaceMono-Regular.ttf`.
- Create `modules/thermal-printer/android/src/main/assets/fonts/SpaceMono-Bold.ttf`.
- Create `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterRecords.kt` — validated Expo records and result maps.
- Create `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterErrors.kt` — stable coded exceptions.
- Create `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/EscPosRasterEncoder.kt` — pure `GS v 0` band encoder.
- Create `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt` — wrapping and draw-command layout.
- Create `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketRenderer.kt` — Canvas rendering and monochrome conversion.
- Create `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/DiagnosticTicketFactory.kt` — edge/accent/large-payload test pattern.
- Create `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/BluetoothPrinterTransport.kt` — socket factory, timeouts, chunking, pacing, progress.
- Create `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/BluetoothDeviceDirectory.kt` — adapter state and bonded-device ordering.
- Create `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterModule.kt` — Expo API orchestration.

### UI and verification

- Create `src/components/domain/ThermalPrinterPicker.tsx` — bonded-device picker and diagnostic action.
- Modify `app/print/[orderId].tsx` — direct print state machine, selected device, PDF fallback, safe reprint alerts.
- Modify `app.json` — register the local config plugin.
- Create TypeScript/Node tests under `tests/thermal*.test.{ts,mjs}`.
- Create Kotlin tests under `modules/thermal-printer/android/src/test/...`.
- Create renderer instrumentation tests under `modules/thermal-printer/android/src/androidTest/...`.
- Create `docs/MP210_BLUETOOTH_PRINT_QA.md` — build and physical-acceptance evidence.

## Task 1: Canonical ticket branding and generated raster logo

**Files:**
- Create: `assets/grupofrio-ticket-logo.png`
- Create: `scripts/embed-sale-ticket-logo.mjs`
- Create: `src/generated/saleTicketLogo.ts`
- Create: `src/services/saleTicketBranding.ts`
- Modify: `src/services/saleTicket.ts`
- Test: `tests/saleTicketBranding.test.mjs`
- Test: `tests/saleTicket.test.ts`

- [ ] **Step 1: Write the failing branding test**

Assert that the embed script passes `--check`, that the PDF uses `data:image/png;base64`, and that legal name/RFC/footer come from the shared branding module rather than duplicated literals.

```js
test('embedded ticket logo is current', () => {
  const result = spawnSync(process.execPath, ['scripts/embed-sale-ticket-logo.mjs', '--check']);
  assert.equal(result.status, 0, result.stderr.toString());
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --experimental-strip-types tests/saleTicketBranding.test.mjs`

Expected: FAIL because the generator and shared branding module do not exist.

- [ ] **Step 3: Produce the canonical thermal PNG**

Render `assets/grupofrio-logo.svg` to a white-background PNG, crop to the logo bounds, resize to at most 384 px wide, and visually inspect it before committing:

```bash
qlmanage -t -s 512 -o /private/tmp assets/grupofrio-logo.svg
sips --resampleWidth 384 /private/tmp/grupofrio-logo.svg.png --out assets/grupofrio-ticket-logo.png
```

If Quick Look adds padding, crop it with `sips --cropToHeightWidth` using the inspected dimensions; do not accept a clipped wordmark.

- [ ] **Step 4: Implement deterministic embedding**

`scripts/embed-sale-ticket-logo.mjs` must read the PNG, emit the generated module deterministically, and compare instead of writing under `--check`:

```js
const source = readFileSync(resolve(REPO_ROOT, 'assets/grupofrio-ticket-logo.png'));
const generated = `// Generated by scripts/embed-sale-ticket-logo.mjs. Do not edit.\n` +
  `export const SALE_TICKET_LOGO_PNG_BASE64 = '${source.toString('base64')}';\n`;

if (process.argv.includes('--check')) {
  assert.equal(readFileSync(OUTPUT, 'utf8'), generated);
} else {
  writeFileSync(OUTPUT, generated);
}
```

`src/services/saleTicketBranding.ts` must export:

```ts
export const SALE_TICKET_BRANDING = {
  version: 'grupo-frio-ticket-v1',
  legalName: 'SOLUCIONES EN PRODUCCION GLACIEM',
  rfcLabel: 'RFC: SPG230420F52',
  title: 'Ticket de venta',
  footer: 'Gracias por su compra',
  logoPngBase64: SALE_TICKET_LOGO_PNG_BASE64,
} as const;
```

Update `buildSaleTicketHtml` to consume these fields and the same PNG data URI. Preserve 58 mm PDF dimensions, zero side padding, totals, and credit note.

- [ ] **Step 5: Regenerate and verify GREEN**

Run:

```bash
node scripts/embed-sale-ticket-logo.mjs
node --test --experimental-strip-types tests/saleTicketBranding.test.mjs tests/saleTicket.test.ts
npm run typecheck
```

Expected: focused tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add assets/grupofrio-ticket-logo.png scripts/embed-sale-ticket-logo.mjs src/generated/saleTicketLogo.ts src/services/saleTicketBranding.ts src/services/saleTicket.ts tests/saleTicketBranding.test.mjs tests/saleTicket.test.ts
git commit -m "refactor: share sale ticket branding"
```

## Task 2: Thermal document, formatting, selection, and partial-print policy

**Files:**
- Create: `src/services/saleTicketFormatting.ts`
- Create: `src/services/thermalPrinterTypes.ts`
- Create: `src/services/thermalTicketDocument.ts`
- Create: `src/services/thermalPrinterSelection.ts`
- Modify: `src/services/saleTicket.ts`
- Modify: `src/persistence/storage.ts`
- Test: `tests/thermalTicketDocument.test.ts`
- Test: `tests/thermalPrinterSelection.test.ts`
- Test: `tests/thermalPrintOutcome.test.ts`

- [ ] **Step 1: Write failing pure tests**

Cover cash/credit/transfer, invalid date, missing seller, integer/decimal quantity, Spanish characters, long names, large totals, exact `folio === snapshot.saleId`, valid/invalid stored selections, and the conservative partial policy:

```ts
assert.equal(buildThermalTicketDocument(snapshot).folio, snapshot.saleId);
assert.equal(requiresManualReprintConfirmation({ rasterPayloadAttempted: true, rasterBytesWritten: 0 }), true);
assert.equal(requiresManualReprintConfirmation({ rasterPayloadAttempted: false, rasterBytesWritten: 0 }), false);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test --experimental-strip-types tests/thermalTicketDocument.test.ts tests/thermalPrinterSelection.test.ts tests/thermalPrintOutcome.test.ts`

Expected: FAIL on missing modules.

- [ ] **Step 3: Extract shared formatting without changing PDF output**

Move the existing currency/date/quantity/seller functions from `saleTicket.ts` into `saleTicketFormatting.ts`. Keep their current outputs and reuse them from both the HTML and thermal builder.

- [ ] **Step 4: Implement the DTO and policy**

Use the approved contract:

```ts
export interface ThermalTicketDocument {
  schemaVersion: 1;
  branding: {
    logoPngBase64: string;
    logoVersion: string;
    legalName: string;
    rfcLabel: string;
    title: string;
    footer: string;
  };
  folio: string;
  formattedDate: string;
  customerName: string;
  sellerName: string;
  paymentLabel: string;
  lines: Array<{
    productId: number;
    productName: string;
    quantityAndUnitPrice: string;
    lineTotal: string;
  }>;
  subtotal: string;
  totalKg: string;
  total: string;
  creditNote?: string;
}

export function requiresManualReprintConfirmation(
  progress: Pick<NativePrintProgress, 'rasterPayloadAttempted'>,
): boolean {
  return progress.rasterPayloadAttempted;
}
```

- [ ] **Step 5: Implement versioned selection persistence**

Add `THERMAL_PRINTER: 'preferences:thermalPrinter'` to `STORAGE_KEYS`. Load with structural validation and save/remove through the strict storage functions. Accept only version `1` and MAC addresses matching six hexadecimal octets; return `null` for malformed persisted data.

- [ ] **Step 6: Run focused and regression tests**

Run:

```bash
node --test --experimental-strip-types tests/thermalTicketDocument.test.ts tests/thermalPrinterSelection.test.ts tests/thermalPrintOutcome.test.ts tests/saleTicket.test.ts
npm run typecheck
```

Expected: all focused tests PASS and PDF assertions remain unchanged except the approved shared PNG source.

- [ ] **Step 7: Commit**

```bash
git add src/services/saleTicketFormatting.ts src/services/thermalPrinterTypes.ts src/services/thermalTicketDocument.ts src/services/thermalPrinterSelection.ts src/services/saleTicket.ts src/persistence/storage.ts tests/thermalTicketDocument.test.ts tests/thermalPrinterSelection.test.ts tests/thermalPrintOutcome.test.ts
git commit -m "feat: build thermal ticket documents"
```

## Task 3: Tracked local Expo module and exact Bluetooth permissions

**Files:**
- Create: `modules/thermal-printer/expo-module.config.json`
- Create: `modules/thermal-printer/app.plugin.js`
- Create: `modules/thermal-printer/index.ts`
- Create: `modules/thermal-printer/src/ThermalPrinterModule.ts`
- Create: `modules/thermal-printer/android/build.gradle`
- Create: `modules/thermal-printer/android/src/main/AndroidManifest.xml`
- Create: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterModule.kt`
- Create: `scripts/verify-thermal-printer-android.mjs`
- Modify: `app.json`
- Test: `tests/thermalPrinterConfigPlugin.test.mjs`
- Test: `tests/thermalPrinterModuleWiring.test.mjs`

- [ ] **Step 1: Write failing plugin and wiring tests**

Load the plugin against a minimal Android manifest and assert exactly:

```xml
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
```

Also assert that neither module nor plugin adds `BLUETOOTH_SCAN`, that `app.json` registers `./modules/thermal-printer/app.plugin.js`, and that the Expo module name is `KoldThermalPrinter`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/thermalPrinterConfigPlugin.test.mjs tests/thermalPrinterModuleWiring.test.mjs`

Expected: FAIL because the local module does not exist.

- [ ] **Step 3: Create the minimal module**

Use this registration:

```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["mx.grupofrio.thermalprinter.ThermalPrinterModule"]
  }
}
```

The Kotlin definition initially exposes only the module name. The TypeScript boundary uses `requireOptionalNativeModule`, never `requireNativeModule`, so Expo Go and iOS return unavailable rather than crash.

- [ ] **Step 4: Implement the idempotent config plugin**

Upsert permissions by `android:name`; update `android:maxSdkVersion` for the two legacy entries; avoid duplicates; never remove permissions owned by other features. Wrap with `createRunOncePlugin` and register it in `app.json`.

- [ ] **Step 5: Configure Gradle and test dependencies**

Apply `ExpoModulesCorePlugin.gradle`, `applyKotlinExpoModulesCorePlugin()`, `useCoreDependencies()`, and `useDefaultAndroidSdkVersions()`. Add JUnit 4.13.2, Truth, Robolectric 4.11.1, `org.json`, AndroidX test runner/core/rules, and configure:

```gradle
android {
  namespace "mx.grupofrio.thermalprinter"
  defaultConfig {
    testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
  }
  testOptions {
    unitTests.includeAndroidResources = true
  }
  sourceSets {
    test.resources.srcDir("${rootProject.projectDir}/../fixtures")
  }
}
```

`scripts/verify-thermal-printer-android.mjs` must parse `android/app/src/main/AndroidManifest.xml` after Prebuild and fail unless each required permission occurs once, both legacy permissions carry `android:maxSdkVersion="30"`, `BLUETOOTH_CONNECT` has no legacy maximum, and `BLUETOOTH_SCAN` is absent.

- [ ] **Step 6: Verify autolinking and native compilation**

Run:

```bash
npx expo-modules-autolinking resolve --platform android
npx expo prebuild --platform android --clean
node scripts/verify-thermal-printer-android.mjs
./android/gradlew -p android :thermal-printer:compileDebugKotlin
```

Expected: autolinking lists `thermal-printer`; Kotlin compilation exits 0. Confirm `git status --short` does not list `/android`.

- [ ] **Step 7: Run GREEN tests and commit**

```bash
node --test tests/thermalPrinterConfigPlugin.test.mjs tests/thermalPrinterModuleWiring.test.mjs
git add modules/thermal-printer app.json scripts/verify-thermal-printer-android.mjs tests/thermalPrinterConfigPlugin.test.mjs tests/thermalPrinterModuleWiring.test.mjs
git commit -m "feat: scaffold thermal printer native module"
```

## Task 4: Pure ESC/POS raster encoder

**Files:**
- Create: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/EscPosRasterEncoder.kt`
- Test: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/EscPosRasterEncoderTest.kt`

- [ ] **Step 1: Write failing encoder tests**

Test 384 px equals 48 bytes per row, MSB-first pixels, white padding bits, 512-row bands, a 24,576-byte maximum initial payload, `GS v 0` dimensions, `ESC @` initialization, and `ESC d 4` feed.

For a two-row raster, assert the exact header:

```kotlin
byteArrayOf(0x1D, 0x76, 0x30, 0x00, 0x30, 0x00, 0x02, 0x00)
```

- [ ] **Step 2: Run the focused Gradle test and verify RED**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*EscPosRasterEncoderTest'`

Expected: FAIL because the encoder is missing.

- [ ] **Step 3: Implement the minimal pure encoder**

Use immutable output objects so the transport can stream and release one band at a time:

```kotlin
data class MonochromeRaster(val width: Int, val height: Int, val bytes: ByteArray)
data class RasterBand(val rowOffset: Int, val rowCount: Int, val command: ByteArray)

class EscPosRasterEncoder(private val bandRows: Int = 512) {
  fun initialize(): ByteArray = byteArrayOf(0x1B, 0x40)
  fun bands(raster: MonochromeRaster): Sequence<RasterBand> = sequence { /* GS v 0 */ }
  fun feed(lines: Int = 4): ByteArray = byteArrayOf(0x1B, 0x64, lines.toByte())
}
```

Reject widths not divisible by 8, mismatched buffer lengths, nonpositive dimensions, and payloads at or above 40 KB.

- [ ] **Step 4: Run GREEN tests**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*EscPosRasterEncoderTest'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/EscPosRasterEncoder.kt modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/EscPosRasterEncoderTest.kt
git commit -m "feat: encode MP210 raster bands"
```

## Task 5: Deterministic 384-pixel layout and Canvas renderer

**Files:**
- Create: `modules/thermal-printer/android/src/main/assets/fonts/SpaceMono-Regular.ttf`
- Create: `modules/thermal-printer/android/src/main/assets/fonts/SpaceMono-Bold.ttf`
- Create: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterRecords.kt`
- Create: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt`
- Create: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketRenderer.kt`
- Test: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketLayoutTest.kt`
- Test: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalTicketRendererTest.kt`
- Test: `modules/thermal-printer/android/src/androidTest/java/mx/grupofrio/thermalprinter/ThermalTicketRendererInstrumentedTest.kt`

- [ ] **Step 1: Copy the exact packaged fonts**

Copy from the already locked dependency:

```bash
cp node_modules/@expo-google-fonts/space-mono/400Regular/SpaceMono_400Regular.ttf modules/thermal-printer/android/src/main/assets/fonts/SpaceMono-Regular.ttf
cp node_modules/@expo-google-fonts/space-mono/700Bold/SpaceMono_700Bold.ttf modules/thermal-printer/android/src/main/assets/fonts/SpaceMono-Bold.ttf
```

- [ ] **Step 2: Write failing layout tests**

Inject a `TextMeasurer` and test: x=0/x=383 full-width dividers, 8 px text inset, word then character wrapping, label/value fallback, right-aligned unbroken amounts, 16 px minimum amount size, credit note height, long customer/seller/payment/RFC, and `ticket_too_large` above 6000 rows.

- [ ] **Step 3: Run the layout test and verify RED**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*ThermalTicketLayoutTest'`

Expected: FAIL on missing layout classes.

- [ ] **Step 4: Implement records and layout commands**

Model Expo inputs as `Record` classes with `@Field`. Convert them immediately to validated immutable domain objects. Emit commands rather than drawing while measuring:

```kotlin
sealed interface DrawCommand {
  data class Text(val text: String, val x: Float, val baseline: Float, val style: TextStyle) : DrawCommand
  data class Divider(val y: Float) : DrawCommand
  data class Logo(val top: Float, val width: Int, val height: Int) : DrawCommand
}
```

Use constants from the spec: width 384, body 20/26 px, small 18/23 px, total 28/34 px, amount minimum 16 px, inset 8 px, logo maximum 256 px, maximum height 6000.

- [ ] **Step 5: Run layout GREEN**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*ThermalTicketLayoutTest'`

Expected: PASS.

- [ ] **Step 6: Write failing renderer/pixel tests**

Use Robolectric plus the packaged fonts to assert width 384, white background, black edge pixels for diagnostic dividers, decoded logo bounds, monochrome-only output, stable height, and no clipping for cash/credit fixtures. Add an instrumented version for real Android Canvas; compare approved fixtures with a documented pixel tolerance rather than device-dependent text screenshots.

- [ ] **Step 7: Implement Canvas and 1-bit conversion**

Render ARGB first, then convert to `MonochromeRaster` with a deterministic ordered threshold. Recycle the bitmap in `finally`; cache decoded logo by `logoVersion`; reject malformed/oversized base64 with `invalid_ticket`.

- [ ] **Step 8: Run renderer tests**

Run:

```bash
./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*ThermalTicketRendererTest'
./android/gradlew -p android :thermal-printer:testDebugUnitTest
```

Expected: PASS. Defer `connectedDebugAndroidTest` to the emulator/device task.

- [ ] **Step 9: Commit**

```bash
git add modules/thermal-printer/android/src/main/assets/fonts modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterRecords.kt modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketLayout.kt modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalTicketRenderer.kt modules/thermal-printer/android/src/test modules/thermal-printer/android/src/androidTest
git commit -m "feat: render 384-dot thermal tickets"
```

## Task 6: Cancellable Bluetooth transport and conservative progress

**Files:**
- Create: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterErrors.kt`
- Create: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/BluetoothPrinterTransport.kt`
- Test: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/BluetoothPrinterTransportTest.kt`

- [ ] **Step 1: Write failing transport tests with fake sockets**

Cover secure SPP success, secure-to-insecure fallback only after connect failure, 12 s connect timeout, 8 s write-idle timeout, 60 s job timeout, 2,048-byte chunks, 10 ms/40 ms pacing, socket close in every path, mutex/busy behavior, and progress.

The critical regression is a fake first raster write that transmits then throws:

```kotlin
assertThat(error.progress.rasterPayloadAttempted).isTrue()
assertThat(error.progress.rasterBytesWritten).isEqualTo(0)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*BluetoothPrinterTransportTest'`

Expected: FAIL because the transport does not exist.

- [ ] **Step 3: Implement testable socket abstractions**

Introduce `PrinterSocket`, `PrinterSocketFactory`, `Clock`, and `Pacer` interfaces. Production uses `BluetoothDevice.createRfcommSocketToServiceRecord(SPP_UUID)` and the insecure variant. Tests use fakes; do not use reflection or hidden channel-1 APIs.

- [ ] **Step 4: Implement blocking-operation cancellation**

Run connect/write on a dedicated worker. A watchdog owns the current socket; on timeout it closes the socket, interrupts the worker, and joins it before returning the coded timeout. Do not resolve/reject while a worker can still write.

On API 31+, never query or cancel discovery. On API 30 and below, cancel only when already active and covered by the legacy permission.

- [ ] **Step 5: Implement conservative progress**

Set `rasterPayloadAttempted = true` immediately before the first call whose buffer includes raster payload. Increment `rasterBytesWritten` only after a write call returns; increment `bandsCompleted` only after an entire band returns. Include all progress fields in every coded write failure.

- [ ] **Step 6: Run GREEN and full module unit tests**

Run:

```bash
./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*BluetoothPrinterTransportTest'
./android/gradlew -p android :thermal-printer:testDebugUnitTest
```

Expected: PASS with no live worker after timeout tests.

- [ ] **Step 7: Commit**

```bash
git add modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterErrors.kt modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/BluetoothPrinterTransport.kt modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/BluetoothPrinterTransportTest.kt
git commit -m "feat: add cancellable Bluetooth printer transport"
```

## Task 7: Native Bluetooth state and bonded-device directory

**Files:**
- Create: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/BluetoothDeviceDirectory.kt`
- Modify: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterModule.kt`
- Modify: `modules/thermal-printer/src/ThermalPrinterModule.ts`
- Modify: `modules/thermal-printer/index.ts`
- Test: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/BluetoothStateTest.kt`
- Test: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/BluetoothDeviceDirectoryTest.kt`
- Test: `tests/thermalPrinterModuleWiring.test.mjs`

- [ ] **Step 1: Write failing state/list tests**

Require `getBluetoothState` and `getBondedDevices`; test `unsupported | off | on`, missing `BLUETOOTH_CONNECT`, MP210-first ordering, stable name/address ordering, and the exact discovery policy: never `startDiscovery`; on API 31+ never call `isDiscovering`/`cancelDiscovery`; on API 30 or lower query and cancel only when discovery is already active and legacy permission exists.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/thermalPrinterModuleWiring.test.mjs
./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*BluetoothDeviceDirectoryTest'
```

Expected: FAIL on the missing API/directory.

- [ ] **Step 3: Implement adapter state only**

Inject an adapter facade. Return `unsupported` for no adapter, `off` for disabled, and `on` otherwise. On API 31+, surface `permission_denied` before reading protected adapter/device properties.

- [ ] **Step 4: Run the focused state tests GREEN**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*BluetoothStateTest'`

Expected: PASS for state cases.

- [ ] **Step 5: Implement bonded-device listing**

Map only `bondedDevices`; sort case-insensitive `MP210` names first, then name/address. Never call `startDiscovery`. On API 31+, never query or cancel discovery; on API 30 and below cancel only if already active and legacy permission is present.

- [ ] **Step 6: Run GREEN and commit**

```bash
node --test tests/thermalPrinterModuleWiring.test.mjs
./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*BluetoothStateTest' --tests '*BluetoothDeviceDirectoryTest'
git add modules/thermal-printer
git commit -m "feat: list paired thermal printers"
```

## Task 8: Native ticket and diagnostic print APIs

**Files:**
- Create: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/DiagnosticTicketFactory.kt`
- Create: `fixtures/mp210-long-sale-ticket.json`
- Create: `src/services/thermalTicketFixtures.ts`
- Modify: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterModule.kt`
- Modify: `modules/thermal-printer/src/ThermalPrinterModule.ts`
- Modify: `modules/thermal-printer/index.ts`
- Test: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/ThermalPrinterModuleTest.kt`
- Test: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/DiagnosticTicketFactoryTest.kt`
- Test: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/LongSaleTicketPayloadTest.kt`
- Test: `tests/thermalTicketFixtures.test.ts`
- Test: `tests/thermalPrinterModuleWiring.test.mjs`

- [ ] **Step 1: Write failing print-ticket tests**

In the Node contract test require `printTicket(address, document)` and all progress fields. In `ThermalPrinterModuleTest`, cover valid, invalid, unbonded, renderer failure, encoder failure, and transport failure documents.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/thermalPrinterModuleWiring.test.mjs
./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*ThermalPrinterModuleTest'
```

Expected: both focused tests FAIL on missing `printTicket` behavior.

- [ ] **Step 3: Implement `printTicket` orchestration**

Validate that the address remains bonded; validate/convert the Expo record; render; encode `ESC @`, bands, and `ESC d 4`; send with the transport; recycle resources; map errors to stable codes and complete progress.

- [ ] **Step 4: Run the native ticket tests GREEN**

Run: `./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*ThermalPrinterModuleTest'`

Expected: PASS for every `printTicket` case.

- [ ] **Step 5: Write and run the diagnostic RED test**

Require `printDiagnostic(address, branding)` in the Node contract. `DiagnosticTicketFactoryTest` must assert x=0/x=383 marks, supplied branding/logo usage, accents/sizes, and raw payload above 64 KB, while verifying no logo/legal identity literal exists in Kotlin.

```bash
node --test tests/thermalPrinterModuleWiring.test.mjs
./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*DiagnosticTicketFactoryTest'
```

Expected: FAIL because the branded diagnostic is missing.

- [ ] **Step 6: Implement branded diagnostic**

`printDiagnostic` must receive the same `branding` shape used by `printTicket`. Generate x=0/x=383 lines, checker/ruler, supplied logo, `á é í ó ú ñ Ñ $`, every font size, aligned amounts, `384 dots`, encoder mode, and enough rows to exceed 64 KB. Never embed an alternate logo/RFC/legal name in Kotlin.

- [ ] **Step 7: Run the diagnostic GREEN test**

Run:

```bash
node --test tests/thermalPrinterModuleWiring.test.mjs
./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*DiagnosticTicketFactoryTest'
```

Expected: PASS.

- [ ] **Step 8: Write and run separate long-sale fixture RED tests**

Add expectations in `thermalTicketFixtures.test.ts` for a sale-shaped JSON fixture and in `LongSaleTicketPayloadTest` for more than 65,536 raster bytes.

```bash
node --test --experimental-strip-types tests/thermalTicketFixtures.test.ts
./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*LongSaleTicketPayloadTest'
```

Expected: FAIL because the shared fixture does not exist.

- [ ] **Step 9: Implement the separate long-sale fixture**

Store the sale fields and product lines once in `fixtures/mp210-long-sale-ticket.json`. `buildLongSaleThermalTicketFixture()` imports that JSON and injects `SALE_TICKET_BRANDING`. Kotlin loads the same JSON from the Gradle test resources, renders it, and asserts `raster.bytes.size > 65_536`. This is distinct from `DiagnosticTicketFactoryTest` and guarantees the physically printed debug fixture is the automatically measured one.

- [ ] **Step 10: Run fixture GREEN and the complete module suite**

```bash
node --test --experimental-strip-types tests/thermalTicketFixtures.test.ts tests/thermalPrinterModuleWiring.test.mjs
./android/gradlew -p android :thermal-printer:testDebugUnitTest --tests '*LongSaleTicketPayloadTest'
./android/gradlew -p android :thermal-printer:testDebugUnitTest
./android/gradlew -p android :thermal-printer:compileDebugKotlin
```

Expected: all commands exit 0.

- [ ] **Step 11: Commit**

```bash
git add modules/thermal-printer fixtures/mp210-long-sale-ticket.json src/services/thermalTicketFixtures.ts tests/thermalTicketFixtures.test.ts tests/thermalPrinterModuleWiring.test.mjs
git commit -m "feat: expose MP210 ticket and diagnostic APIs"
```

## Task 9: TypeScript permission and device-list service

**Files:**
- Create: `src/services/thermalPrinter.ts`
- Test: `tests/thermalPrinterPermission.test.ts`

- [ ] **Step 1: Write failing permission/list tests**

Cover non-Android/unavailable module, Android <31 without runtime prompt, Android 31+ granted/denied/never-ask-again, Bluetooth off, MP210-first list, and a saved printer no longer bonded.

- [ ] **Step 2: Run and verify RED**

Run: `node --test --experimental-strip-types tests/thermalPrinterPermission.test.ts`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement a dependency-injected permission/list factory**

```ts
export function createThermalPrinterService(deps: {
  platform: 'android' | 'ios' | 'web';
  androidApiLevel: number;
  native: NativeThermalPrinterModule | null;
  requestConnectPermission: () => Promise<'granted' | 'denied' | 'never_ask_again'>;
}) { /* permission and list methods first */ }
```

Keep React Native globals behind production dependencies so Node tests never load native code. Never request `BLUETOOTH_SCAN`.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test --experimental-strip-types tests/thermalPrinterPermission.test.ts
npm run typecheck
git add src/services/thermalPrinter.ts tests/thermalPrinterPermission.test.ts
git commit -m "feat: prepare paired printer access"
```

## Task 10: TypeScript print jobs and partial-result policy

**Files:**
- Modify: `src/services/thermalPrinter.ts`
- Test: `tests/thermalPrinterService.test.ts`

- [ ] **Step 1: Write failing job tests**

Cover selection persistence, single-flight/busy, diagnostic receiving `SALE_TICKET_BRANDING`, successful print, pre-raster failure, first-raster-block failure with zero confirmed bytes, later partial failure, and long-sale debug fixture. Add a table-driven assertion for every required native code and its Spanish user message while preserving `phase`, `transportBytesWritten`, `rasterBytesWritten`, `bandsCompleted`, and `rasterPayloadAttempted`:

```ts
const codes = [
  'bluetooth_unsupported', 'bluetooth_disabled', 'permission_denied',
  'printer_not_bonded', 'connect_timeout', 'connect_failed', 'busy',
  'invalid_ticket', 'ticket_too_large', 'write_timeout', 'write_failed',
] as const;
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test --experimental-strip-types tests/thermalPrinterService.test.ts`

Expected: FAIL because job methods do not exist.

- [ ] **Step 3: Implement selection and single-flight methods**

Add `selectPrinter`, `changePrinter`, and a process-local single-flight guard shared by diagnostic and ticket jobs. Do not alter sale snapshots.

- [ ] **Step 4: Run selection/single-flight tests GREEN**

Run: `node --test --experimental-strip-types --test-name-pattern='selection|single-flight|busy' tests/thermalPrinterService.test.ts`

Expected: PASS for that subset.

- [ ] **Step 5: Implement structured print outcomes**

Normalize unknown native rejections into `ThermalPrinterError`. Implement an exhaustive `toThermalPrinterMessage(code)` mapping for the required codes; unknown codes use a generic Spanish fallback. Preserve phase and every progress field unchanged. Use `rasterPayloadAttempted`, never byte counts alone, for manual-reprint decisions. Pass `SALE_TICKET_BRANDING` to the diagnostic method and the DTO to ticket printing.

- [ ] **Step 6: Run GREEN and commit**

```bash
node --test --experimental-strip-types tests/thermalPrinterService.test.ts tests/thermalPrinterSelection.test.ts tests/thermalPrintOutcome.test.ts
npm run typecheck
git add src/services/thermalPrinter.ts tests/thermalPrinterService.test.ts
git commit -m "feat: orchestrate thermal print jobs"
```

## Task 11: MP210 picker and diagnostic controls

**Files:**
- Create: `src/components/domain/ThermalPrinterPicker.tsx`
- Test: `tests/thermalPrinterPickerWiring.test.mjs`

- [ ] **Step 1: Write the failing picker wiring test**

Assert a Modal/FlatList, device name/address, MP210-first data, cancel, explicit selection, “Imprimir diagnóstico”, and a debug-only “Imprimir ticket largo de prueba” action.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/thermalPrinterPickerWiring.test.mjs`

Expected: FAIL because the picker is missing.

- [ ] **Step 3: Build selection UI**

Persist only after an explicit device tap. Diagnostic receives shared branding through the service. Gate the long-sale control behind `__DEV__`; production users do not see synthetic tickets.

- [ ] **Step 4: Run GREEN, typecheck, and commit**

```bash
node --test tests/thermalPrinterPickerWiring.test.mjs
npm run typecheck
git add src/components/domain/ThermalPrinterPicker.tsx tests/thermalPrinterPickerWiring.test.mjs
git commit -m "feat: add MP210 setup and diagnostics"
```

## Task 12: One-tap ticket-screen state machine

**Files:**
- Modify: `app/print/[orderId].tsx`
- Modify: `tests/saleTicketWiring.test.mjs`
- Test: `tests/thermalPrinterUiWiring.test.mjs`

- [ ] **Step 1: Write failing screen tests**

Assert “Imprimir en MP210”, selected-printer name, “Cambiar impresora”, retained “Abrir PDF”, loading/disabled behavior, permanent-denial settings action, exact success copy, and explicit reprint action after `rasterPayloadAttempted`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/thermalPrinterUiWiring.test.mjs tests/saleTicketWiring.test.mjs`

Expected: FAIL because direct printing UI is absent.

- [ ] **Step 3: Wire normal states**

Add `idle | permission | connecting | sending`. First tap with no selection opens the picker; later taps print directly. Disable both output actions while a print job is active. On success say “Ticket enviado a MP210”, never “impreso”.

- [ ] **Step 4: Run normal-state tests GREEN**

Run: `node --test --test-name-pattern='button|selection|success|PDF' tests/thermalPrinterUiWiring.test.mjs`

Expected: PASS for normal states.

- [ ] **Step 5: Wire failure and reprint states**

- `rasterPayloadAttempted === false`: specific error and normal retry;
- `rasterPayloadAttempted === true`: “El ticket pudo salir incompleto” with `Cancelar` and explicit `Reimprimir`;
- permanent denial: `Linking.openSettings()`;
- missing native module: explain that a new Android build is required while PDF remains usable.

- [ ] **Step 6: Run GREEN and commit**

```bash
node --test tests/thermalPrinterUiWiring.test.mjs tests/saleTicketWiring.test.mjs
npm run typecheck
git add -- 'app/print/[orderId].tsx' tests/thermalPrinterUiWiring.test.mjs tests/saleTicketWiring.test.mjs
git commit -m "feat: print sale tickets to MP210"
```

## Task 13: Generated Android, automated integration, and APKs

**Files:**
- Create: `docs/MP210_BLUETOOTH_PRINT_QA.md`
- Modify if required by verified failures only: files from Tasks 3–12

- [ ] **Step 1: Regenerate Android from tracked sources**

Run: `npx expo prebuild --platform android --clean`

Expected: `/android` is generated but remains ignored.

- [ ] **Step 2: Run automated generated-manifest verification**

```bash
npx expo-modules-autolinking resolve --platform android
node scripts/verify-thermal-printer-android.mjs
```

Expected: local module is linked; required permissions occur exactly once with correct maxima; no `BLUETOOTH_SCAN`.

- [ ] **Step 3: Run all automated verification and both build variants**

```bash
npm test
npm run typecheck
./android/gradlew -p android :thermal-printer:testDebugUnitTest
./android/gradlew -p android assembleDebug
./android/gradlew -p android assembleRelease
git diff --check
```

Expected: 0 failures; debug APK and release artifact build.

- [ ] **Step 4: Run Canvas instrumentation when an emulator/device is attached**

Run: `./android/gradlew -p android :thermal-printer:connectedDebugAndroidTest`

Expected: PASS. If no device exists yet, record pending; Task 14 must run it on the physical device before completion.

- [ ] **Step 5: Record and commit automated evidence**

Create `docs/MP210_BLUETOOTH_PRINT_QA.md` with SHA, commands/counts, both artifact paths, permission evidence, and a separate physical section marked pending.

```bash
git add docs/MP210_BLUETOOTH_PRINT_QA.md
git commit -m "docs: record MP210 automated verification"
```

## Task 14: Physical MP210 diagnostic and release gate

**Files:**
- Modify: `docs/MP210_BLUETOOTH_PRINT_QA.md`
- Conditional create: `modules/thermal-printer/android/src/main/java/mx/grupofrio/thermalprinter/EscStar24Encoder.kt`
- Conditional test: `modules/thermal-printer/android/src/test/java/mx/grupofrio/thermalprinter/EscStar24EncoderTest.kt`

- [ ] **Step 1: Install the debug APK on the approved Android device**

Confirm the exact `adb devices` target, then run `adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk`.

Expected: install succeeds without removing app data.

- [ ] **Step 2: Select and persist the paired MP210**

Grant Nearby Devices, select MP210, restart the app, and confirm the same name/address remains selected.

- [ ] **Step 3: Run Canvas instrumentation on the physical device**

Run: `./android/gradlew -p android :thermal-printer:connectedDebugAndroidTest`

Expected: PASS before physical print acceptance.

- [ ] **Step 4: Print the branded diagnostic**

Verify SPP, `GS v 0`, x=0/x=383, canonical logo, accents, `$`, columns, sizes, feed, and its >64 KB section. Record evidence.

- [ ] **Step 5: Print the separate long-sale fixture**

Use the debug-only control and confirm its returned `rasterBytesWritten > 65_536`. Record the exact byte count and verify the complete sale-shaped ticket printed; this does not reuse the diagnostic result.

- [ ] **Step 6: Apply ESC `*` fallback only if required**

If `GS v 0` fails or truncates either >64 KB job, write the failing `EscStar24EncoderTest`, implement 24-dot 384-wide `ESC *` behind the encoder interface, rerun all unit/build/instrumentation commands, and repeat both physical jobs. Do not reduce content/density. If both modes fail, report the protocol gate blocked.

- [ ] **Step 7: Print representative saved sales**

Print cash and credit, long names, decimal quantities, large totals, offline-saved ticket, and manual reprint after an intentionally interrupted raster attempt. Confirm PDF still opens.

- [ ] **Step 8: Run final fresh verification after all physical adjustments**

```bash
npm test
npm run typecheck
node scripts/verify-thermal-printer-android.mjs
./android/gradlew -p android :thermal-printer:testDebugUnitTest
./android/gradlew -p android :thermal-printer:connectedDebugAndroidTest
./android/gradlew -p android assembleDebug
./android/gradlew -p android assembleRelease
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 9: Finalize QA evidence and commit**

Record printer result, encoder, payload/pacing, physical photos/observations, remaining limitations, APK SHA-256, tester, and date.

```bash
git add modules/thermal-printer docs/MP210_BLUETOOTH_PRINT_QA.md
git commit -m "test: validate MP210 Bluetooth printing"
```

## Final completion criteria

- All TypeScript/Node tests, typecheck, Kotlin unit tests, Canvas instrumentation, and Android debug/release builds pass freshly.
- The generated Android manifest contains the required connect/legacy permissions without adding scan permission for this feature.
- Expo Go/native-module absence leaves PDF fallback usable.
- MP210 is selected once and remembered after restart.
- The physical diagnostic, the separate shared long-sale fixture, and representative saved sales print completely at 384 dots.
- Any attempted raster write requires explicit manual confirmation before reprint.
- Both >64 KB physical jobs pass with the recorded encoder mode; the long-sale fixture records more than 65,536 raster bytes independently of the diagnostic.
- No generated `/android` files or unrelated user files are committed.
