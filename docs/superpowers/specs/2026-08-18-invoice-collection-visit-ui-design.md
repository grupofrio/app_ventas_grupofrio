# Kold Field: Cobro por factura desde la visita — diseño

**Fecha:** 2026-08-18
**Estado:** aprobado para planificación
**Alcance:** frontend móvil; consume el contrato Invoice Collection ya integrado en GF `main`.

## Objetivo

Cerrar la acción **Cobrar** como una acción de la parada actual. El vendedor
selecciona una factura abierta concreta, registra un abono parcial o total y
selecciona efectivo, transferencia o cheque. La autoridad contable permanece
en GF: el cliente no envía partner, empresa, diario, línea de método, empleado
ni plan.

No se crea una pestaña de navegación ni un flujo de cobro manual paralelo.

## Navegación y datos

- La acción desde una parada navega a `collect/[stopId]`; no recibe
  `partnerId` como autoridad.
- La pantalla lee el bundle del día cifrado para esa sesión y toma únicamente
  `invoice_snapshots` de ese `stop_id`.
- Antes de persistir o enviar un cobro, la acción exige el gate de bundle
  actual que habilita mutaciones. Un bundle stale puede orientar al vendedor,
  pero no permite capturar una operación de dinero.
- Si el bundle no tiene un snapshot válido de la parada, la pantalla informa
  que no hay facturas disponibles para cobrar y ofrece reintentar la
  preparación/sincronización del día. No consulta clientes ni facturas por
  rutas legacy.
- Un snapshot es guía de selección y UX, no una autorización ni un saldo
  definitivo. El servidor vuelve a validar al registrar el abono.
- Las respuestas HTTP de GF se interpretan únicamente mediante su envelope
  `{ok, code, status, data}`. Las facturas están en `data.invoices` y el
  resultado de cobro en `data.state`; nunca se tratan los campos de `data`
  como si estuvieran en la raíz.

## Flujo visible

1. Se muestra el cliente de la parada, las facturas abiertas del snapshot y el
   saldo de cada una.
2. El vendedor elige exactamente una factura. La pantalla precarga el saldo,
   pero permite un abono mayor que cero y menor o igual al saldo del snapshot.
3. El vendedor selecciona `cash`, `transfer` o `check`.
4. Al confirmar se crea un `operation_id` UUID v4 estable y el intent se
   persiste de forma cifrada y serializada antes del primer envío.
5. Con conexión, se muestra progreso y se llama al endpoint Bearer estricto.
   `applied` muestra confirmación; `review_required` muestra revisión
   requerida y conserva la evidencia local.
6. Sin conexión, o ante timeout/5xx/408/429, se muestra
   **Pendiente de confirmación**. No se declara pago aplicado ni se emite
   recibo. El vendedor puede continuar la ruta.
7. Al reabrir la app o recuperar conexión, el reconciliador existente reintenta
   sólo los intents pendientes con el mismo UUID. No usa la cola genérica.
8. Si ya existe un intent no terminal (`dispatching`, `pending` o
   `review_required`) para esa misma parada y factura, la UI
   muestra su estado y no crea otro UUID ni otro cobro. `pending` reutiliza su
   reconciliación; `review_required` permanece visible para revisión humana.
9. Tras `applied`, la pantalla deja de aceptar otra selección con el snapshot
   anterior: actualiza el bundle o sale de la acción hasta que haya datos
   frescos.

## Estados y mensajes

| Estado | Significado visible | Acción posterior |
| --- | --- | --- |
| `applied` | Abono confirmado por servidor | Actualizar/revalidar datos del día cuando corresponda |
| `pending` | Pendiente de confirmación, sin recibo | Reconciliación automática con el UUID original |
| `review_required` | El saldo, scope o configuración cambió; requiere revisión | No reintentar automáticamente ni ocultar el intent |
| `reauth_required` | Debe iniciar sesión de nuevo | Conserva UUID y binding cifrados; persiste sólo la señal de reautenticación para impedir replays con token revocado |

Un pendiente no bloquea iniciar la siguiente visita. Los pendientes y revisiones
de dinero sí participan en el gate de liquidación/cierre, no en la navegación
normal de ruta. El resumen de estos intents es dedicado; no se mezclan con la
cola genérica.

## Recuperación de sesión y conectividad

- Ante `reauth_required`, la UI indica explícitamente **Inicia sesión de
  nuevo**. La reautenticación del mismo empleado y compañía conserva/migra
  exclusivamente los intents de cobranza cifrados y sus UUID originales hacia
  la nueva sesión; al cambiar de empleado o compañía se conserva el borrado
  destructivo y no se migra evidencia entre cuentas.
- Un `reauth_required` producido por reconciliación en segundo plano persiste
  esa señal visible sobre el intent (sin cambiar UUID ni binding) y ofrece la
  misma acción de inicio de sesión que una captura en primer plano. Tras un
  handoff de mismo principal, vuelve a ser pendiente para reintentar con el
  UUID original.
- Si la escritura del estado del intent falla tras un 401, se persiste un
  **latch de sesión de reautenticación** separado del record de cobranza. Ese
  latch bloquea bootstrap y replay tras reinicio hasta que se renueve la
  credencial; no contiene importe, factura ni datos de cobro. Sólo después del
  handoff seguro de mismo principal se limpia y vuelve a permitir el UUID
  original.
- El arranque no envía intents antes de conocer conectividad. La reconciliación
  de red se programa después de inicializar NetInfo/estado real y nunca bloquea
  rehydration ni la entrada a ruta en modo avión.
- Los estados visibles usan exactamente: **Confirmado**, **Pendiente de
  confirmación**, **Revisión requerida** e **Inicia sesión de nuevo**. Ningún
  estado pendiente presenta recibo, pago confirmado o fallo definitivo.

## Contrato móvil

El único POST permitido es:

```ts
{
  operation_id: UUIDv4,
  stop_id: number,
  invoice_id: number,
  amount: number,
  payment_method: 'cash' | 'transfer' | 'check',
}
```

Se envía exclusivamente a
`/gf/logistics/api/employee/payments/collect` con `Authorization: Bearer`.
El endpoint de facturas abiertas acepta exclusivamente `stop_id`.

No se revive `payments/create`, el control legacy de `collectPaymentIntent`,
un `payment` de la cola genérica, ni `updateLocalStock`.

## Integridad

- El intent incluye saldo y timestamp del snapshot sólo para UX local; esos
  campos no entran al cuerpo REST.
- La escritura cifrada es el punto de commit local. Si falla, la pantalla no
  afirma que guardó ni envía una solicitud.
- Un doble toque y dos capturas concurrentes de la misma factura convergen en
  el intent efectivo persistido y su mismo `operation_id`.
- Si GF confirma pero falla el ACK cifrado local, tras reinicio se repite ese
  UUID; la UI no publica `applied` antes de que el ACK sea durable.
- Reiniciar después de un timeout conserva y reutiliza el intent no terminal
  de esa factura; no permite otro intento paralelo con un UUID nuevo.
- Tras una respuesta perdida, el servidor recupera por UUID y devuelve el
  resultado estable. No hay heurísticas por importe ni tokens de revisión
  inventados.
- La forma de pago visible es el código permitido; el servidor la mapea a su
  diario y línea inbound configurados.

## Fuera de alcance

- Nueva UX de corte/liquidación, recibos, contabilidad offline o cobro manual.
- Cambios en el contrato GF #110 ya integrado.
- Prospección/Datos, consignación, devolución, carga/recarga y rutas ajenas.

## Verificación requerida

- Pruebas puras para selección, límites de abono, UUID estable y copy de cada
  estado.
- Pruebas de wiring que impidan transportes legacy y comprueben `stop_id`.
- Pruebas de persistencia: write antes de envío, restart, doble toque,
  timeout/reintento y `review_required` sin reintento.
- `npm test`, `npm run typecheck` y `git diff --check`.
- Antes del piloto: prueba física Android con online, modo avión, kill/restart,
  respuesta perdida y cierre de jornada.
