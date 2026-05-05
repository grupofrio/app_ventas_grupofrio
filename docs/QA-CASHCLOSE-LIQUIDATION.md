# QA Cash Close / Liquidación

> Branch: `feat/cashclose-liquidation-summary`
> Commit base: `fb0ca37`
> Doc creado: 2026-04-27 (BLD-20260427-P1-CASHCLOSE-LIQUIDATION)

## Objetivo

Validar en device real que KoldField consume correctamente
`POST /pwa-ruta/liquidation` para mostrar la cobranza real del vendedor del
día (cash / credit / transferencia / total cobrado / total esperado /
diferencias) y que el flujo es **sólo lectura** — sin botones ni endpoints
de confirmación, validación o cierre.

Este es el QA de la **base estable** de Cash Close. Confirmación de
liquidación se evaluará en una rama separada (`feat/cashclose-confirm-flow`)
una vez este QA pase y se decida agregarla.

## Precondiciones

- APK instalado en device físico (Android, EAS preview o development).
- Vendedor con login válido en producción `https://grupofrio.odoo.com`.
- Vendedor con plan del día activo (`gf.route.plan` `state in {published,
  in_progress, closed, reconciled}` y fecha = hoy).
- Plan con al menos una venta (`sale.order`) confirmada.
- Plan con al menos un pago cobrado (`account.payment` con
  `gf_route_stop_id` poblado y `state` en `posted` / `reconciled`).
- Backend producción `grupofrio.odoo.com` con `gf_logistics_ops`
  `18.0.1.0.1` o superior.
- Endpoint `/pwa-ruta/liquidation` confirmado deployado (verificado
  2026-04-27 vía probe sin auth: respondió con envelope JSON estándar
  `{ok:false, message:"Token de empleado requerido."}` en HTTP 200).

## Endpoint bajo prueba

| Método | Ruta | Propósito | Auth |
|---|---|---|---|
| `POST` | `/pwa-ruta/liquidation` | Lectura — resumen de liquidación del plan | `X-GF-Employee-Token` (solo lectura, NO muta) |

Backend handler: `gf_logistics_ops/controllers/gf_api.py::_handle_liquidation`
→ delega a `gf.route.plan.build_liquidation_summary(include_draft=False)`.

## Endpoints que esta pantalla **NO** debe llamar

Cualquiera de estos usados sería un bug bloqueante:
- ❌ `POST /pwa-ruta/corte-confirm`
- ❌ `POST /pwa-ruta/validate-corte`
- ❌ `POST /pwa-ruta/liquidacion-confirm`
- ❌ `POST /gf/logistics/api/employee/liquidacion/confirm`
- ❌ Cualquier `account.payment/create`, `sale.order/action_confirm`,
  `button_validate`, `route_close`, `route_return/accept`, etc.

## Casos de prueba

### TC-01 Login y carga de plan
**Pasos:**
1. Abrir KoldField en device.
2. Login con credenciales de vendedor de prueba.
3. Esperar a que cargue Home + tab Ruta.

**Esperado:**
- Login exitoso.
- Tab Ruta muestra plan del día con stops.
- `useRouteStore.plan.plan_id` poblado (verificable con dev tools si
  aplica, o por evidencia indirecta: plan visible en Ruta).

---

### TC-02 Abrir Corte de Caja
**Pasos:**
1. Tap tab Ventas (cart icon).
2. Buscar entrada/botón a "Corte de Caja" o navegación equivalente
   (ruta `/cashclose`).

**Esperado:**
- Pantalla "Corte de Caja" abre **sin crash**.
- Visible: TopBar "Corte de Caja" con back arrow.
- Visible: banner azul informativo con texto "Resumen informativo.
  Confirmacion de liquidacion pendiente de validar deploy backend."
- **NO** visible: banner amarillo "Corte de caja en desarrollo".

---

### TC-03 Cobranza real
**Pasos:**
1. En Cash Close, esperar a que cargue (puede mostrar "Cargando..." en
   sección Cobranza por unos ms).

**Esperado — sección "Cobranza / Liquidacion" muestra estas 7 líneas:**
- Efectivo esperado — monto $X.XX
- Crédito — monto $X.XX
- Transferencia — monto $X.XX
- Total cobrado — monto $X.XX
- Total esperado — monto $X.XX
- Diferencia cobranza — monto signado (`+`/`-`/`$0.00`) con color
  verde/rojo/neutral
- Total a Liquidar — monto $X.XX (en destacado azul)

**Validar también:**
- Sección "Resumen de venta": Total Vendido, Pedidos, Kg vendidos
  (de `useSalesStore.summary`).
- Sección "Operativo": Devoluciones = "Pendiente backend" en italic dim,
  Ops sincronizadas con conteo `N/M`.

---

### TC-04 Validación matemática
**Pasos:**
1. En Cash Close cargado, anotar valores numéricos.

**Esperado:**
- `Efectivo + Crédito + Transferencia ≈ Total cobrado`
  (tolerancia $0.01 por redondeo de toLocaleString)
- `Total cobrado − Total esperado = Diferencia cobranza`
  (con signo correcto)
- `Total a Liquidar === Efectivo esperado` (mismo número en pantalla)

> Si alguna no cuadra, capturar screenshot + nota: hay bug de mapping o
> backend está devolviendo dato inconsistente. **No avanzar TC-05+ hasta
> resolver**.

---

### TC-05 Efectivo físico menor
**Pasos:**
1. En sección "Efectivo en Mano", capturar un monto **menor** al
   "Efectivo esperado". Ej: si esperado $500, capturar `400`.

**Esperado:**
- Card "Diferencia física vs Efectivo esperado" muestra `-$100.00` en
  rojo (`#EF4444`).
- Hint debajo: "Positivo = sobrante, Negativo = faltante".

---

### TC-06 Efectivo físico mayor
**Pasos:**
1. Borrar input. Capturar monto **mayor** al esperado. Ej: $600.

**Esperado:**
- Diferencia muestra `+$100.00` en verde (`colors.success`).

---

### TC-07 Efectivo físico igual
**Pasos:**
1. Borrar input. Capturar monto **igual** al esperado. Ej: $500.

**Esperado:**
- Diferencia muestra `$0.00` en color neutral (`colors.text`).

---

### TC-08 Sin endpoint / error backend
**Pasos:**
1. Activar modo avión en device O desconectar wifi/datos.
2. Salir de Cash Close y volver a entrar para forzar refetch.

**Esperado:**
- Sección "Cobranza / Liquidacion" NO muestra montos numéricos.
- Las 7 líneas de cobranza muestran **"No disponible"** en italic dim.
- Card roja inline DENTRO de la sección con:
  - Texto: "Liquidación no disponible en backend"
  - Subtexto: el `error.message` del fetch (network error u otro)
  - Botón **"Reintentar"** que reinvoca `loadLiquidation()`.
- Sección "Resumen de venta" puede o no mostrar valores según sales tenga
  cache (es independiente).
- Diferencia física también muestra "No disponible" (porque depende de
  `liquidation.payments.cash.total` que no existe).
- **NO** se muestran cash/credit/transferencia con valores 0 falsos.
- **NO** se cae a `summary.cash_amount_total` o `summary.credit_amount_total`
  (esos están hardcoded a 0 en backend, sería falsamente correcto).

**Restaurar conexión** y tap "Reintentar" → datos vuelven, "No disponible"
desaparece.

---

### TC-09 Sin ventas
**Pasos:**
1. Login con vendedor sin ventas hoy (o limpiar el plan del día), o
   probar usuario que recién empieza turno.
2. Abrir Cash Close.

**Esperado:**
- Card neutra: "Sin ventas registradas hoy".
- Sección "Resumen de venta": Total Vendido $0.00, Pedidos 0, Kg 0.0 kg.
- Sección "Cobranza / Liquidacion": si plan existe pero sin pagos,
  todas las líneas en $0.00 (no "No disponible"); si no hay plan, fallback
  "No disponible" como en TC-08.
- Diferencia física funciona igual: con expected = $0, capturar cualquier
  cantidad da diferencia positiva.

---

### TC-10 No mutaciones
**Pasos:**
1. Recorrer toda la pantalla Cash Close arriba/abajo.

**Esperado:**
- **NO existe** botón "Confirmar Liquidación".
- **NO existe** botón "Confirmar Corte".
- **NO existe** botón "Cerrar Corte".
- **NO existe** botón "Liquidar".
- Único botón funcional en la pantalla (además del back arrow): "Reintentar"
  (sólo aparece cuando hay `liquidationError`, y sólo reinvoca lectura).
- Footer aclara: "Fuente de cobranza: /pwa-ruta/liquidation
  (account.payment por bucket). La confirmacion final se habilitara cuando
  se valide el deploy backend. El supervisor revisara las diferencias
  mayores a $50."

**Validar a nivel red (opcional, con proxy/charles si aplica):**
- Al abrir Cash Close se ven sólo dos requests:
  - `POST /gf/logistics/api/employee/sales/summary`
  - `POST /gf/logistics/api/employee/sales/list`
  - `POST /pwa-ruta/liquidation`
- Al capturar efectivo en input: **cero** requests (es local).
- Al tap Reintentar: sólo el `POST /pwa-ruta/liquidation` se reenvía.
- **Cero** llamadas a `liquidacion-confirm`, `corte-confirm`,
  `validate-corte`, `account.payment/create`, `payments/create`, etc.

## Evidencia a capturar

Por TC ejecutado:

1. **Screenshot 1** — Cash Close cargado completo (TC-03). Visible las 4
   secciones y los 7 valores de Cobranza.
2. **Screenshot 2** — Diferencia física (uno por TC-05, TC-06, TC-07).
3. **Screenshot 3** — Estado error con "No disponible" + botón Reintentar
   (TC-08).
4. **Screenshot 4** — Estado sin ventas (TC-09).
5. **Logs** del device (si aplica `adb logcat | grep koldfield` o export
   desde menú): se debe ver el `[api] http_request` con `url: ...
   /pwa-ruta/liquidation` y el response correspondiente.

## Criterio de aprobación

✅ Para mergear:
- `npm run typecheck` → PASS (verificado pre-commit)
- `npm test` → PASS 36/36 (verificado pre-commit)
- TC-01 a TC-10 todos pasan en device real con sesión real
- TC-04 (validación matemática): los 3 chequeos cuadran
- TC-08: cuando backend no responde, NO hay cash/credit falsos visibles
- TC-10: cero botones de mutación, cero requests mutantes en red

❌ Bloqueantes que paran el merge:
- Cualquier TC con efectivo/crédito mostrando valores que no vienen de
  `/pwa-ruta/liquidation` (por ejemplo, si caen a `summary.cash_amount_total
  = 0` falsamente).
- Cualquier llamada de red a un endpoint de mutación (`*-confirm`,
  `payments/create`, etc.).
- Crash al abrir la pantalla con plan/sin plan.
- Botón "Confirmar Liquidación" o equivalente visible.
- Devoluciones mostrando un número en lugar de "Pendiente backend".

## Pendientes backend (no bloquean este QA, pero se documentan)

1. **Devoluciones del día** — pedir a Sebas crear endpoint
   `POST /gf/logistics/api/employee/returns/summary` que devuelva totales
   por método de pago para cerrar el "Pendiente backend".
2. **`get_kold_sales_summary` en `sale_order.py`** devuelve
   `cash_amount_total: 0.0` y `credit_amount_total: 0.0` HARDCODED (L256-257
   del snapshot `gf_logistics_ops`). Para esta pantalla NO bloquea (usamos
   `/pwa-ruta/liquidation`), pero sería útil para la tab Sales y otros
   consumidores. Issue separado.
3. **Confirmación de liquidación** — endpoint `/pwa-ruta/liquidacion-confirm`
   está deployado (probe 2026-04-27 confirmado). UX/QA del flow
   (botón + validación de diferencia + force=true + idempotencia leyendo
   `liquidacion_done_at`) se evaluará en rama separada
   `feat/cashclose-confirm-flow` después de aprobar este QA.

## Referencias

- **Branch:** `feat/cashclose-liquidation-summary`
- **Commit base:** `fb0ca37` (cashclose + wrapper) + commit del doc
- **Wrapper:** `src/services/gfLogistics.ts::fetchLiquidationSummary`
- **Pantalla:** `app/cashclose.tsx`
- **Backend handler:** snapshot
  `tmp/route_request_phase/_refs/gf_logistics_ops/controllers/gf_api.py`
  `_handle_liquidation` (L2877) + `gf_route_plan.py`
  `build_liquidation_summary` (L804-844)
- **Verificación deploy:** probe HTTP 200 sin auth devolvió envelope
  `{ok:false, message:"Token de empleado requerido."}` (2026-04-27).
