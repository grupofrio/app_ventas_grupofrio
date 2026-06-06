# KoldField — Notas de release de piloto (jefe de ruta)

**Rama:** `feat/route-start-sprint-a`
**Commit:** `a46ac43`
**Fecha:** 2026-06-06
**Estado:** listo para build de piloto. **NO mergeado a main.**

---

## 1. Qué incluye esta rama

Flujo operativo diario completo del jefe de ruta dentro de KoldField, sin
depender de la PWA de colaboradores:

**Sprint A — Inicio de operación**
- Hub "Iniciar operación" (`app/route-start.tsx`).
- Checklist de unidad de salida (yes/no, numérico, texto).
- KM inicial.
- Aceptar carga inicial (reusa `acceptRouteLoad` de Sebas).
- CTA contextual en Home.

**Sprint A.1 — Cierre de bloqueantes de piloto**
- Captura de **foto** en checks tipo `photo` (reusa `camera.ts`).
- KM inicial **único**: se alimenta del odómetro del checklist (no se pide dos veces).
- CTA de Home con 3 estados (Iniciar operación / Continuar a ruta / Ver ruta).

**Sprint B — Refill e incidentes**
- Pantalla de **recarga** mid-ruta (`app/refill-accept.tsx`) con estados claros.
- Reporte de **incidentes** (`app/incident.tsx`): tipo + severidad + descripción + recientes.
- Botón "Reportar diferencia" → incidente (la aceptación de carga es binaria).

**Sprint C — Regreso, conciliación, liquidación y cierre**
- Hub de **cierre** (`app/route-close.tsx`).
- **KM final** (reusa `updateKm('arrival')`).
- Conciliación + validar corte + confirmar liquidación: **reusa `app/cashclose.tsx`** (ya implementado por Sebas).
- **Cerrar ruta** (`closeRoute` → `/pwa-ruta/close-route`).

**Sprint C.1 — KM recorrido**
- Cálculo y display de **KM inicial / final / recorrido**.
- Rehidratación de KM al reabrir (si `/my_plan` serializa los campos).

---

## 2. Qué NO incluye todavía

- ❌ Mapa como pantalla principal / navegación tipo recorrido.
- ❌ Rediseño UX profundo.
- ❌ **Checklist de regreso** (no existe en backend; se maneja con KM final + incidente).
- ❌ Captura de diferencias de carga por línea (la aceptación es binaria; ajustes de corte ya existen en cashclose).
- ❌ Cola offline para fotos/incidentes (son online-first).

---

## 3. Riesgos conocidos

| # | Riesgo | Severidad | Mitigación / nota |
|---|--------|-----------|-------------------|
| 1 | Policy `gf.route.incident` puede no permitir create/read a la API key de KoldField | 🟡 | Si la niega, el reporte de incidente falla con error claro (no falso éxito). **Confirmar con Sebas.** |
| 2 | Checklist de regreso no existe en backend | 🟡 | Documentado. Se usa KM final + incidente. Pendiente decisión de negocio. |
| 3 | Rehidratación de KM final depende de que `/my_plan` serialice `arrival_km` | 🟢 | Si no lo expone, el cálculo queda vivo tras capturar en la sesión. |
| 4 | Tamaño de foto sin resize (calidad 0.4, sin `expo-image-manipulator`) | 🟢 | Si el backend rechaza por tamaño → mensaje claro. Fix futuro: instalar `expo-image-manipulator`. |
| 5 | 401 (token vencido) no hace auto-redirect a login en estos flujos | 🟢 | Consistente con el resto de la app; el error se muestra. |

---

## 4. Dependencias backend a confirmar con Sebas

1. **`os_api.generic_model_policies`**: habilitar **create + read** de `gf.route.incident` para la API key de KoldField (Sprint B).
2. **Checklist de regreso**: decidir si se crea en backend o se acepta el flujo KM final + incidente (Sprint C).
3. (Opcional) **`/my_plan`** que serialice `departure_km` / `arrival_km` para rehidratar el KM al reabrir el cierre (Sprint C.1).

> Todos los demás endpoints usados ya están en producción y los consume la PWA hoy:
> `vehicle-checklist*`, `km-update`, `route_plan/seal_load`, `reconciliation`,
> `validate-corte`, `liquidacion/confirm`, `close-route`.

---

## 5. Cómo probar

Ver `docs/KOLDFIELD_ROUTE_PILOT_QA.md` — checklist manual paso a paso para
una salida real con un jefe de ruta.

Resumen del happy-path:
Home → Iniciar operación → checklist + foto odómetro + KM → aceptar carga →
ruta → venta/no-venta → recarga/incidente → cerrar ruta → KM final +
recorrido → corte/liquidación → ruta cerrada.

---

## 6. Qué reportar durante el piloto

- Cualquier pantalla que **crashee** o quede en blanco.
- Cualquier botón que **no haga nada** o lleve a una pantalla equivocada.
- Cualquier **mensaje de error** poco claro (anotar el texto exacto).
- Casos donde la app **parezca** que guardó algo pero el backend no lo tenga.
- Tiempos de carga molestos.
- Confusiones de UX del vendedor (qué no entendió).
- Llenar la **tabla de feedback** del QA con prioridad bloqueante/molesto/mejora.

---

## 7. Comandos

```bash
# Validación
npm run typecheck      # PASS salvo error PRE-EXISTENTE (ver nota abajo)
npm test               # 87 tests, 83 pass, 4 fail (4 PRE-EXISTENTES)

# Build de piloto (APK vía EAS, perfil preview → buildType apk)
npm run build:preview:android
#   = eas build -p android --profile preview

# Alternativa build local (requiere android/ prebuild + toolchain):
npm run build:field-update:android
#   = cd android && ./gradlew assembleRelease
```

### Nota sobre typecheck/test (fallas PRE-EXISTENTES, NO de esta rama)
- **typecheck:** `src/services/saleTicketPdf.ts` reporta `Cannot find module
  'expo-print' / 'expo-sharing'`. Ambos están en `package.json` (~14.0.3 /
  ~13.0.1) pero no instalados en el `node_modules` local. **No es código de
  esta rama** (viene de cambios previos de Sebas). En EAS build, `npm install`
  los resuelve. Para limpiarlo localmente: `npm install`.
- **test:** 4 fallas en `tests/cashcloseSettlementFlow.test.ts` y
  `tests/httpTimeout.test.ts` — **pre-existentes** (commits previos de Sebas),
  no atribuibles a A/A.1/B/C/C.1. Esta rama agregó tests nuevos
  (`routeStartLogic`, `routeIncidentLogic`), todos en verde.

---

## 8. Commit actual de la rama

```
a46ac43 feat(route-close): Sprint C.1 — KM recorrido (cálculo + display + rehidratación)
f450608 feat(route): Sprint C — KM final + cierre de ruta (reusa corte/liquidación de Sebas)
ccdf865 fix(route): Sprint B validation — incidentes vía generic create + botón diferencia
7ee8adf feat(route): Sprint B — aceptar refill mid-ruta + incidentes + prep cierre
f521fa3 feat(route-start): Sprint A.1 — checks foto + KM único + CTA contextual
bce3036 fix(route-start): KM validation > 0 to match backend
5427a3c fix(route-start): self-review fixes — readiness live + aviso check foto
98aa0c1 feat(route-start): Sprint A — checklist de unidad + KM inicial + aceptar carga
```

---

## 9. Recomendación

**No mergear a main hasta terminar el piloto.** Pilotear desde un APK generado
de esta rama con un jefe de ruta, recoger feedback en el QA, y sólo entonces
decidir merge + ajustes. Confirmar antes las 2 dependencias backend (policy de
incidentes y decisión de checklist de regreso) para no bloquear al vendedor en
campo.
