# KoldField — QA Pedido offline pendiente de envío

**Rama:** `feat/koldfield-offline-pending-orders` · **Base:** `main` @ `e188275`
**Política:** **S1** (no se descuenta stock local; el backend valida/descuenta al confirmar en Odoo). **Piloto controlado** — autorizado asumiendo el riesgo hasta que #116 esté en prod.

## Qué cambió
Sin señal, "Confirmar Pedido" ya **no bloquea**: guarda el pedido como **pendiente de envío** (encola `sale_order` + foto) y permite avanzar. **Nunca** se marca como venta confirmada offline, **no** se crea pago ni se descuenta stock local; al reconectar el dispatcher de la cola ejecuta `createSale` (Odoo confirma + cobra). Idempotente por `_operationId`. cashclose/route-close **siguen bloqueados** mientras haya pedidos pendientes/error (cuentan en `pendingCount`).

> **Importante (riesgo aceptado):** un "pedido pendiente" se convierte en **venta real + cobro en Odoo al sincronizar** (puede ser horas después, contra el stock de ese momento). Sin #116 (stock guard duro, en staging) dos pedidos offline pueden **sobrevender**, detectado solo al sincronizar (`insufficient_stock`). Mitigar en piloto: stock holgado, supervisión, sincronizar pronto.

## Estados (rótulos del botón / UI)
| Cola | Botón venta | Significado |
|---|---|---|
| `pending` | ⏳ Pedido pendiente de envío | capturado, sin enviar |
| `syncing` | (enviando) | en envío |
| `done` | ✓ Pedido enviado | Odoo aceptó |
| `error`/`dead` | ⚠️ Error al enviar (revisa Sync) | Odoo rechazó / falló |
| (online directo) | ✓ Pedido confirmado | venta online inmediata |

## Casos de prueba
1. **Capturar pedido sin señal:** modo avión → arma productos + foto → "Guardar pedido pendiente" → Alert "Pedido guardado. Pendiente de envío…"; botón pasa a "⏳ Pedido pendiente de envío".
2. **Avanzar al siguiente cliente:** tras guardar, "Continuar a checkout"/"Volver a ruta" funciona; el vendedor sigue su ruta.
3. **Ver en Sync:** la pantalla Sync muestra el `sale_order` pendiente (y la foto dependiente).
4. **Reconectar y sincronizar:** al volver online (o "Sincronizar pendientes") el pedido se envía; estado → "✓ Pedido enviado". La foto sube después (dependsOn).
5. **Estado enviado:** checkout muestra la venta sincronizada; no re-confirma; no duplica.
6. **`insufficient_stock` al sincronizar:** si Odoo rechaza por stock (con #116), el item queda en error con `available_qty`; el vendedor corrige/cancela; **no** se marcó como vendido.
7. **Sesión expirada al sincronizar:** la cola marca error; al re-login se reintenta; sin duplicar (mismo `_operationId`).
8. **Bloqueo cierre/liquidación:** con un pedido `pending`/`error`/`dead`, cashclose **no** habilita "Confirmar liquidación" y route-close **no** permite cerrar (mensaje de pendientes). Tras sincronizar todo → se habilitan.
9. **Doble-tap offline:** un solo `sale_order` encolado (lock `saleConfirmed` + `_operationId` estable).
10. **Pedido muerto:** un `sale_order` que agota reintentos NO restaura stock local (S1: no se descontó) y sigue visible/bloqueante en Sync hasta resolución manual.

## Pruebas automáticas (node)
- `tests/saleOfflineUx.test.ts` — banner pendiente + `saleConfirmButtonLabel` (pending/sent/error/guardar/confirmado; nunca "confirmado" si está pendiente).
- `tests/offlineSaleWiring.test.mjs` — offline encola `sale_order` + `photo`; online sigue `createSale`; sin descuento local (S1); rollback no-op (`sale_order_dead_no_stock_rollback`); insufficient_stock cableado.
- Cobertura existente: `getSaleSyncState` (saleSyncState), `rearmSaleOrderForRetry` (saleRetry), cashcloseGuard/routeCloseGuard (bloqueo por conteos).
- **typecheck limpio; tests 124/124.**

## Riesgos / dependencias
- **#116 (backend, draft/staging):** barrera dura anti-sobreventa + `insufficient_stock` con `data.lines` + idempotencia (ya existe por `operation_id`). **Hasta que esté en prod, el riesgo de sobreventa diferida persiste** (aceptado para piloto).
- **Reversión de la regla #42** (online-only) — coordinada con Yamil; conviene avisar a Sebas (dueño backend).
- Offroute offline: el cierre de visita especial por red no ocurre offline (queda al continuar/checkout); pre-existente.
- Per-cliente badge en ruta de "pedido pendiente": **follow-up menor** (hoy visible en Sync + checkout).

## Fuera de alcance
Backend #116, política S2 (descuento optimista), badge por-cliente en lista de ruta.
