# KoldField — QA de Consignación

**Rama:** `feat/koldfield-presale-consignment`
**Backend:** módulo `gf_consignment` (Sebas). Endpoints `/pwa-ruta/consignment/{my-active,create,visit,close}`.

> ⚠️ **Contrato ASUMIDO + BLOQUEADO:** el módulo backend no es accesible desde
> el repo de la app. Mientras `CONSIGNMENT_BACKEND_CONFIRMED = false` (en
> `src/services/consignment.ts`), las operaciones que afectan inventario/cobro
> (create/visit/close) **NO se ejecutan**: la app muestra "Consignación
> pendiente de validar con backend" y no registra nada. La UI sí es navegable.
> Flip a `true` SÓLO cuando Sebas confirme paths/payloads/respuestas (abajo).
> El parseo es defensivo y **no adivina** importes: el backend es la verdad.

---

## Contrato asumido (a confirmar con Sebas)

| Endpoint | Método | Request | Respuesta |
|---|---|---|---|
| `consignment/my-active` | GET | `?partner_id=N` | `{ok,data:{consignment_id,partner_id,state,name,lines:[{product_id,product_name,target_qty,theoretical_qty,price_unit,last_visit}],last_visit_date}}` o `data:null` |
| `consignment/create` | POST | `{operation_id,partner_id,lines:[{product_id,target_qty,price_unit}],employee_id,company_id,route_plan_id,source:'koldfield_consignment'}` | `{ok,data:{consignment_id,name}}` |
| `consignment/visit` | POST | `{operation_id,consignment_id,lines:[{product_id,physical_qty}],employee_id,route_plan_id}` | `{ok,data:{consignment_id,charged_amount,name}}` |
| `consignment/close` | POST | `{operation_id,consignment_id,lines:[{product_id,physical_qty}],employee_id,route_plan_id}` | `{ok,data:{consignment_id,charged_amount,returned_total,state}}` |

**Preguntas abiertas para Sebas** (ver final del doc).

---

## A. Crear consignación (cliente sin consignación activa)

- [ ] Abrir un **cliente de alta** desde Ruta → `/stop/[id]`.
- [ ] Ver y tocar **"📦 Consignación"**.
- [ ] (Lead: el botón NO debe aparecer.)
- [ ] La app consulta `my-active` → sin activa → muestra pantalla **"Nueva consignación"**.
- [ ] "+ Agregar" → ProductPicker → elegir producto + **cantidad objetivo**.
- [ ] Ver líneas con objetivo, precio del cliente y **Valor consignado** total.
- [ ] "Confirmar consignación" → `POST /pwa-ruta/consignment/create`.
- [ ] Éxito → "Consignación creada — Folio …" → vuelve al cliente.
- [ ] **Validar en Odoo:** se afectó **inventario de la unidad** (entrega inicial) y **NO** se cobró efectivo.

## B. Visitar consignación activa

- [ ] Abrir el mismo cliente → "📦 Consignación".
- [ ] La app muestra **líneas activas** (objetivo, teórico, precio, última visita).
- [ ] Capturar **existencia física** por producto.
- [ ] La app calcula **preliminar**: vendido = objetivo − físico; cobro = vendido × precio; resurtir = vendido.
- [ ] Ejemplo: objetivo 10, físico 4 → vendido 6, cobro = 6×precio, resurtir 6.
- [ ] "Registrar visita" → confirmar → `POST /pwa-ruta/consignment/visit`.
- [ ] Éxito → "Visita registrada — cobrado del faltante …" → recarga la consignación.
- [ ] **Validar en Odoo:** se creó **venta/cobro** por el faltante, **resurtido** al objetivo, e **inventario de unidad** afectado.

## C. Cerrar consignación

- [ ] En la consignación activa, tocar **"Cerrar consignación"**.
- [ ] Capturar **existencia física final**.
- [ ] La app muestra preliminar de **cobro del faltante** (y nota de devolución del resto).
- [ ] "Confirmar cierre" → `POST /pwa-ruta/consignment/close`.
- [ ] Éxito → "Consignación cerrada — cobrado …" → vuelve al cliente.
- [ ] **Validar en Odoo:** se **cobró el faltante**, se **devolvió/recuperó** el producto restante, y la consignación quedó en estado **cerrado**.

## D. Errores (no debe simular éxito)
- [ ] Sin conexión → pantalla "Requiere conexión" (no llama).
- [ ] Conteo físico faltante/ inválido → mensaje, no llama.
- [ ] Crear sin productos → mensaje.
- [ ] Error 400 / backend → muestra el mensaje del backend.
- [ ] Respuesta sin folio ni id en create → error claro (no falso éxito).
- [ ] Token/sesión inválida → error.

## E. No-regresión
- [ ] **Venta normal** (cliente → `/stop/[id]` → Venta → checkout).
- [ ] **Preventa** ("📅 Preventa" en menú general).
- [ ] **Venta fuera de plan / visita especial**.
- [ ] **Checkout** y **No venta**.
- [ ] **Cierre de ruta** (en la rama que lo incluya; N/A en esta base).
- [ ] El carrito de consignación NO contamina venta normal ni preventa.

---

## Preguntas abiertas para Sebas (confirmar contrato)
1. `my-active`: ¿query por `partner_id` (asumido) o también `stop_id`/`route_plan_id`?
2. `create`/`visit`/`close`: ¿nombres exactos de campos del payload?
3. ¿El backend **calcula** importes/vendido/resurtido (asumido) o espera que la app los mande?
4. **Pago/cobro:** ¿`visit`/`close` asumen **efectivo**, o hay que mandar `payment_method` (cash/transfer)?
5. ¿`visit` crea venta+cobro+resurtido automáticamente? ¿`close` crea cobro+devolución automáticamente?
6. ¿Respuesta incluye `charged_amount`/`returned_total` para mostrar al vendedor?
7. ¿`operation_id` es la clave de idempotencia (asumido) para visita/cierre?

Si alguno difiere, se ajusta **sólo** `src/services/consignment.ts`.
