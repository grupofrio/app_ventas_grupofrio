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
  companyId: number;
  partnerId: number;
  resolvedPricelistId: number | null;
  preparedAtMs: number;
  productFingerprint: string;
  prices: Array<[productId: number, unitPrice: number]>;
}
```

`prices` contendrá el precio completo de todos los productos devueltos por Odoo, incluso cuando coincida con `list_price`. Así, un cambio posterior en el catálogo público no altera retroactivamente el snapshot.

La identidad primaria será `companyId + partnerId + resolvedPricelistId`. También se conservará un índice al snapshot más reciente por `companyId + partnerId`, necesario cuando una parada antigua no traiga la lista o cuando Odoo la resuelva durante la preparación.

El reemplazo será atómico: primero se valida el snapshot completo y después se publica como el último conocido. Una respuesta parcial o fallida no debe borrar el snapshot anterior.

La antigüedad será informativa offline, no una causa de eliminación. Online, la app siempre intentará actualizarlo.

## Preparación de ruta

La preparación derivará objetivos únicos desde las paradas, preservando:

- `partnerId`;
- `stop._pricelistId`, cuando exista;
- empresa activa.

Ya no reducirá el trabajo únicamente a una lista de partners. Para cada objetivo consultará el endpoint de precios con la lista explícita de la parada. La respuesta deberá conservar tanto la lista finalmente resuelta como todos los precios calculados.

Si el mismo cliente aparece varias veces con la misma lista, se calcula una vez. Si aparece con listas diferentes, cada combinación tendrá su propio snapshot.

Los fallos seguirán aislados por cliente/lista. Al finalizar se persistirán los snapshots exitosos y se mantendrán los anteriores para los fallidos.

## Resolución en el selector

Online:

1. usar un snapshot fresco en memoria cuando corresponda;
2. solicitar el cálculo actual a Odoo cuando falte o se fuerce actualización;
3. reemplazar atómicamente el último snapshot.

Offline:

1. snapshot exacto de cliente + lista;
2. último snapshot del mismo cliente y lista;
3. último snapshot del cliente cuando la parada no permita identificar la lista;
4. `list_price` solamente si nunca existió un precio conocido para ese producto.

El cuarto caso no bloqueará la venta, pero mostrará una confirmación al vendedor indicando que se usará precio público sin validación del cliente.

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

El valor `SaleLineItem.price` seguirá siendo el único precio usado para subtotal, total e impresión local. Los metadatos sirven para interfaz, diagnóstico y auditoría; no habrá un segundo cálculo al imprimir.

Odoo seguirá siendo la autoridad durante la sincronización. Si la tarifa cambió después de preparar la ruta, el pedido de Odoo puede diferir del ticket ya impreso. Cuando el pedido aparezca en `sales/list`, una reimpresión se construirá desde las líneas definitivas del servidor y reemplazará el snapshot local correspondiente.

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
3. Dos listas para el mismo cliente generan snapshots distintos.
4. El mapa persistido incluye precios iguales a `list_price`.
5. Un fallo parcial conserva el snapshot anterior.
6. Un snapshot sobrevive reinicio y cambio de día.
7. El selector offline usa exacto, último conocido y público en ese orden.
8. El fallback público exige confirmación.
9. Carrito y ticket usan exactamente el mismo precio.
10. Tickets legacy sin metadatos siguen cargando.
11. La reimpresión de una venta sincronizada usa las líneas de Odoo.
12. Suite existente de precios, preparación, venta offline, tickets y contratos.

## Criterios de aceptación

- Preparar ruta deja precios utilizables offline para cada cliente/lista exitosa.
- La búsqueda offline usa la misma identidad que la precarga.
- Un precio preparado no cae silenciosamente a `list_price`.
- La pérdida de red o el reinicio no elimina el último snapshot.
- El ticket local coincide con el carrito confirmado.
- Sin precio conocido, la venta continúa únicamente después de una advertencia.
- Odoo conserva su cálculo autoritativo al sincronizar.

