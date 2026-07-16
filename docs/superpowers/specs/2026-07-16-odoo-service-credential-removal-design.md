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
4. **Guard de regresión.** Añadir una prueba que falle si el código móvil vuelve a contener configuración de cuenta de servicio, contraseña literal o RPC web directo no autorizado.
5. **Validación.** Ejecutar pruebas automatizadas y un flujo físico controlado: login, ruta, stock, precio, venta, evidencia y sincronización offline/reconexión.
6. **Rotación.** Solo tras validar la migración, rotar o desactivar la cuenta de servicio antigua en Odoo producción. Cualquier integración externa que aún dependa de ella es un bloqueo explícito.

## Manejo de fallos y rollback

- Si falta un endpoint seguro para un uso inventariado, se detiene la migración de ese flujo y se coordina el cambio mínimo en Odoo; no se conserva la credencial como excepción.
- Si falla la validación de un flujo, no se rota la cuenta antigua ni se genera build de TestFlight.
- El rollback antes de la rotación consiste en revertir el cambio móvil. Tras la rotación, la corrección es restaurar un endpoint seguro o una cuenta con privilegios mínimos del lado servidor; nunca reintroducir un secreto en la app.

## Criterios de aceptación

- No queda configuración de una cuenta de servicio ni contraseña literal en `app/` o `src/`.
- No quedan llamadas del móvil a `/web/dataset/call_kw` ni fallbacks `execute_kw` basados en la cuenta antigua.
- Las operaciones de stock, precios y venta usan tokens de empleado y el servidor recalcula precios.
- La suite afectada pasa y un iPhone físico completa el flujo controlado con producción.
- Un escaneo del bundle generado no encuentra indicadores de la cuenta antigua ni secretos privados.
- La cuenta histórica se rota o desactiva solo después de esas verificaciones.
- Solo entonces se habilita la build de iOS `1.3.1` para TestFlight.

## Fuera de alcance

- Publicación pública en App Store.
- Cambiar reglas de negocio, datos productivos no controlados o el esquema de permisos del empleado.
- Habilitar capabilities adicionales de Apple.
- Cambios de Google Cloud; la restricción de la clave de Maps se tratará como gate separado antes de distribución externa.
