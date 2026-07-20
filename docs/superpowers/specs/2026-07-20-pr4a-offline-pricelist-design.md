# PR-4a: resolución de tarifa al confirmar una venta sin conexión

**Fecha:** 2026-07-20

**Estado:** Diseño aprobado

**Alcance:** Evitar cualquier intento de resolución remota de tarifa al confirmar una venta sin conexión.

## Objetivo

La confirmación de una venta offline debe llegar inmediatamente al flujo local de encolado. No debe esperar ni intentar `getPartnerPricelistId`, porque ese resolvedor puede consultar Odoo cuando no hay una tarifa confirmada en caché.

La venta conservará la mejor tarifa confiable disponible localmente:

1. La tarifa explícita de la parada, si existe.
2. En su ausencia, una tarifa positiva ya confirmada en la caché del cliente.
3. Si ninguna existe, `null`; `buildSalesCreatePayload` omitirá `pricelist_id` y el backend la resolverá al sincronizar.

## Problema actual

`app/sale/[stopId].tsx` resuelve la tarifa antes de separar la ruta online de la offline. Cuando la parada no trae una tarifa explícita, la confirmación llama a `getPartnerPricelistId` aun con `isOnline === false`. Esto introduce una dependencia de red en un flujo que debe ser enteramente local y puede retrasar o impedir que la venta se encole.

El flujo actual ya dispone de `peekResolvedPartnerPricelistId`, que solo consulta el estado local rehidratado. Esa lectura sí es segura offline.

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

La función normalizará ambos identificadores y solo considerará válidos los enteros positivos. La matriz de decisión será:

| Conectividad | Tarifa de parada | Tarifa en caché | Tarifa elegida inicialmente | Ejecutar resolvedor |
| --- | --- | --- | --- | --- |
| cualquiera | válida | cualquiera | parada | no |
| offline | ausente | válida | caché | no |
| offline | ausente | ausente | `null` | no |
| online | ausente | cualquiera | caché o `null` | sí |

En el último caso se conserva el comportamiento online actual: se llama al resolvedor existente, que puede responder desde su propia caché o actualizarla mediante Odoo. Después se vuelve a leer `peekResolvedPartnerPricelistId` y se ejecuta nuevamente la decisión con el valor actualizado.

### Integración en la confirmación de venta

Dentro de `handleConfirm`, el orden será:

1. Normalizar la tarifa explícita de la parada.
2. Leer la tarifa confirmada en caché con `peekResolvedPartnerPricelistId`.
3. Calcular la decisión pura.
4. Ejecutar `getPartnerPricelistId` solo cuando `shouldResolvePartnerPricelist` sea verdadero.
5. Si se ejecutó el resolvedor, volver a leer la caché y recalcular la decisión.
6. Construir el payload con la tarifa elegida.
7. Continuar por el flujo online u offline existente.

La decisión no moverá ni alterará el bloqueo de confirmación, la captura de fotos, la generación de `operation_id`, la escritura en la cola, la impresión del ticket ni la sincronización posterior.

### Contrato sin tarifa local

Cuando una venta offline no tenga tarifa explícita ni una tarifa positiva confirmada en caché, la decisión devolverá `pricelistId: null`. El comportamiento existente de `buildSalesCreatePayload` omitirá `pricelist_id`; no se enviará un valor inventado ni una tarifa de compañía no confirmada. El backend seguirá siendo responsable de asignar la tarifa al procesar la operación.

### Errores

El camino offline no incorpora una nueva fuente de error: la decisión y la lectura de caché son síncronas y locales.

El manejo de errores del resolvedor online permanece sin cambios. Si falla, la confirmación seguirá mostrando el error y liberando el bloqueo como lo hace actualmente. La recuperación de respuestas ambiguas pertenece a PR-4b.

## Pruebas

La implementación seguirá TDD e incluirá:

1. Pruebas unitarias de la matriz completa de la función pura, incluyendo identificadores inválidos.
2. Una prueba de cableado que demuestre que `getPartnerPricelistId` queda condicionado por la decisión y no se ejecuta en el camino offline.
3. Una prueba que preserve el comportamiento online sin tarifa explícita.
4. La suite existente de tarifa, payload y venta offline.
5. Verificación de tipos y suite completa del repositorio.

La validación manual final será confirmar una venta en modo avión y comprobar que se encola como `sale_order` sin espera ni intento de RPC de tarifa.

## Criterios de aceptación

- Una venta offline nunca llama a `getPartnerPricelistId` durante la confirmación.
- Una tarifa explícita de la parada conserva precedencia online y offline.
- Una venta offline puede reutilizar una tarifa positiva confirmada en caché.
- Sin tarifa local confiable, el payload offline omite `pricelist_id` y la venta se encola normalmente.
- El flujo online conserva la resolución actual de tarifa del cliente.
- No cambian los contratos de cola, payload, stock, idempotencia ni interfaz.
