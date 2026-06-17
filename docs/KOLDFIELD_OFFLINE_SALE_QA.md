# KoldField — QA guards offline de venta + insufficient_stock

**Rama:** `fix/koldfield-offline-sale-guards`
**Base:** `main` @ `b9eada3`.
**Alcance:** endurecer el comportamiento offline de la venta y mostrar el `available_qty` real ante `insufficient_stock`. **Frontend-only; sin backend; sin cambios de contrato; venta sigue online-first (NO se habilita venta offline).**

## Diagnóstico (riesgos reportados por Sebastián)

| # | Riesgo | Estado previo | Acción |
|---|---|---|---|
| 1 | App sin red se queda **cargando** al agregar productos | ProductPicker disparaba `computeCustomerPrices` (RPC) sin red → spinner hasta el timeout de **45 s** si el partner no estaba precargado | **FIX**: guard `isOnline` |
| 2 | Venta offline debe **bloquearse con mensaje** | Ya bloqueaba: `if (!isOnline) Alert('Venta requiere conexion')` antes de lockear | **OK (verificado + test)** |
| 3 | No guardar venta offline como **confirmada/pendiente** | La venta llama `createSale` directo (online-first); **no** se encola como `sale_order`; el guard offline retorna antes de `lockSaleConfirm` | **OK (verificado + test)** |
| 4 | **Visita fantasma** al reconectar / mezclar estado | `shouldRehydrateVisit` solo rehidrata si el stop existe **y** está `in_progress`; `shouldResetVisitAfterPlanRefresh` resetea si el stop desaparece; `deriveVisitGuard` suprime fantasmas | **OK (ya cubierto + tests existentes)** |
| 5 | `insufficient_stock` debe mostrar **available_qty real** | El `catch` solo mostraba `message`; `unwrapRestResult` **descartaba `data`** → se perdían las líneas | **FIX**: propagar `data` + parser + refrescar stock |

## Cambios
1. **`src/utils/apiResult.ts`** — `unwrapRestResult` ahora **adjunta `data` y `error_code`** al error lanzado en `ok:false` (aditivo; ya adjuntaba `code`). Permite al caller leer el detalle por línea.
2. **`src/services/insufficientStock.ts`** (NUEVO, puro): `getInsufficientStockDetail(error)` (tolerante: por `code` o por mensaje; líneas opcionales) + `describeInsufficientStock(detail)`.
3. **`app/sale/[stopId].tsx`** — en el `catch` de `createSale`: si es `insufficient_stock`, **refresca el inventario** (`loadProducts`) para mostrar el `available_qty` real, muestra el detalle por línea y **mantiene el carrito** para ajustar; **no** marca la venta como exitosa. El bloqueo offline y el no-encolado se mantienen.
4. **`src/components/domain/ProductPicker.tsx`** — guard `isOnline` en el efecto de precios: sin red y sin caché, **no** dispara el RPC (cae a `list_price`, sin spinner colgado); `refreshCatalog` avisa "Sin conexión" en vez de colgarse.

## Pruebas manuales
- [ ] **Abrir ruta sin red:** Home/Ruta cargan desde caché (Fase 2B); no se cuelga.
- [ ] **Abrir ProductPicker sin red (partner no precargado):** muestra productos con `list_price`, **sin spinner infinito**; con partner precargado muestra precios cacheados.
- [ ] **Intentar confirmar venta sin red:** alerta "Venta requiere conexión…"; **no** se crea/encola venta; el carrito se mantiene.
- [ ] **Reconectar:** confirmar venta funciona normal; no aparece visita fantasma; el cliente/visita es el correcto.
- [ ] **insufficient_stock (backend rechaza):** alerta "Stock insuficiente (servidor)" con `pediste X, disponible Y` por línea (cuando el backend manda `data.lines`); el inventario se refresca al stock real; el carrito queda para ajustar; la venta **no** se marca exitosa.
- [ ] **Cambio de cliente sin visita fantasma:** abrir cliente A (check-in), volver, abrir cliente B → B no hereda estado de A; si A sigue `in_progress`, B muestra "otra visita en curso" (correcto, no fantasma); si A desapareció del plan refrescado, no bloquea.

## Caso de evidencia real (campo, 2026-06-17) — venta armada en modo avión
Reporte: en `Nueva Venta` el vendedor armó subtotal $70.00 / 11.0 kg / foto capturada y, al tocar **Confirmar Pedido** con el teléfono **sin conexión**, apareció el modal "Venta requiere conexión…".

**Diagnóstico: comportamiento ESPERADO y seguro** (guard de #42), confirmado en código:
- El guard `if (!isOnline)` corre **antes** de `lockSaleConfirm()` y de `createSale()` → **no** crea venta/pago/picking, **no** marca `saleConfirmed`, **no** encola `sale_order`.
- El carrito y la foto **se conservan** (return temprano, sin `resetVisit`); el botón sigue habilitado (`disabled={saleConfirmed}`, y `saleConfirmed` es false) → **se puede reintentar al reconectar**.
- No hay spinner/lock que quede activo (no se llamó a `lockSaleConfirm` ni a un loading state en esa rama).

**Mejora UX aplicada (sin habilitar venta offline):** banner **"Sin conexión: puedes capturar la venta, pero para confirmarla necesitas conexión con Odoo."** en la pantalla de venta + hint bajo el botón **"Conecta el dispositivo para confirmar en Odoo."** → el vendedor sabe **antes** de armar/confirmar. **No** se deshabilita el botón (la conectividad en ruta es intermitente; deshabilitarlo podría bloquear el confirm en la ventana en que sí hay señal). El modal de confirmación se mantiene como guard final.

Checklist del caso:
- [ ] **Modo avión + venta armada + foto:** banner offline visible arriba; hint bajo el botón.
- [ ] **Confirmar offline:** modal claro; **no** se crea venta ni cola; carrito/foto intactos.
- [ ] **Cerrar modal:** botón sigue habilitado; nada trabado.
- [ ] **Reconectar + Confirmar:** confirma normal; **no** duplica foto/venta/operación/visita.

## Pruebas automáticas (node)
- `tests/saleOfflineUx.test.ts` — `describeSaleOfflineUx`: online sin banner/hint; offline banner+hint claros, sin prometer venta offline.
- `tests/insufficientStock.test.ts` — parser (con/sin líneas, fallback por mensaje, no-confusión, null-safe), `describeInsufficientStock`, y `unwrapRestResult` adjunta `data`+`code`.
- `tests/offlineSaleWiring.test.mjs` — picker tiene guard `isOnline`; venta bloquea offline **antes** de lockear; venta **no** se encola como `sale_order`; catch cablea `getInsufficientStockDetail`/`describeInsufficientStock`.
- `tests/offlineSaleWiring.test.mjs` — además: banner offline (`describeSaleOfflineUx`/`AlertBanner`), hint bajo botón, y que el botón **no** se deshabilita por offline.
- `tests/visitPersistence.test.ts` (existente) — `shouldRehydrateVisit` exige `in_progress`; reset si el stop desaparece (cubre #4).
- **typecheck limpio; tests 125/125.**

## Riesgos pendientes
- El **detalle por línea** de `insufficient_stock` (product/requested/available) solo se ve cuando el backend lo envíe en `data.lines` — eso llega con **#116** (en staging). Mientras tanto, el fix ya **refresca el stock real** y muestra el mensaje del backend; degrada de forma segura.
- La barrera **dura** anti-sobreventa sigue siendo backend (#116). El frontend revalida y bloquea local, pero no es atómico.
- `list_price` offline en el picker es referencial; la venta es online-first y el backend recalcula precio al confirmar.

## Fuera de alcance
Backend (#116), habilitar venta offline, cambios de contrato, otros bugs.
