# Baja Controlada De Cliente Design

## Objetivo

Implementar un flujo trazable de baja controlada de cliente para que vendedores/repartidores reporten posibles bajas desde KOLD Field, una supervisora verifique en campo y corporativo Guadalajara apruebe, rechace, pida segunda verificacion o envie a recuperacion comercial.

La app nunca debe borrar clientes ni aplicar bajas directas. La unica aplicacion final ocurre despues de aprobacion corporativa, actualizando estados operativos/comerciales en Odoo y conservando ventas, facturas, contactos e historial.

## Contexto Del Repo

La app actual es Expo/React Native con `expo-router`, Zustand y servicios TypeScript. La integracion con Odoo usa endpoints REST bajo `gf/logistics/api/employee` y JSON-RPC/generic model helpers.

Piezas existentes relevantes:

- `src/types/plan.ts`: `GFPlan` y `GFStop` contienen `plan_id`, ruta, `customer_id`, estado de parada y datos de contacto.
- `src/services/gfLogistics.ts`: carga ruta/paradas y define operaciones REST de visita, venta, fotos y GPS.
- `src/stores/useSyncStore.ts`: cola offline persistente con `_operationId`, prioridades, reintentos, `dead`, dependencias y rehidratacion.
- `src/services/camera.ts`: captura fotos y guarda `localUri` persistente para subir despues.
- `src/services/gps.ts`: captura posicion y encola puntos GPS.
- `src/stores/useAuthStore.ts`: persiste `employeeId`, `companyId`, `parentId`, `isSupervisor` y permisos.
- `app/supervisor.tsx`: pantalla supervisora actual es mock, por lo que debe convertirse o complementarse con cola real.
- `src/services/routeIncidents.ts`: incidentes existentes no son suficientes para este workflow porque no tienen estados, evidencia, aprobaciones ni aplicacion controlada.

## Alcance

Incluido:

- Crear solicitud de baja desde una parada/cliente en la app.
- Capturar motivo, comentario obligatorio, GPS, fecha/hora, usuario, ruta, evidencia fotografica obligatoria para motivos criticos y contacto/persona consultada opcional.
- Soportar captura offline para solicitud y verificacion, con sincronizacion posterior.
- Evitar dos solicitudes abiertas para el mismo cliente.
- Mostrar indicador de "baja en revision" sin sacar automaticamente al cliente de la ruta.
- Cola real para supervisora con revisitas pendientes.
- Captura de verificacion por supervisora con GPS, foto, comentario y resultado.
- Revision/aprobacion/aplicacion corporativa desde Odoo web como primera version.
- Bitacora completa de cambios de estado y evidencia.

Fuera de alcance inicial:

- Borrar clientes, contactos, facturas o ventas historicas.
- Sacar automaticamente clientes de rutas antes de `applied`.
- Automatizar recuperacion comercial mas alla de marcar estado y exponer cola/accion en Odoo.
- Construir una app corporativa movil completa; corporativo usa Odoo en la primera version.

## Modelo Odoo

Crear modelo principal `gf.customer.deactivation.request`.

Campos base:

- `name`: folio secuencial.
- `company_id`: empresa obligatoria.
- `partner_id`: cliente `res.partner` obligatorio.
- `route_plan_id`: plan de ruta origen, opcional pero enviado si existe.
- `stop_id`: parada origen, opcional pero enviado si existe.
- `route_name`: texto de ruta para auditoria.
- `state`: estado del workflow.
- `reason`: motivo de solicitud.
- `client_operation_id`: idempotencia enviada por la app.
- `active`: archivado logico del workflow, no del cliente.

Solicitud inicial:

- `requested_by_employee_id`.
- `requested_by_user_id`, si aplica.
- `requested_at`.
- `request_comment`.
- `request_latitude`, `request_longitude`, `request_accuracy`.
- `request_photo_attachment_id` o relacion a evidencias.
- `request_contact_person`.

Verificacion supervisora:

- `supervisor_employee_id`.
- `supervisor_user_id`.
- `supervisor_verified_at`.
- `supervisor_result`.
- `supervisor_comment`.
- `supervisor_latitude`, `supervisor_longitude`, `supervisor_accuracy`.
- `supervisor_photo_attachment_id` o relacion a evidencias.

Decision corporativa:

- `corporate_user_id`.
- `corporate_decision`.
- `corporate_comment`.
- `corporate_decided_at`.
- `applied_at`.
- `applied_by_user_id`.

Evidencias:

- Puede usarse `ir.attachment` con `res_model='gf.customer.deactivation.request'`.
- Si se requiere metadato por evidencia, crear `gf.customer.deactivation.evidence` con `request_id`, `stage`, `attachment_id`, `latitude`, `longitude`, `accuracy`, `captured_by_employee_id`, `captured_at`, `comment`.

Bitacora:

- Usar `mail.thread` para cambios y crear `gf.customer.deactivation.log` si se necesita bitacora estructurada.
- Cada transicion debe registrar usuario, fecha/hora, estado anterior/nuevo, motivo, comentario, GPS si aplica y origen (`mobile`, `odoo`, `sync_retry`).

Constraint:

- No permitir mas de una solicitud abierta por `(company_id, partner_id)`.
- Estados abiertos: `reported`, `pending_revisit`, `supervisor_verified`, `corporate_review`, `second_visit_required`, `commercial_recovery`.
- Estados cerrados: `approved`, `rejected`, `applied`.

Extensiones a `res.partner`:

- `gf_deactivation_state`: estado resumido.
- `gf_under_deactivation_review`: boolean.
- `gf_operational_status`: `active`, `under_review`, `deactivation_approved`, `inactive_operational`, `commercial_recovery`.
- `gf_deactivation_request_id`: solicitud vigente/ultima.
- `gf_deactivation_applied_at`.
- No modificar `active` automaticamente en primera version, salvo decision explicita posterior.

## Motivos Y Resultados

Motivos de solicitud:

- `not_exists`: cliente ya no existe.
- `permanently_closed`: cerrado permanentemente.
- `does_not_want_buy`: no quiere comprar.
- `moved`: cambio de domicilio.
- `duplicate`: duplicado.
- `other`: otro.

Foto obligatoria para:

- `not_exists`.
- `permanently_closed`.

Resultados de supervisora:

- `confirmed_not_exists`.
- `confirmed_does_not_want_buy`.
- `confirmed_moved`.
- `not_confirmed`.
- `second_visit_required`.
- `keep_active`.
- `commercial_recovery`.

Decisiones corporativas:

- `approve_deactivation`.
- `reject_deactivation`.
- `request_second_verification`.
- `keep_active`.
- `commercial_recovery`.

## Estados Y Transiciones

Estados:

- `reported`: solicitud creada por vendedor/repartidor.
- `pending_revisit`: lista para revisita de supervisora.
- `supervisor_verified`: verificacion capturada.
- `corporate_review`: lista para corporativo Guadalajara.
- `approved`: baja aprobada, pendiente de aplicacion si se separa el paso.
- `rejected`: baja rechazada.
- `second_visit_required`: corporativo o supervisora pidio otra verificacion.
- `commercial_recovery`: enviada a recuperacion comercial.
- `applied`: baja aplicada operativamente.

Transiciones permitidas:

- vendedor/repartidor: crear `reported` o `pending_revisit`.
- backend: puede normalizar `reported -> pending_revisit` al aceptar la solicitud.
- supervisora: `pending_revisit -> supervisor_verified`, `pending_revisit -> second_visit_required`, `pending_revisit -> commercial_recovery`, `pending_revisit -> rejected` si se define "mantener activo" como cierre.
- backend: `supervisor_verified -> corporate_review`.
- corporativo: `corporate_review -> approved`, `rejected`, `second_visit_required`, `commercial_recovery`.
- corporativo: `approved -> applied`.
- corporativo/supervisora: `second_visit_required -> pending_revisit` al asignar nueva revisita.

## Endpoints

Endpoints de vendedor/repartidor:

- `POST /gf/logistics/api/employee/customer-deactivation/request`
  - Crea solicitud con payload offline-friendly e idempotente.
  - Devuelve solicitud creada o solicitud abierta existente si el `client_operation_id` ya fue aplicado.
  - Si existe otra solicitud abierta para el cliente, devuelve conflicto funcional con datos resumidos.

- `GET /gf/logistics/api/employee/customer-deactivation/open?partner_id=N`
  - Permite a la app mostrar badge/estado vigente.

Endpoints de supervisora:

- `GET /gf/logistics/api/supervisor/customer-deactivation/revisits`
  - Lista solicitudes `pending_revisit` y `second_visit_required` visibles para su equipo/empresa.

- `POST /gf/logistics/api/supervisor/customer-deactivation/<id>/verify`
  - Registra verificacion, evidencia y transicion.
  - Idempotente por `client_operation_id`.

Endpoints corporativos:

- `GET /gf/logistics/api/corporate/customer-deactivation/review`
  - Lista `corporate_review`.

- `POST /gf/logistics/api/corporate/customer-deactivation/<id>/decide`
  - Aprueba, rechaza, pide segunda verificacion, mantiene activo o envia a recuperacion.

- `POST /gf/logistics/api/corporate/customer-deactivation/<id>/apply`
  - Aplica baja operativa despues de aprobacion.

## Payloads App

Solicitud:

```json
{
  "client_operation_id": "customer_deactivation_request_<uuid>",
  "partner_id": 123,
  "stop_id": 456,
  "route_plan_id": 789,
  "route_name": "R-Norte",
  "company_id": 34,
  "reason": "not_exists",
  "comment": "Local vacio, vecinos indican cierre definitivo",
  "contact_person": "Vecino del local contiguo",
  "latitude": 20.0,
  "longitude": -103.0,
  "accuracy": 18,
  "captured_at": "2026-07-01T10:30:00-06:00",
  "photo_base64": "..."
}
```

Verificacion:

```json
{
  "client_operation_id": "customer_deactivation_verify_<uuid>",
  "request_id": 987,
  "result": "confirmed_not_exists",
  "comment": "Se confirma local cerrado sin actividad",
  "latitude": 20.0,
  "longitude": -103.0,
  "accuracy": 12,
  "verified_at": "2026-07-01T12:00:00-06:00",
  "photo_base64": "..."
}
```

La cola de la app debe guardar `localUri` de foto, no base64. El servicio de sync lee el archivo y arma el base64 solo al enviar.

## Cambios En App

Tipos y servicios:

- Crear `src/types/customerDeactivation.ts`.
- Crear `src/services/customerDeactivationLogic.ts` con catalogos, validaciones, copy y helpers puros.
- Crear `src/services/customerDeactivation.ts` para llamadas REST.
- Agregar `customer_deactivation_request` y `customer_deactivation_verification` a `SyncItemType` y `SYNC_PRIORITY_MAP`.
- Extender `processSyncItem` con dispatchers para ambos tipos.

Pantallas:

- Crear `app/customer-deactivation/[stopId].tsx` para solicitud desde vendedor/repartidor.
- Crear `app/supervisor-deactivation.tsx` o reemplazar `app/supervisor.tsx` con una cola real de revisitas.
- Agregar entrada desde `app/stop/[stopId].tsx` con boton secundario "Reportar posible baja".
- Agregar badge en tarjeta de parada/lista si `GFStop` trae solicitud abierta.

Estado local:

- Extender `GFStop` con campos opcionales:
  - `deactivation_request_id`.
  - `deactivation_state`.
  - `deactivation_reason`.
  - `deactivation_under_review`.
- Al crear solicitud offline, parchear el stop local como `deactivation_under_review=true` para evitar duplicados visuales.
- No cambiar `stop.state` a `done` ni sacar de ruta por solicitud de baja.

Sync:

- Solicitud y verificacion son P1 por impacto operativo.
- Cada item debe tener `client_operation_id` estable y `_operationId`.
- Si el backend responde conflicto por solicitud abierta, el item debe tratarse como exito funcional si la solicitud abierta equivale al mismo cliente y la app puede actualizar el estado local.
- No usar el tipo generico `photo`; la foto viaja dentro del payload de baja para que la evidencia no quede separada de la solicitud/verificacion.

## Cambios En Odoo

Modulo sugerido: extender `gf_logistics_ops` o crear submodulo `gf_customer_deactivation`.

Backend:

- Modelo, security groups y record rules.
- Secuencias y constraints.
- Controladores REST.
- Adjuntos/evidencias.
- Transiciones con validacion de rol.
- Aplicacion final a `res.partner`.
- Campos resumidos en `res.partner`.
- Serializacion de campos `deactivation_*` en `/plan/stops`.

Vistas Odoo:

- Menu "Bajas controladas".
- Kanban/list/form por estado.
- Smart button en cliente.
- Acciones de aprobar, rechazar, pedir segunda verificacion, recuperacion comercial y aplicar.

## Permisos

Backend es fuente de verdad.

- Vendedor/repartidor: crear solicitud propia; leer resumen de solicitudes de sus clientes/ruta.
- Supervisora: leer solicitudes de su equipo/empresa; capturar verificacion; no aprobar/aplicar.
- Corporativo Guadalajara: leer `corporate_review`; decidir y aplicar.
- Administrador: mantenimiento y correcciones auditadas.

Multi-company:

- Todas las busquedas y constraints deben incluir `company_id`.
- Record rules deben limitar por empresas permitidas.
- Endpoints deben derivar o validar empresa desde empleado/token y rechazar mismatch.

## Offline Y Conflictos

Solicitud offline:

- La pantalla valida localmente motivo, comentario, GPS y foto obligatoria.
- Guarda item `customer_deactivation_request` en cola con `localUri`.
- Marca el cliente localmente "en revision" para impedir nuevas solicitudes desde ese dispositivo.

Verificacion offline:

- La supervisora puede capturar verificacion si la solicitud ya esta cacheada.
- Se encola `customer_deactivation_verification`.
- Si otro usuario resolvio la solicitud antes de sincronizar, el backend debe devolver conflicto con estado actual. La app conserva evidencia y muestra error accionable en Sync.

Resolucion de conflicto:

- Mismo `client_operation_id`: idempotencia, devolver exito.
- Solicitud abierta distinta: no crear duplicado; devolver conflicto funcional y datos de solicitud abierta.
- Solicitud ya cerrada antes de sync: no descartar evidencia automaticamente; dejar item en error/dead con mensaje "solicitud ya resuelta" o crear log de evidencia tardia si negocio lo permite.

## UX

Vendedor/repartidor:

- Desde parada: "Reportar posible baja".
- Formulario compacto:
  - Motivo.
  - Comentario obligatorio.
  - Contacto/persona consultada opcional.
  - GPS visible con estado.
  - Foto requerida solo para `not_exists` y `permanently_closed`.
  - Guardado: "Solicitud enviada" online o "Guardada localmente, se enviara al reconectar" offline.

Supervisora:

- Cola con filtros por ruta, motivo, antiguedad y estado.
- Detalle muestra evidencia del vendedor y datos del cliente.
- Accion "Capturar verificacion" con resultado, comentario, foto y GPS.

Corporativo:

- Vista Odoo con evidencia comparada: solicitud, verificacion, historial y ventas recientes.
- Botones de decision con comentario obligatorio para rechazar, segunda verificacion y recuperacion.

## Plan De Implementacion Por Fases

1. Backend Odoo base: modelo, ACL, estados, constraints, endpoints de solicitud y serialization de `deactivation_*` en paradas.
2. App solicitud: tipos, helper de validacion, servicio REST, sync queue, pantalla desde parada y badges.
3. Backend supervisora: endpoint de cola y endpoint de verificacion.
4. App supervisora: cola real, detalle, captura de verificacion offline-friendly.
5. Corporativo Odoo: vistas, botones, aprobacion/aplicacion, cambios resumidos en `res.partner`.
6. Hardening: conflictos, reportes, recuperacion comercial, pruebas piloto.

## Pruebas

App unitarias:

- Validacion de motivo/comentario/foto obligatoria.
- Construccion de payload sin base64 en cola.
- Lectura de `localUri` a base64 durante sync.
- Idempotencia/conflicto funcional.
- Wiring de boton en parada y pantalla supervisora.
- Badge "baja en revision" sin cambiar `stop.state`.

Backend unitarias/integracion:

- Constraint una solicitud abierta por cliente/empresa.
- ACL por rol.
- Transiciones validas e invalidas.
- Bitacora por transicion.
- Idempotencia por `client_operation_id`.
- Multi-company mismatch rechazado.
- `approved -> applied` actualiza partner sin borrar historico.

QA operativo:

- Solicitud online con foto obligatoria.
- Solicitud offline, cierre/reapertura app, reconexion y sync.
- Duplicado offline desde dos dispositivos.
- Verificacion supervisora offline.
- Rechazo corporativo.
- Segunda verificacion.
- Aplicacion final y ruta conserva historial.

## Riesgos

- Backend no tiene aun rol corporativo movil: mitigacion inicial, corporativo opera desde Odoo web.
- Fotos grandes: se reutiliza compresion actual; si falla por tamano, evaluar `expo-image-manipulator`.
- Conflictos multi-dispositivo: se resuelven con constraint + idempotencia y no se descarta evidencia sin mensaje.
- Cambio prematuro de rutas: no se modifica asignacion/ruta hasta `applied`.
- Uso de `res.partner.active`: no se toca en primera version para evitar ocultar historicos o romper reportes.
