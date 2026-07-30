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

## Productos usados recientemente

Se mantendrá un índice pequeño y versionado por el mismo contexto:

```ts
interface RecentProductSnapshot {
  productId: number;
  name: string;
  defaultCode: string | null;
  listPrice: number;
  weight: number;
  lastSeenAtMs: number;
}
```

Se actualizará al confirmar y encolar localmente una venta, antes de conocer el resultado de Odoo. Una venta posteriormente rechazada no elimina su producto del índice: este registro representa descubribilidad reciente, no una contabilidad de ventas confirmadas.

El índice conservará como máximo 100 productos por contexto, con reemplazo LRU por `lastSeenAtMs`. En caso de empate se ordenará por `productId` ascendente para elegir una víctima estable. Este límite evita crecimiento indefinido y permite una prueba determinista. El nombre evita sugerir que el servidor ya confirmó la venta.

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

El catálogo efectivo usará un tipo de presentación explícito que combine la identidad del producto con `origin` e `inventoryFreshness`; no se fabricará un `TruckProduct` completo con campos de inventario inexistentes.

## Comportamiento del selector

El bypass será opt-in mediante una política explícita del consumidor, por ejemplo `stockPolicy="offline_sale"`. Solo el flujo de venta de visita lo habilitará. Preventa, consignación y cualquier otro consumidor de `ProductPicker` conservarán sus reglas actuales hasta contar con un diseño propio.

Online:

- se conserva la ocultación y el bloqueo por stock autoritativo;
- el refresh exige conexión;
- la confirmación conserva `findFreshStockIssues`.

Si vuelve la conexión mientras el catálogo solo contiene inventario `cached` o `unknown`, la app fuerza una carga autoritativa. Hasta que esa carga tenga éxito, el flujo de venta online muestra `Actualizando inventario` y no permite agregar líneas nuevas ni confirmar. Si la conectividad vuelve a declararse offline, se reactiva la política referencial.

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

Si Odoo rechaza con `error_code: insufficient_stock`:

- la cola conserva la venta y su `operation_id`;
- la operación pasa directamente a un estado no reintentable automáticamente y la tarjeta muestra `Requiere atención`;
- se persiste un mensaje entendible con los productos afectados;
- la venta no desaparece;
- no se incluye en el total oficial ni en el corte.

La cola ampliará su esquema durable con `error_code?: string | null`. Para un rechazo clasificado como inventario, `error_code: 'insufficient_stock'` es obligatorio antes de persistir el estado no reintentable; si el código no puede persistirse, la operación no se purga ni se presenta como resuelta. Tras reiniciar, este discriminador gobierna la tarjeta, la retención y el reintento.

`clearDead` no eliminará ventas `sale_order` con `insufficient_stock`; solamente una acción explícita de resolución puede retirarlas. La acción disponible en esta entrega será `Reintentar` después de una reposición o actualización de inventario, que rearma el mismo `operation_id`. Si tiene éxito, el pedido remoto reemplaza la tarjeta local.

Una venta en `Requiere atención` cuenta como operación de negocio irresuelta y mantiene bloqueados el cierre de ruta, corte y liquidación, igual que una venta pendiente, hasta que el reintento con el mismo `operation_id` termine correctamente. No aporta montos a los KPI oficiales durante ese tiempo.

Esta entrega no introduce edición ni cancelación de líneas. Si se requiere cambiar cantidades, esa experiencia será una entrega posterior. Hasta entonces una venta sin inventario suficiente permanece visible y no se pierde.

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
4. El índice reciente se actualiza al encolar, conserva rechazados y respeta el límite LRU de 100.
5. La unión elimina duplicados con precedencia correcta.
6. Offline permite seleccionar stock cero, cacheado o desconocido.
7. Offline no limita cantidad con stock antiguo.
8. Online mantiene bloqueo y validación estricta.
9. La confirmación offline omite el bloqueo local de stock.
10. El bypass opt-in no afecta preventa, consignación ni otros consumidores.
11. Volver online con inventario no autoritativo fuerza refresh y bloquea nuevas líneas.
12. `insufficient_stock` persiste obligatoriamente su código, pasa a atención requerida, no se reintenta automáticamente y sobrevive reinicio y `clearDead`.
13. Una venta en atención bloquea cierre, corte y liquidación sin alterar KPI oficiales.
14. Reintentar conserva el mismo `operation_id`.
15. El catálogo no reutiliza precios específicos de otro cliente.
16. Suite existente de producto, inventario, venta offline, rehidratación y sincronización.

## Criterios de aceptación

- Un vendedor puede abrir el selector offline usando el último catálogo conocido.
- Si el catálogo falta, los productos vendidos recientemente siguen disponibles.
- Offline, stock cero o desconocido no bloquea producto ni cantidad.
- La UI identifica el stock como no validado.
- Online conserva las protecciones actuales.
- Un rechazo de Odoo queda visible y no altera el corte.
