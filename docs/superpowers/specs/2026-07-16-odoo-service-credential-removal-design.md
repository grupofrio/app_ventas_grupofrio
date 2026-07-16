# KOLD Field — Eliminación de la cuenta de servicio Odoo del cliente móvil

**Estado:** diseño aprobado; pendiente de revisión de especificación y ejecución.  
**Objetivo:** permitir la distribución externa por TestFlight sin incluir una cuenta de servicio de Odoo ni sus credenciales en el bundle móvil.

## Contexto y restricción de seguridad

El cliente configura una cuenta de servicio al arrancar y la usa para crear una sesión Odoo y realizar RPC directos. Toda credencial incluida en JavaScript puede extraerse de una IPA, por lo que el build actual no puede distribuirse a un tester externo.

El backend ya expone endpoints autenticados por empleado. La migración conservará la autenticación de empleado existente y no añadirá secretos a variables `EXPO_PUBLIC_*`, configuración Expo ni EAS.

## Diseño elegido

El móvil consumirá únicamente endpoints REST autenticados con los tokens de empleado que obtiene durante el inicio de sesión. Cada uso del cliente de la sesión Odoo de servicio se sustituirá por el endpoint seguro equivalente:

| Necesidad | Sustituto esperado |
|---|---|
| Stock de camión | `truck_stock` |
| Precios por cliente | `pricing/by_partner` |
| Venta con recálculo en servidor | `sales/create` |
| Lista/precio de parada | Datos incluidos en `route` / `stop` |

No se usará un proxy nuevo ni se moverá la misma credencial a secretos de build: ambas opciones conservarían una dependencia de una cuenta privilegiada o ampliarían el alcance de la intervención.

## Componentes y flujo

1. **Inventario de llamadas.** Localizar cada consumidor de `odooRpc`, `odooSession`, `setServiceCredentials` y RPC web directo; documentar su dato y sustituto.
2. **Migración por flujo.** Cambiar una pantalla o servicio a la vez hacia el endpoint seguro existente, conservando la cola offline y el cálculo de venta en servidor.
3. **Eliminación.** Borrar la configuración de cuenta de servicio, la sesión Odoo asociada y los fallbacks RPC una vez que no queden consumidores.
4. **Guard de regresión.** Añadir una prueba de CI que falle si cualquier entrada de release móvil (código, configuración Expo/EAS, proyectos nativos, assets o artefactos generados) contiene una credencial Odoo, sesión de servicio o RPC web directo no autorizado.
5. **Validación.** Ejecutar pruebas automatizadas y un flujo físico controlado: login, ruta, stock, precio, venta, evidencia y sincronización offline/reconexión. Se conservará el resultado del escaneo del IPA firmado exacto como evidencia de go/no-go.
6. **Retiro de la cuenta histórica.** Solo tras validar la migración, revocar/desactivar la cuenta de servicio antigua, invalidar sus sesiones/tokens activos, confirmar que no existen integraciones dependientes y registrar la evidencia operativa. No es suficiente conservar la cuenta rotada como fallback.

## Manejo de fallos y rollback

- Si falta un endpoint seguro para un uso inventariado, se detiene la migración de ese flujo y se coordina el cambio mínimo en Odoo; no se conserva la credencial como excepción.
- Si falla la validación de un flujo, no se retira la cuenta antigua ni se genera build de TestFlight.
- Un rollback de TestFlight solo puede usar un build previamente verificado como libre de credenciales o una corrección del backend. Revertir el cliente al camino de cuenta de servicio queda prohibido para cualquier distribución.
- El backend debe desplegar compatibilidad segura antes de retirar el camino móvil; la telemetría debe alertar fallos de autorización y sincronización durante el canario controlado.

## Autorización y datos offline

- Cada endpoint debe verificar en servidor compañía/tenant, empleado, camión, ruta, parada y cliente asociados al token. Se probarán explícitamente tokens erróneos, vencidos, revocados y de otra ruta.
- `sales/create` debe aplicar en servidor precio, producto, cantidad, descuento, stock disponible e idempotencia; una repetición de la cola no puede duplicar una venta.
- Los tokens de empleado no se escribirán en la cola offline, trazas ni logs. Una operación encolada se reautoriza y se revalida al sincronizar; un token vencido o revocado exige reautenticación.
- Las ventas y evidencias pendientes se conservarán solo en el almacenamiento protegido ya definido por la app y se eliminarán según el resultado de sincronización y logout.

## Gates de distribución y responsables

| Gate | Evidencia | Responsable de aprobación |
|---|---|---|
| Inventario y paridad de endpoints | Mapeo completo de consumidores y contratos de respuesta | Frontend + responsable Odoo |
| Autorización y sincronización | Matriz automatizada de accesos válidos/denegados, offline y reintentos | Frontend + responsable Odoo |
| Datos controlados | Operaciones de QA identificables y limpieza confirmada | Operación Grupo Frío |
| Sin secretos en release | CI y escaneo del IPA firmado exacto, conservados como artefacto | Frontend |
| Cuenta histórica retirada | Revocación, sesiones invalidadas y dependencias auditadas | Administrador Odoo |
| Google Maps iOS | Clave limitada a iOS y Bundle ID `mx.grupofrio.koldfield`; verificación en Google Cloud | Administrador Google Cloud |
| TestFlight | Todos los gates anteriores aprobados y build firmado procesado | Release owner |

## Criterios de aceptación

- No queda configuración de una cuenta de servicio ni contraseña literal en `app/` o `src/`.
- No quedan llamadas del móvil a `/web/dataset/call_kw` ni fallbacks `execute_kw` basados en la cuenta antigua en ninguna entrada de release.
- Las operaciones de stock, precios y venta usan tokens de empleado; el servidor aplica autorización de contexto, recálculo, stock e idempotencia.
- La matriz de stock, precios, venta, ruta/parada, reconexión y acceso denegado pasa con datos controlados y limpieza documentada.
- Un iPhone físico completa el flujo controlado con producción sin Metro.
- CI y el escaneo del IPA firmado exacto no encuentran indicadores de la cuenta antigua ni secretos privados.
- La cuenta histórica queda revocada/desactivada, con sesiones invalidadas y dependencias auditadas, solo después de esas verificaciones.
- La clave de Google Maps queda restringida y verificada antes de distribuir externamente.
- Solo entonces se habilita la build de iOS `1.3.1` para TestFlight.

## Fuera de alcance

- Publicación pública en App Store.
- Cambiar reglas de negocio, datos productivos no controlados o el esquema de permisos del empleado.
- Habilitar capabilities adicionales de Apple.
- Cambios de Google Cloud; la restricción de la clave de Maps se tratará como gate separado antes de distribución externa.
