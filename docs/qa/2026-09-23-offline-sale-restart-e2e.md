# QA: persistencia de venta offline después de reiniciar

Fecha: 23/09/2026  
Rama: `codex/integrate-staging-fixes-main`  
Commit funcional probado: `ce635bf` (`fix(sales): preserve offline sale lines after restart`)  
Aplicación: `mx.grupofrio.koldfield.dev`  
Dispositivo: Android físico `R5CT60ZLR4V`, conectado por ADB  
Perfil: empleado QA 2549, `[QA GDL] KOLD FIELD`

## Resultado

**Aprobado.** Una venta guardada sin conexión conservó producto, cantidad, precio, inventario local y visita activa después de forzar el cierre de la aplicación. Al recuperar la conexión se sincronizó exactamente una vez, recibió el folio `S31651` y permitió completar la visita.

## Escenario ejecutado

- Plan QA: `7162`, en progreso.
- Parada usada: `216374`, cliente QA `67905`.
- Producto: `2996`, `[QA-GDL-KF] [QA GDL] PRODUCTO PRUEBA KOLD FIELD`.
- Inventario inicial mostrado: 13 unidades.
- Venta de prueba: 1 unidad a `$11.50`, con foto obligatoria.
- Venta previa de control: `S31637`, sin modificaciones.

## Evidencia E2E en Android

1. Se hizo check-in conectado y se preparó una venta de una unidad.
2. Se activó el modo avión y se guardó el pedido pendiente. La app mostró dos operaciones en cola y confirmó que el pedido no se enviaría hasta recuperar conexión.
3. Se forzó el cierre de `mx.grupofrio.koldfield.dev`.
4. Se reinició Metro desde el worktree correcto y se volvió a abrir la app sin restablecer datos.
5. Todavía sin conexión, la app recuperó:
   - dos operaciones en cola;
   - la visita activa de la parada `216374`;
   - inventario local de 12 unidades;
   - una venta pendiente por `$11.50` en Ventas del día.
6. Al recuperar Wi-Fi, la venta pasó por `Sincronizando` y desapareció de pendientes.
7. El servidor devolvió un único folio nuevo, `S31651`. Ventas del día mostró exactamente dos pedidos: `S31651` y el control previo `S31637`.
8. El ticket `S31651` conservó la línea `1 x $11.50` del producto QA.
9. Se completó el check-out: venta `$11.50`, 1.0 kg, GPS registrado. La ruta quedó en `2/2 visitados · 100%`.

Capturas principales:

- Guardado offline: `../../.tmp-tests/auto-e2e-20-offline-order-saved.png`
- Ruta recuperada después de reiniciar: `../../.tmp-tests/auto-e2e-40-restored-route-offline.png`
- Venta pendiente recuperada: `../../.tmp-tests/auto-e2e-44-sales-offline-after-restart.png`
- Sincronización en curso: `../../.tmp-tests/auto-e2e-45-after-reconnect-sync.png`
- Sincronización terminada, sin duplicado: `../../.tmp-tests/auto-e2e-46-after-sync-wait.png`
- Ticket `S31651`: `../../.tmp-tests/auto-e2e-47-new-sale-ticket.png`
- Check-out: `../../.tmp-tests/auto-e2e-51-after-checkout.png`
- Ruta completada: `../../.tmp-tests/auto-e2e-53-route-complete.png`
- Inventario final de 12 unidades: `../../.tmp-tests/auto-e2e-54-inventory-after-sync.png`

## Verificación automatizada

- `node --experimental-strip-types --test tests/visitPersistence.test.ts tests/visitState.test.ts tests/legacySaleRecoveryRoundTrip.test.ts`: **4/4 aprobadas**.
- Suite ampliada de visita, recuperación, rehidratación, cola y UX offline: **35/36 aprobadas**.
- El único fallo ampliado es de portabilidad del test `rehydrateSaleOrdering.test.mjs`: su expresión regular exige finales de línea `LF`, mientras el archivo inspeccionado usa `CRLF` en Windows. La comprobación funcional del mismo archivo, que exige recuperar el estado antes de despertar la cola, sí aprobó.
- `npm run typecheck`: **aprobado**, salida 0.

Salidas:

- `../../.tmp-tests/offline-sale-persistence-tests.txt`
- `../../.tmp-tests/offline-sale-regression-suite.txt`
- `../../.tmp-tests/offline-sale-typecheck.txt`

## Observaciones

- El primer reintento de apertura mostró `There was a problem loading the project` porque el cliente de desarrollo apuntaba a procesos Metro anteriores. Se detuvieron ambos procesos, se levantó Metro limpio desde este worktree en el puerto 8081 y se reabrió la app sin borrar almacenamiento. La venta reapareció offline, por lo que el reinicio del entorno no alteró el resultado funcional.
- La vista agregada de Odoo muestra `$13.34` por pedido, mientras el ticket conserva subtotal y total de `$11.50`. Esta diferencia de impuestos ya estaba identificada y queda fuera del alcance de la corrección de persistencia.
- La ruta quedó completada en visitas, pero no se ejecutó `Cerrar ruta`; ese paso pertenece al flujo de corte/devolución y no era necesario para esta validación.
