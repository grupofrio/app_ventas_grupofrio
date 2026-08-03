# Alta independiente de leads de campo

## Objetivo

Permitir que la pantalla **Nuevo Lead** cree un registro `crm.lead` en Odoo
sin depender de una parada de ruta ni crear automáticamente un `res.partner`.

## Contexto

La app encola el formulario como una operación `prospection` y la envía a
`/gf/logistics/api/employee/lead/upsert`. Ese endpoint está reservado para el
flujo posterior a una visita: exige `stop_id` y `stage_id`, termina asociando
la oportunidad a un partner y actualiza la parada. Un lead capturado desde el
menú general no tiene ninguna de esas entidades, por lo que la solicitud se
rechaza antes de crear el lead.

## Alternativas consideradas

1. Adaptar la app para inventar una parada y usar `lead/upsert`.
   Se descarta: mezcla una alta general con el flujo de conversión de una ruta
   y puede crear clientes o afectar el plan incorrectamente.
2. Ampliar `lead/upsert` con bifurcaciones según `_source`.
   Se descarta: el contrato quedaría ambiguo y una regresión podría saltarse
   controles propios de una parada.
3. Añadir `POST /gf/logistics/api/employee/lead/create` para la alta general.
   Es la opción elegida: el endpoint tiene un contrato pequeño y separa de
   forma explícita la creación independiente de la actualización de ruta.

## Contrato del endpoint

La app enviará una petición REST plana autenticada por
`X-GF-Employee-Token` a:

```
POST /gf/logistics/api/employee/lead/create
```

Campos de entrada:

| Campo | Requerido | Uso |
| --- | --- | --- |
| `customer_name` | Sí | Nombre comercial y `crm.lead.name`. |
| `contact_name` | No | Contacto del prospecto. |
| `phone` | No | Teléfono del lead. |
| `mobile` | No | Celular del lead. |
| `street` | No | Dirección del lead. |
| `description` | No | Giro, canal y notas legibles. |
| `latitude`, `longitude` | No | Coordenadas del lead. |
| `giro`, `x_canal`, `x_source_channel`, `x_prospect_source` | No | Metadatos de prospección. `x_canal` es un código de entrada que el backend normaliza a `channel_id`; nunca se escribe directamente como campo legacy. |
| `operation_id` | Sí | UUID estable de la operación de cola; llave de idempotencia. |
| `_client_meta` | No | Tiempos y metadatos de dispositivo; no es necesario para la idempotencia. |

La cola inyecta `_operationId` al persistir la operación. La app lo transforma
en `operation_id` al llamar al endpoint nuevo. El servidor guarda ese UUID en
un campo técnico de `crm.lead` y, si recibe de nuevo el mismo UUID dentro de la
misma compañía, devuelve el mismo lead con `duplicate: true` sin crear otro.
`_client_meta.x_client_op_uuid` se envía únicamente cuando su bandera global
esté activa y es información adicional, no la fuente de verdad.

El servidor determina la compañía objetivo y plaza analítica a partir del
empleado autenticado. Asigna una etapa inicial configurada para esa compañía,
crea un `crm.lead` de tipo `lead`, no crea ni modifica un partner y devuelve:

```
{ "ok": true, "message": "Lead creado", "data": {
  "lead": { "id": 123, "name": "...", "type": "lead", "stage_id": [1, "Nuevo"] },
  "operation_id": "...",
  "duplicate": false
} }
```

Los errores de autorización, configuración de plaza, falta de nombre o falta
de etapa inicial se devuelven como `ok: false` con uno de los códigos
`access_denied`, `scope_not_configured`, `validation_error` o
`configuration_error`; no crean registros.

El backend resolverá `x_canal` a través de `gf.sales.channel` y escribirá solo
`channel_id`. El catálogo vigente no contiene `INDUSTRIAL`: tanto la app como
el normalizador del backend lo tratarán como el alias histórico de
`DISTRIBUIDOR`, para que los leads de giro Industria no sean rechazados.

## Cambios en app

`buildProspectionPayload` conservará las claves actuales de interfaz, pero
agregará los nombres del contrato canónico: `customer_name` y `phone`.
La opción de giro Industria emitirá el canal vigente `DISTRIBUIDOR`.
`upsertLeadData` se dividirá en una llamada `createFieldLeadData`, destinada
solo a `Nuevo Lead`; el flujo de post-visita continuará usando `lead/upsert`.
El dispatcher de `prospection` seleccionará el endpoint de alta cuando
`_source === 'nuevo_lead_ruta'`.

El aviso inmediato del formulario se cambiará a **"Lead guardado localmente"**
para no afirmar que Odoo ya lo creó. La pantalla de sincronización seguirá
mostrando cualquier rechazo del servidor.

## Errores e idempotencia

`operation_id` es obligatorio y se persiste en `crm.lead`; no se acepta una
creación sin una llave de idempotencia. Esto permite que un timeout, donde Odoo
sí creó el registro pero la app no recibió la respuesta, termine en una lectura
idempotente en el siguiente intento.

Las respuestas `ok: false` son rechazos definitivos y `postRest` conserva su
`code`; la cola no las reintenta porque ya recibió una respuesta del servidor.
Solo los errores de transporte y timeout permanecen reintentables con la
política actual. El código se muestra en los logs y el mensaje legible se
muestra en Sincronización.

## Pruebas de aceptación

1. Una solicitud válida sin `stop_id` crea exactamente un `crm.lead` tipo
   `lead`, con compañía, plaza, etapa, dirección y coordenadas correctas.
2. La creación no genera ni modifica un `res.partner` ni una `gf.route.stop`.
3. Un nombre vacío, una plaza no configurada o una etapa inicial ausente no
   crean registros y devuelven un error explícito.
4. La app manda `customer_name` y `phone` al endpoint nuevo y no enruta el
   payload de `nuevo_lead_ruta` a `lead/upsert`.
5. El formulario comunica que el registro está pendiente hasta que se
   sincronice.
6. Un giro Industria se guarda como `channel_id.code == 'DISTRIBUIDOR'`, sin
   intentar escribir el campo legacy `x_canal`.

## Fuera de alcance

- Convertir el lead a cliente o venderle desde esta pantalla.
- Crear una parada de ruta para un lead nuevo.
- Migrar elementos ya fallidos de la cola; se podrán reenviar tras la versión
  que incluya el endpoint.
