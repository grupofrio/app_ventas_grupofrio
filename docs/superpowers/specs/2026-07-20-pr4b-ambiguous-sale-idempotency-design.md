# PR-4b: recuperación idempotente de ventas con respuesta online ambigua

**Fecha:** 2026-07-20

**Estado:** Diseño aprobado

**Alcance:** Conservar el `operation_id` de una venta cuando el intento online no produce un resultado confiable, persistirla en la cola durable y reintentarla sin riesgo de crear una segunda venta.

## Objetivo

Una confirmación online puede alcanzar Odoo y, aun así, terminar localmente con timeout, desconexión, respuesta HTTP 5xx o una respuesta imposible de validar. En esos casos la aplicación no sabe si la venta fue creada. Liberar el bloqueo y permitir otra confirmación genera un nuevo `operation_id`, con lo cual un segundo intento puede duplicar la venta, el pago y el movimiento de inventario.

PR-4b distinguirá un rechazo definitivo de un resultado ambiguo:

- ante un rechazo definitivo, conservará el comportamiento editable actual y liberará el intento;
- ante un resultado ambiguo, convertirá automáticamente el mismo intento en un pedido pendiente, usando exactamente el mismo `operation_id` en la cola y en todos los reintentos.

El backend ya es idempotente por `operation_id`: si el primer intento sí creó la venta, el reintento devuelve la venta existente con `duplicate: true`; si no la creó, el reintento la crea una sola vez. PR-4b hace que la aplicación preserve la llave necesaria para aprovechar esa garantía.

## Problema actual

`app/sale/[stopId].tsx` genera un identificador mediante `lockSaleConfirm()` y lo incluye en el payload como `_operationId`. Sin embargo, cualquier excepción de `createSale` entra al mismo `catch`, ejecuta `unlockSaleConfirm()` y borra ese identificador. Una nueva confirmación produce otra llave aunque el servidor pudiera haber confirmado ya la operación anterior.

El camino offline sí encola un `sale_order`, pero `useSyncStore.enqueue` siempre sustituye `_operationId` por un UUID nuevo. Por ello, el camino online ambiguo no puede reutilizar hoy el identificador enviado en el primer intento.

Además, `postRest` conserva el mensaje visible pero descarta datos necesarios para decidir con seguridad, como el estado HTTP y los campos `code` y `data` generados por `unwrapRestResult`. La pantalla no puede diferenciar actualmente una validación funcional de una pérdida de respuesta.

## Contrato confirmado del backend

El endpoint `/gf/logistics/api/employee/sales/create` devuelve el sobre estándar:

```ts
{
  ok: true,
  message: string,
  data: {
    success: true,
    order_id: number,
    operation_id: string,
    duplicate: boolean,
    // otros datos descriptivos de la venta
  },
}
```

Odoo puede envolver esa estructura en el `result` exterior de JSON-RPC. `unwrapRestResult` elimina únicamente ese sobre exterior y entrega a `createSale` la estructura `{ ok, message, data }`. El resultado solo se aceptará como confirmación válida si:

1. es un objeto;
2. `ok === true`;
3. `data` es un objeto y `data.success === true`;
4. `data.order_id` es un identificador positivo válido;
5. `data.operation_id` es una cadena no vacía y coincide con la operación enviada.

`data.duplicate: true` también es éxito: indica que Odoo encontró la venta creada por un intento anterior. Una respuesta 2xx que no satisfaga el contrato se convertirá en un error con `code: "invalid_response"`; no se interpretará como venta confirmada por ser simplemente un valor truthy.

## Alcance aprobado

PR-4b incluye:

- metadatos aditivos en los errores de `postRest` para conservar `httpStatus`, `responseReceived`, `code` y `data`;
- validación explícita del resultado de `createSale`;
- una decisión pura que clasifique el intento como `definitive_rejection` o `ambiguous_result`;
- soporte opcional en la cola para usar un `operationId` explícito;
- recuperación del intento online ambiguo mediante la cola durable con el mismo ID;
- dependencia de las fotos respecto del mismo ID de venta;
- persistencia explícitamente esperada antes de comunicar que el pedido quedó pendiente;
- cobertura unitaria, contractual y de cableado del flujo.

Quedan fuera:

- PR-4c y cualquier cambio al significado o autoridad de las existencias;
- cambios al backend o a su esquema de idempotencia;
- edición manual de una venta cuyo resultado es ambiguo;
- un botón nuevo de reintento dentro de la pantalla de venta;
- cambios al flujo offline normal, salvo reutilizar las mismas primitivas existentes;
- aplicar esta política a pagos u otros endpoints;
- rediseños visuales o cambios al ticket PDF.

## Diseño

### Metadatos de error en el límite HTTP

`src/services/api.ts` conservará en el error lanzado la información estructurada disponible, sin cambiar los mensajes actuales ni el contrato de los consumidores existentes:

```ts
interface ApiRequestError extends Error {
  httpStatus?: number;
  responseReceived?: boolean;
  code?: string;
  data?: unknown;
}
```

Cuando exista una respuesta HTTP:

- `responseReceived` será `true`;
- `httpStatus` contendrá el estado real;
- si `unwrapRestResult` produce un error funcional, sus campos `code` y `data` se copiarán al error final;
- si el sobre válido contiene `ok: false` pero no trae código, se asignará `code: "api_rejection"` para identificar estructuralmente el rechazo;
- el mensaje seguirá siendo el mismo que se muestra hoy y el marcado interno de logging existente se preservará.

Cuando falle el transporte antes de obtener una respuesta:

- `responseReceived` será `false`;
- se conservará `code: "timeout"` cuando provenga del timeout existente;
- los errores de red o aborto conservarán su nombre, código y mensaje utilizables por el clasificador.

Los campos son opcionales y aditivos para no romper consumidores que solo inspeccionan `error.message`.

### Validación del resultado de creación

`src/services/gfLogistics.ts` dejará de considerar exitosa cualquier respuesta truthy de `createSale`. Un validador pequeño y puro verificará el contrato confirmado y devolverá el resultado tipado.

Una respuesta incompleta, HTML transformado en `{ raw: ... }`, JSON con forma inesperada, `ok !== true`, `data.success !== true`, un `data.order_id` inválido o un `data.operation_id` distinto se marcará como `invalid_response`, `responseReceived: true`. Este error pertenece al resultado ambiguo porque la aplicación recibió bytes, pero no una confirmación confiable de la operación esperada.

### Clasificador puro del intento de venta

Se agregará un servicio sin efectos secundarios, por ejemplo `src/services/saleSubmissionOutcome.ts`, que reciba un error desconocido y devuelva:

```ts
type SaleSubmissionOutcome =
  | { kind: 'definitive_rejection' }
  | { kind: 'ambiguous_result' };
```

La precedencia será deliberadamente conservadora:

| Señal | Clasificación | Motivo |
| --- | --- | --- |
| HTTP 5xx | `ambiguous_result` | El servidor o un proxy pudo completar la transacción antes de fallar la respuesta. |
| `responseReceived === false` | `ambiguous_result` | No existe confirmación del resultado remoto. |
| Timeout, desconexión o aborto | `ambiguous_result` | La petición pudo alcanzar Odoo. |
| `code === "invalid_response"` | `ambiguous_result` | La respuesta no prueba que se confirmó la operación correcta. |
| Respuesta funcional válida con `ok: false` sobre 2xx | `definitive_rejection` | Odoo procesó la petición y la rechazó explícitamente. |
| HTTP 4xx | `definitive_rejection` | La petición fue rechazada de manera explícita. |
| `insufficient_stock`, `session_expired`, acceso o validación conocidos | `definitive_rejection` | Son rechazos funcionales que permiten corregir o reautenticar. |
| Error sin metadatos suficientes | `ambiguous_result` | Ante duda se preserva la llave para evitar duplicados. |

La regla de HTTP 5xx tiene precedencia incluso si el cuerpo contiene un mensaje funcional, porque un intermediario o un fallo tardío no garantiza que toda la transacción haya sido revertida.

Un rechazo funcional 2xx sin código propio será reconocible por `code: "api_rejection"`, asignado en el límite HTTP. El clasificador no dependerá de buscar frases en el mensaje para distinguirlo de un error desconocido.

El clasificador no decidirá textos, navegación, reintentos ni mutará stores. La pantalla será responsable únicamente de orquestar la decisión.

### Identificador explícito e idempotente en la cola

`useSyncStore.enqueue` ampliará su opción actual sin cambiar las llamadas existentes:

```ts
enqueue(type, payload, {
  dependsOn?: string[];
  operationId?: string;
  holdProcessing?: boolean;
}): string
```

Las reglas serán:

1. Sin `operationId`, se conserva exactamente el comportamiento actual: se genera un UUID y se escribe como `item.id` y `payload._operationId`.
2. Con `operationId`, la cadena debe ser no vacía después de normalizar espacios; un valor inválido produce un error y nunca genera silenciosamente otra llave.
3. Si no existe el ID, se crea el ítem con `item.id === operationId` y `payload._operationId === operationId`.
4. Si ya existe un ítem del mismo tipo con ese ID, se devuelve el ID existente sin insertar, reemplazar payload ni duplicar la operación. El primer registro es autoritativo.
5. Si el ID ya pertenece a otro tipo de operación, se lanza una colisión explícita y no se sobrescribe el ítem.
6. `holdProcessing: true` registra el ID en un conjunto transitorio de bloqueos antes de exponerlo como candidato. No solo evita el auto-disparo de ese `enqueue`: impide que cualquier ciclo concurrente, reconexión, sincronización manual o redrenaje post-ciclo despache el ítem mientras siga retenido.
7. El store expondrá `releaseProcessingHolds(ids)` para liberar una venta y sus fotos como grupo. La liberación no dispara procesamiento por sí sola; el llamador decide si inicia el ciclo.

Para un ítem del mismo ID y tipo ya existente, el estado se resolverá así:

- `pending`, `syncing` o `error`: se conserva el ítem y su política normal de procesamiento/backoff;
- `dead`: se rearma el mismo ítem a `pending`, limpiando error, reintentos y `next_retry_at`, pero sin sustituir su payload;
- `done`: se conserva como `done` y no se reenvía, porque la operación ya tiene éxito conocido.

La prioridad, dependencias, telemetría, conteos y auto-procesamiento existentes seguirán funcionando. No se cambia la forma persistida de `SyncQueueItem`.

El conjunto de bloqueos será solo de memoria y no formará parte de `SyncQueueItem`. Si la aplicación se cierra después de que un ítem quedó durable, la rehidratación comienza sin bloqueos y la cola puede procesarlo normalmente. La opción también se aplica cuando el ID explícito ya existía: un ítem reutilizado o rearmado queda retenido frente a futuros ciclos hasta que el lote se libere; un envío que ya estaba efectivamente `syncing` no puede cancelarse, pero en ese caso la operación ya provenía de la cola durable.

### Persistencia serializada y barrera antes del envío

Todas las escrituras de la cola —inmediatas, agendadas, producidas por metadata o solicitadas explícitamente— pasarán por un único coordinador serial. Cada solicitud:

1. espera a que termine la escritura anterior;
2. lee el estado más reciente de la cola cuando le corresponde ejecutarse, no cuando se solicitó;
3. escribe ese snapshot completo;
4. devuelve una promesa que resuelve solo después de que su snapshot quedó guardado.

Con esto, una escritura parcial iniciada por el primer `enqueue` nunca puede terminar después de una escritura más nueva y sobrescribir el lote completo. `persistQueue()` representará una barrera: al resolver, no quedará ninguna escritura anterior capaz de degradar el estado durable que acaba de guardar.

Los llamadores fire-and-forget del coordinador consumirán y registrarán sus rechazos para evitar promesas no manejadas. La llamada explícita usada como barrera no ocultará el error: conservará el rechazo para que la pantalla aplique la política de fallo de persistencia.

Durante la recuperación ambigua, tanto la venta como sus fotos se encolarán con `holdProcessing: true`. `enqueueVisitPhotos` ampliará sus opciones para propagar esta bandera a cada foto y devolverá sus IDs como hoy. `processQueue` excluirá los IDs retenidos al seleccionar candidatos, y la decisión de redrenaje post-ciclo evaluará la cola filtrada por la misma regla. Después de insertar todo el lote en memoria, la pantalla esperará `persistQueue()`, liberará juntos el ID de venta y los IDs de fotos y solo entonces invocará `processQueue()` sin bloquear la interfaz. El comportamiento predeterminado de los demás `enqueue` seguirá persistiendo y auto-procesando como hoy.

### Flujo online exitoso

El camino feliz permanece igual:

1. `lockSaleConfirm()` genera o reutiliza el ID de la confirmación.
2. La pantalla envía la venta directamente con `_operationId`.
3. Un `try/catch` limitado exclusivamente a `createSale` valida o clasifica el resultado remoto.
4. Después de una respuesta válida, se cierra definitivamente la fase de envío de la venta.
5. En una fase posterior separada se encolan las fotos con el comportamiento online actual, se guarda el ticket y se continúa al checkout o a la ruta.
6. Un error de fotos, ticket o navegación nunca vuelve a entrar al clasificador, nunca ejecuta `unlockSaleConfirm()` y nunca encola un segundo `sale_order`; se registra y se comunica como un problema posterior a una venta ya confirmada.
7. No se crea un `sale_order` pendiente.

### Rechazo definitivo

Si el clasificador devuelve `definitive_rejection`:

1. se ejecuta `unlockSaleConfirm()`;
2. el carrito conserva sus líneas y puede editarse;
3. `insufficient_stock` mantiene su detalle y refresco de inventario actuales;
4. sesión, acceso y validaciones muestran su mensaje funcional;
5. no se agrega ningún `sale_order` a la cola.

### Resultado ambiguo

Si el clasificador devuelve `ambiguous_result`, la pantalla no llamará a `unlockSaleConfirm`. Ejecutará en este orden:

1. Encolar `sale_order` con el payload original, la metadata visible de cliente/total y `{ operationId, holdProcessing: true }`.
2. Encolar las fotos con `dependsOn: [operationId]` y `holdProcessing: true`, conservando sus IDs devueltos.
3. Ejecutar y esperar `persistQueue()` después de que el lote completo esté en memoria.
4. Liberar como grupo los bloqueos de la venta y las fotos.
5. Iniciar `processQueue()` solo después de que la persistencia durable haya terminado y los bloqueos hayan sido liberados.
6. Guardar `saleOperationId: operationId` para que checkout, ruta y sincronización sigan la operación correcta.
7. Guardar el snapshot del ticket con el mismo ID.
8. Mantener `saleConfirmed: true`, impidiendo que el carrito genere otra confirmación.
9. Mostrar el estado pendiente y continuar por la misma decisión checkout/ruta del camino offline.

El mensaje será:

> No pudimos confirmar la respuesta del servidor. El pedido quedó pendiente de verificación y se reintentará con el mismo identificador.

No se mostrará “Venta rechazada”, porque eso sugeriría que es seguro volver a confirmar con una operación nueva.

La cola podrá procesar inmediatamente porque el dispositivo sigue marcado online. Todos sus intentos usarán la misma llave:

- si Odoo ya creó la venta, responderá con la venta existente y `duplicate: true`;
- si Odoo no la creó, el siguiente intento la creará;
- en ambos casos solo existirá una venta para el `operation_id`.

Al procesar un ítem `sale_order`, la cola reutilizará el mismo clasificador estructurado para decidir si el error admite backoff/reintento. Así, `invalid_response`, transporte, 5xx y errores desconocidos ambiguos agotarán la política normal de reintentos, mientras un rechazo definitivo pasará a `dead` como ocurre hoy con errores no reintentables. Los demás tipos de ítem conservarán su predicado actual basado en mensajes; PR-4b no amplía su política.

### Fallo de persistencia local

La recuperación solo se comunicará como pendiente después de que `persistQueue()` resuelva. Si falla el almacenamiento durable:

- el ítem permanecerá en memoria para que el procesador pueda seguir intentando mientras la aplicación esté abierta;
- no se liberará ni sustituirá el `operation_id`;
- `saleConfirmed` permanecerá bloqueado;
- no se avanzará al checkout ni se marcará la parada como terminada;
- no se mostrará “Pedido guardado”;
- se advertirá que no se cierre la aplicación mientras continúa la verificación.

Si la barrera falla, la pantalla liberará los bloqueos sin invocar `processQueue()`. Las inserciones siguen en memoria y una transición posterior de conectividad, una sincronización manual u otro despertar normal de la cola podrá volver a intentarlas, siempre con el mismo ID. Esta liberación evita dejar ítems inaccesibles durante toda la sesión, pero no convierte el fallo en éxito ni provoca un envío inmediato desde el flujo de recuperación.

Esta política prioriza evitar una duplicación sobre permitir una nueva edición. Un flujo manual de recuperación de almacenamiento queda fuera de PR-4b.

### Fotos, ticket y estado visible

Las fotos son operaciones dependientes y nunca deben usar una llave nueva como padre. En la recuperación ambigua, su `dependsOn` será el mismo `operationId` del intento directo y del `sale_order` recuperado.

El ticket local también usará ese ID, de modo que una respuesta idempotente posterior se relacione con el mismo comprobante. Un fallo posterior al persistir la venta —por ejemplo al guardar el ticket— no deberá desbloquear la venta ni retirar el ítem durable; la cola ya es la fuente de recuperación.

Los estados existentes de sincronización (`pending`, `syncing`, `error`, `dead`) y sus acciones de reintento seguirán siendo la interfaz para observar y recuperar el pedido.

### Límites de las fases de error

La clasificación aplica exclusivamente a la promesa de `createSale`. Los pasos se separarán en tres bloques con responsabilidades distintas:

1. **Preparación local:** tarifa y payload. Sus errores conservan el manejo previo y pueden liberar el bloqueo porque no se envió la venta.
2. **Envío de venta:** solo la excepción de `createSale` entra al clasificador definitivo/ambiguo.
3. **Post-confirmación o recuperación local:** fotos, ticket, persistencia y navegación tienen manejo propio. Nunca se reclasifican como un fallo remoto de venta.

Una vez que `createSale` devuelve un resultado válido, la venta se considera confirmada aunque falle un efecto local posterior. Si la respuesta fue ambigua y la venta ya quedó durable, un fallo posterior tampoco retira el ítem ni desbloquea la operación.

### Observabilidad

Los logs del flujo registrarán el `operation_id`, la clasificación (`definitive_rejection` o `ambiguous_result`) y, cuando existan, `httpStatus` y `code`. No se añadirá información personal ni el payload completo. Esto permitirá distinguir rechazos funcionales de operaciones recuperadas por idempotencia.

## Pruebas

La implementación seguirá TDD e incluirá:

1. **Clasificador puro:** matriz de timeout, red, aborto, `responseReceived: false`, 5xx, 4xx, `invalid_response`, `insufficient_stock`, `session_expired`, rechazo funcional 2xx y error desconocido. También verificará la precedencia de 5xx sobre códigos funcionales.
2. **Metadatos HTTP:** pruebas de que `postRest` conserva `httpStatus`, `responseReceived`, `code` y `data` para respuestas, y marca correctamente fallos de transporte. Los mensajes y el marcado de logging existente deben permanecer compatibles.
3. **Contrato de creación:** éxito normal con `{ ok: true, data: ... }`, éxito idempotente con `data.duplicate: true`, `data.order_id` inválido, `data.operation_id` ausente o distinto, objeto truthy no reconocido y respuesta cruda/no JSON.
4. **Cola con ID explícito:** inserción con el mismo ID en item/payload, llamadas normales que aún generan UUID, reencolado idempotente del mismo tipo, primera escritura autoritativa, valor vacío, colisión con otro tipo y comportamiento definido para `pending`, `syncing`, `error`, `dead` y `done`.
5. **Persistencia serializada:** dos o más escrituras solapadas no permiten que un snapshot antiguo sobrescriba uno nuevo; la promesa de barrera solo resuelve cuando el snapshot más reciente solicitado quedó durable.
6. **Bloqueo transitorio de procesamiento:** la venta y las fotos quedan fuera de candidatos y del redrenaje durante la barrera, incluso ante ciclos concurrentes, reconexión o sincronización manual; al éxito se liberan juntas y después se dispara una sola ejecución normal.
7. **Dependencias:** las fotos de una recuperación dependen exactamente del ID original de la venta.
8. **Cableado de pantalla:** resultado definitivo libera el bloqueo de confirmación; resultado ambiguo conserva ese bloqueo, encola con `{ operationId, holdProcessing: true }`, espera `persistQueue()`, libera los bloqueos transitorios antes del procesador y del aviso, guarda el ticket con el mismo ID y aplica la navegación de pedido pendiente.
9. **Límites de fase:** un error de `createSale` sí se clasifica; errores posteriores de fotos, ticket o navegación no desbloquean ni reencolan la venta confirmada.
10. **Reintentos de cola:** `sale_order` usa la clasificación estructurada, reintenta resultados ambiguos —incluido `invalid_response` y desconocido— y no reintenta rechazos definitivos; otros tipos mantienen la decisión existente.
11. **Fallo de persistencia:** libera los bloqueos transitorios sin disparar procesamiento, no muestra éxito, no avanza y conserva bloqueada la confirmación de la operación.
12. **Regresión:** flujo online exitoso, flujo offline existente, stock insuficiente, sincronización y tickets.
13. **Verificación completa:** `npm test` y `npm run typecheck`.

La validación manual crítica simulará este orden:

1. Odoo confirma la venta.
2. La respuesta se pierde antes de llegar a la aplicación.
3. La aplicación persiste el pedido con la misma llave.
4. La cola lo reintenta.
5. Odoo devuelve `duplicate: true` para la venta existente.
6. Se comprueba una sola venta, un solo pago y un solo efecto de inventario.

También se probará un timeout anterior a la creación para verificar que el mismo mecanismo crea la venta en el reintento.

## Criterios de aceptación

- Un rechazo funcional conocido libera el intento y permite corregir la venta.
- Un timeout, error de red, aborto, HTTP 5xx, respuesta inválida o error desconocido nunca genera una nueva llave de operación.
- El `sale_order` recuperado usa el mismo valor en `item.id`, `payload._operationId`, `saleOperationId`, dependencias de fotos y ticket.
- No se informa que el pedido quedó pendiente hasta completar la persistencia durable.
- Mientras la barrera de persistencia está pendiente, ningún punto de entrada del procesador puede enviar la venta ni sus fotos.
- Una escritura antigua de la cola nunca puede sobrescribir un snapshot durable más reciente.
- Un fallo de persistencia no desbloquea la venta ni permite confirmar otra operación.
- Reencolar el mismo ID y tipo no duplica ni reemplaza el ítem existente.
- Una colisión de ID entre tipos falla de forma explícita.
- Una respuesta de creación solo es éxito cuando cumple el contrato confirmado; `data.duplicate: true` se acepta como éxito idempotente.
- La cola reintenta los resultados ambiguos de `sale_order` con la misma llave y no cambia la política de otros tipos.
- Solo los errores de `createSale` se clasifican; fallos posteriores no recrean ni desbloquean la venta.
- El camino online exitoso y el camino offline normal mantienen su comportamiento actual.
- La suite completa y el typecheck pasan.
