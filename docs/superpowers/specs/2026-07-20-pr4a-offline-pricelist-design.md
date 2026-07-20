# PR-4a: resolución de tarifa al confirmar una venta sin conexión

**Fecha:** 2026-07-20

**Estado:** Diseño aprobado

**Alcance:** Evitar cualquier intento de resolución remota de tarifa al confirmar una venta sin conexión.

## Objetivo

La confirmación de una venta offline debe llegar inmediatamente al flujo local de encolado. No debe esperar ni intentar `getPartnerPricelistId`, porque ese resolvedor puede consultar Odoo cuando no hay una tarifa confirmada en caché.

La venta conservará la mejor tarifa confiable disponible localmente:

1. La tarifa explícita de la parada, si existe.
2. En su ausencia, una tarifa positiva ya confirmada en la caché del cliente.
3. Si ninguna existe, `null`; el ítem de cola conservará ese valor y `buildSalesCreatePayload` omitirá `pricelist_id` del contrato REST cuando se sincronice.

## Problema actual

`app/sale/[stopId].tsx` resuelve la tarifa antes de separar la ruta online de la offline. Cuando la parada no trae una tarifa explícita, la confirmación llama a `getPartnerPricelistId` aun con `isOnline === false`. Esto introduce una dependencia de red en un flujo que debe ser enteramente local y puede retrasar o impedir que la venta se encole.

El flujo actual ya dispone de `peekResolvedPartnerPricelistId`, que solo consulta el mapa local en memoria, ya sea rehidratado o poblado durante la sesión. Esa lectura sí es segura offline.

## Alcance aprobado

PR-4a incluye únicamente:

- decidir de forma explícita si corresponde ejecutar el resolvedor de tarifa del cliente;
- impedir su ejecución cuando la venta se confirma sin conexión;
- reutilizar la tarifa explícita de la parada o la tarifa confirmada en caché;
- conservar el contrato actual del payload cuando no existe una tarifa local confiable;
- agregar cobertura de regresión para la decisión y su integración en la pantalla de venta.

Quedan fuera de este cambio:

- PR-4b: conservar `operation_id` ante respuestas online ambiguas;
- PR-4c: distinguir existencias referenciales de existencias autoritativas;
- cambios al esquema de almacenamiento, la cola offline o el backend;
- cambios visuales o de interacción;
- modificaciones a la carga de productos en `ProductPicker`;
- cambios al manejo actual de errores online.

## Diseño

### Decisión pura de tarifa

Se agregará un servicio pequeño y sin efectos secundarios, por ejemplo `src/services/salePricelistDecision.ts`, con una función que reciba:

```ts
interface SalePricelistDecisionInput {
  isOnline: boolean;
  stopPricelistId: number | null;
  cachedPricelistId: number | null;
}
```

Y devuelva:

```ts
interface SalePricelistDecision {
  pricelistId: number | null;
  shouldResolvePartnerPricelist: boolean;
}
```

La función aplicará el mismo criterio positivo que usa actualmente la pantalla (`typeof value === 'number' && value > 0`) para evitar cambiar el comportamiento online como parte de PR-4a. La matriz de decisión será:

| Conectividad | Tarifa de parada | Tarifa en caché | Tarifa elegida inicialmente | Ejecutar resolvedor |
| --- | --- | --- | --- | --- |
| cualquiera | válida | cualquiera | parada | no |
| offline | ausente | válida | caché | no |
| offline | ausente | ausente | `null` | no |
| online | ausente | cualquiera | caché o `null` | sí |

En el último caso se conserva el comportamiento online actual: se llama al resolvedor existente, que puede responder desde su propia caché o actualizarla mediante Odoo. La decisión se calcula una sola vez. Después de resolver, la pantalla vuelve a leer `peekResolvedPartnerPricelistId`, aplica el mismo criterio positivo al valor leído y lo usa directamente como tarifa final. No se vuelve a evaluar `shouldResolvePartnerPricelist` ni se crea un ciclo de resolución.

### Integración en la confirmación de venta

Dentro de `handleConfirm`, el orden será:

1. Normalizar la tarifa explícita de la parada.
2. Leer la tarifa confirmada en caché con `peekResolvedPartnerPricelistId`.
3. Calcular la decisión pura.
4. Ejecutar `getPartnerPricelistId` solo cuando `shouldResolvePartnerPricelist` sea verdadero.
5. Si se ejecutó el resolvedor, volver a leer la caché y usar directamente ese valor normalizado como tarifa final.
6. Construir el payload con la tarifa elegida.
7. Continuar por el flujo online u offline existente.

La decisión no moverá ni alterará el bloqueo de confirmación, la captura de fotos, la generación de `operation_id`, la escritura en la cola, la impresión del ticket ni la sincronización posterior.

### Contrato sin tarifa local

Cuando una venta offline no tenga tarifa explícita ni una tarifa positiva confirmada en caché, la decisión devolverá `pricelistId: null`. La pantalla seguirá encolando el payload crudo con `pricelist_id: null`; PR-4a no aplicará el builder antes de `enqueue` ni modificará el contrato persistido de la cola.

Al despachar posteriormente el ítem `sale_order`, `processSyncItem` seguirá llamando a `buildSalesCreatePayload`. En ese límite cola → REST, el builder existente omitirá el valor nulo y el backend recibirá el contrato sin `pricelist_id`, por lo que seguirá siendo responsable de asignar la tarifa. No se enviará un valor inventado ni una tarifa de compañía no confirmada.

### Errores

El camino offline no incorpora una nueva fuente de error: la decisión y la lectura de caché son síncronas y locales.

El manejo de errores del resolvedor online permanece sin cambios. Si falla, la confirmación seguirá mostrando el error y liberando el bloqueo como lo hace actualmente. La recuperación de respuestas ambiguas pertenece a PR-4b.

## Pruebas

La implementación seguirá TDD e incluirá:

1. Pruebas unitarias de la matriz completa de la función pura, incluyendo valores nulos, cero, negativos y `NaN`; deben comprobar expresamente `shouldResolvePartnerPricelist === false` offline.
2. Una prueba de cableado sobre la pantalla que asegure que la llamada a `getPartnerPricelistId` está dentro del guard `shouldResolvePartnerPricelist` producido por la decisión. El repositorio usa inspecciones estructurales de texto para este nivel; no se exigirá un spy de runtime ni una orquestación inyectable fuera del alcance aprobado.
3. Una prueba de cableado que preserve el camino online sin tarifa explícita: la decisión habilita el resolvedor y la lectura posterior de caché produce la tarifa final.
4. Una prueba contractual de `buildSalesCreatePayload` con `pricelist_id: null` que confirme que el contrato REST lo omite, sin cambiar el payload crudo que persiste la cola.
5. La suite existente de tarifa, payload y venta offline.
6. Verificación de tipos y suite completa del repositorio.

La validación manual final será confirmar una venta en modo avión y comprobar que se encola como `sale_order` sin espera ni intento de RPC de tarifa.

## Criterios de aceptación

- Una venta offline nunca llama a `getPartnerPricelistId` durante la confirmación.
- Una tarifa explícita de la parada conserva precedencia online y offline.
- Una venta offline puede reutilizar una tarifa positiva confirmada en caché.
- Sin tarifa local confiable, el ítem offline se encola normalmente con `pricelist_id: null` y el contrato REST posterior omite ese campo.
- Para identificadores que cumplen el criterio positivo actual, el flujo online conserva la resolución vigente de tarifa del cliente.
- No cambian los contratos de cola, payload, stock, idempotencia ni interfaz.
