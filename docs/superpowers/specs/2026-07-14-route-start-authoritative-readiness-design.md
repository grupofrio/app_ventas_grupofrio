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
- La carga está lista cuando no existe una carga inicial pendiente, usando la
  normalización existente de `routeLoadAcceptance`.
- Si el plan está `in_progress`, `closed` o `reconciled`, Odoo confirma que la
  ruta ya inició y el bloqueo operativo no puede degradarla por una copia local
  antigua.
- Un plan `published` continúa sujeto a checklist, KM y carga antes de iniciar.

La sincronización siempre ejecutará primero `setForPlan(plan_id)`, para que no
se mezclen datos de otro plan o de otro día, y después actualizará los campos
autoritativos observados.

### 2. Rehidratación en los puntos de entrada

Después de descargar o refrescar el plan, la app actualizará
`useRouteStartStore`. Esto cubre abrir directamente Inicio, Venta, una visita o
“Iniciar operación”; ya no dependerá de visitar las pantallas en cierto orden.

Si no hay conexión, se conserva la copia persistida sólo cuando su `planId`
coincide con el plan cacheado. El estado de otro plan nunca habilita la operación
actual.

### 3. Inicio real e idempotente desde la app

El servicio móvil expondrá `startPlan(planId)` y el botón “Iniciar ruta” lo
invocará antes de navegar. Durante la petición el botón quedará deshabilitado.
Después de una respuesta correcta se forzará la recarga del plan para persistir
`in_progress`.

Si al refrescar Odoo ya devuelve `in_progress`, la app lo tratará como éxito y
no solicitará repetir checklist, KM o carga. Un error real conservará al usuario
en la pantalla y mostrará un mensaje; no navegará aparentando que la ruta inició.

### 4. Regla del bloqueo operativo

`OperationGate` seguirá bloqueando cuando no exista un plan activo o cuando un
plan todavía `published` tenga requisitos pendientes. Para planes ya iniciados
en Odoo permitirá operar aun si una versión anterior del estado local decía que
faltaba KM.

## Pruebas

El cambio se implementará con pruebas primero:

1. Caso Alemán: copia local sin KM + plan `in_progress` con `departure_km=399728`
   produce acceso operativo y rehidrata el KM.
2. Aislamiento: cambiar de `planId` descarta el estado del plan anterior.
3. Plan publicado: KM ausente continúa bloqueando.
4. Cableado: “Iniciar ruta” llama al endpoint antes de navegar y evita doble
   envío.
5. Regresión: ejecutar las pruebas de readiness, inicio, carga y el conjunto
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
