# Continuidad del catálogo e inventario referencial offline

**Fecha:** 2026-07-23

**Estado:** Diseño aprobado

**Entrega:** Continuidad offline 3 de 3

## Objetivo

La falta de conexión o de una descarga reciente de inventario no debe impedir agregar productos conocidos. Offline, la existencia será informativa; Odoo conservará la validación final cuando la venta se sincronice.

## Problema actual

La app ya persiste un catálogo, pero:

- la clave incluye el día y el sobre vence después de una jornada;
- un miss o entrada vencida elimina el catálogo;
- `ProductPicker` puede mostrar productos como referencia, pero `handleSelect` vuelve a bloquear cuando `qty_display <= 0`;
- el control de cantidad usa el stock viejo como máximo;
- `handleConfirm` ejecuta `findFreshStockIssues` incluso offline.

Por eso un catálogo visible puede seguir siendo inutilizable y un reinicio sin conexión puede dejar la lista vacía.

## Alcance

Esta entrega incluye:

- snapshot durable del último catálogo por contexto logístico;
- índice acotado de productos vendidos recientemente;
- unión determinista de fuentes;
- estado explícito de frescura de inventario;
- bypass de producto y cantidad solamente offline;
- persistencia del motivo de rechazo de Odoo en la venta pendiente.

Quedan fuera:

- permitir sobreventa en Odoo;
- modificar la barrera dura de stock del backend;
- reservas reales de inventario mientras el dispositivo está offline;
- editar o cancelar una venta pendiente desde la pestaña Ventas;
- compartir cachés entre empresas o almacenes.

## Contexto y persistencia

El último catálogo se particionará por:

- empresa;
- almacén;
- ubicación móvil, cuando exista;
- empleado, para evitar cruces en dispositivos compartidos.

No incluirá el día en su identidad. La fecha de descarga se conservará como metadato y nunca funcionará como expiración bloqueante offline.

```ts
interface LastKnownCatalogSnapshot {
  version: 1;
  companyId: number;
  employeeId: number;
  warehouseId: number;
  mobileLocationId: number | null;
  fetchedAtMs: number;
  inventorySource: InventorySource | null;
  hasStockData: boolean | null;
  products: TruckProduct[];
}
```

Cada carga exitosa reemplazará atómicamente el snapshot de su contexto. Un fallo de red no borrará el anterior.

## Productos vendidos recientemente

Se mantendrá un índice pequeño y versionado por el mismo contexto:

```ts
interface RecentSoldProduct {
  productId: number;
  name: string;
  defaultCode: string | null;
  listPrice: number;
  weight: number;
  lastSeenAtMs: number;
}
```

Se actualizará al confirmar localmente una venta y tendrá un límite fijo, ordenado por uso reciente, para evitar crecimiento indefinido. Este índice permite reconstruir una selección mínima incluso cuando nunca se pudo persistir el catálogo completo.

No almacenará precios específicos del cliente; esa responsabilidad pertenece al snapshot de precios.

## Unión de fuentes

Offline, el catálogo efectivo respetará esta precedencia:

1. productos actuales en memoria;
2. último catálogo del contexto;
3. productos vendidos recientemente que no estén en las fuentes anteriores.

La identidad será `productId`. La fuente de mayor precedencia aporta nombre, código, peso y precio público.

Cada producto llevará una frescura de inventario:

```ts
type InventoryFreshness =
  | 'authoritative'
  | 'cached'
  | 'unknown';
```

- `authoritative`: carga online exitosa y aplicable al almacén actual;
- `cached`: cantidad proveniente del último snapshot;
- `unknown`: producto reconstruido desde ventas recientes o respuesta sin stock confiable.

## Comportamiento del selector

Online:

- se conserva la ocultación y el bloqueo por stock autoritativo;
- el refresh exige conexión;
- la confirmación conserva `findFreshStockIssues`.

Offline:

- no se oculta un producto por `qty_display <= 0`;
- `handleSelect` no rechaza por stock cero, desconocido o antiguo;
- el control de cantidad acepta cualquier entero positivo y no usa el stock antiguo como máximo;
- el producto muestra `Stock sin validar`;
- se muestra la antigüedad del catálogo cuando exista;
- la validación local de stock no bloquea `handleConfirm`.

El bypass depende de la conectividad real y no de una heurística de cantidades. Volver online reactiva la validación estricta.

## Sincronización y rechazo de Odoo

El payload seguirá enviando producto y cantidad. El backend conservará `_check_route_stock` como barrera final.

Si Odoo rechaza por inventario:

- la cola conserva la venta y su `operation_id`;
- la tarjeta pasa a `Reintentando` o `Requiere atención`, según la política vigente;
- se persiste un mensaje entendible con los productos afectados;
- la venta no desaparece;
- no se incluye en el total oficial ni en el corte.

Esta entrega no introduce edición de la cola. La corrección manual seguirá el flujo de sincronización existente; una experiencia de edición/cancelación será una entrega posterior si operación la requiere.

## Separación respecto a precios

El catálogo efectivo aporta identidad del producto, peso y precio público de último recurso. `ProductPicker` debe solicitar después el precio mediante el resolvedor de snapshots por cliente:

1. precio preparado;
2. último precio del cliente;
3. precio público del producto efectivo con advertencia.

Así, recuperar un producto reciente no implica asumir que su último precio pertenecía al cliente actual.

## Errores y seguridad

- Un snapshot corrupto se ignora sin borrar el índice reciente.
- Nunca se mezclan catálogos de empresa, almacén o empleado.
- Los datos antiguos se etiquetan; no se presentan como inventario actual.
- El bypass se desactiva al recuperar conexión.
- Odoo continúa rechazando cantidades sin existencia.
- Logout limpia memoria; la persistencia queda particionada y no se rehidrata bajo otro contexto.

## Pruebas

1. El snapshot no se invalida solo por cambiar de día.
2. Un fallo de refresh conserva el catálogo anterior.
3. Contextos de almacén, empresa, ubicación y empleado no se mezclan.
4. El índice reciente se actualiza y respeta su límite.
5. La unión elimina duplicados con precedencia correcta.
6. Offline permite seleccionar stock cero, cacheado o desconocido.
7. Offline no limita cantidad con stock antiguo.
8. Online mantiene bloqueo y validación estricta.
9. La confirmación offline omite el bloqueo local de stock.
10. El rechazo del backend permanece visible en la cola y Ventas.
11. El catálogo no reutiliza precios específicos de otro cliente.
12. Suite existente de producto, inventario, venta offline, rehidratación y sincronización.

## Criterios de aceptación

- Un vendedor puede abrir el selector offline usando el último catálogo conocido.
- Si el catálogo falta, los productos vendidos recientemente siguen disponibles.
- Offline, stock cero o desconocido no bloquea producto ni cantidad.
- La UI identifica el stock como no validado.
- Online conserva las protecciones actuales.
- Un rechazo de Odoo queda visible y no altera el corte.

