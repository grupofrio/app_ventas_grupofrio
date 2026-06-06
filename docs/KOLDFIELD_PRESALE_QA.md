# KoldField — QA de Preventa

**Rama:** `feat/koldfield-presale-consignment` · **Commit:** `310255e`
**Estado backend:** `PRESALE_BACKEND_ENABLED = false` (registro de cotización aún no habilitado por Sebas).

> Checklist para validar en dispositivo/simulador que la Preventa está bien
> integrada y **no rompe ventas**. Marcar ✅/❌ y anotar hallazgos.

---

## 1. Acceso

- [ ] Entrar a la pestaña **Ruta**.
- [ ] Ver el botón **"📅 Preventa"** en la zona de acciones generales (junto a "🔍 Visita especial" y "📋 Nuevo Lead").
- [ ] Tocar "📅 Preventa" → abre la pantalla de Preventa (`/presale`).
- [ ] **Confirmar que Preventa NO aparece:**
  - [ ] dentro del pin del mapa,
  - [ ] dentro del cliente `/stop/[id]` como función de cliente.
  (Preventa es acción **general**, no de un cliente del plan.)

---

## 2. Cliente / lead

- [ ] En "1 · Cliente", escribir ≥2 caracteres y "Buscar".
- [ ] Seleccionar un **cliente existente** → queda fijado con badge "Cliente" y opción "Cambiar".
- [ ] Buscar un **lead/prospecto** (si aparece en resultados, con badge "Prospecto").
- [ ] Tocar el lead → **debe bloquear** con mensaje: *"Este prospecto debe convertirse a cliente antes de hacer preventa."*
- [ ] Confirmar que NO se puede continuar con un lead mientras esté bloqueado.

---

## 3. Productos

- [ ] Con cliente seleccionado, tocar "+ Agregar" en "2 · Productos".
- [ ] (Sin cliente, "+ Agregar" debe pedir seleccionar cliente primero.)
- [ ] Agregar productos con el **ProductPicker** (el mismo de venta).
- [ ] Confirmar que los **precios** se ven correctamente (precio por cliente si aplica).
- [ ] Agregar el mismo producto dos veces → la cantidad se **suma** (no se duplica la fila).
- [ ] Quitar un producto con la "✕".
- [ ] Ver el **Total (sin IVA)** actualizado.
- [ ] **No-contaminación:** sin salir, abrir una **venta normal** en un cliente del plan y confirmar que su carrito **NO** trae los productos de la preventa (carritos independientes).

---

## 4. Fecha de entrega

- [ ] En "3 · Fecha de entrega" ver una fecha por defecto (mañana, +1 día).
- [ ] Probar **fecha válida** futura (AAAA-MM-DD) → aceptada.
- [ ] Probar **fecha pasada** → al confirmar muestra "La fecha de entrega no puede ser en el pasado."
- [ ] Probar **formato inválido** (ej. `15-06-2026`) → "Fecha inválida (usa AAAA-MM-DD)."
- [ ] Probar **fecha inexistente** (ej. `2026-13-40`) → "Fecha inexistente."
- [ ] Probar chips **+1 / +3 / +7 días** → la fecha cambia correctamente (incluye cambio de mes/año).
- [ ] (Técnico) Se enviará como `commitment_date` en el payload.

---

## 5. Confirmación con backend APAGADO (estado actual)

- [ ] Banner visible arriba: **"⚠️ Preventa pendiente de habilitar en backend"**.
- [ ] Con cliente + productos + fecha válida, tocar **"Confirmar preventa"**.
- [ ] Debe mostrar: **"Preventa no disponible — pendiente de habilitar en el backend. No se creó ninguna cotización."**
- [ ] Confirmar que **NO**:
  - [ ] simula éxito / no muestra folio falso,
  - [ ] genera venta,
  - [ ] abre checkout,
  - [ ] registra pago,
  - [ ] afecta inventario de ruta,
  - [ ] entra a liquidación/corte.

---

## 6. No regresión (crítico)

Validar que **siguen funcionando igual** que antes:

- [ ] **Venta normal** (cliente del plan → `/stop/[id]` → Venta → checkout).
- [ ] **Venta fuera de plan** ("🔍 Visita especial" → cliente → venta).
- [ ] **Visita especial / lead** (flujo offroute).
- [ ] **Checkout** de visita.
- [ ] **No venta** con motivo + foto.
- [ ] **Ruta / mapa** (si se prueba sobre la rama de mapa; en esta rama el mapa es el estándar de main).
- [ ] **Cierre de ruta** (si la rama lo incluye; en esta rama base puede no estar — N/A).
- [ ] El **carrito de venta normal** no se ve afectado por haber usado Preventa.

---

## 7. Cuando Sebas habilite el backend

Pendiente hasta que exista el endpoint de cotización. Pasos:

1. En `src/services/presale.ts`:
   - [ ] `PRESALE_BACKEND_ENABLED = true`.
   - [ ] `PRESALE_ENDPOINT` = ruta exacta confirmada por Sebas.
   - [ ] `PRESALE_LEAD_SUPPORTED = true` **sólo si** el backend acepta `lead_id`.
2. Generar APK y crear una preventa real.
3. Validar en **Odoo**:
   - [ ] se creó un **`sale.order` en estado `draft`** (cotización),
   - [ ] tiene **`commitment_date`** = la fecha capturada,
   - [ ] **NO** está confirmado (no `sale`/`done`),
   - [ ] **NO** generó entrega ni movió inventario de la ruta,
   - [ ] **NO** entró a liquidación/corte del día,
   - [ ] el **folio/nombre** devuelto coincide con el que muestra la app.
4. Si se habilitó lead: validar el flujo de preventa a prospecto según contrato.

---

## Payload que enviará la app (referencia)
```json
{
  "operation_id": "presale-…",
  "partner_id": 123,
  "lead_id": null,
  "commitment_date": "2026-06-15",
  "lines": [{ "product_id": 10, "quantity": 5, "price_unit": 25.0 }],
  "employee_id": 45,
  "company_id": 1,
  "route_plan_id": 987,
  "source": "koldfield_presale"
}
```

## Notas
- Detalle completo de contrato/endpoint y de Consignación en
  `docs/KOLDFIELD_PRESALE_CONSIGNMENT_PLAN.md`.
- Riesgo conocido: foto/tamaño y dependencias de mapa NO aplican a Preventa.
- Pre-existentes (no de esta rama): typecheck `saleTicketPdf`; 4 tests
  `cashcloseSettlementFlow` + `httpTimeout`.
