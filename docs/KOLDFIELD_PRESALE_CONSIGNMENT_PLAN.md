# KoldField — Preventa & Consignación

**Rama:** `feat/koldfield-presale-consignment` (desde `main`)
**Estado:** Preventa MVP (frontend) implementado, **gated** por backend. Consignación **documentada, no implementada**.

---

## PARTE 1 — PREVENTA (MVP frontend)

### Alcance MVP
- Acción **"📅 Preventa"** en el menú general de Ruta (junto a Visita especial / Nuevo Lead).
- Seleccionar **cliente existente** (búsqueda reutilizando `searchOffrouteEntities`).
- **Lead bloqueado** en MVP: si se toca un prospecto → "Este prospecto debe convertirse a cliente antes de hacer preventa." (controlado por `PRESALE_LEAD_SUPPORTED`).
- Selección de **productos** con el mismo `ProductPicker` (vía nuevo prop `onAddLine` → carrito local, sin tocar el carrito de visita).
- **Carrito + totales** reutilizando `SaleLineItem` y el mismo cálculo (sin IVA).
- **Fecha de entrega** (`commitment_date`) con input `AAAA-MM-DD` + chips rápidos (+1d/+3d/+7d), validada (no pasado, formato, fecha real).
- **Resumen** y **Confirmar**.
- Debe crear una **cotización en Odoo (draft)**, mostrar folio. **NO** checkout, **NO** pago, **NO** inventario de ruta, **NO** liquidación.

### Qué NO hace
- No confirma la venta (es cotización).
- No cobra ni abre checkout.
- No descuenta inventario de la van.
- No entra a la liquidación del día.
- No soporta lead hasta que backend lo confirme.

### Contrato backend requerido (PENDIENTE — Sebas)
Hoy `POST /gf/logistics/api/employee/sales/create` **siempre** hace `action_confirm()` → no sirve para cotización. Se requiere **una** de:
- **Opción A (preferida):** nuevo endpoint `POST /gf/logistics/api/employee/presale/create` que cree `sale.order` en `draft` con `commitment_date`, **sin** confirmar, sin entrega, sin tocar inventario de ruta — reutilizando la lógica server-side de pricelist/analítica/almacén que ya tiene `_handle_sales_create`.
- **Opción B:** un flag `confirm=false` (o `as_quotation=true`) + `commitment_date` en `/sales/create`.

**Respuesta esperada:** `{ ok:true, data:{ sale_order_id, name } }`.
Errores funcionales como `{ ok:false, message }` (postRest ya lanza en `ok:false`).

### Payload propuesto (enviado por la app)
```json
{
  "operation_id": "presale-1717000000000-ab12cd",
  "partner_id": 123,
  "lead_id": null,
  "commitment_date": "2026-06-15",
  "lines": [
    { "product_id": 10, "quantity": 5, "price_unit": 25.0 }
  ],
  "employee_id": 45,
  "company_id": 1,
  "route_plan_id": 987,
  "source": "koldfield_presale"
}
```
- `operation_id`: idempotencia (como en ventas).
- `price_unit`: precio base sin IVA (igual que `SaleLineItem.price`).
- `partner_id` requerido en MVP; `lead_id` sólo si el backend lo soporta.

### Cómo se habilita
En `src/services/presale.ts`:
- `PRESALE_BACKEND_ENABLED = false` → flip a `true` cuando el endpoint esté desplegado.
- `PRESALE_LEAD_SUPPORTED = false` → flip a `true` si el backend acepta `lead_id`.
- `PRESALE_ENDPOINT` → confirmar la ruta exacta con Sebas.

Mientras `PRESALE_BACKEND_ENABLED=false`: la pantalla muestra banner "Preventa pendiente de habilitar en backend" y al confirmar lanza `PresaleNotEnabledError` → mensaje claro, **sin simular éxito ni crear nada**.

### Cómo probar
**Hoy (backend OFF):** Ruta → "📅 Preventa" → buscar/seleccionar cliente → agregar productos → fecha → "Confirmar preventa" → debe mostrar "Preventa no disponible / pendiente de habilitar". Verificar que un lead se bloquea con el mensaje de conversión.
**Cuando backend ON:** flip flags → "Confirmar" crea cotización y muestra folio; verificar en Odoo que queda `draft` con `commitment_date`, sin entrega ni movimiento de inventario.

---

## PARTE 2 — CONSIGNACIÓN (documentada, NO implementada)

### Por qué no se implementa todavía
No existe contrato backend: cero modelo/endpoint de consignación en `gf_logistics_ops`. Implementar por vía genérica (`/api/create_update` con picking/owner) sería frágil y puede **corromper inventario**. Por decisión de negocio, se deja **placeholder seguro** en `/stop/[id]` ("📦 Consignación (próximamente)" → aviso, no registra nada; sólo clientes de alta, no leads).

### Opciones backend
| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| **`gf.consignment` (recomendada inicial)** | Modelo propio: cliente, empleado, plan, almacén, líneas, fecha, estado | Trazable, claro, evita ambigüedad nativa | Requiere desarrollo + vistas + policy |
| Ubicación de consignación por cliente | `stock.location` tipo cliente + transfer | Nativo Odoo | Config por cliente, complejo |
| `stock.quant.owner_id` | Stock en poder del cliente vía owner | Nativo, sin venta | Reporting menos directo; setup |
| Picking interno | Transfer van → ubicación consignación | Mueve inventario real | No registra "acuerdo" comercial |

### Recomendación inicial
**Modelo propio `gf.consignment`** + endpoint `POST /gf/logistics/api/employee/consignment/create`, sujeto a validación de Sebas. Decidir si además mueve inventario (picking/owner) o sólo registra el acuerdo.

### Contrato mínimo requerido para implementar en KoldField
```json
{
  "operation_id": "...",
  "partner_id": 123,
  "lines": [{ "product_id": 10, "quantity": 5, "price_unit": 25.0 }],
  "employee_id": 45,
  "company_id": 1,
  "route_plan_id": 987,
  "warehouse_id": 7,
  "consignment_date": "2026-06-10",
  "source": "koldfield_consignment"
}
```
+ respuesta `{ ok:true, data:{ consignment_id, name } }` y, si aplica, policy en `os_api.generic_model_policies`.

### Preguntas de negocio pendientes
1. ¿Consignación **mueve inventario** de la van al consignar, o sólo registra acuerdo?
2. ¿Lleva **precio/valor** o sólo cantidades?
3. **Ciclo de liquidación:** ¿cómo se cierra (venta de lo vendido + retorno de lo no vendido)?
4. ¿Modelo propio `gf.consignment` o inventario nativo (owner/ubicación)?
5. ¿Quién consulta consignaciones (vendedor, supervisor) y dónde?

---

## Qué debe hacer Sebas (resumen)
1. **Preventa:** endpoint/flag de cotización en `draft` con `commitment_date` (Opción A o B). Confirmar ruta exacta y si soporta `lead_id`.
2. **Consignación:** definir modelo/flujo (recom. `gf.consignment`), endpoint, si mueve inventario, y responder las 5 preguntas.
3. Confirmar policies si alguno usa modelos genéricos.

## Estado de validación (esta rama)
- `npm run typecheck`: limpio (salvo `saleTicketPdf` pre-existente).
- `npm test`: 86/82/4 (4 pre-existentes: cashcloseSettlementFlow, httpTimeout). +`presaleLogic` en verde.
