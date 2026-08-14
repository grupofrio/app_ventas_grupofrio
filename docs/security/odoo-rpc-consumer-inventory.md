# Inventario de consumidores Odoo privilegiados — móvil

**Estado:** línea base R0/R1; pendiente de migración.
**Alcance:** código de producción móvil (`app/` y `src/`). Esta es una lista de
consumidores y transportes, no una autorización para conservarlos. Los valores
de credenciales, tokens y cabeceras se han omitido deliberadamente.

## Regla de corte

Todo acceso debe terminar en una ruta REST de empleado, con autorización de
compañía, plaza, ruta, parada y cliente resuelta en el servidor. No se permite
llevar la cuenta de servicio a una variable de build ni mantener un fallback
`call_kw`, `execute_kw`, `/get_records` o `/api/create_update`. Cuando la ruta
de empleado no existe, el flujo se deshabilita o elimina hasta que el backend y
su prueba estén listos.

Las columnas de prueba distinguen lo que ya existe de la cobertura que debe
añadirse durante las tareas R0/R1; por tanto, una prueba marcada **pendiente**
no es evidencia de que la migración esté cubierta hoy.

## Consumidores e implementación de sesión/RPC

| Archivo / símbolo | Dato u operación actual | Sustituto REST o decisión | Backend requerido | Prueba que lo cubre |
| --- | --- | --- | --- | --- |
| `app/_layout.tsx` — inicialización y rehidratación autenticada | Configura dos veces la cuenta de servicio para habilitar toda la sesión Odoo. | Eliminar ambas invocaciones; el arranque solo rehidrata el token individual existente. | Ninguno nuevo; el inicio de sesión ya debe entregar el token de empleado. | `tests/noPrivilegedOdooClient.test.mjs` (**pendiente**, Task 1); `tests/authOffline.test.ts` tras migración. |
| `src/services/odooSession.ts` — `setServiceCredentials` / `hasServiceCredentials` | Guarda en memoria credenciales de servicio y decide si puede abrir la sesión. | Eliminar el módulo junto con su estado; no hay equivalente del lado cliente. | Ninguno. | `tests/noPrivilegedOdooClient.test.mjs` (**pendiente**) debe prohibir el símbolo y pares de credenciales. |
| `src/services/odooSession.ts` — autenticación web | Autentica contra `/web/session/authenticate` para obtener cookie y UID. | Eliminar; todas las rutas móviles usan el token de empleado ya emitido por login. | Login de empleado: token individual, revocable y plaza analítica en respuesta. | `os_api/tests/test_employee_signin_security.py` (**pendiente/plan**) y el guard `noPrivilegedOdooClient`. |
| `src/services/odooSession.ts` — `sessionRpc` | Ejecuta ORM arbitrario por `/web/dataset/call_kw`; ante error usa el fallback de `/jsonrpc` con `execute_kw`. | Eliminar ambos caminos y el módulo; cada caso de uso queda limitado a una ruta REST tipada. | Rutas específicas indicadas en las filas consumidoras. | `tests/noPrivilegedOdooClient.test.mjs` (**pendiente**) bloquea `call_kw` y `execute_kw`; `tests/networkTimeoutsWiring.test.mjs` cubre solo los timeouts actuales, no autoriza el flujo. |
| `src/services/odooSession.ts` — `clearOdooSession` | Borra el estado local de la sesión web al cerrar sesión. | Eliminar la llamada; logout borra token/cachés/cola propios, sin sesión Odoo. | Ninguno nuevo. | `tests/logoutPrivacy.test.mjs` (**pendiente**, Task 7) y `tests/authOffline.test.ts`. |
| `src/services/odooRpc.ts` — `odooRpc` | Wrapper ORM genérico que delega en `sessionRpc`, por tanto obtiene el alcance de la cuenta de servicio. | Eliminar; ningún consumidor usa ORM genérico. | Rutas específicas por consumidor. | `tests/noPrivilegedOdooClient.test.mjs` (**pendiente**). |
| `src/services/odooRpc.ts` — `odooRead` | Lectura genérica de modelo/dominio/campos mediante `POST /get_records`. | Eliminar; no aceptar modelo, dominio ni campos escogidos por el cliente. | Rutas allowlisted por consumidor. | `tests/noPrivilegedOdooClient.test.mjs` (**pendiente**) y pruebas de contrato de cada ruta. |
| `src/services/odooRpc.ts` — `odooWrite` | `create`/`write` genérico de modelo y `dict` mediante `POST /api/create_update`. | Eliminar; mutaciones usan rutas idempotentes y con identidad derivada del token. | Rutas de incidente/contacto/venta/pago que correspondan. | `tests/noPrivilegedOdooClient.test.mjs` y `tests/secureSyncTransport.test.ts` (**pendientes**). |
| `src/services/odooRpc.ts` — `koldRead` | Lectura genérica de modelos KOLD por `/get_records`, con interpretación local de ACL/módulo ausente. | Eliminar; una única consulta de insights allowlisted conserva flags explícitos de disponibilidad. | `POST /gf/logistics/api/employee/kold/insights`. | `tests/secureIncidentsAndKold.test.ts` (**pendiente**); reemplaza `tests/koldOptionalRpcWiring.test.mjs`. |
| `src/stores/useAuthStore.ts` — `clearOdooSession` | Logout importa el módulo de sesión y limpia su estado. También llama a `fetchEmployeeAnalyticPlaza` para el siguiente caso. | Quitar el import/llamada; limpiar únicamente sesión de empleado y datos locales de ese empleado. | Ninguno para logout. | `tests/logoutPrivacy.test.mjs` (**pendiente**) y `tests/authOffline.test.ts`. |
| `src/services/employeeAnalytics.ts` — `fetchEmployeeAnalyticPlaza` | Lee `hr.employee.x_analytic_account_id`: primero `odooRpc(read)`, luego `/get_records`. | Eliminar el servicio; obtener la plaza del payload de login, sin releer `hr.employee`. | `/api/employee-sign-in` debe devolver plaza analítica asociada al empleado autenticado. | `os_api/tests/test_employee_signin_security.py` (**pendiente**); `tests/authOffline.test.ts` tras eliminar el fetch. |

## Lecturas y mutaciones de negocio

| Archivo / símbolo | Dato u operación actual | Sustituto REST o decisión | Backend requerido | Prueba que lo cubre |
| --- | --- | --- | --- | --- |
| `src/services/offrouteSearch.ts` — `searchCustomers` | Busca `res.partner` por dominio creado en el móvil mediante `search_read`; si falla, `/get_records`. | Usar una búsqueda de directorio con texto recortado y límite 20; adaptar la respuesta al modelo de UI. | `POST /gf/logistics/api/employee/directory/search`, con alcance de empleado/plaza/ruta aplicado en servidor. | `tests/employeeData.test.ts` (**pendiente**) y `tests/offrouteSearch.test.ts`. |
| `src/services/offrouteSearch.ts` — `searchLeads` | Busca `crm.lead` mediante `search_read`, con fallback `/get_records`. | Misma llamada `directory/search`; la respuesta separa clientes y leads permitidos. | `POST /gf/logistics/api/employee/directory/search`. | `tests/employeeData.test.ts` (**pendiente**) y `tests/offrouteSearch.test.ts`. |
| `src/services/customerContactUpdate.ts` — `syncCustomerContactUpdate` | Import dinámico de `odooRpc` y `res.partner.write` para nombre y datos de contacto. | `customer/contact/update` con `{ partner_id, values }`; no enviar empresa, plaza, empleado ni token en el cuerpo. | `POST /gf/logistics/api/employee/customer/contact/update`, validando que el partner es accesible para el empleado. | `tests/employeeData.test.ts` (**pendiente**) y `tests/customerEditFrontendWiring.test.mjs`. |
| `src/services/loyalty.ts` — `fetchPartnerLoyalty` | Lee los campos de lealtad de `res.partner` con `odooRpc(search_read)`. | Pedir un objeto de lealtad allowlisted y pasarlo a `parsePartnerLoyalty`. | `POST /gf/logistics/api/employee/customer/loyalty`, con validación de partner en alcance. | `tests/employeeData.test.ts` y `tests/loyaltyWiring.test.mjs` (**pendientes**). |
| `src/services/routeIncidents.ts` — `createIncident` | Crea `gf.route.incident` por `/api/create_update`, incluyendo `employee_id` y `company_id` elegidos por el cliente. | Ruta de creación idempotente; ignorar/eliminar identidad del payload y derivarla del token. | `POST /gf/logistics/api/employee/incidents/create`; valida plan/parada, tipo, severidad y `operation_id`. | `tests/secureIncidentsAndKold.test.ts` (**pendiente**) y pruebas Odoo `test_employee_customer_api_contract` / `test_fasttrack_api` (**pendientes**). |
| `src/services/routeIncidents.ts` — `getMyIncidents` | Lista `gf.route.incident` por `/get_records` y un dominio con `employee_id` del cliente. | Ruta paginada de incidencias propias; el servidor calcula empresa/empleado/alcance. | `POST /gf/logistics/api/employee/incidents/list`. | `tests/secureIncidentsAndKold.test.ts` (**pendiente**) y pruebas Odoo de contrato (**pendientes**). |
| `src/stores/useKoldStore.ts` — score de cliente | `koldRead` solicita `kold.customer.score` con modelo, campos y dominio genéricos. | Una sola respuesta `kold/insights` con scores allowlisted y `scores_available`; conservar degradación explícita cuando falte el módulo. | `POST /gf/logistics/api/employee/kold/insights`, máximo 500 partners e intersección con alcance del empleado. | `tests/secureIncidentsAndKold.test.ts` (**pendiente**). |
| `src/stores/useKoldStore.ts` — pronóstico de demanda | `koldRead` solicita `kold.demand.forecast` con modelo, campos y dominio genéricos. | Misma llamada `kold/insights`, con forecasts allowlisted y `forecasts_available`. | `POST /gf/logistics/api/employee/kold/insights`. | `tests/secureIncidentsAndKold.test.ts` (**pendiente**). |
| `src/stores/useProductStore.ts` — fallback `stock.quant` | Si `truck_stock` está vacío, lee cuantías del almacén/ubicación mediante `/get_records`. | Eliminar; aceptar solo `truck_stock` o caché contextual marcado como no autoritativo. Sin datos y sin caché: error bloqueante, no catálogo global. | El contrato existente `truck_stock` debe devolver producto/stock para la unidad autorizada. | `tests/secureInventoryPricing.test.ts` y `tests/truckStockFallbackWiring.test.mjs` (**pendientes**). |
| `src/stores/useProductStore.ts` — productos de las cuantías | Tras la lectura anterior, lee `product.product` por IDs para enriquecer catálogo. | Eliminar junto con el fallback de `stock.quant`; `truck_stock` entrega los campos allowlisted necesarios. | `truck_stock`. | `tests/secureInventoryPricing.test.ts` (**pendiente**). |
| `src/stores/useProductStore.ts` — fallback global `product.product` | Si no hubo stock, carga catálogo global sin filtro de unidad mediante `/get_records`. | Eliminar; no ofrecer inventario o catálogo no contextual. | `truck_stock` y caché contextual local únicamente. | `tests/secureInventoryPricing.test.ts` (**pendiente**). |
| `src/services/pricelist.ts` — empresa de lista | Lee `product.pricelist.company_id` por `odooRpc(read)` y luego `/get_records`. | Eliminar la resolución ORM; el servidor selecciona la lista dentro de `pricing/by_partner`. | `POST /gf/logistics/api/employee/pricing/by_partner`. | `tests/secureInventoryPricing.test.ts` y `tests/pricelistServerEndpoint.test.ts` (**pendientes/actual parcial**). |
| `src/services/pricelist.ts` — lista de precios del partner | Lee propiedades de `res.partner` vía `odooRpc(search_read)`. | Eliminar; `pricing/by_partner` deriva partner/empresa/condiciones en servidor. | `POST /gf/logistics/api/employee/pricing/by_partner`, con partner dentro del alcance. | `tests/secureInventoryPricing.test.ts` (**pendiente**); `tests/pricelistNoGetRecordsFallback.test.ts` cubre únicamente una restricción actual. |
| `src/services/pricelist.ts` — reglas `product.pricelist.item` | Lee reglas de precio por `odooRpc(search_read)` y fallback `/get_records`, y calcula precios en el dispositivo. | Eliminar cálculo/reglas ORM; usar precio de servidor y caché de precios previamente autorizados. | `POST /gf/logistics/api/employee/pricing/by_partner`; `sales/create` vuelve a calcular al confirmar. | `tests/secureInventoryPricing.test.ts` (**pendiente**) y `tests/pricelistServerEndpoint.test.ts`. |
| `app/ranking.tsx` — `fetchRanking` | Llama directamente `/get_records` con `sale.order.read_group` y dominio/agrupación construidos por el cliente. | **Deshabilitar la pantalla** hasta tener contrato de ranking; no usar una consulta genérica de ventas. | Ruta nueva propuesta: `POST /gf/logistics/api/employee/ranking/monthly`, con agregados y alcance de equipo definidos por servidor. | `tests/rankingDisabledWiring.test.mjs` (**pendiente**) y `gf_logistics_ops/tests/test_employee_ranking_api.py` (**pendiente**) antes de reactivar. |

## Cola offline y escrituras genéricas restantes

Estas ramas se alcanzan desde `dispatchSyncItem`. El plan R0/R1 las clasifica
como tipos sin productor activo: se deben borrar junto con sus tipos de cola,
no convertirlas automáticamente en otra escritura genérica.

| Archivo / símbolo | Dato u operación actual | Sustituto REST o decisión | Backend requerido | Prueba que lo cubre |
| --- | --- | --- | --- | --- |
| `src/stores/useSyncStore.ts` — caso `collection` | Crea `account.payment` por `/api/create_update` con partner, importe y diario desde la cola. | Deshabilitar/eliminar tipo y rama. Si se descubre un productor activo, detener la retirada y definir primero un endpoint de cobro idempotente con autorización. | Ninguno mientras no haya productor. Si reaparece: ruta `payments/create` con `operation_id`, importe y contexto validados en servidor. | `tests/secureSyncTransport.test.ts` (**pendiente**) debe exigir cero `/api/create_update`; `tests/salesMigration.test.ts` es cobertura parcial existente. |
| `src/stores/useSyncStore.ts` — caso `transfer` | Crea `stock.picking` con un `dict` arbitrario por `/api/create_update`. | Deshabilitar/eliminar tipo y rama; las transferencias no se reintroducen sin contrato de inventario y prueba de servidor. | Ninguno mientras no haya productor. Si se aprueba: endpoint específico con autorización de unidad/ubicación e idempotencia. | `tests/secureSyncTransport.test.ts` (**pendiente**). |
| `src/stores/useSyncStore.ts` — caso `customer_create` | Crea `res.partner` por `/api/create_update` con datos de la cola. | Deshabilitar/eliminar tipo y rama. No confundirlo con `customer/contact/update`, que solo modifica un partner ya autorizado. | Ninguno mientras no haya productor. Si se necesita alta: endpoint de creación de cliente con validación, alcance e idempotencia. | `tests/secureSyncTransport.test.ts` (**pendiente**). |
| `src/types/sync.ts` — `SyncItemType` (`collection`, `transfer`, `customer_create`) | Declara los tres tipos legacy en el esquema persistente de ítems, por lo que un ítem rehidratado aún puede alcanzar el dispatcher. | Eliminar las tres variantes; la rehidratación debe descartar o migrar explícitamente los ítems heredados, nunca enviarlos por RPC. | Ninguno mientras no haya productor. Cualquier nuevo tipo requiere su propio endpoint seguro antes de añadirse al esquema. | `tests/secureSyncTransport.test.ts` (**pendiente**) debe afirmar la ausencia de los tres literales en `SyncItemType`; `tests/syncDependencies.test.ts` cubre dependencias de cola. |
| `src/types/sync.ts` — `SYNC_PRIORITY_MAP` (`collection`, `transfer`, `customer_create`) | Mantiene prioridades para los tres tipos legacy aunque se retire su ejecución; puede normalizar/persistir ítems obsoletos. | Eliminar las tres prioridades junto con los tipos y ramas; no sustituirlas por una prioridad genérica. | Ninguno mientras no haya productor. | `tests/secureSyncTransport.test.ts` (**pendiente**) debe afirmar la ausencia de las tres claves en `SYNC_PRIORITY_MAP`; `tests/syncDependencies.test.ts` cubre dependencias de cola. |
| `src/services/odooRpc.ts` — soporte compartido de las tres ramas | Centraliza los transportes `/get_records` y `/api/create_update` que permiten modelo/dominio/dict genéricos. | Eliminar el archivo cuando las filas anteriores estén migradas o retiradas. | No aplica; se reemplaza por clientes REST tipados. | `tests/noPrivilegedOdooClient.test.mjs` y `tests/secureSyncTransport.test.ts` (**pendientes**). |

## Verificación reproducible de esta línea base

El inventario se obtuvo con los siguientes barridos (la salida no debe copiar
coincidencias que puedan contener secretos):

```sh
rg -l --glob '!node_modules/**' --glob '!\\.git/**' \
  'odooSession|odooRpc|odooRead|odooWrite|koldRead|call_kw|execute_kw|setServiceCredentials|/get_records|/api/create_update' \
  app src

rg -l -U --glob '!node_modules/**' --glob '!\\.git/**' \
  "postRpc\\([\\s\\S]{0,80}['\\\"](?:/get_records|/api/create_update)['\\\"]" \
  app src
```

Antes de publicar una build, el guard de Task 1 debe ejecutar `npm run
test:security`; el escaneo de IPA firmado debe ejecutar `npm run scan:ipa` con
los indicadores revocados disponibles solamente en CI.
