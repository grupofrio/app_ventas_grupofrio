# KoldField — QA de Consignación

**Rama:** `feat/koldfield-presale-consignment`
**Backend:** módulo `gf_consignment` (Sebas) — **CONTRATO REAL CONFIRMADO**.
Endpoints `/pwa-ruta/consignment/{my-active,create,visit,close}` · `auth=api_key`.

> ✅ `CONSIGNMENT_BACKEND_CONFIRMED = true`. El frontend usa el contrato real.
> El backend es la **fuente de verdad** (inventario, venta/cobro, resurtido,
> devolución, cierre). La app manda conteos/objetivos + `price_unit` y muestra
> **preliminar**; la respuesta NO trae `sold_qty`/folio de venta → la app no
> depende de ellos. No simula éxito (postRest lanza en `ok:false`/HTTP≥400).

---

## Contrato real (implementado)

### GET `/pwa-ruta/consignment/my-active`
Query: `?partner_id=N` (requerido) `&company_id=M` (opcional). No usa route_plan_id/employee_id.
Respuesta: `{ ok, message, data:{ consignment: <obj> | false } }`.
Línea: `{ line_id, product_id, product_name, product_uom_id, price_unit, target_qty, current_qty, last_count_qty, active }`.

### POST `/pwa-ruta/consignment/create`
```json
{
  "partner_id": 123,
  "company_id": 1,
  "employee_id": 45,
  "route_plan_id": 987,
  "mobile_location_id": 55,
  "apply_inventory": true,
  "lines": [{ "product_id": 10, "target_qty": 10, "price_unit": 25.0 }]
}
```
(`vehicle_id`/`notes` opcionales — la app no tiene `vehicle_id` en el plan, se omite.)
Reglas: `partner_id`+`lines` requeridos; `apply_inventory=true` baja inventario y necesita `route_plan_id` **o** `mobile_location_id`. `price_unit` lo manda la app (precio cliente del ProductPicker; backend no calcula precio cliente todavía).

### POST `/pwa-ruta/consignment/visit` y `/close`
```json
{
  "consignment_id": 555,
  "operation_id": "consign-visit-...",
  "payment_method": "cash",
  "counts": [{ "product_id": 10, "physical_qty": 4, "target_qty": 10, "price_unit": 25.0 }]
}
```
- Se manda `payment_method` (NUNCA `method`). Default `cash`.
- `visit`: backend calcula `sold = max(target-físico,0)`, crea venta+pago, resurte, baja inventario por resurtido, deja `current_qty = target`.
- `close`: cobra faltante, registra devolución del físico restante (ubicación cliente → unidad), cierra y desactiva líneas.

### Respuesta create/visit/close
`{ ok, message, data:{ consignment:<obj completo con lines> } }`.
Mensajes: create `"Consignacion creada"`, visit `"Visita de consignacion registrada"`, close `"Consignacion cerrada"`.
**Limitación actual:** la respuesta NO trae `sale_order_id`, folio, `payment_id`, `picking_id`, importe ni `sold_qty` (están en `gf.consignment.move`, no serializados). La app muestra el **preliminar** antes de confirmar y el **mensaje del backend** después.

---

## A. Crear consignación (cliente sin consignación activa)
- [ ] Cliente **de alta** → `/stop/[id]` → **"📦 Consignación"** (lead: NO aparece).
- [ ] `my-active` (con `company_id`) → sin activa (`consignment:false`) → pantalla "Nueva consignación".
- [ ] "+ Agregar" → ProductPicker → producto + **cantidad objetivo** (precio = precio cliente).
- [ ] Si **no hay** `route_plan_id` **ni** `mobile_location_id` → **advertencia** antes de confirmar.
- [ ] "Confirmar consignación" → `POST create` con `apply_inventory:true`.
- [ ] Éxito → mensaje backend + folio → vuelve al cliente.
- [ ] **Odoo:** bajó **inventario de la unidad**; **NO** cobró efectivo.

## B. Visitar consignación activa
- [ ] Mismo cliente → "📦 Consignación" → muestra líneas (objetivo, actual, precio, últ. conteo, última visita).
- [ ] Capturar **existencia física** por producto.
- [ ] Preliminar en app: vendido = objetivo − físico; cobro = vendido × precio; resurtir = vendido (ej. obj 10, físico 4 → vendido 6).
- [ ] "Registrar visita" → confirmar (pago efectivo) → `POST visit` con `counts`+`payment_method:cash`.
- [ ] Éxito → mensaje backend → recarga consignación (líneas a `current_qty=target`).
- [ ] **Odoo:** venta/cobro por faltante, resurtido al objetivo, inventario de unidad afectado, entra a corte/liquidación (ligado a `gf_route_plan_id`).

## C. Cerrar consignación
- [ ] En activa → "Cerrar consignación" → capturar **existencia física final**.
- [ ] Preliminar de cobro del faltante (+ nota de devolución del resto).
- [ ] "Confirmar cierre" → `POST close` con `counts`+`payment_method:cash`.
- [ ] Éxito → mensaje backend → vuelve al cliente.
- [ ] **Odoo:** cobró faltante, devolvió/recuperó resto (cliente → unidad), consignación **cerrada**, líneas desactivadas.

## D. Errores (no debe simular éxito)
- [ ] Sin conexión → pantalla "Requiere conexión" (no llama).
- [ ] Conteo físico faltante/ inválido → mensaje, no llama.
- [ ] Crear sin productos → mensaje.
- [ ] Error 400/backend → muestra el mensaje real del backend.
- [ ] Token/sesión inválida → error.

## E. No-regresión
- [ ] **Venta normal** (cliente → Venta → checkout).
- [ ] **Preventa** ("📅 Preventa" en menú general) — intacta.
- [ ] **Venta fuera de plan / visita especial**.
- [ ] **Checkout**, **No venta**, **cierre/corte**.
- [ ] El carrito de consignación NO contamina venta normal ni preventa (carrito local).

---

## Pago
MVP usa sólo **`cash`** (entra al flujo de pago/caja del vendedor; ligado a
`gf_route_plan_id` → entra a corte/liquidación). `transfer`/`card`/`credit` quedan
fuera del selector hasta que corte/liquidación los soporte end-to-end.

## Riesgos abiertos
- La respuesta no expone importe/folio de venta → el vendedor ve el **preliminar** y
  el mensaje del backend, pero no el folio de la venta generada (deuda backend:
  serializar `gf.consignment.move`).
- `vehicle_id` no está en el plan de KoldField → se omite (opcional en backend).
- `mobile_location_id` depende de que el plan lo traiga; si falta y tampoco hay
  `route_plan_id`, se advierte (el backend no sabría de dónde bajar inventario).
