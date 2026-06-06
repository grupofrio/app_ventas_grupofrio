# KoldField — QA de piloto: flujo completo del jefe de ruta

**Rama:** `feat/route-start-sprint-a` · **Commit:** `a46ac43`
**Alcance:** Sprint A + A.1 + B + C + C.1 (inicio de operación → ruta/ventas → refill/incidentes → corte/liquidación → KM final/recorrido → cerrar ruta).

> Esta checklist es para probar en campo con un jefe de ruta real, un día completo.
> Marcar cada paso ✅/❌ y llenar la tabla de feedback al final.

---

## A. Preparación previa (antes de salir del CEDIS)

- [ ] Jefe de ruta con sesión válida en KoldField (token de empleado activo).
- [ ] Plan de ruta **publicado** para hoy.
- [ ] Unidad asignada al plan (vehículo).
- [ ] Carga inicial asignada (picking de carga).
- [ ] Checklist de salida configurado en backend (template con sus checks).
- [ ] Permiso de cámara concedido al instalar el APK.
- [ ] Señal de internet (WiFi del CEDIS).
- [ ] **Confirmar con Sebas:** `os_api.generic_model_policies` permite a la API key de KoldField **crear/leer `gf.route.incident`** (si no, el reporte de incidente fallará con error claro).
- [ ] Entendido: **no existe checklist de regreso** en backend. Si la unidad tiene novedad al volver, se usa **KM final + incidente**.

---

## B. Inicio de operación

- [ ] Abrir KoldField → Home.
- [ ] CTA correcto en Home: con plan y sin preparar → **"🚚 Iniciar operación"**.
- [ ] Entrar a "Iniciar operación" (hub `route-start`).
- [ ] Paso 1: ver unidad y ruta asignada.
- [ ] Paso 2: "Hacer checklist" → responder checks yes/no, numérico, texto.
- [ ] Tomar **foto del odómetro** (check tipo photo): ver preview, "Tomar de nuevo", guardar.
- [ ] Capturar **"Odómetro salida"** (numérico) **una sola vez** en el checklist.
- [ ] "Completar checklist".
- [ ] Volver al hub: **KM inicial registrado automáticamente** desde el odómetro del checklist (no lo pide de nuevo).
- [ ] Paso 4: "Aceptar carga" inicial → confirmar.
- [ ] Resumen: los 3 ✓ (checklist · KM · carga) → botón **"Iniciar ruta"** habilitado.
- [ ] Volver a Home → CTA cambia a **"✅ Continuar a ruta"**.

---

## C. Operación en ruta

- [ ] Abrir pestaña **Ruta**.
- [ ] Entrar a un cliente (parada).
- [ ] Registrar una **venta** (ProductPicker, precios, confirmar).
- [ ] Registrar una **no-venta** con motivo.
- [ ] Hacer **checkout** de una visita (verificar que funciona igual que antes).
- [ ] Confirmar que ventas/no-ventas/checkout **no cambiaron** (sin regresiones).
- [ ] Regresar a Home / Ruta: el CTA refleja el estado (con parada en curso/hecha → **"🗺️ Ver ruta"**).

---

## D. Refill e incidentes (mid-ruta)

- [ ] Pestaña Ruta → **"🔄 Recarga"**.
- [ ] Caso **sin recarga**: ver "✅ Sin recarga pendiente".
- [ ] Caso **con recarga pendiente** (si existe): ver detalle de líneas + "Aceptar recarga" → confirmar → pasa a "Ya aceptadas".
- [ ] Botón **"🚩 Reportar diferencia"** abre el flujo de incidente.
- [ ] Pestaña Ruta → **"🚩 Incidente"**.
- [ ] Crear incidente básico: tipo + severidad + descripción → "Reportar incidente".
- [ ] Confirmar que aparece en **Recientes**.
- [ ] Si falla por policy de `gf.route.incident`: **anotar el mensaje exacto** del error (no debe simular éxito).

---

## E. Corte, liquidación y cierre

- [ ] Pestaña Ruta → **"🏁 Cerrar ruta"** (hub `route-close`).
- [ ] Paso 1: nota de revisión de regreso (sin checklist de regreso) + opción de incidente.
- [ ] Paso 2: capturar **KM final**.
- [ ] Ver **KM inicial**, **KM final** y **Recorrido de la ruta** (= final − inicial).
- [ ] Paso 3: "Abrir Corte de Caja".
  - [ ] Revisar conciliación (cargado/vendido/devuelto/diferencia).
  - [ ] **Validar corte**.
  - [ ] **Confirmar liquidación** (capturar efectivo si aplica; manejar diferencia si la hay).
- [ ] Paso 4: **Cerrar ruta** → confirmar.
- [ ] Ver estado final **"🏁 Ruta cerrada"** → vuelve a Inicio.
- [ ] Confirmar en Home/Ruta que el estado refleja ruta cerrada.

---

## F. Casos borde a observar

- [ ] **Cámara sin permiso:** mensaje claro pidiendo activarlo en ajustes (no crash).
- [ ] **Foto muy pesada:** si el backend la rechaza → "Foto muy pesada, toma otra" (no falso éxito).
- [ ] **Mala conexión / offline:** banners de "sin conexión", botones deshabilitados, **no encola ni simula éxito**.
- [ ] **Token vencido (401):** error visible con mensaje del backend (puede requerir re-login manual — anotar).
- [ ] **App cerrada a medio flujo:** al reabrir, checklist/KM no se pierden indebidamente (checklist re-consulta backend; KM inicial persistido; KM final se rehidrata si `/my_plan` expone `arrival_km`).
- [ ] **Cambio de día/plan:** la readiness se resetea; pide checklist/KM de nuevo.
- [ ] **Error de backend genérico:** mensaje claro, sin avanzar.
- [ ] **KM final < KM inicial:** se bloquea con aviso.
- [ ] **Cierre rechazado por corte/liquidación pendiente:** el backend devuelve el motivo y se muestra; la ruta NO se cierra.

---

## G. Tabla de feedback del vendedor

| Paso | Qué intentó hacer | Qué pasó | Mensaje de error (si hubo) | Captura | Comentario del vendedor | Prioridad (bloqueante/molesto/mejora) |
|------|-------------------|----------|----------------------------|---------|--------------------------|----------------------------------------|
|      |                   |          |                            |         |                          |                                        |
|      |                   |          |                            |         |                          |                                        |
|      |                   |          |                            |         |                          |                                        |

**Leyenda de prioridad:**
- **Bloqueante:** impide completar la operación del día.
- **Molesto:** se puede trabajar pero estorba / confunde.
- **Mejora:** sugerencia para after-piloto.
