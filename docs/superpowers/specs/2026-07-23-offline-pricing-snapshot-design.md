# Snapshot de precios por cliente para ventas offline

**Fecha:** 2026-07-23

**Estado:** Diseño aprobado

**Entrega:** Continuidad offline 1 de 3

## Objetivo

Una venta preparada con conexión debe mostrar e imprimir offline el precio que Odoo calculó para ese cliente y su lista de precios. Reiniciar la app, cambiar de día o perder señal no debe provocar una caída silenciosa al precio público mientras exista un precio previamente validado.

## Problema actual

La app ya precarga y persiste precios, pero los productores y consumidores no usan la misma identidad:

- la preparación de ruta llama `computeCustomerPrices` con `companyId`;
- `ProductPicker` consulta con `companyId` y la lista explícita de la parada;
- `buildPartnerCacheKey` incorpora esa lista, por lo que una precarga válida puede convertirse en un miss offline;
- ante el miss, el selector usa `product.list_price`;
- el ticket captura el valor local del carrito;
- el endpoint de venta ignora cualquier `price_unit` del cliente y vuelve a calcular con la lista de Odoo.

El resultado es un ticket offline con precio público y una venta sincronizada con el precio correcto del cliente.

Además, el caché actual tiene invalidación dura por jornada y conserva solamente las diferencias contra `list_price`. Esto impide usar de forma segura el último precio completo conocido cuando cambia el contexto temporal o el catálogo base.

## Alcance

Esta entrega incluye:

- precarga por combinación cliente + lista de precios;
- persistencia durable de snapshots completos;
- resolución offline determinista;
- metadatos de procedencia y antigüedad en las líneas y tickets;
- advertencia cuando nunca existió un precio del cliente;
- reimpresión con datos definitivos de Odoo después de sincronizar;
- migración compatible con tickets, colas y cachés existentes.

Quedan fuera:

- hacer que Odoo acepte ciegamente precios enviados por el dispositivo;
- snapshots firmados por el backend;
- cambios al motor de listas de Odoo;
- sumar ventas pendientes a corte o indicadores oficiales.

## Modelo de datos

Se introducirá un snapshot versionado equivalente a:

```ts
interface PreparedCustomerPricingSnapshot {
  version: 1;
  snapshotId: string;
  companyId: number;
  partnerId: number;
  resolvedPricelistId: number;
  preparedAtMs: number;
  preparedPlanId: number | null;
  preparationRunId: string;
  origin: 'odoo_server_full';
  productFingerprint: string;
  prices: Array<[productId: number, unitPrice: number]>;
}

interface LastKnownCustomerProductPrice {
  productId: number;
  unitPrice: number;
  capturedAtMs: number;
  preparationRunId: string;
}

interface PricingPreparationManifest {
  version: 1;
  companyId: number;
  planId: number | null;
  preparationRunId: string;
  activatedAtMs: number;
  targets: Array<{
    partnerId: number;
    requestedPricelistId: number | null;
    resolvedPricelistId: number | null;
    snapshotId: string | null;
    status: 'prepared' | 'failed';
  }>;
}
```

`prices` contendrá el precio completo de todos los productos devueltos por Odoo, incluso cuando coincida con `list_price`. Así, un cambio posterior en el catálogo público no altera retroactivamente el snapshot.

La identidad canónica será `companyId + partnerId + resolvedPricelistId`. Los identificadores solicitados no forman parte del snapshot; viven únicamente en mappings y manifiestos. Cada identidad conservará:

- snapshots inmutables y versionados por `snapshotId`, almacenados bajo su `preparationRunId`;
- un ledger `lastKnownPrices` por producto, actualizado con cada snapshot válido;
- las asociaciones de listas solicitadas que resolvieron a esa identidad.

Publicar una corrida nueva no sobrescribe los snapshots de la corrida activa anterior. El manifiesto apunta a `snapshotId` concretos y el cambio del puntero activo es la única activación. Después de una activación exitosa se pueden recolectar snapshots sin referencias, conservando el ledger.

Activar un snapshot nuevo no elimina el ledger de productos ausentes en el catálogo nuevo. Así, un producto recuperado desde el catálogo offline puede usar su último precio conocido de la misma lista aunque ya no pertenezca al snapshot más reciente.

La preparación conservará además un mapeo explícito:

```text
companyId + partnerId + requestedPricelistId
    -> resolvedPricelistId + preparationRunId
```

Ese mapeo permite encontrar el resultado preparado cuando la lista solicitada y la resuelta no coinciden, o cuando la parada llegó sin lista y Odoo la resolvió. No se consultará un snapshot arbitrario del mismo cliente si no existe este mapeo.

Antes de consultar precios, el resolvedor canonicaliza la lista solicitada mediante este mapeo. Solo después busca snapshot preparado o último precio conocido bajo la lista resuelta. Una entrada antigua cuya clave coincida con la lista solicitada nunca gana sobre el mapping actual.

Dos listas solicitadas que resuelvan a la misma lista canónica compartirán snapshot y ledger, pero mantendrán mapeos solicitada → resuelta separados.

`prepared_customer` significa exclusivamente que el precio pertenece al snapshot activado por el manifiesto vigente del plan actual y que su target tiene `status: 'prepared'`. Un snapshot de una preparación anterior, de un manifiesto anterior o un precio proveniente únicamente del ledger se clasifica como `last_known_customer`.

La activación será atómica a nivel de corrida:

1. crear un `preparationRunId`;
2. validar y escribir snapshots candidatos bajo ese run, sin reutilizar claves del manifiesto activo;
3. construir el manifiesto con todos los targets exitosos y fallidos y sus `snapshotId`;
4. publicar el manifiesto activo en una sola escritura.

Si la app se cierra antes del paso 4, el manifiesto anterior sigue activo y ningún candidato parcial se etiqueta como preparado. Los candidatos válidos pueden quedar como últimos conocidos después de una recuperación, pero no como parte de la preparación vigente. Un target fallido del nuevo manifiesto usa el ledger anterior y se etiqueta `last_known_customer`.

La antigüedad será informativa offline, no una causa de eliminación. Online, la app siempre intentará actualizarlo.

## Preparación de ruta

La preparación derivará objetivos únicos desde las paradas, preservando:

- `partnerId`;
- `stop._pricelistId`, cuando exista;
- empresa activa.

Ya no reducirá el trabajo únicamente a una lista de partners. Para cada objetivo consultará el endpoint de precios con la lista explícita de la parada. La respuesta deberá conservar tanto la lista finalmente resuelta como todos los precios calculados.

Solamente una respuesta completa y exitosa del endpoint de precios de Odoo puede publicarse con `origin: 'odoo_server_full'`. Se considera completa cuando:

- devuelve un `resolvedPricelistId` positivo;
- el conjunto de `productId` aceptados es exactamente igual al conjunto de IDs distintos solicitados; las filas extra se descartan antes de comparar;
- cada precio es finito y mayor o igual a cero;
- no contiene productos desconocidos que sustituyan cobertura faltante.

Un hit del caché legacy, el resolvedor client-side o una respuesta parcial pueden servir al comportamiento existente durante una sesión online, pero no crean ni reemplazan un snapshot preparado ni el ledger de último precio conocido.

Si el mismo cliente aparece varias veces con la misma lista solicitada, se calcula una vez. Listas solicitadas diferentes conservan mappings distintos; si Odoo las resuelve a listas canónicas diferentes tendrán snapshots distintos, y si las resuelve a la misma lista compartirán un único snapshot canónico dentro de la corrida.

Los fallos seguirán aislados por cliente/lista. Al finalizar se persistirán los snapshots exitosos y se mantendrán los anteriores para los fallidos.

## Resolución en el selector

Online:

1. usar un snapshot fresco en memoria cuando corresponda;
2. solicitar el cálculo actual a Odoo cuando falte o se fuerce actualización;
3. si la respuesta completa ocurre fuera de `prepareRouteData`, actualizar solamente el ledger `lastKnownPrices` de la lista canónica y el mapping solicitado → resuelto;
4. no sobrescribir ni reetiquetar el snapshot apuntado por el manifiesto activo.

Solo la preparación de ruta crea snapshots candidatos y activa un nuevo manifiesto. Un refresh online del selector puede producir `last_known_customer`, nunca `prepared_customer`.

Offline:

1. canonicalizar la lista solicitada mediante el mapping solicitado → resuelto;
2. precio del snapshot activado para ese cliente + lista canónica;
3. precio del ledger `lastKnownPrices` del mismo cliente + lista canónica;
4. `list_price` si no existe una coincidencia demostrable para cliente + lista.

El cuarto caso no bloqueará la venta, pero mostrará una confirmación al vendedor indicando que se usará precio público sin validación del cliente.

Una parada sin lista que tampoco tenga un mapeo solicitado → resuelto no puede reutilizar silenciosamente otra lista del cliente.

## Carrito, ticket y sincronización

Cada línea conservará opcionalmente:

```ts
type OfflinePriceSource =
  | 'prepared_customer'
  | 'last_known_customer'
  | 'public_fallback';

interface SaleLinePricingMetadata {
  priceSource?: OfflinePriceSource;
  priceCapturedAtMs?: number | null;
  pricelistId?: number | null;
}
```

Los campos serán opcionales para rehidratar ventas y tickets legacy.

El valor `SaleLineItem.price` seguirá siendo el único precio usado para subtotal, total e impresión local. Los metadatos sirven para interfaz, diagnóstico y auditoría; no habrá un segundo cálculo al imprimir. El precio unitario capturado y sus metadatos permanecen inmutables al cambiar cantidad, persistir, rehidratar o imprimir; solamente se recalculan los totales derivados de la cantidad.

Odoo seguirá siendo la autoridad durante la sincronización. Si la tarifa cambió después de preparar la ruta, el pedido de Odoo puede diferir del ticket ya impreso. Cuando el pedido aparezca en `sales/list`, una reimpresión se construirá desde las líneas definitivas del servidor y reemplazará únicamente el snapshot local del ticket `sale-ticket:<operationId>`. Nunca actualizará ni inferirá snapshots de precios del cliente desde `sales/list`.

## Migración

Los cachés legacy no se promoverán a `PreparedCustomerPricingSnapshot`: contienen solamente diferencias contra `list_price`, usan otra identidad y pueden haber vencido. La nueva persistencia tendrá clave y versión propias.

En una actualización:

- un caché legacy puede seguir sirviendo como optimización de la sesión existente, pero nunca se etiqueta como `prepared_customer` ni `last_known_customer`;
- la primera preparación online exitosa crea los snapshots nuevos;
- después de publicar al menos un snapshot nuevo, la entrada legacy correspondiente puede eliminarse;
- si el dispositivo inicia offline únicamente con datos legacy, se aplicará el fallback público con advertencia en lugar de inventar un snapshot completo.

## Errores y observabilidad

- Un fallo de un cliente no invalida los demás.
- Un snapshot corrupto se ignora sin borrar otros snapshots.
- Un precio no finito o negativo no se publica.
- El fallback público requiere confirmación visible, pero no bloquea.
- Los logs incluirán partner, lista, edad y fuente; nunca imprimirán tokens ni datos sensibles.
- Preparar ruta mostrará cuántas combinaciones cliente/lista quedaron listas y cuántas fallaron.

## Pruebas

1. Clave exacta por cliente + lista + empresa.
2. Dos paradas del mismo cliente/lista generan una sola consulta.
3. Dos listas resueltas distintas para el mismo cliente generan snapshots distintos.
4. La respuesta solicitada y la lista resuelta quedan mapeadas y canonicalizadas antes del lookup.
5. Dos listas solicitadas que resuelven igual comparten snapshot sin perder sus mapeos.
6. Solo una respuesta con lista positiva y cobertura exacta se publica como preparada.
7. Los candidatos se guardan con claves versionadas por corrida; el manifiesto se activa atómicamente y una interrupción conserva snapshots anteriores.
8. El mapa persistido incluye precios iguales a `list_price`.
9. Un fallo parcial conserva el snapshot y ledger anteriores como último conocido.
10. Activar un snapshot no elimina el último precio de productos ausentes.
11. Un snapshot sobrevive reinicio y cambio de día.
12. El selector offline usa preparado, último conocido y público en ese orden.
13. Una lista desconocida no reutiliza otra lista del cliente.
14. El fallback público exige confirmación.
15. Carrito y ticket usan exactamente el mismo precio tras cantidad, persistencia y rehidratación.
16. Tickets legacy sin metadatos siguen cargando.
17. Cachés legacy no se promueven a snapshots completos.
18. La reimpresión de una venta sincronizada usa las líneas de Odoo y solo reemplaza el ticket.
19. Un refresh online fuera de preparación actualiza únicamente mapping y ledger, sin tocar el manifiesto activo.
20. Suite existente de precios, preparación, venta offline, tickets y contratos.

## Criterios de aceptación

- Preparar ruta deja precios utilizables offline para cada cliente/lista exitosa.
- La búsqueda offline usa la misma identidad que la precarga.
- Un precio preparado no cae silenciosamente a `list_price`.
- La pérdida de red o el reinicio no elimina el último snapshot.
- El ticket local coincide con el carrito confirmado.
- Sin precio conocido, la venta continúa únicamente después de una advertencia.
- Odoo conserva su cálculo autoritativo al sincronizar.
