# Estado autoritativo para el inicio diario de ruta

## Contexto

El 14 de julio de 2026, el plan `RPLAN/2026/00676` de Esteban Alemán estaba en
Odoo como `in_progress`, con KM inicial `399728`, checklist completado y carga
aceptada. Sin embargo, la pantalla de Venta mostraba “Ruta no iniciada” y pedía
capturar el KM inicial.

La causa es que “Iniciar operación” combina datos actuales de Odoo con estado
local, mientras `OperationGate` sólo consulta la copia persistida en
`useRouteStartStore`. Al recuperar el KM desde Odoo, la pantalla lo muestra pero
no actualiza esa copia. Por lo tanto, dos pantallas pueden evaluar el mismo plan
con estados distintos.

Además, el botón “Iniciar ruta” actualmente sólo navega al mapa. No confirma el
inicio contra `/gf/logistics/api/employee/plan/start`, aunque ese endpoint ya
existe en Odoo.

## Objetivo

Hacer que Odoo sea la fuente autoritativa del estado de inicio cuando existe
conexión y conservar una copia local aislada por plan para operar offline. Un
plan confirmado como iniciado en Odoo nunca debe volver a bloquear Venta por
datos locales incompletos o desactualizados.

## Diseño aprobado

### 1. Normalización única del estado del plan

Se añadirá una función pura que convierta un `GFPlan` y los datos observados del
checklist en el estado local de inicio:

- El KM es válido únicamente si `departure_km > 0`.
- La carga inicial está lista cuando no existe una carga inicial pendiente,
  usando la normalización existente de `routeLoadAcceptance`. Una recarga
  (`load_kind=refill`) pendiente no cambia el estado de inicio diario ni vuelve
  a bloquear Venta; conserva sus controles dentro del flujo de recarga.
- `OperationGate` recibirá el `plan.state` actual y comparará el `planId` de la
  copia local. No se convertirán artificialmente checklist o carga a `true`:
  los requisitos conservan su significado y `in_progress` funciona como una
  autorización separada emitida por Odoo.
- Un plan `published` continúa sujeto a checklist, KM, carga inicial y
  preparación mínima de datos antes de invocar el inicio.

La decisión por cada `PlanState` será exhaustiva:

| Estado | Venta/checkout/consignación | Cierre de ruta | Acción de inicio |
| --- | --- | --- | --- |
| Sin plan | Bloqueado | Bloqueado | No disponible |
| `draft` | Bloqueado: plan no publicado | Bloqueado | No disponible |
| `confirmed` | Bloqueado: plan no publicado | Bloqueado | No disponible |
| `published` | Bloqueado hasta confirmar el inicio | Bloqueado | Disponible sólo con checklist, KM, carga inicial y datos listos |
| `in_progress` | Permitido por autorización de Odoo | Permitido | Ya iniciado; no repite la petición |
| `closed` | Bloqueado | Permitido para mostrar el resultado idempotente | No disponible |
| `reconciled` | Bloqueado | Permitido para mostrar el resultado final | No disponible |
| `done` | Bloqueado | Permitido como estado final legacy | No disponible |

`OperationGate` tendrá un modo transaccional por defecto y un modo de cierre
usado únicamente por `route-close`, para no abrir ventas sobre rutas terminadas.

La sincronización siempre ejecutará primero `setForPlan(plan_id)`, para que no
se mezclen datos de otro plan o de otro día, y después actualizará los campos
autoritativos observados.

### 2. Rehidratación en los puntos de entrada

Después de descargar o refrescar el plan, la app actualizará los datos que sí
pertenecen al contrato de `GFPlan`: `planId`, KM inicial, estado de inicio y
aceptación de la carga inicial. Esto cubre abrir directamente Inicio, Venta, una
visita o “Iniciar operación”; ya no dependerá de visitar las pantallas en cierto
orden.

El checklist seguirá consultándose mediante su servicio separado. El orden de
arranque será:

1. Hidratar el plan y el estado de inicio persistidos.
2. Ligar la copia de inicio al `planId` cacheado; una discrepancia la reinicia.
3. Al recuperar el plan online, sobrescribir KM, estado y carga inicial.
4. En “Iniciar operación”, consultar `ensureChecklistReady` y sobrescribir el
   indicador sólo cuando la consulta tenga éxito.

Si la consulta del checklist falla para el mismo plan, la app conserva el último
valor conocido y muestra el error con opción de reintentar. Si es un plan nuevo,
`setForPlan` ya habrá reiniciado el valor a `false`, por lo que un fallo no puede
heredar la respuesta del día anterior. No se consultará el checklist desde cada
Venta: un plan `in_progress` ya tiene autorización de servidor y un plan
`published` debe volver al flujo de inicio para resolver requisitos pendientes.

Si no hay conexión, se conserva la copia persistida sólo cuando su `planId`
coincide con el plan cacheado. El estado de otro plan nunca habilita la operación
actual.

### 3. Inicio real e idempotente desde la app

El servicio móvil expondrá `startPlan(planId)` y hará `POST` a
`gf/logistics/api/employee/plan/start` con `{ plan_id: planId }`. Normalizará la
respuesta esperada `{ ok, message, data: { plan_id, state } }` y sólo aceptará
`state=in_progress` como confirmación. El botón “Iniciar ruta” lo invocará antes
de navegar y permanecerá deshabilitado durante la petición.

La semántica de recuperación será:

- Si el plan local ya está `in_progress`, no se envía otra petición y se navega.
- Ante éxito del endpoint, la app marca y persiste inmediatamente ese mismo plan
  como `in_progress`, intenta una recarga forzada y navega incluso si esa recarga
  secundaria falla; la confirmación de la mutación ya es suficiente.
- Ante timeout o error del endpoint, la app fuerza una sola lectura de Odoo. Si
  la lectura devuelve el mismo plan `in_progress`, considera que la primera
  petición sí se confirmó y navega. De lo contrario permanece en la pantalla y
  muestra el error.
- El bloqueo contra doble toque evita peticiones simultáneas.

### 4. Regla del bloqueo operativo

`OperationGate` seguirá bloqueando cuando no exista un plan operativo, cuando el
estado sea anterior a `published`, cuando un plan `published` aún no haya
confirmado el inicio o cuando la copia local corresponda a otro plan. Para el
mismo plan en `in_progress` permitirá operar aun si una versión anterior del
estado local decía que faltaba KM. Los estados terminados sólo se admitirán en
el modo de cierre descrito en la tabla.

La preparación mínima de ruta/productos permanece como requisito adicional del
botón “Iniciar ruta”. No forma parte de `OperationGate` ni de la rehidratación
del backend y no cambia en este arreglo.

## Pruebas

El cambio se implementará con pruebas primero:

1. Caso Alemán: copia local sin KM + plan `in_progress` con `departure_km=399728`
   produce acceso operativo y rehidrata el KM.
2. Tabla completa: cada `PlanState` tiene el resultado definido para operación
   y cierre.
3. Aislamiento y arranque offline: un `planId` coincidente conserva respaldo;
   uno distinto descarta el estado anterior.
4. Checklist: éxito actualiza; fallo del mismo plan conserva; fallo de un plan
   nuevo permanece bloqueado.
5. Carga: una carga inicial pendiente bloquea el inicio; una recarga pendiente
   no degrada una ruta ya iniciada.
6. Inicio: éxito, doble toque, respuesta ya iniciada, timeout seguido de lectura
   `in_progress` y éxito seguido de fallo de recarga.
7. Plan publicado: KM ausente o datos mínimos ausentes mantienen deshabilitado
   “Iniciar ruta”.
8. Regresión: ejecutar las pruebas de readiness, inicio, carga y el conjunto
   completo del proyecto.

## Fuera de alcance

- Cambiar datos productivos del plan de Alemán; ya son correctos.
- Relajar checklist, KM o aceptación de carga para planes no iniciados.
- Modificar otros flujos de cierre, liquidación o ventas.

## Despliegue y recuperación

El arreglo es principalmente móvil. Se verificará contra el contrato existente
del endpoint Odoo y se preparará una compilación de prueba. Si apareciera una
regresión, la versión móvil anterior puede mantenerse mientras Odoo conserva el
estado correcto de los planes; no hay migración de datos.
