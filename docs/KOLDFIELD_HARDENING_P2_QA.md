# KoldField — QA Hardening P2 (Control operativo)

**Rama:** `feat/koldfield-hardening-p2-control-traceability`
**Alcance:** quick wins P2 frontend-puros. **Sin backend, sin cambios de contrato.**

## Resumen de cambios
1. **Regalo vs stock** — no se puede regalar más de lo disponible (reusa `findFreshStockIssues`). qty≤0/NaN ya lo descartaba `toGiftPayloadLines`.
2. **KM absurdo** — guard de confirmación si el odómetro o el recorrido del día es absurdo (umbrales documentados). Reglas duras (km>0, final≥inicial) intactas.
3. **Consignación-create vs stock** — el objetivo por producto no puede exceder el stock visible (reusa `findFreshStockIssues`). `visit`/`close` NO se tocan (los recalcula el backend).
4. **Offroute / venta fuera de plan** — confirmado: enruta a `/sale`, que ya valida stock (P0). **Sin bypass; sin código nuevo.**
5. **Geocerca antes de venta** — cubierto por el flujo de check-in (geocerca + rechazo `lat/lon=0`, #19) + `OperationGate`. **No se agregó guard en `/sale`** para no romper el flujo legítimo offroute "Generar venta" (venta especial sin geocerca). Documentado.

### Criterio de "KM absurdo" (documentado)
- `MAX_REASONABLE_ODOMETER_KM = 2,000,000` — lectura de odómetro mayor ⇒ probable typo.
- `MAX_REASONABLE_KM_PER_DAY = 1,500` — recorrido (final−inicial) mayor en un día ⇒ probable typo.
- **No bloquea:** muestra "KM inusualmente alto, ¿es correcto?" con opción de confirmar o corregir.

---

## Pruebas manuales

### A. Regalo
- [ ] **Sin/insuficiente stock:** regalar cantidad > disponible de un SKU → bloquea con "Stock insuficiente: regalas X, disponible Y".
- [ ] **Con stock:** regalar cantidad ≤ disponible → procede.
- [ ] qty 0 / negativa / texto → no genera línea / pide datos (comportamiento previo).

### B. KM (inicio y cierre)
- [ ] **KM inicial absurdo:** capturar p.ej. `99999999` → pide confirmación "KM inusualmente alto". Corregir cancela; confirmar guarda.
- [ ] **KM final absurdo (recorrido):** inicial 50,000; final 60,000 (10,000 km en el día) → pide confirmación.
- [ ] **Reglas duras intactas:** km 0/negativo → "KM inválido"; final < inicial → "KM final menor al inicial".

### C. Consignación (create)
- [ ] **Objetivo > stock:** crear consignación con objetivo > disponible → bloquea "Stock insuficiente: objetivo X, disponible Y".
- [ ] **Objetivo ≤ stock:** procede.
- [ ] **visit/close:** sin cambios (cálculo lo confirma backend). Sigue **cash-only**.

### D. Venta fuera de plan (offroute)
- [ ] Buscar cliente fuera de plan → "Generar venta" → llega a `/sale` → vender qty > stock → bloquea (misma validación que venta normal). **No hay atajo que la salte.**

### E. Venta con check-in válido (geocerca)
- [ ] Flujo normal: check-in (dentro de geocerca) → venta procede.
- [ ] Sin check-in / lejos: el check-in ya bloquea geocerca y `lat/lon=0` (#19); `/sale` está bajo `OperationGate` (readiness). Venta especial offroute sí permite venta sin geocerca **por diseño**.

---

## Validación
- `npm run typecheck` → limpio.
- `npm test` → **106/106** (incluye `kmGuards`, `p2StockGuards`, `p2WiringControls`).

## Fuera de alcance (P2+ pendiente / backend)
Devoluciones reales, credenciales por usuario, **rechazo de inventario negativo (backend)**, telemetría, feature flags, dashboards, sync queue, métodos no-cash en consignación. El frontend es *advisory*: la barrera dura de stock/negativos es backend (ver `KOLDFIELD_BACKEND_HARDENING_REQUESTS.md`).
