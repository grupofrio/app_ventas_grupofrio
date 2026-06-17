# KoldField — QA Programa de Lealtad (vista cliente)

**Rama:** `feat/koldfield-loyalty-customer-view`
**Base:** `main` @ `daeb489`.
**Alcance:** conectar el botón "⭐ Lealtad" del cliente a una pantalla real de **lectura** del programa de lealtad. **Frontend-only; sin backend; sin endpoint nuevo.**

## Qué se encontró en Odoo
La lealtad **NO usa el módulo nativo** de Odoo (`loyalty.program/card/reward`). Es un esquema **custom**:
- **`gf_partner_loyalty`** añade campos a **`res.partner`**:
  - `x_loyalty_level` — Selection **bronce/plata/oro** ("Nivel de Lealtad").
  - `x_loyalty_streak` — Integer, semanas consecutivas con compra.
  - `x_last_order_week` — Integer, semana ISO de la última orden confirmada.
- **`gf_w14_loyalty_engine`** — **cron** (`gf.loyalty.cron.service`) que actualiza esos campos a partir de la actividad de `stock.picking`.
- **NO hay endpoint dedicado** (`@http.route`) ni **modelo de redención/recompensas**.

**Conclusión:** los datos existen y se leen vía el **RPC genérico de `res.partner`** (`odooRpc('res.partner','search_read')`, sesión Odoo autenticada — el mismo camino que `pricelist.ts`; `/get_records` corre como público y no lee `res.partner` confiablemente). → **MVP de SOLO LECTURA; sin cambios de backend.**

## Cambios
1. **`src/services/loyaltyLogic.ts`** (NUEVO, puro): `parsePartnerLoyalty`, `hasLoyaltyData`, `describeLoyaltyLevel` (bronce🥉→plata🥈→oro🥇), `PARTNER_LOYALTY_FIELDS`.
2. **`src/services/loyalty.ts`** (NUEVO): `fetchPartnerLoyalty(partnerId)` vía `odooRpc('res.partner','search_read')`; re-exporta los helpers puros.
3. **`app/loyalty/[partnerId].tsx`**: reescrito (antes era un **stub** con bug `partnerId={}`). Ahora carga datos reales con estados loading / error+retry / **empty** ("sin programa activo") / **offline** (sin caché → mensaje claro); muestra nivel (emoji+label), racha, última compra, siguiente nivel; nota de "solo lectura".
4. **`app/stop/[stopId].tsx`**: el botón "⭐ Lealtad" **ya no es placeholder** (`Alert('F8…')`); navega a `/loyalty/[partnerId]` con el partner resuelto. Si el cliente no tiene contacto enlazado (lead sin partner), avisa que complete Datos.

## Pruebas manuales
- [ ] **Cliente con programa activo:** abrir cliente → "⭐ Lealtad" → muestra nivel (Bronce/Plata/Oro), racha de semanas, última compra y siguiente nivel.
- [ ] **Cliente sin lealtad:** muestra "Este cliente aún no tiene programa de lealtad activo" (empty), no error.
- [ ] **Error backend / sesión:** muestra mensaje + "Reintentar".
- [ ] **Sin conexión:** mensaje "Sin conexión… conéctate para ver puntos y nivel" (no hay caché de lealtad; es informativo).
- [ ] **Navegación desde cliente:** el botón navega siempre (no es placeholder); lead sin partner → aviso de completar Datos.
- [ ] **Redención:** N/A — el backend no tiene modelo de recompensas; la pantalla indica "solo lectura".
- [ ] **No rompe otras acciones** del cliente (check-in, venta, regalo, no-venta, consignación).

## Pruebas automáticas (node)
- `tests/loyalty.test.ts` — parseo de res.partner (completo, campos `false`/ausentes, nivel inválido, inválidos→null), `hasLoyaltyData` (empty vs con dato), `describeLoyaltyLevel`.
- `tests/loyaltyWiring.test.mjs` — el placeholder `F8` desapareció, el stop navega a `/loyalty`, la pantalla usa `fetchPartnerLoyalty`/`hasLoyaltyData`, y el bug `partnerId={}` se eliminó.
- **typecheck limpio; tests 122/122.**

## Riesgos / notas
- `fetchPartnerLoyalty` usa `odooRpc` (sesión Odoo de servicio, igual que pricelist). Si la sesión no está configurada o falla, la pantalla muestra error/retry (no crashea).
- Solo lectura: **no** hay flujo de redención porque el backend no expone modelo/endpoint de recompensas. Si en el futuro se requiere redimir, se necesitará endpoint backend (ver "Para Sebastián").
- Sin caché offline de lealtad (es informativa); se puede agregar en una fase posterior si se requiere en ruta sin señal.

## Para Sebastián (si se quiere ir más allá de lectura)
Hoy NO se necesita backend para la vista de lectura. **Si** se desea redención o puntos canjeables desde la app, haría falta:
- Un endpoint PWA (p.ej. `GET /pwa-ruta/loyalty?partner_id=N`) que devuelva nivel/racha/beneficios y, si aplica, recompensas disponibles; y un `POST` de redención idempotente (`operation_id`).
- O exponer el esquema de puntos/recompensas si se migra al módulo nativo `loyalty.*`.
Mientras tanto, la app lee `res.partner` directamente (sin endpoint nuevo).

## Fuera de alcance
Redención/canje, endpoint dedicado, caché offline de lealtad, otros bugs.
