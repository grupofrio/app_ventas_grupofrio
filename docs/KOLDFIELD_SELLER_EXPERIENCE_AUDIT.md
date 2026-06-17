# KoldField — Auditoría de Experiencia Operativa del Vendedor en Ruta

**Fecha:** 2026-06-17 · **Rama:** `main` · **Commit auditado:** `d071959` · **PRs abiertos:** ninguno
**Typecheck:** ✅ exit 0 · **Tests:** ✅ 125/125

> Auditoría QA/UX/operativa **inmersiva** (no solo tests). Se simularon perfiles de vendedor, escenarios de señal, datos de cliente, inventario/precios y la jornada completa. Diagnóstico estático sobre código real (no emulador). **No se aplicaron fixes** (salvo nota explícita); entregable = diagnóstico + roadmap priorizado.

## Metodología y verificación

Se hicieron 5 barridos en profundidad por subsistema (ruta/sync/supervisor, venta/ProductPicker/stock-precio, offline/cola/checkout, flujos secundarios, arranque/cierre). **Cada hallazgo crítico se verificó contra el código** antes de clasificarlo, para no propagar falsos positivos.

**Falsos positivos descartados al verificar (NO son bugs):**
- **"No existe botón Confirmar Liquidación" (alegado P0).** FALSO: el botón existe en `app/cashclose.tsx:901-909`, cableado a `handleConfirmLiquidation` (512) y a `describeLiquidationButtonBlock` (365). El alegato venía de un comentario obsoleto en `cashcloseGuard.ts`.
- **"no_sale no tiene operation_id → duplica" (alegado P1).** FALSO: `useSyncStore.enqueue` asigna `payload._operationId = id` a **todo** item encolado (`useSyncStore.ts:205`). Todos los flujos (venta, no-venta, regalo, refill, consignación, preventa) heredan idempotencia por operation_id.
- **"Cantidad decimal 3.5 → 35" (alegado P1).** Degradado a **P4**: el input usa `keyboardType="number-pad"` + `inputMode="numeric"` (`sale/[stopId].tsx:457-458`); el teclado numérico no expone punto decimal. Solo reproducible con teclado físico o pegado.
- **"Badge de pedido no pasa a 'enviado'".** Es comportamiento intencional: `done` → sin badge (limpia la lista de ruta).

---

## Hito 2 — Perfiles de vendedor

### 1. Vendedor nuevo (se equivoca, toca rápido, no entiende Sync)
- **Anti-doble-tap:** ✅ presente en venta (`saleConfirmed` guard, `sale/[stopId].tsx:193`), regalo (`submitting`), refill, consignación, preventa. Confirmar dos veces no duplica.
- **Cliente equivocado / fuera de orden:** ✅ Alert de confirmación "Fuera de orden · el siguiente es X" antes de abrir (`route.tsx:193-215`). No bloquea, registra desviación.
- **Pantalla Sync:** mayormente clara (secciones PENDIENTES / CON ERROR / FALLIDOS PERMANENTEMENTE / COMPLETADOS, colores y resumen priorizado). **Fricción:** la diferencia "error (reintentable)" vs "dead (no reintenta)" solo se explica en un hint, no en el badge; botones deshabilitados sin tooltip de motivo.
- **Veredicto:** apto, pero confía demasiado en que el vendedor lea hints. **Score claridad nuevo: 6/10.**

### 2. Vendedor promedio (ruta normal, venta/no venta/regalo/refill, señal intermitente)
- Flujos core encolan bien offline (venta, no-venta, regalo). Refill encola directo. Reconexión dispara `processQueue`.
- **Fricción:** mensajes offline inconsistentes (refill dice "registrada" aunque solo encoló; consignación/preventa bloquean en vez de encolar).
- **Veredicto:** experiencia sólida en el camino feliz. **Score: 7/10.**

### 3. Vendedor experto (pocos toques, búsqueda, cambio rápido)
- Búsqueda potente (nombre/ref/contacto/teléfono/email/id/secuencia, debounced 300ms, normaliza acentos — `routeStops.ts:30-53`). Abrir cliente = 1 toque.
- **Fricción:** venta requiere varios pasos (productos + foto obligatoria + método pago + analítica + almacén). Sin subtotal por línea para verificación rápida.
- **Veredicto:** rápido para navegar; la venta en sí es multi-paso por diseño (auditoría/evidencia). **Score velocidad: 7/10.**

### 4. Vendedor bajo presión (mala señal, pantalla chica, GPS malo, cliente esperando)
- **GPS adquiriendo:** muestra "🔴 Fuera de rango (999m)" ficticio cuando no hay fix ni distancia precomputada (`stop/[stopId].tsx:84,120`) → confunde y puede inducir a pedir permiso off-distance sin necesidad.
- **Señal lenta:** sin timeout/feedback por ítem; spinner "Sincronizando…" puede colgar ~45s por request sin indicar cuál ítem (`useSyncStore` processQueue).
- **Veredicto:** funcional pero con confusiones bajo estrés. **Score robustez sin señal: 7/10.**

### 5. Supervisor / jefe de ruta (pendientes, errores, avance)
- **Pantalla Supervisor es MOCK** (`app/supervisor.tsx`): sin datos reales del equipo (quién tiene errores/dead, quién va atrasado, posiciones).
- El vendedor sí ve su propio estado (banner de pedidos en ruta, Sync). El supervisor **no** tiene visibilidad consolidada.
- **Veredicto:** brecha de gestión. **Score visibilidad supervisor: 3/10.**

---

## Hito 3 — Escenarios de señal

| Escenario | Comportamiento real | ¿Avanza? | ¿Duplica? | Claridad |
|---|---|---|---|---|
| Buena todo el día | Venta online directa (`createSale`), idempotente | ✅ | No | Alta |
| Intermitente | Encola/envía según conectividad; auto-trigger al reconectar | ✅ | No | Media |
| Sin señal al iniciar | Cae a caché de ruta; `routeFreshness='offline_cache'` | ✅ | — | **Media** (no avisa antigüedad de precios) |
| Sin señal al abrir cliente | Abre con datos en caché | ✅ | — | Media |
| Sin señal al agregar productos | ProductPicker cae a `list_price`/stock cacheado | ✅ | — | **Baja** (no marca "referencial") |
| Sin señal al guardar pedido | Encola `sale_order` + foto (`dependsOn`); no confirma/cobra/descuenta local (S1) | ✅ | No | Alta (banner pendiente claro) |
| Sin señal al checkout | No bloquea por `pending`; "Visita cerrada. Pedido pendiente" | ✅ | No | Alta |
| Reconexión con varios pendientes | `processQueue` ordena por prioridad + DAG (foto tras venta) | ✅ | No (operation_id estable) | Alta |
| Señal débil/lenta | Hasta ~45s por request sin feedback por ítem | ⚠️ percibe cuelgue | No | Baja |

**Idempotencia (verificada):** `enqueue` fija `_operationId=id` (`useSyncStore.ts:205`), constante en reintentos (el ítem se reprocesa, no se re-encola). **Depende de que el backend valide `operation_id` server-side** (B.3 — confirmar con Sebas).

**Bloqueos de cierre (verificado):** `sale_order` cuenta en `pendingCount` (solo `gps` excluido de `isUserVisibleSyncItem`); `cashcloseGuard`/`routeCloseGuard` bloquean con pending/error/dead/isSyncing. Limpieza de caché de jornada solo tras cierre exitoso (`route-close.tsx`). ✅ Correcto.

**Riesgo verificado (P1) — foto huérfana:** la foto se encola con `dependsOn:[saleId]` (`sale/[stopId].tsx:318-329`). `areSyncDependenciesSatisfied` exige `dep.status==='done'` (`syncDependencies.ts:15-18`). Si la venta llega a `dead` (3 fallos repetibles, p.ej. rechazo de stock sin #116), `markDead` **no cascada** a dependientes (`useSyncStore.ts:300-316`) → la foto queda `pending` para siempre. `clearDead` solo borra items `dead`, no la foto `pending` → **bloqueo permanente de cashclose sin escape en UI** + foto no sincronizada. Solo se libera si la venta finalmente tiene éxito.

**Detalle menor (P3):** `setOnline` solo dispara `processQueue` si hay items `pending`, no `error` en backoff (`useSyncStore.ts:320`); items en error esperan su timer aunque el vendedor vea "en línea".

---

## Hito 4 — Escenarios de cliente / datos

| Escenario | Qué ve el vendedor | Riesgo | Sev |
|---|---|---|---|
| Cliente completo | Tarjeta con score/forecast, acciones | — | — |
| Sin teléfono | Banner amarillo "no tiene teléfono… captúralo" + botón Capturar (`stop` screen) | Bajo (aviso claro) | P3 |
| Sin dirección/geo | En lista visible; botón "📍 Maps" → Alert "Sin ubicación" si no hay geo ni `google_maps_url`. En mapa no aparece (lista "unlocated") | Confusión (botón siempre activo) | P2 |
| Geo incorrecta | GeoFenceBar rojo "Fuera de rango: Xm"; botón principal bloquea salvo permiso off-distance | Bajo | P3 |
| Fuera de orden | Alert de confirmación, no bloquea | Bajo (log) | P3 |
| No encontrado (URL directa) | Pantalla "Parada no encontrada (ID: X)" + back | Bajo | P3 |
| Con lealtad | Botón "⭐ Lealtad" → vista solo-lectura (nivel/racha); requiere conexión, sin caché | Bajo (esperado) | P3 |
| Con consignación | Botón "📦 Consignación"; online-first, lectura con caché si existe | Inconsistencia offline | P2 |
| Con preventa | Pantalla preventa; online-only, sin cola | Inconsistencia offline | P2 |
| Con pedido pendiente | Badge naranja "📦 Pedido pendiente" en tarjeta + banner ruta + Sync | Bajo (visibilidad OK tras #48) | — |
| Con error de sync | Badge rojo "📦 Pedido con error"; bloquea cierre | **Trampa si llega a dead** (ver P1 foto huérfana) | P1 |

---

## Hito 5 — Inventario / precios / productos

- **Stock:** la línea captura `stock=qty_display` como tope; antes de confirmar revalida contra stock fresco. Backend rechaza `insufficient_stock` con detalle por producto ("pediste X, disponible Y") y **conserva el carrito** (`insufficientStock.ts`, `sale/[stopId].tsx:369-385`). ✅ No sobrevende localmente.
- **Stock referencial:** productos con `hasStockData===false` se muestran como "Agotado" pero el catálogo global avisa solo en fallback global; **sin conexión no hay banner de "stock referencial / última sync"** en el carrito.
- **Precios:** con conexión + pricelist → precio cliente (badge "cliente"); sin pricelist o sin conexión → `list_price` **sin diferenciación visual** de que es público/viejo (`ProductPicker.tsx:154-189`). Riesgo: vender a precio incorrecto sin saberlo.
- **Precio 0/corrupto:** no hay guard visible que impida confirmar con precio 0 → riesgo de "venta regalada" (verificar; backend debería rechazar).
- **Producto sin imagen:** fallback emoji por categoría. ✅
- **Carrito con muchas líneas:** ScrollView no virtualizado; fluido ~20 líneas; **sin subtotal por línea** (solo total global al final).
- **Cantidad equivocada:** `0`/texto → borra línea; negativos imposibles (regex digits-only); `>stock` se capea a stock sin avisar; decimal no aplica (number-pad).
- **Doble tap confirmar:** ✅ guard + `lockSaleConfirm` con operationId persistido (crash-safe).
- **Foto:** obligatoria siempre (`canConfirm` exige `salePhotoTaken`); sin lógica condicional por tipo de parada (aceptable, más seguro).

**Riesgo central (P1/P2): falta señalización "modo referencial offline".** La lógica es robusta (revalida stock, idempotente, no descuenta local), pero el vendedor **no distingue dato real vs referencial** en precios/stock sin conexión → puede cerrar ventas a precio/stock viejo sin advertencia. **Score confianza inventario/precio: 5/10.**

---

## Hito 6 — Jornada completa (calificación por paso)

| Paso | Claridad | Velocidad | Riesgo | Toques | Mensajes | Atasco | Recuperación |
|---|---|---|---|---|---|---|---|
| 1. Login | Media | Media | Bajo | 2 | "Sin conexión, verifica red" | **Sí, sin señal** (no reusa sesión guardada) | Reintentar en WiFi |
| 2. Preparar ruta/cache | Media | Media | **Medio** (sin "hace cuánto") | 1 | "Preparada a las HH:mm" | Errores vagos en red débil | Botón Reintentar |
| 3. Iniciar ruta / checklist | Alta | Alta | Bajo | 1-N | Checklist bloquea sin WiFi (correcto) | No | — |
| 4. Venta con señal | Alta | Media | Bajo | ~6 | Claros | No | Idempotente |
| 5. Pedido offline pendiente | Alta | Alta | Bajo | ~6 | "Pedido pendiente de envío" | No | Cola |
| 6. No venta | Alta | Media | Bajo | ~5 | Claros | No | Encola |
| 7. Regalo offline | Alta | Media | Bajo | ~6 | "Regalo guardado para sincronizar" | No | Encola + opId |
| 8. Consignación | Media | Media | **Medio** (online-only) | ~6 | "Requiere conexión" | **Sí si pierde red a mitad** | Esperar reconexión |
| 9. Refill | Media | Alta | Bajo | ~4 | "Registrada" (ambiguo offline) | No | Encola |
| 10. Reconexión / Sync | Alta | Media | Bajo | 0-1 | Estados claros | Señal lenta | Auto + manual |
| 11. insufficient_stock | Media | Media | Medio | ~5 | "pediste X, disponible Y" | No (conserva carrito) | Ajustar + reintentar |
| 12. Liquidación | Alta | Media | **Medio** (diferencia sin monto) | ~3 | "Hay diferencia" (sin importe) | No | Revisar / forzar |
| 13. Cierre ruta | Alta | Alta | Bajo | ~2 | Bloqueo claro con pendientes | No | Ir a Sync |

**Atasco potencial real:** paso 8 (consignación online-only) y la trampa P1 de foto huérfana (paso 5→11 si la venta muere).

---

## Hito 7 — Matriz de hallazgos

| # | Escenario | Perfil | Esperado | Actual | Fricción | Riesgo | Sev | Recomendación | PR |
|---|---|---|---|---|---|---|---|---|---|
| H1 | Venta muere (dead) con foto dependiente | Promedio | Foto y bloqueo se resuelven | Foto queda `pending` eterna, bloquea cashclose, sin escape UI | Alta | Pérdida foto + cierre bloqueado | **P1** | Cascada dead→dependientes o cancelar foto + escape en Sync | PR-G |
| H2 | Sin señal, precios/stock | Todos | Saber que es referencial | `list_price`/stock cacheado sin marca "referencial" | Media | Vender a precio/stock viejo | **P1** | Banner "referencial · última sync hace X" en carrito/picker | PR-A |
| H3 | Preparó ruta de día/plan anterior | Promedio | Aviso de antigüedad | "Preparada a las 06:00" sin "hace cuánto" | Media | Precios viejos, descuadre | **P1** | "Preparada hace Xh" + alerta si >2h | PR-C |
| H4 | Supervisor revisa equipo | Supervisor | Ver pendientes/errores/avance | Pantalla mock | Alta | Gestión ciega | **P1** | Dashboard real (depende backend) | PR-H |
| H5 | GPS adquiriendo | Bajo presión | "GPS no disponible" | "Fuera de rango (999m)" ficticio | Media | Falso off-distance | P2 | Mostrar "GPS no disponible" si no hay fix | PR-B |
| H6 | insufficient_stock múltiple | Promedio | Distinguir agotado vs reducible | Lista sin énfasis (0 vs N) | Media | Reintento fallido | P2 | Resaltar "disponible 0" en rojo | PR-D |
| H7 | Refill offline | Promedio | Saber si llegó o encoló | "Registrada" siempre | Baja | Expectativa falsa | P2 | "Guardada localmente, se enviará al reconectar" | PR-D |
| H8 | Liquidación con diferencia | Promedio | Ver monto faltante | "Hay diferencia" sin importe | Media | Acepta descuadre a ciegas | P2 | Mostrar capturado/esperado/diferencia | PR-F |
| H9 | Consignación pierde red | Promedio | Encolar como venta | Online-only, atasca | Media | Inconsistencia / espera | P2 | Encolar o mensaje consistente | PR-I |
| H10 | Login sin señal con sesión guardada | Todos | Reusar sesión | Pide reintentar | Media | No inicia operación | P2 | "Usar sesión anterior" offline | PR-I |
| H11 | Cliente sin geo toca "Maps" | Nuevo | Botón inactivo | Botón activo → Alert | Baja | Confusión | P2 | Deshabilitar Maps sin geo | PR-E |
| H12 | Botón deshabilitado en stop | Nuevo | Saber por qué | Opacity sin tooltip | Baja | Confusión | P3 | Hint de motivo | PR-E |
| H13 | Carrito grande | Experto | Subtotal por línea | Solo total global | Baja | Auditoría manual difícil | P3 | Subtotal por línea | PR-E |
| H14 | Refresh de plan durante visita | Promedio | Avisar | Reset silencioso (ghost-suppress) | Baja | Draft no capturado perdido | P3 | Aviso al resetear | PR-I |
| H15 | Checklist foto sin WiFi | Promedio | Error claro | "Error" genérico | Baja | Vuelve a CEDIS | P2 | Distinguir red/servidor | PR-D |
| H16 | Sync lento | Bajo presión | Feedback por ítem | Spinner ~45s sin detalle | Media | Percibe cuelgue | P2 | Indicador por ítem/timeout | PR-D |
| H17 | Preventa banner | Nuevo | Coherente con backend | Posible banner "pendiente de habilitar" obsoleto (confirmar) | Baja | Falsa alarma | P3 | Quitar/condicionar banner | PR-E |
| H18 | Cantidad decimal | Bajo presión | Entero | number-pad sin punto (ok); riesgo teclado físico/pegar | Baja | 10× edge | P4 | Validar `Number.isInteger` | PR-E |
| H19 | `/transfer` placeholder | — | No expuesto | "Proximamente" en ruta no enlazada | — | Limpieza | P4 | Ocultar/marcar | PR-E |
| H20 | GPS dedup en reinicio | — | Sin duplicado | Map en memoria se pierde | — | Telemetría | P4 | Persistir ventana | — |

**Severidad:** P0 bloquea operación · P1 pérdida/dato incorrecto · P2 confunde/retrasa · P3 mejora UX · P4 nice-to-have.
**P0 confirmados: ninguno** (el alegado fue falso positivo).

---

## Hito 8 — Calificación de la herramienta (1-10)

| Dimensión | Score | Nota |
|---|---|---|
| Velocidad en ruta | 7 | Navegación/búsqueda rápida; venta multi-paso por diseño |
| Claridad para vendedor nuevo | 6 | Sync estructurado; faltan tooltips/aclaraciones |
| Robustez sin señal | 7 | Core encola bien; consignación/preventa bloquean; foto huérfana |
| Recuperación de errores | 6 | Retry/dead/idempotencia sólidos; foto huérfana sin escape |
| Confianza inventario/precio | 5 | Lógica robusta pero sin señal "referencial" offline |
| Visibilidad supervisor | 3 | Pantalla mock |
| Prevención de duplicados | 9 | operation_id estable en todos los flujos (verificado) + anti-doble-tap |
| Cierre/liquidación | 8 | Guards robustos, botón existe; falta detalle de diferencia |
| Experiencia visual | 7 | Badges/colores claros; faltan tooltips/subtotales |
| Preparación para piloto | 7 | typecheck/test limpios, core funciona; P1 de señalización a cerrar |

**Calificación global ponderada: 6.5 / 10.**

**Conclusiones:**
- **¿Herramienta de primer nivel?** Cerca en arquitectura (idempotencia, offline-first, guards), **aún no en señalización al usuario**. Es una buena herramienta de piloto, no todavía "primer nivel" para producción amplia.
- **¿Qué falta para 9/10?** (1) Señal de "referencial/última sync" en precios/stock; (2) freshness de preparación; (3) resolver foto huérfana; (4) supervisor real; (5) detalle de diferencia en liquidación; (6) tooltips de bloqueo.
- **¿Qué bloquea APK QA?** Nada (no hay P0; ya estaba en GO_APK_QA). 
- **¿Qué bloquea producción?** P1 de señalización (H2, H3), foto huérfana (H1), supervisor (H4 para rol jefe), y backend **#116** (barrera dura de sobreventa) en staging.

---

## Hito 9 — Roadmap de PRs

### Antes de APK QA (UX-only, bajo riesgo — no tocan lógica de sync ni contrato)
- **PR-A — Indicador "referencial / última sync" en precios y stock** · Objetivo: que el vendedor sepa cuándo el dato no es en vivo · Riesgo: bajo · Archivos: `ProductPicker.tsx`, `sale/[stopId].tsx` · Tests: helper puro de copy/freshness · **Prioridad: P1**
- **PR-B — Geo "GPS no disponible" en vez de 999m** · Objetivo: no inducir off-distance falso · Riesgo: bajo · Archivos: `stop/[stopId].tsx` · Tests: helper de etiqueta de distancia · **P2**
- **PR-C — Freshness de preparación ("hace Xh" + alerta >2h)** · Objetivo: evitar vender con plan/precios viejos · Riesgo: bajo · Archivos: `RoutePreparationCard.tsx`, `routePreparationLogic.ts` · Tests: puro · **P1**

### Durante piloto (UX/mensajería)
- **PR-D — Mensajería de borde** (insufficient_stock resalta agotados; refill "guardada localmente"; checklist distingue red/servidor; feedback por ítem en sync) · Riesgo: bajo · Archivos: `insufficientStock.ts`, `refill.tsx`, `checklist/[planId].tsx`, `sync.tsx` · Tests: puros · **P2**
- **PR-E — Pulido UX** (tooltip de motivo en botones disabled, deshabilitar Maps sin geo, subtotal por línea, validar entero, limpiar `transfer`/banner preventa) · Riesgo: bajo · Archivos: `stop/[stopId].tsx`, `route.tsx`, `sale/[stopId].tsx`, `presale.tsx`, `transfer.tsx` · Tests: puros · **P3**
- **PR-F — Detalle de diferencia de efectivo** · Objetivo: liquidar sin descuadre a ciegas · Riesgo: bajo · Archivos: `cashclose.tsx` (texto del Alert) · Tests: helper de formato · **P2**

### Antes de producción
- **PR-G — Foto huérfana** · Objetivo: cascada `dead→dependientes` o cancelar/liberar foto al morir la venta + escape en Sync · Riesgo: **medio (toca lógica de cola)** → coordinar; fuera del alcance de "no cambiar lógica de sync" · Archivos: `useSyncStore.ts`, `syncDependencies.ts`, `sync.tsx` · Tests: unit de DAG/dead-cascade · **P1**
- **PR-I — Consistencia offline + login** (consignación encola o mensaje consistente; aviso al resetear visita; "usar sesión anterior" offline) · Riesgo: medio · Archivos: `consignment/[stopId].tsx`, `useRouteStore.ts`, `login.tsx`, `useAuthStore.ts` · **P2**

### Dependientes de backend #116 (Sebas, vía PR a `GrupoFrio`, requiere staging)
- **PR-H — Supervisor real** (telemetría de equipo: pendientes/errores/avance/posición) · **P1** gestión · depende de endpoints backend.
- **insufficient_stock por-línea** (`data.lines`) y barrera dura de sobreventa · depende de #116.

### Solo UX (sin backend, sin contrato): PR-A, PR-B, PR-C, PR-D, PR-E, PR-F.

---

## Entregables del Hito 10

1. **Commit auditado:** `d071959` (main).
2. **Typecheck/test:** ✅ exit 0 · 125/125.
3. **Documento:** este archivo.
4. **Calificación global:** **6.5/10** (buena herramienta de piloto; aún no "primer nivel" para producción amplia).

### Top 10 fricciones
1. Precios/stock sin marca "referencial" offline (H2).
2. Preparación sin "hace cuánto" (H3).
3. Geo "999m" ficticio durante adquisición GPS (H5).
4. Botones deshabilitados sin tooltip de motivo (H12).
5. Sync lento sin feedback por ítem (H16).
6. Diferencia de liquidación sin monto (H8).
7. Refill "registrada" ambiguo offline (H7).
8. Consignación online-only (inconsistente vs venta/regalo) (H9).
9. Login no reusa sesión guardada sin señal (H10).
10. Sin subtotal por línea en carrito grande (H13).

### Top 10 riesgos operativos
1. **Foto huérfana** bloquea cierre + foto perdida si la venta muere (H1, P1).
2. **Vender a precio/stock referencial viejo** sin advertencia (H2, P1).
3. **Vender con preparación de plan/día anterior** (H3, P1).
4. **Supervisor ciego** (H4, P1).
5. Sobreventa detectada solo al sincronizar sin **#116** (riesgo de modelo S1).
6. Idempotencia depende de validación server-side de `operation_id` (confirmar B.3).
7. Descuadre de caja por confirmar diferencia sin ver monto (H8).
8. Consignación huérfana sin ruta/ubicación de contexto (verificar) / atasco offline (H9).
9. Precio 0 no bloqueado en app (verificar guard backend) — venta regalada.
10. Draft de visita perdido en reset por refresh de plan (H14).

### Escenarios P0/P1
- **P0:** ninguno confirmado.
- **P1:** H1 (foto huérfana), H2 (precio/stock referencial), H3 (freshness preparación), H4 (supervisor mock).

### Qué probar en Android real (no cubrible estáticamente)
1. Modo avión completo: venta→checkout→avanzar cliente; reconectar → envía sin duplicar.
2. Forzar venta que muera (3 rechazos) → ¿la foto queda atascada y bloquea cashclose? (validar H1 en dispositivo).
3. GPS adquiriendo: confirmar texto "999m".
4. Teclado real: ¿el number-pad expone punto? (confirmar H18 no reproducible).
5. Carrito 20+ líneas: scroll/rendimiento en gama media.
6. Liquidación con diferencia: legibilidad del Alert.
7. Pantalla chica + sol/reflejo: contraste de badges y botones.
8. Reconexión con 5+ pendientes: orden y no-duplicación.

### Recomendación: **GO / NO-GO APK QA**
**GO para APK de QA.** No hay P0; el flujo core (ruta, venta, pedido offline, sync, no-venta, regalo, refill, liquidación, cierre) funciona; typecheck/test limpios; idempotencia y guards verificados. Las P1 son de **señalización/visibilidad**, ideales de validar precisamente en el piloto QA en dispositivo.
**Producción = NO-GO** hasta cerrar P1 (H1, H2, H3), supervisor (H4) y backend **#116** en staging.
