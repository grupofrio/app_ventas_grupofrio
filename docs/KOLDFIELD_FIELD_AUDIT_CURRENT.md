# KoldField — auditoría operativa vigente y decisiones

**Estado:** vigente

**Fecha de corte:** 2026-07-17

**Base auditada:** `main@4cb062f`

**Aplicación:** `1.3.1` · Android `versionCode 3`
**Reemplaza:** la auditoría de solo lectura hecha sobre `fix/koldfield-backend116-integration@b70c081` y cualquier conclusión de `docs/KOLDFIELD_SELLER_EXPERIENCE_AUDIT.md` que contradiga este corte.

> Este documento actualiza diagnóstico, respuestas y prioridades. No afirma que el backend productivo o los dispositivos de campo hayan sido validados en vivo el 2026-07-17. La evidencia de este corte es el código de `main`, sus pruebas y los documentos de validación existentes.

## 1. Respuesta al incidente de ruta

El vendedor no había olvidado iniciar la ruta. La evidencia recibida mostraba que Odoo tenía `RPLAN/2026/00686` en progreso, con 24 de 33 paradas completadas (73 %), hora de salida y carga sellada. La aplicación móvil, en cambio, conservaba hechos locales de inicio incompletos y el `OperationGate` los trataba como si pudieran revocar el estado del servidor. Por eso mostró **“Ruta no iniciada”** a mitad de jornada.

La corrección ya está integrada en `main@4cb062f`:

- `plan.state === 'in_progress'` en Odoo es autoritativo y habilita la operación.
- Los hechos locales de checklist, KM y carga solo explican lo que falta antes de iniciar un plan `published`; no pueden volver a bloquear uno que el servidor ya inició.
- El inicio nuevo exige confirmación real de `/plan/start`, valida el `plan_id` y el estado `in_progress`, actualiza el plan persistido y evita doble toque.
- El refresco sincroniza los hechos de inicio desde el plan y conserva caché útil ante fallas transitorias.

**Resolución de campo:** instalar una APK construida desde `main@4cb062f` o posterior (`versionCode 3`), abrir la ruta y forzar actualización. No se debe capturar otro KM inicial ni reiniciar administrativamente una ruta que Odoo ya reporta `in_progress`. Si reaparece con ese build, exportar el diagnóstico del dispositivo antes de limpiar datos.

## 2. Qué cambió desde la auditoría anterior

Leyenda: **resuelto**, **parcial**, **abierto**, **requiere decisión externa**.

| # | Queja de campo | Estado vigente | Evidencia y pendiente real |
|---|---|---|---|
| 1 | No deja vender | **Parcial** | Ya persisten catálogo y precios; el picker no dispara RPC de pricelist sin conexión; `insufficient_stock` conserva `code/data`. Sigue abierto el tope duro por stock local/cacheado en `ProductPicker` y `useVisitStore`; la confirmación aún intenta resolver pricelist antes de entrar al branch offline; y una respuesta perdida en venta online llama `unlockSaleConfirm()`, pudiendo generar otro `operation_id` en el siguiente intento. |
| 2 | No deja llenar checklist | **Abierto** | Cada respuesta y foto se envía inmediatamente al backend. Los borradores viven solo en memoria y no hay cola offline; si la pantalla se desmonta o la app se reinicia antes de poder enviarlos, el avance no enviado se pierde. |
| 3 | No avanza si un punto no está satisfactorio | **Parcial / no apto para cerrar** | El frontend considera listo un checklist totalmente respondido aunque el backend reporte un punto bloqueante, pero `/vehicle-checklist-complete` todavía documenta que el backend rechaza fallas bloqueantes. `/plan/start` sigue siendo autoritativo. Falta contrato de “continuar con incidencia” y política de seguridad. |
| 4 | No deja hacer regalos | **Parcial** | El regalo sí se encola offline con idempotencia y muestra faltantes de partner/ubicación/plaza. Sigue leyendo `mobile_location_id` solo del plan, aunque Auth también lo conserva; mantiene un bloqueo duro por stock fresco/cacheado; el botón en la parada sigue deshabilitado antes de check-in sin explicar la causa junto al botón. |
| 5 | No deja vender sin señal | **Parcial** | Ya sobreviven reinicios el catálogo y los precios, y el picker evita computar precios por red cuando está offline. Sin embargo, `handleConfirm` todavía llama `getPartnerPricelistId` antes del branch offline cuando el stop no trae pricelist; además, un producto con `qty_display <= 0` no puede agregarse y el confirm valida contra stock local aunque sea referencial. La venta offline existe, pero estos prerequisitos todavía pueden impedir llegar a la cola. |
| 6 | No sincroniza al recuperar señal | **Abierto — siguiente PR** | `enqueue` intenta procesar a los 100 ms y `setOnline(true)` despierta la cola cuando hay ítems `pending`. El hueco real es que no existe listener de `AppState`, no hay timer para el menor `next_retry_at`, `setOnline` no despierta una cola formada solo por errores y `isInternetReachable === null` se modela como online. Por eso un error en backoff o un regreso desde background puede quedar detenido hasta otra acción. |
| 7 | No carga ruta en CEDIS | **Parcial** | `fetchMyPlan` ya distingue `found:false` de red/servidor/respuesta inválida; el store conserva la ruta cacheada y hay botón Reintentar cuando existe plan. Sin plan cacheado, cualquier timeout/error todavía termina en “No tienes ruta” sin retry. Además, `my_plan` y `plan/stops` usan `postRest` y conservan timeout de mutación de 45 s; `getPlanStops` convierte el fallo en `[]` y deja la causa solo en logs. |

### Hallazgos de la auditoría anterior que ya no deben abrirse como trabajo nuevo

- **Catálogo/precios no persistentes:** resuelto con caché de jornada y rehidratación (`PRODUCTS_CATALOG`, `hydrateFromCache`, `hydratePriceCacheFromDisk`).
- **RPC de pricelist del picker colgado sin conexión:** resuelto en el picker; **no confundir con la confirmación de venta**, que todavía puede llamar `getPartnerPricelistId` antes de encolar offline.
- **Detalle de `insufficient_stock` perdido:** resuelto; `unwrapRestResult` conserva `error.code` y `error.data`.
- **Ruta iniciada bloqueada por hechos locales:** resuelto en `main@4cb062f`.
- **Preparación de ruta sin gate mínimo:** resuelto; `route-start` exige ruta y productos mediante `computeRouteReadiness` y monta `RoutePreparationCard`.
- **Versiones divergentes:** el código auditado coincide en `1.3.1`; Android usa `versionCode 3`.

### Hallazgos confirmados que siguen abiertos

- Despertadores de Sync: foreground, backoff y conectividad indeterminada.
- Confirmación de venta offline todavía puede intentar resolver pricelist por red antes de encolar.
- Checklist offline y contrato de incidencia para puntos bloqueantes.
- Stock referencial tratado todavía como límite duro para venta y regalo.
- Error ambiguo de venta online puede liberar el `operation_id` demasiado pronto.
- Refill y unload se encolan como `prospection`; los dispatchers `refill`/`unload` existen pero son inalcanzables desde esas pantallas.
- Incidentes de ruta son online-only.
- Login y autenticación JSON-RPC usan `fetch` sin timeout.
- Metadatos universales de idempotencia están desactivados (`CLIENT_EVENT_META_ENABLED = false`).
- Telemetría remota no está conectada; `sendMonitoringSnapshot` devuelve `endpoint_not_configured`.

## 3. Respuestas a las decisiones de la auditoría

### 3.1 ¿Se aprueba el roadmap V1.1–V1.5?

**Sí como estructura de trabajo, no como lista literal.** Debe rebaselinarse porque partes importantes de V1.1 y V1.3 ya están en `main`.

Orden vigente:

1. **PR-1 — despertadores de Sync.** Frontend puro, una intención.
2. **PR-2 — estado vacío/error de ruta.** Mostrar error y Reintentar sin caché; timeout corto explícito para lecturas de plan/stops; no ocultar fallo de stops como ruta vacía.
3. **PR-3 — refill/unload.** Encolar con sus tipos reales, validar modelos de backend, `operation_id` y rollback.
4. **PR-4 — venta offline, stock referencial e idempotencia.** Saltar la resolución remota de pricelist cuando no hay conexión, separar dato visual de límite autoritativo y preservar el mismo `operation_id` ante resultado ambiguo.
5. **PR-5 — checklist con incidencia.** Solo después de decisión de Operaciones y contrato backend.
6. **Observabilidad.** Conectar ingesta y alertas cuando exista endpoint.

No se debe crear una rama “V1.1 completa” que mezcle Sync, venta, checklist, ruta y login.

Backlog posterior explícito, fuera del PR-1 pero no descartado:

- Añadir timeout y recuperación clara al login y a la autenticación JSON-RPC.
- Encolar incidentes de ruta offline, una vez confirmado el contrato de backend.
- Usar `auth.mobileLocationId` como fallback del regalo y explicar el prerequisito de check-in junto al botón.
- Cerrar idempotencia de check-in, checkout y no-venta con contrato backend antes de activar `_client_meta` universal.

### 3.2 ¿Se debe iniciar PR-1 `fix/koldfield-sync-wakeup-triggers`?

**Sí.** Es el siguiente cambio recomendado para el colaborador, partiendo de `main@4cb062f` o de un `main` posterior que lo contenga.

Alcance cerrado del PR:

- Al volver `AppState` a `active`: consultar conectividad y procesar la cola si hay trabajo elegible.
- Programar un único timer para el menor `next_retry_at` de ítems reintentables; reprogramarlo al cambiar la cola y limpiarlo al desmontar/resetear.
- Modelar correctamente NetInfo cuando `isInternetReachable` es `null`, evitando perder el despertar inicial y sin crear ciclos repetidos.
- Reusar el guard de concurrencia `isSyncing`; no crear un segundo procesador.
- Cubrir foreground, offline real, reachability indeterminado, backoff vencido, deduplicación y cleanup con pruebas puras.

Criterio de aceptación: al recuperar señal —con la app abierta o al volver del background— un pendiente elegible empieza a procesarse automáticamente en menos de 60 segundos, sin toque manual y sin dos ciclos concurrentes.

Fuera de alcance: cambiar contratos, reglas de dinero/inventario, checklist, ruta, refill/unload o UI general de Sync.

### 3.3 ¿Se envían las preguntas técnicas a Sebastián?

**Sí, pero actualizadas como sigue.** No enviar la lista antigua sin estas respuestas parciales.

## 4. Respuestas y preguntas vigentes para backend

| Tema | Respuesta disponible | Estado / pregunta que sí debe enviarse |
|---|---|---|
| Backend #116 | El documento del 2026-06-17 registra que Sebastián informó el despliegue productivo. El contrato en código pasó y la app entiende `insufficient_stock`, `already_closed` y `already_confirmed`. | **No está cerrado:** T1–T6 nunca se ejecutaron coordinadamente contra producción. Pedir fecha/ventana y datos de prueba para registrar evidencia PASS/FAIL. |
| Refill/unload por `/lead/upsert` | El frontend actual los manda erróneamente como `prospection`, por lo que caen en `/lead/upsert`; los casos `refill` y `unload` del dispatcher no se alcanzan. | No depender de que `/lead/upsert` interprete esos payloads. Confirmar modelos y permisos finales: `van.refill.request` para refill y `van.unload` o `van.unload.request` para unload; luego corregir el tipo frontend. |
| Idempotencia de check-in/out/no-sale | La cola asigna `_operationId` a todos los ítems, pero eso no prueba que cada controlador backend lo consuma. El mecanismo `_client_meta` está apagado. | Confirmar si los tres endpoints deduplican por `operation_id`/`x_client_op_uuid`; documentar nombre de campo y respuesta ante repetición antes de activar metadata universal. |
| Checklist con incidencia | No hay evidencia de un contrato backend de override. El frontend solo tiene una mitigación local cuando todas las respuestas están guardadas. | Definir si `/vehicle-checklist-complete` aceptará `override_reason`, incidencia/foto y una política por punto; `/plan/start` debe devolver estado trazable, no depender de una bandera local. |
| Estados de carga pendientes | El frontend bloquea con `confirmed`, `assigned`, `waiting`, `partially_available` y `draft`. | Sebastián + Operaciones deben confirmar cuáles estados representan carga realmente entregable/aceptable y cuál es la salida para un picking que nunca avanza. |
| Precios intradía | No hay evidencia en el repo. El caché usa ventana de jornada. | Confirmar si una pricelist puede cambiar durante la ruta y si existe `last_updated`/versión. Hasta entonces, el precio cacheado debe seguir marcado como referencial y el backend debe ser autoritativo. |
| Monitoreo | No existe endpoint configurado; el envío está comentado. | Definir endpoint autenticado, esquema, retención y límites para snapshots; después conectar `sendMonitoringSnapshot`. |

## 5. Respuestas pendientes de Operaciones

Estas preguntas no se pueden contestar honestamente desde el repositorio. Quedan convertidas en decisiones con dueño:

| Pregunta | Respuesta vigente | Dueño / evidencia requerida |
|---|---|---|
| ¿Qué puntos del checklist bloquean una unidad? | **Pendiente.** No debe decidirlo frontend. | Operaciones + Seguridad + Sebastián: matriz por `check_id` con `bloquea`, `permite incidencia`, foto/motivo obligatorio y quién autoriza. |
| ¿Cómo está el WiFi de cada CEDIS? | **Sin evidencia.** | Operaciones/Infra: prueba por CEDIS de cobertura, DNS/TLS y latencia en zona de carga; registrar fecha, dispositivo y resultado. |
| ¿Los vendedores conocen Sync/Reintentar? | **No confirmado.** | Jefatura de ruta: capacitación inmediata “al recuperar señal, revisar Sync y exportar diagnóstico si no baja”. No sustituye el fix automático. |
| ¿Cuáles son los casos exactos de 2–3 vendedores? | Solo está confirmado el caso de Ricardo Miranda: Odoo `in_progress` y móvil bloqueado por estado local obsoleto; corregido en `main@4cb062f`. | Recabar captura del mensaje, hora, plan, conectividad, versión/versionCode y export JSON de cada caso restante. |

## 6. Handoff para el colaborador

1. Actualizar su rama desde `origin/main` y verificar que contiene `4cb062f`.
2. Abrir el PR-1 de Sync con el alcance de §3.2; un PR = una intención.
3. Ejecutar typecheck y suite completa, más pruebas específicas de lifecycle/timer.
4. Probar en Android real: offline → pendiente → background → recuperar señal → foreground; y error con backoff → despertar al vencer.
5. Adjuntar evidencia de tiempos y asegurar que no hay doble envío.
6. No reutilizar los números de línea de la auditoría antigua: corresponden a `b70c081` y ya no representan `main`.

## 7. Estado de verificación de este corte

- Revisión estática contra `main@4cb062f`: completada.
- `npm run typecheck`: exit 0.
- `npm test`: 139 tests aprobados, 0 fallos.
- Backend productivo el 2026-07-17: no consultado ni mutado.
- Dispositivo de campo con APK `versionCode 3`: pendiente de instalación/validación operativa.
- Contrato #116: soportado por código; E2E T1–T6 sigue pendiente.
