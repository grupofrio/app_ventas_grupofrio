# Kold Field — Auditoría y plan de construcción (front + back)

**Fecha:** 10 de agosto de 2026
**Repos:** `grupofrio/app_ventas_grupofrio` (Kold Field, React Native/Expo v1.3.1 — frontend del vendedor) · `grupofrio/colaboradores-pwa` (referencia de diseño y disciplina de datos) · backend Odoo `GrupoVeniu/GrupoFrio` (gf_salesops / gf_pwa — referido por contrato, no auditado directamente)
**Complementos:** mockups navegables de 20 pantallas (`mockups_koldfield.html`, artefacto "koldfield-mockups-vendedor"): login, flujo completo del día y las 4 pestañas de la barra de navegación

---

# PARTE 1 — AUDITORÍA (versión final, con decisiones incorporadas)

## 1.1 Veredicto general

Kold Field ya tiene el esqueleto completo del día del vendedor: inicio de ruta en pasos, checklist de unidad, aceptación de carga, mapa Google Maps como pantalla principal, check-in con geocerca de 50 m, venta offline con foto obligatoria y ticket térmico, no venta con razones, regalo, cambio con ticket, consignación, preventa con fecha de entrega, visita especial, alta de prospectos, corte de unidades y liquidación idempotente. La base es buena; el problema son reglas de negocio invertidas, un offline a medias y una imagen que no es la de la casa.

## 1.2 Decisiones de producto tomadas en esta revisión

1. **Sin portada intermedia.** Tras el login, el vendedor cae directo en "Inicio del día": checklist de la camioneta → kilómetros → aceptar/rechazar carga → descarga de toda la información → iniciar plan del día. La pestaña de inicio de la barra pasa a ser "Mi día" (el hub de pasos).
2. **El mapa es la pantalla principal** durante la jornada (ya es así — se conserva), con un solo mapa (hoy hay dos implementaciones) y panel fijo del siguiente cliente.
3. **La rejilla del check-in reúne las 7 acciones**: Venta, No venta, Regalo, Consignación, Cambio, Preventa, Cobrar (+ Datos). Hoy Consignación y Preventa están escondidas en otras pantallas.
4. **Renombres de cara al vendedor:** "Lead" → **"Prospecto"** en toda la UI; "Foto de entrega" → **"Foto del congelador"**; "Confirmar Check-out y Navegar al Siguiente" → **"Próxima visita"**; el cierre del día se presenta como **"Cerrar visitas"**.
5. **Conversión explícita:** botón **"Convertir a cliente y habilitar venta"** en la ficha del prospecto (hoy la conversión sucede implícita dentro de "Datos").
6. **Barra de navegación definida (5 pestañas):** **Mi día** = hub contextual que cambia con la jornada (pasos de salida en la mañana → resumen vivo en ruta → pasos de cierre al regresar; el CTA muta "Iniciar plan del día" → "Continuar ruta" → "Cerrar visitas") · **Ruta** = mapa (vista principal) con toggle a **Lista**, donde vive el plan del día completo con el resultado de cada visita por palabra · **Inventario** = existencia viva de la unidad (descontada localmente con cada movimiento, con desglose cargado/vendido/regalado/consignado/cambio neto 0 y alerta de agotamiento) · **Ventas** = movimientos del día con chip de tipo, estado de sincronización por palabra y reimpresión de ticket, con totales separados efectivo/crédito/total · **Yo** = perfil y ranking.
7. **Identidad visual:** tema claro institucional de la PWA de supervisor de ventas (fondo `#F0F9FF`, tarjetas blancas borde `#DBEFF9`, azules `#0077BB / #00B8D4 / #005A8D`, CTA pill degradado `#005A8D→#0077BB`, semáforos AA `#166534/#b45309/#b91c1c` con palabra + glifo) y el logo oficial de Grupo Frío (cubo isométrico, `public/icons/logo-grupo-frio.svg`). El claro además resuelve la legibilidad bajo el sol.

## 1.3 Mapeo del proceso contra la app actual

| # | Paso del proceso | Estado hoy | Evidencia |
|---|---|---|---|
| 1 | Checador físico, carga física, traspaso del almacenista | Fuera de app (almacenista en PWA `entregas`) | `colaboradores-pwa/src/modules/entregas/` |
| 2a | Checklist de unidad | ✅ Existe; ⚠️ reprobar no bloquea (solo "responder") | `app/checklist/[planId].tsx`, `route-start.tsx:166-168` |
| 2b | Aceptar **o rechazar** traspaso | ❌ Sin rechazo; solo "reportar diferencia" (incidente) | `route-start.tsx:529`, `refill-accept.tsx:167-188` |
| 2c | Iniciar plan del día con precarga total | ⚠️ Precarga manual y mínima; no recarga con caché en memoria; no baja padrón ni catálogo completo | `useRoutePreparationStore.ts:90-113`, `route-start.tsx:92-98,240` |
| 3 | Mapa pantalla principal | ✅ (`router.replace('/(tabs)/route?view=map')`); ⚠️ segundo mapa duplicado | `route-start.tsx:300`, `app/map.tsx` |
| 4a | Check-in con geocerca | ✅ 50 m, bloqueo sin GPS, encolado offline | `checkin/[stopId].tsx` |
| 4b | Venta sin preguntar forma de pago | ❌ La pide, obligatoria, y decide facturación | `sale/[stopId].tsx:188,321,400,856-870`; el contrato `GFStop` no trae condición de pago |
| 4c | Foto del congelador obligatoria | ⚠️ Obligatoria pero se llama "Foto de entrega" | `sale:883` |
| 4d | Ticket + impresión en venta | ✅ PDF + térmica MP210 | `app/print/[orderId].tsx` |
| 4e | No venta: razón + nota + foto | ✅; ⚠️ catálogo hardcodeado; reintento puede duplicar | `nosale/[stopId].tsx`, `noSaleReasons.ts:7-18` |
| 4f | Consignación a crédito + ticket | ❌ Fija a efectivo, sin ticket, online-only | `consignment:85,197-199,183/231/286` |
| 4g | Regalo = venta a $0 + inventario + ticket | ❌ Va a merma de la van, sin ticket, sin ajuste local | `gift:250,284`, dispatcher `useSyncStore.ts:1330` |
| 4h | Cambio NO afecta inventario | ❌ Es la única operación que SÍ lo afecta (local y servidor) | `exchange:242-252,294-297` |
| 4i | Venta especial fuera de plan | ✅ Existe (offroute); ❌ búsqueda online-only | `offroute.tsx:83,139-200` |
| 4j | Venta/regalo descuentan camioneta local | ❌ No descuentan (solo el cambio); rollback escrito y sin usar | `stockRollback.ts:29`, `useSyncStore.ts:1443-1451` |
| 5 | Botón "Próxima visita" | ⚠️ Existe con otro nombre y pasando por checkout | `checkout/[stopId].tsx:380-389` |
| 6 | Preventa con fecha de entrega | ✅; ❌ online-only, sin prospectos | `presale.tsx`, `presale.ts:21-24` |
| 7a | "Prospecto" en vez de "lead" | ❌ "Lead" sigue en ~8 pantallas | `route.tsx:463`, `newcustomer.tsx:59,136`, `offroute.tsx:259,305`, `sale:330`, `postvisit:263`, `routeActions.ts:23` |
| 7b | Editar teléfono/datos del cliente | ✅ Con confirmación antes de sobrescribir | `customer/[partnerId].tsx` |
| 7c | Convertir prospecto → cliente | ⚠️ Implícito dentro de "Datos", sin botón | `postvisit:221,231-234`, `leadVisit.ts:37-66` |
| 8a | Acuse de devolución del vendedor | ❌ Invertido: el vendedor captura devolución y merma | `cashclose.tsx:29-31,328,665-690`; `returns/` es stub |
| 8b | Cerrar visitas: inventario en 0 | ✅ Corte con diferencia global y por producto, validado en servidor | `cashclose.tsx:603-700` |
| 8c | Liquidar crédito/efectivo + captura de efectivo | ✅ Idempotente, con confirmación de diferencia | `cashclose.tsx:465-530` |
| 8d | Administración imprime corte y firma | ⚠️ Existe solo en PWA admin (escritorio); sin firma | `colaboradores-pwa/src/modules/admin/` |

## 1.4 Hallazgos priorizados (síntesis)

**P0 — lógica:** venta pide forma de pago (falta dato en contrato) · regalo no es venta a $0 · cambio mueve inventario · sin rechazo de traspaso · devolución invertida (sin acuse) · vendedor atrapado si una venta muere en la cola (`checkout:387`) · inventario local no se descuenta al vender/regalar (sobreventa offline) · consignación fija a efectivo sin ticket.

**P0 — seguridad:** credenciales de dirección embebidas en texto plano en el APK (`_layout.tsx:72,122`). **Rotar hoy, independiente de todo lo demás.**

**P0 — imagen:** reloj falso "9:41" en el home · pantallas con datos inventados en producción (gpsmap/supervisor/compintel) · steppers de venta de 30×30 px · sin barra fija de total en venta · tema oscuro exclusivo para uso bajo el sol · rejilla de KPIs que no es rejilla.

**P1:** precarga manual/incompleta · 5 flujos online-only (cambio, consignación, preventa, incidente, venta especial) · no venta duplicable al reintentar · checklist reprobado no bloquea · razones de no venta hardcodeadas · cero coincidencia de paleta con la marca · `#2563EB` como texto (falla AA) · DM Sans declarada pero no aplicada (~90 % del texto) · 214 `Alert.alert` como feedback · teclado tapa campos (KeyboardAvoidingView solo en login) · estado por color sin palabra.

**P2:** dos mapas · geocerca duplicada en 2 constantes · check-ins (0,0) · `cashclose` con sistema visual propio · chips con 4 radios distintos · "--" como sin dato · 23 accessibilityLabel para 269 botones · pantallas stub (`transfer`, `returns`, `statement`, `prodmod`).

---

# PARTE 2 — DISEÑO OBJETIVO (las 20 pantallas)

Flujo completo, correspondiendo 1:1 con los mockups:

**Arranque:** 0 Login (logo completo, código + PIN, sesión persistente) → 1 Inicio del día (5 pasos: checklist ✓, KM ✓, traspaso aceptar/RECHAZAR, descarga del día, salir a ruta; CTA "Iniciar plan del día" bloqueado hasta que TODO bajó).

**Jornada:** 2 Mapa (principal; panel del siguiente cliente con condición de pago; progreso "6 de 14 · En ruta") → 3 Check-in y acciones (7 acciones + datos; chip Crédito/Contado) → 4 Venta (sin forma de pago; steppers 46 px; foto del congelador; barra fija total + confirmar; descuenta camioneta local) · 5 No venta (razones de Odoo; idempotente) · 6 Regalo (venta a $0, motivo, ticket, descuenta camioneta) · 7 Consignación (a crédito, ticket, offline) · 8 Cambio (espejo entregas/recoges, neto 0, foto, ticket) → 9 Próxima visita (resumen + sync por palabra + ruta de escape si la venta falla).

**Fuera de plan:** 10 Venta especial (búsqueda sobre padrón precargado, offline) · 11 Preventa (fecha con chips, "no cobra/no descuenta" declarado, offline, acepta prospectos) · 12 Nuevo prospecto (GPS automático, giro, foto fachada, offline) · 13 Datos · Convertir a cliente (requisitos visibles, botón explícito).

**Cierre:** 14 Acuse de devolución (almacenista captura → vendedor acepta/rechaza con motivo) · 15 Cerrar visitas y liquidar (inventario a 0 con palabra "Cuadrado", crédito/efectivo separados, captura de efectivo, estado posterior "En revisión de administración").

**Pestañas de la barra (16-19):** 16 Mi día (hub contextual: avance, vendido, cobrado, efectividad, piezas en camioneta, sincronización por palabra, accesos fuera de visita — incidencia, recarga, ranking, preventa — y CTA que muta según la hora) · 17 Ruta · Lista (el plan del día completo: visitas hechas con resultado por palabra, la siguiente resaltada con "Ya llegué", pendientes con condición de pago, especiales intercaladas con chip) · 18 Inventario (cargado − vendido − regalado − consignado, cambio neto 0, disponible por producto, "⚠ Quedan 4" y pedir recarga) · 19 Ventas del día (totales efectivo/crédito/total espejo de la liquidación, meta, movimientos con chip de tipo y estado ✓ Enviada / 🕑 En cola, tocar para reimprimir).

**Sistema visual transversal:** tokens del tema claro institucional; DM Sans aplicada; palabra + glifo en todo estado (`✓ Listo / ⚠ Por revisar / ▢ Pendiente / 🕑 En cola`); `null ≠ 0` ("Sin dato", nunca "--"); touch targets ≥ 44 px; barra fija de acción en pantallas de captura; hojas inferiores y banners propios en lugar de `Alert.alert`; logo Grupo Frío en login e hitos del día.

---

# PARTE 3 — PLAN DE CONSTRUCCIÓN · FRONTEND (Kold Field)

> Convenciones de trabajo (heredadas de la disciplina de la PWA supervisor): vista pura + contenedor + modelo puro por pantalla; estados honestos como criterio de aceptación; tests de contrato contra fixtures golden; commits `feat(sale): …` con verificación explícita; `npm run typecheck` y suite en verde por PR.

## F0 — Higiene inmediata (día 1, sin dependencias)

* **F0.1** Retirar credenciales embebidas (`app/_layout.tsx:72,122`) y rotarlas en Odoo. Sustituir por el token de empleado que ya existe.
* **F0.2** Quitar del build las pantallas mock/stub: `gpsmap`, `supervisor` (o gate por rol real), `compintel`, `transfer`, `returns` (se reconstruye en F4), `statement`, `prodmod`.
* **F0.3** Quitar barra de estado falsa "9:41" (`(tabs)/index.tsx:171-174`) y placeholders "--"/"--kg" → "Sin dato".

## F1 — Renombres y quick wins de UX (semana 1, sin backend)

* **F1.1** "Lead" → "Prospecto" en los 8 puntos detectados (`route.tsx:463`, `newcustomer.tsx:59,136`, `offroute.tsx:259,305`, `sale:330`, `postvisit:263`, `routeActions.ts:23`). El valor crudo `stop_kind === 'lead'` del backend no se toca.
* **F1.2** "Foto de entrega" → "Foto del congelador" (`sale:883`) con hint de encuadre.
* **F1.3** Checkout → botón primario **"Próxima visita"**; atajo directo desde la confirmación de venta (sin pasar dos pantallas).
* **F1.4** Steppers de cantidad a 46-48 px (`sale:1032-1037`, `ProductPicker.tsx:764-773`) y objetivos táctiles secundarios ≥ 44 px (limpiar búsqueda, reintentar, quitar línea con confirmación).
* **F1.5** Barra fija de acción en Venta (total siempre visible + CTA), reubicando los FAB globales para que no tapen.
* **F1.6** `KeyboardAvoidingView` en cashclose, route-start/close, nosale, customer, presale.
* **F1.7** Arreglar rejilla KPI: `KPICard` acepta `style`/`flex-basis` 48 % (`KPICard.tsx:29-34`).
* **F1.8** Botón "Convertir a cliente y habilitar venta" en `postvisit`/ficha del prospecto (la lógica `applyLeadUpsertToStop` ya existe; solo se le pone nombre, requisitos visibles y CTA).
* **F1.9** Rejilla de check-in con las 7 acciones (agregar Consignación y Preventa a `checkin/[stopId].tsx:496-558`).
* **F1.10** Ruta de escape del checkout bloqueado: si `liveSaleSyncState === 'failed'` definitivo → "Marcar para revisión del supervisor y continuar" (crea incidente con el payload).
* **F1.11** Pestaña **Mi día** contextual: un solo hub (`(tabs)/index.tsx`) que renderiza pasos de salida / resumen de jornada / pasos de cierre según `routeFlowState`, con el CTA mutante. Elimina la portada estática actual.
* **F1.12** Pestaña **Ruta · Lista**: enriquecer la vista lista existente con el resultado por palabra de cada visita (✓ Venta $X · ✓ No venta · razón · ◈ Siguiente · ▢ Pendiente), la siguiente resaltada con "Ya llegué" y las especiales con chip; el header de 10 botones (`route.tsx:444-508`) se reduce a un menú "☰" jerarquizado.
* **F1.13** Pestaña **Ventas**: chips de tipo de movimiento (Venta, Regalo $0, Consignación, Cambio neto 0, Cobro) + estado de sync por palabra en cada tarjeta; totales en rejilla real efectivo/crédito/total (espejo de la liquidación).

## F2 — Re-tema visual (semanas 1-3, en paralelo; sin backend)

* **F2.1** Reescribir `src/theme/tokens.ts` como espejo del tema claro institucional (`colaboradores-pwa/src/theme/brandTokens.js`): paleta, radios 14/18/22/24/pill, sombras suaves, canal `state` (fg/bg/border/glifo/palabra) y canal `freshness` separado.
* **F2.2** Aplicar DM Sans de verdad: helper de tipografía obligatorio (los 16 presets de `typography.ts` + lint que prohíba `fontSize` suelto sin preset).
* **F2.3** Componentes compartidos faltantes: `Chip` (un solo radio), `Input`, `EmptyState`, `ErrorState`, `ActionBar` (barra fija), `StatusWord` (palabra+glifo), `BottomSheet` (reemplazo de `Alert.alert` para confirmaciones) y `Stepper` 46 px.
* **F2.4** Migración pantalla por pantalla al tema claro en el orden del flujo: login → route-start → route (mapa) → checkin → sale → nosale → gift → consignment → exchange → checkout → offroute → presale → newcustomer → postvisit/customer → cashclose → route-close → pestañas (Mi día, Ruta·Lista, Inventario, Ventas, Yo). `cashclose` abandona su sistema visual paralelo.
* **F2.5** Logo Grupo Frío (asset ya en `assets/grupofrio-logo.svg`) en login, inicio del día y cierre; lockup en tickets ya existe (`grupofrio-ticket-logo.png`).
* **F2.6** Unificar el mapa: eliminar `app/map.tsx`, dejar `RouteMap` + `RouteStopPanel`; pines con estados diferenciados (no visitado ≠ rechazado) y leyenda con palabra.
* **F2.7** Accesibilidad: `accessibilityLabel` en todos los botones-icono; `maxFontSizeMultiplier` coherente; contraste AA verificado con un test de tokens (copiar el de la PWA: `brandLightSupervisor.test.mjs`).

## F3 — Offline de verdad (semanas 2-4; F3.4+ requieren backend B1)

* **F3.1** Precarga automática y forzada al tocar "Iniciar plan del día": plan, paradas, precios, catálogo, padrón de clientes de la plaza y razones de no venta; invalidar caché en memoria (`useRoutePreparationStore.ts:90-113`); bloquear el inicio si algo esencial no bajó, con el paso 4 del hub mostrando qué falta por palabra.
* **F3.2** Descuento de inventario local en venta y regalo (`updateLocalStock`) + activar el rollback ya escrito (`stockRollback.ts` → `_localStockDelta` en payloads → reversal de `useSyncStore.ts:1443-1451`). La pestaña **Inventario** (18) pasa a leer esta existencia local viva: desglose de movimientos del día, disponible por producto y alerta de agotamiento con acceso a "Pedir recarga".
* **F3.3** `operation_id` idempotente en no venta (hoy duplica incidente/fotos al reintentar) y en todo flujo que no lo tenga.
* **F3.4** Encolar offline: cambio, consignación, preventa, incidentes (mismo patrón que `sale_order`).
* **F3.5** Búsqueda de venta especial contra el padrón precargado (fallback a búsqueda online si hay señal).
* **F3.6** Unificar la geocerca en una constante (`useLocationStore.ts`) y bloquear check-ins (0,0).

## F4 — Pantallas de reglas nuevas (semanas 3-5; requieren backend B2)

* **F4.1** Rechazo de traspaso en `route-start` y `refill-accept` (motivo obligatorio, líneas visibles).
* **F4.2** Regalo como venta a $0: motivo de catálogo, ticket impreso, descuento local.
* **F4.3** Consignación a crédito con ticket (crear/visita/cierre), offline.
* **F4.4** Cambio espejo sin efecto neto de inventario (retirar `updateLocalStock` del flujo y el `validate:true` según defina B2.3).
* **F4.5** Venta sin selector de forma de pago: leer `payment_terms` del stop; el selector queda solo como excepción supervisada (permiso explícito) si negocios lo pide.
* **F4.6** Acuse de devolución (`returns` reconstruida): ver movimiento del almacenista → aceptar / rechazar con motivo; el corte (`cashclose`) pasa a solo-lectura en devoluciones.
* **F4.7** Preventa para prospectos (`PRESALE_LEAD_SUPPORTED = true` cuando B2.7 esté).
* **F4.8** Razones de no venta desde catálogo del servidor con caché local.

## F5 — Cierre y pulido (semana 6)

* Checklist con puntos críticos bloqueantes (flag por punto desde B2.8) · estado "En revisión de administración" post-liquidación · impresión del corte desde la app (opcional, la térmica ya está) · limpieza de código muerto y `Alert.alert` restantes · QA de campo (piloto con 2-3 vendedores en una ruta).

---

# PARTE 4 — PLAN DE CONSTRUCCIÓN · BACKEND (Odoo `gf_salesops` / `gf_pwa`)

> Cada punto define el contrato que el front consumirá. Recomendación de disciplina (heredada de la PWA): publicar cada contrato como JSON de ejemplo (golden fixture) y verificarlo con test de drift en ambos repos antes de construir la pantalla.

## B1 — Precarga y catálogos (desbloquea F3)

* **B1.1 Bundle de inicio de día.** Endpoint (o conjunto) que entregue en una sola descarga: plan + paradas, listas de precios vigentes, catálogo de productos con existencias de la unidad, **padrón de clientes de la plaza** (id, nombre, dirección, geo, condición de pago) y catálogos (razones de no venta, motivos de regalo, competidores). Con `ETag`/versión para descargas incrementales.
* **B1.2 Catálogo de razones de no venta** administrable en Odoo (hoy viven hardcodeadas en la app).
* **B1.3 Idempotencia universal:** aceptar `operation_id` en no venta/incidentes (los flujos de venta y liquidación ya lo tienen).

## B2 — Reglas de negocio (desbloquea F4)

* **B2.1 Condición de pago en el contrato del stop.** `/plan/stops` (tipo `GFStop`) agrega `payment_terms: 'cash' | 'credit'` (+ límite y saldo de crédito). Es LO que permite quitar el selector de forma de pago; sin esto el front no tiene de dónde derivarlo.
* **B2.2 Regalo = venta a $0.** Sustituir `/gf/salesops/gift/create` (movimiento a merma) por una `sale.order` con descuento 100 % (o lista de precios $0), motivo de catálogo, que descargue la unidad y genere ticket. Mantener el endpoint viejo un ciclo con redirect para apps no actualizadas.
* **B2.3 Cambio sin efecto neto.** Definir con almacén el modelo (recomendado: picking espejo entrega+recolección en la misma operación, con la merma marcada para separación al regreso). El inventario neto de la unidad no cambia; queda rastro completo del movimiento.
* **B2.4 Rechazo de traspaso del vendedor.** Equivalente a `/pwa-pt/reject-transfer` (que ya existe para el almacenista) para el picking de carga/recarga: `reject(picking_id, reason)` → el picking regresa al almacenista sin sellarse.
* **B2.5 Devolución con acuse.** El almacenista captura la separación buena/merma (su flujo PWA ya existe); nuevo estado "por confirmar del vendedor" + endpoints `returns/pending`, `returns/accept`, `returns/reject(reason)`. El corte del vendedor consume el resultado como solo-lectura.
* **B2.6 Consignación a crédito + ticket.** `payment_method: 'credit'` en crear/visita/cierre, cargo al crédito del cliente al contar lo vendido, y snapshot de ticket en la respuesta para impresión.
* **B2.7 Preventa de prospectos.** Aceptar `lead_id` (o partner provisional) en la cotización de preventa; hoy `PRESALE_LEAD_SUPPORTED = false` por falta de soporte.
* **B2.8 Checklist con severidad por punto.** Marcar puntos críticos cuyo reprobado bloquea `route-start` del lado servidor (hoy solo exige "respondido").
* **B2.9 Conversión prospecto → cliente formalizada.** Endpoint explícito que valide requisitos (teléfono, geo, giro), cree el `res.partner` con condición de pago inicial y devuelva `partner_id` — hoy sucede como efecto secundario del upsert de "Datos".

## B3 — Cierre del ciclo (acompaña F5)

* **B3.1** Estado post-liquidación visible para el vendedor: `en_revision_administracion` → `cerrado` (lo consume la pantalla 15).
* **B3.2** Formato imprimible del corte disponible por API (la PWA admin ya genera los formatos HTML; exponerlos para la térmica del vendedor si se decide).
* **B3.3** Firma digital del corte (opcional, fase posterior): captura de trazo o PIN de conformidad del vendedor + visto de administración.
* **B3.4** Rotación de las credenciales expuestas y auditoría de accesos con ellas (**inmediato**, no espera fase).

## Resumen de contratos nuevos/modificados

| Contrato | Cambio | Desbloquea |
|---|---|---|
| `/plan/stops` (`GFStop`) | + `payment_terms`, `credit_limit`, `credit_balance` | Venta sin selector (F4.5) |
| Bundle inicio de día | Nuevo (plan+precios+catálogo+padrón+catálogos) | Precarga total (F3.1), venta especial offline (F3.5) |
| Regalo | De merma → `sale.order` a $0 con ticket | F4.2 |
| Cambio | Movimiento espejo neto 0 | F4.4 |
| Traspaso | + `reject(picking_id, reason)` del vendedor | F4.1 |
| Devoluciones | + `pending / accept / reject` | F4.6 |
| Consignación | + `payment_method: credit` + ticket | F4.3 |
| Preventa | + soporte de prospecto | F4.7 |
| No venta | + catálogo servido + `operation_id` | F3.3, F4.8 |
| Checklist | + severidad bloqueante por punto | F5 |
| Conversión | Endpoint explícito con validación | F1.8/F4 |

---

# PARTE 5 — SECUENCIA, VERIFICACIÓN Y RIESGOS

## Secuencia (6 semanas de front + backend en paralelo)

```
Semana 1  F0 higiene + F1 renombres/quick-wins        B: rotar credenciales (día 1), arrancar B1
Semana 2  F2 re-tema (tokens+componentes)  F3.1-F3.3  B1 termina · arranca B2.1-B2.4
Semana 3  F2 migración de pantallas        F3.4-F3.6  B2.5-B2.9
Semana 4  F4.1-F4.5 (contra B2 ya desplegado)          B2 estabiliza en staging
Semana 5  F4.6-F4.8                                    B3.1-B3.2
Semana 6  F5 cierre + piloto de campo                  Ajustes del piloto
```

Reglas de secuencia: F0/F1/F2 no dependen de backend — arrancan hoy. Ningún F4 se construye sin su contrato B2 congelado en fixture. El piloto de campo (2-3 vendedores, una ruta, una semana) es la puerta de salida a todos.

## Verificación por fase (criterios de aceptación)

* **Contratos:** fixture golden + test de drift (sha256) en ambos repos por cada endpoint de B1/B2 — el mecanismo ya existe en la PWA (`supervisorContractDrift.test.mjs`), se replica.
* **Estados honestos:** ninguna pantalla nueva pasa revisión con "--", "$0" por null, o color sin palabra. Checklist de las 5 reglas: null≠0 · error≠0 · unknown≠incumplimiento · sin señal≠detenido · sin fuente≠sin hallazgos.
* **Offline:** prueba de guion completo en modo avión desde "Iniciar plan del día" hasta el regreso: venta, no venta, regalo, cambio, consignación, preventa, venta especial y prospecto deben capturarse sin señal y sincronizar al volver, sin duplicados (verificar `operation_id`).
* **Inventario:** al cierre, el corte local debe cuadrar contra Odoo tras sincronizar (venta+regalo descuentan, cambio neto 0, consignación descuenta, preventa no toca).
* **Contraste y táctil:** test automatizado de tokens AA + revisión manual de touch targets con el overlay de accesibilidad de Android.
* **Piloto:** métricas de éxito — tiempo de venta por visita, número de `Alert` vistos, ventas atoradas en cola, y feedback directo de los vendedores.

## Riesgos principales

1. **El cambio de modelo de regalo y cambio toca inventario contable** — coordinar con almacén/contabilidad antes de B2.2/B2.3; es la definición más delicada del plan.
2. **Migración visual grande en app de campo:** hacerla pantalla por pantalla detrás de la misma versión (no big-bang), con el piloto validando legibilidad al sol.
3. **Bundle de precarga pesado en plazas grandes:** medir tamaño del padrón; si excede, descarga incremental por `ETag` (previsto en B1.1).
4. **Doble app en transición** (venta con y sin selector de pago): el front debe tolerar stops sin `payment_terms` (fallback al selector) hasta que el backend esté 100 % desplegado.
5. **Credenciales expuestas ya distribuidas en APKs:** rotar en servidor las invalida de inmediato; hacerlo antes de cualquier otra cosa.

---

*Anexos: auditoría extendida original (`auditoria_koldfield_vendedor.md`) y mockups de referencia (`mockups_koldfield.html` / artefacto "koldfield-mockups-vendedor"). Referencias de patrón: `colaboradores-pwa/src/theme/brandTokens.js`, `src/components/kold/`, `src/modules/supervisor-ventas/v2/` (vistas puras, gates fail-closed, tests de contrato).*
