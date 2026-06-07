# KoldField — QA de Preventa

**Rama:** `feat/koldfield-presale-consignment`
**Estado backend:** `PRESALE_BACKEND_ENABLED = true` — endpoint LIVE `POST /pwa-ruta/presale-create` (crea cotización `sale.order` en `draft`). Leads bloqueados (`PRESALE_LEAD_SUPPORTED = false`).

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

## 5. Confirmación con backend ACTIVO (estado actual)

- [ ] (Ya NO debe aparecer el banner de "pendiente de habilitar".)
- [ ] Con cliente + productos + fecha válida, tocar **"Confirmar preventa"**.
- [ ] Llama `POST /pwa-ruta/presale-create`.
- [ ] Éxito → mensaje **"Preventa creada como cotización S01234."** con folio real.
- [ ] El carrito/formulario se **limpia** tras éxito; botón **"Volver a Ruta"**.
- [ ] Confirmar que **NO**:
  - [ ] abre checkout,
  - [ ] registra pago,
  - [ ] afecta inventario de ruta,
  - [ ] entra a liquidación/corte.
- [ ] Validar en **Odoo** que se creó `sale.order` en `draft` con `commitment_date` (ver §7).

### Errores a verificar (no debe simular éxito)
- [ ] Sin conexión → "Conéctate para registrar la preventa." (no llama).
- [ ] Fecha pasada/ inválida → mensaje de fecha, no llama.
- [ ] Sin cliente / sin productos → mensaje, no llama.
- [ ] Error 400 / payload → muestra el mensaje del backend.
- [ ] Token/sesión inválida → muestra error, no crea.
- [ ] Respuesta sin `sale_order_id` ni `name` → "El servidor no devolvió la cotización…" (no falso éxito).
- [ ] Error de red → mensaje claro.

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

## 7. Validación en Odoo (backend ya disponible)

Tras crear una preventa real desde el APK:
- [ ] se creó un **`sale.order` en estado `draft`** (cotización),
- [ ] tiene **`commitment_date`** = la fecha capturada en la app,
- [ ] **NO** está confirmado (no `sale`/`done`),
- [ ] **NO** generó entrega ni movió inventario de la ruta,
- [ ] **NO** entró a liquidación/corte del día,
- [ ] el **folio/nombre** (`data.name`) coincide con el que mostró la app,
- [ ] (idempotencia) reintentar con el mismo `operation_id` no duplica la cotización.

**Leads (futuro):** cuando el backend soporte `lead_id`, poner
`PRESALE_LEAD_SUPPORTED=true` y validar el flujo de preventa a prospecto.

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
