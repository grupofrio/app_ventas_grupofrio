# Checklist offline: reemplazo de respuestas muertas

## Objetivo

Evitar que un cierre offline dependa de respuestas de checklist que ya agotaron sus reintentos (`dead`), y permitir que una nueva respuesta del mismo `check_id` las sustituya de forma visible y operativa.

## Modelo de vigencia

Para cada checklist y `check_id`, solo cuenta la operación más reciente en el orden durable de la cola (por `created_at`; ante empate, por su posición en el arreglo). Los estados `pending`, `syncing`, `error` y `done` sustituyen una operación `dead` anterior; una operación `dead` posterior vuelve a requerir reparación. El banner deduplica por `check_id` y muestra únicamente los muertos vigentes.

La sustitución offline ocurre cuando se encola una nueva respuesta. La sustitución online elimina de forma selectiva los `vehicle_check` muertos del mismo checklist y check después de que el servidor confirma la nueva respuesta. No se eliminan ni se reordenan operaciones vivas: la corrección se limita a recuperar un fallo terminal.

## Cierre offline

`completeOffline` no encola un cierre si existe algún check **requerido** con una respuesta muerta vigente. Los checks opcionales se reportan, pero no bloquean el cierre, consistente con la validación actual de requeridos. El mensaje coincide con el banner de reparación. Cuando no hay muertas vigentes, conserva el comportamiento actual: el cierre depende de las respuestas pendientes o en error accionable de ese checklist.

Los cierres ya encolados antes de esta corrección no se mutan: si llegan al backend sin una respuesta requerida, el backend los rechaza y quedan reparables desde la pantalla. La garantía nueva se aplica a cierres creados con la pantalla actualizada.

## Alcance

El cambio se limita a los helpers puros de `vehicleChecklistOffline`, su uso en `app/checklist/[planId].tsx`, y pruebas de regresión. No altera el contrato backend ni el formato de los ítems ya persistidos en la cola.

## Pruebas

1. Una respuesta `dead` de un check requerido bloquea el cierre offline.
2. Las secuencias `dead → pending/error/syncing/done` desbloquean y `dead → dead` vuelve a bloquear; se deduplica el banner por check.
3. Una respuesta online confirmada elimina el muerto correspondiente; una respuesta offline nueva lo sustituye por orden durable.
4. Respuestas muertas de otros checklists y checks opcionales no bloquean.
5. El cierre no se encola mientras exista un muerto requerido vigente; después usa exactamente las operaciones vivas como `dependsOn`.
