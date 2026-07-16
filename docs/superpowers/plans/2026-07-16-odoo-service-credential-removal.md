# KOLD Field Odoo Service Credential Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** entregar una build iOS candidata a TestFlight que opere con el token individual de empleado y no contenga ni dependa de una cuenta de servicio Odoo embebida.

**Architecture:** el cliente consumirá rutas REST con sesión de empleado para todos los datos que hoy requieren la sesión web de Odoo. `gf_logistics_ops` mantendrá la autorización de compañía, plaza, ruta/parada y cliente en el servidor; la app encapsulará esos contratos en servicios limitados y eliminará los fallbacks ORM/RPC privilegiados. El corte se protege con tests de fuente, escaneo del IPA exacto y revocación posterior de la cuenta histórica, sin rollback al cliente inseguro.

**Tech Stack:** Expo SDK 52 / React Native / TypeScript / Zustand / Node 22 test runner; Odoo 18 Python (`gf_logistics_ops`, `os_api`); EAS Build and App Store Connect.

---

## Límites y condiciones de ejecución

- Este plan modifica dos repositorios: la app en `/Users/sebis/Desktop/app-ventas-v2` y Odoo en `/Users/sebis/Documents/odoo/GrupoFrio`.
- La cuenta y contraseña expuestas deben tratarse como comprometidas. No se copiarán a tests, commits, logs ni documentación. Los valores de comparación del IPA vivirán únicamente como secretos de CI.
- Ningún paso habilita TestFlight, revoca una cuenta, cambia Google Cloud ni modifica datos productivos sin la aprobación operativa indicada en la especificación.
- Si un flujo no tiene endpoint de empleado, se implementa y se prueba primero en Odoo. No se permite conservar `odooSession`, `call_kw`, `execute_kw`, `odooRpc` ni `/api/create_update` como fallback de distribución.
- Las rutas REST existentes que se reutilizan son: `truck_stock`, `pricing/by_partner`, `directory/search`, `customer/loyalty`, `customer/contact/update`, `sales/create`, `payments/create`, `plan` y `stop`.

## Mapa de archivos y responsabilidades

### Cliente móvil

| Archivo | Cambio | Responsabilidad posterior |
|---|---|---|
| `app/_layout.tsx` | Modificar | Arranque sin configurar una credencial Odoo. |
| `src/services/odooSession.ts` | Eliminar | No debe existir sesión web de Odoo en el cliente. |
| `src/services/odooRpc.ts` | Eliminar | No debe existir wrapper de ORM/RPC genérico en el cliente. |
| `src/services/employeeData.ts` | Crear | Cliente REST tipado para directorio, lealtad, contacto, incidencias e insights KOLD. |
| `src/services/loyalty.ts` | Modificar | Adaptar la respuesta REST de lealtad a `loyaltyLogic`. |
| `src/services/offrouteSearch.ts` | Modificar | Consumir `directory/search`, sin buscar `res.partner` o `crm.lead` directamente. |
| `src/services/customerContactUpdate.ts` | Modificar | Sincronizar contacto mediante la ruta con alcance de empleado. |
| `src/services/employeeAnalytics.ts` | Eliminar | La plaza llega en el login; no se consulta `hr.employee` desde el móvil. |
| `src/services/pricelist.ts` | Modificar | Usar el precio del servidor y caché local; eliminar reglas ORM y fallbacks directos. |
| `src/services/routeIncidents.ts` | Modificar | Usar rutas REST de incidencias acotadas al empleado. |
| `src/stores/useProductStore.ts` | Modificar | Aceptar solo catálogo/stock de `truck_stock`; nunca catálogo global o `stock.quant`. |
| `src/stores/useKoldStore.ts` | Modificar | Usar el endpoint de insights KOLD y mantener la degradación explícita si el módulo no está instalado. |
| `src/stores/useAuthStore.ts` | Modificar | Usar plaza del login, borrar solo tokens/cachés propios al salir. |
| `src/stores/useSyncStore.ts` y `src/types/sync.ts` | Modificar | Eliminar ramas sin productores que escriben `/api/create_update`, vincular la cola al empleado y conservar reintentos REST idempotentes sin tokens. |
| `src/persistence/storage.ts` y `src/services/visitPhotos.ts` | Modificar | Eliminar cola, cachés y evidencias locales del empleado al cerrar sesión o descartar explícitamente. |
| `src/services/api.ts` | Modificar | Hacer opcional `Api-Key` para la app y exigir token de empleado para las rutas REST. |
| `scripts/scan-ios-release-secrets.mjs` | Crear | Escanear el IPA firmado sin imprimir indicadores sensibles. |
| `tests/noPrivilegedOdooClient.test.mjs` | Crear | Guard de fuente para impedir reintroducir RPC/sesión o credenciales de servicio. |
| `tests/employeeData.test.ts`, `tests/secureInventoryPricing.test.ts`, `tests/secureSyncTransport.test.ts` | Crear | Pruebas unitarias y de wiring de los contratos REST. |

### Odoo

| Archivo | Cambio | Responsabilidad posterior |
|---|---|---|
| `/Users/sebis/Documents/odoo/GrupoFrio/gf_logistics_ops/controllers/gf_api.py` | Modificar | Exponer incidencias e insights KOLD mediante `_run_with_session_employee`, validando alcance en servidor. |
| `/Users/sebis/Documents/odoo/GrupoFrio/gf_logistics_ops/tests/test_employee_customer_api_contract.py` | Modificar | Verificar que las rutas sensibles usan el wrapper de token de empleado. |
| `/Users/sebis/Documents/odoo/GrupoFrio/gf_logistics_ops/tests/test_fasttrack_api.py` | Modificar | Casos funcionales de autorización, idempotencia y respuestas de nuevas rutas. |
| `/Users/sebis/Documents/odoo/GrupoFrio/os_api/controllers/employee_login.py` | Modificar solo si la prueba demuestra una ausencia | Garantizar que el login devuelve la plaza analítica y token de empleado sin depender de una API key compartida. |
| `/Users/sebis/Documents/odoo/GrupoFrio/os_api/tests/test_employee_signin_security.py` | Modificar | Contrato de respuesta y no filtración de tokens en logs. |

## Inventario de migración que debe quedar cerrado

| Uso actual | Reemplazo seguro | Estado esperado |
|---|---|---|
| Sesión Odoo inicializada desde `app/_layout.tsx` | Ninguno; se elimina | Eliminado |
| Precios/lista y reglas de `pricelist.ts` | `pricing/by_partner` y caché de precios ya obtenidos | Migrado |
| `stock.quant` / catálogo global en `useProductStore` | `truck_stock` | Migrado |
| Lealtad de cliente | `customer/loyalty` | Migrado |
| Búsqueda libre cliente/lead | `directory/search` | Migrado |
| Actualización de contacto | `customer/contact/update` | Migrado |
| Plaza analítica del empleado | payload de `/api/employee-sign-in` | Migrado |
| Alta/lista de incidencias | nuevas rutas `incidents/create` y `incidents/list` | Migrado |
| Score/forecast opcional KOLD | nueva ruta `kold/insights` | Migrado o degradado explícitamente |
| Ramas genéricas de cola sin productores | eliminar, no convertir en RPC | Eliminado |

### Task 1: Crear el guard de seguridad y el inventario ejecutable

**Files:**
- Create: `tests/noPrivilegedOdooClient.test.mjs`
- Create: `scripts/scan-ios-release-secrets.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Escribir primero el test rojo de fuente**

  Implementar `tests/noPrivilegedOdooClient.test.mjs` para recorrer **todos** los archivos versionables de las entradas de release (`app/`, `src/`, `assets/`, `app.json`, `eas.json`, `ios/`, `android/`, `package.json` y lockfile), excluyendo solo `.git`, `node_modules`, Pods y productos de build. Debe fallar al encontrar sesión/RPC privilegiado, imports estáticos o dinámicos, y pares literales que parezcan login+contraseña de Odoo:

  ```js
  const forbidden = [
    /setServiceCredentials\s*\(/,
    /\/web\/session\/authenticate/,
    /\/web\/dataset\/call_kw/,
    /\bexecute_kw\b/,
    /(?:from|import\()\s*['\"][^'\"]*odoo(?:Session|Rpc)/,
    /(?:login|user(?:name)?|password|passwd)\s*:\s*['\"][^'\"]{8,}['\"]/i,
    /['\"][^'\"\n]+@[^'\"\n]+\.[a-z]{2,}['\"]\s*,\s*['\"][^'\"\n]{8,}['\"]/i,
  ];
  ```

  Ignorar `.git`, `node_modules`, Pods, productos de build y el propio test. El mensaje debe incluir solo ruta y regla, nunca el texto coincidente ni valores sensibles.

- [ ] **Step 2: Verificar que el guard falla contra el estado vulnerable**

  Run: `node --test --experimental-strip-types tests/noPrivilegedOdooClient.test.mjs`

  Expected: FAIL señalando al menos la configuración de sesión o un consumidor directo; el output no contiene credenciales.

- [ ] **Step 3: Añadir el escáner de IPA sin secretos en el repositorio**

  Crear `scripts/scan-ios-release-secrets.mjs`. Debe aceptar una ruta `.ipa`, descomprimirla en un directorio temporal y recorrer todos los archivos de `Payload/*.app` y de los bundles JavaScript/assets incluidos; no limitarse a un archivo JS conocido. Debe bloquear los indicadores de código y los secretos de comparación:

  ```js
  const sourceIndicators = [
    '/web/session/authenticate',
    '/web/dataset/call_kw',
    'execute_kw',
    'setServiceCredentials',
  ];
  const secretEnvNames = ['KOLD_REVOKED_ODOO_LOGIN', 'KOLD_REVOKED_ODOO_PASSWORD'];
  ```

  Para cada valor presente de `secretEnvNames`, buscarlo en todos los bytes del IPA extraído y lanzar `Error('IPA contains a revoked-secret indicator')` sin interpolar ni imprimir el valor. Fallar si falta alguno de esos secretos en modo CI; el pipeline de release siempre se ejecuta en ese modo. El script también debe bloquear cada `sourceIndicator`, incluso si los secretos no estuvieran empaquetados. Añadir a `.gitignore` el directorio temporal y los IPA descargados.

- [ ] **Step 4: Exponer comandos repetibles**

  Añadir scripts en `package.json`:

  ```json
  {
    "test:security": "node --test --experimental-strip-types tests/noPrivilegedOdooClient.test.mjs",
    "scan:ipa": "node scripts/scan-ios-release-secrets.mjs"
  }
  ```

- [ ] **Step 5: Ejecutar el guard de fuente y la suite base**

  Run: `npm run test:security`

  Then run: `npm test`

  Expected: el guard aún falla antes de la migración; `npm test` establece el baseline existente sin nuevos fallos.

- [ ] **Step 6: Commit del guard rojo**

  ```bash
  git add package.json .gitignore tests/noPrivilegedOdooClient.test.mjs scripts/scan-ios-release-secrets.mjs
  git commit -m "test(security): add privileged Odoo client guard"
  ```

### Task 2: Cerrar los contratos REST ya disponibles en Odoo

**Files:**
- Modify: `/Users/sebis/Documents/odoo/GrupoFrio/gf_logistics_ops/tests/test_employee_customer_api_contract.py`
- Modify: `/Users/sebis/Documents/odoo/GrupoFrio/gf_logistics_ops/tests/test_fasttrack_api.py`
- Modify only if needed: `/Users/sebis/Documents/odoo/GrupoFrio/os_api/controllers/employee_login.py`
- Test: `/Users/sebis/Documents/odoo/GrupoFrio/os_api/tests/test_employee_signin_security.py`

- [ ] **Step 1: Escribir pruebas de autorización y contrato antes de cambiar Odoo**

  En `test_employee_customer_api_contract.py`, extender `ROUTE_HANDLERS` y las aserciones AST para exigir que `directory/search`, `customer/loyalty` y `customer/contact/update` llaman exactamente a `_run_with_session_employee(payload, handler)`. Añadir casos que documenten que el servidor obtiene compañía/plaza desde el empleado y no acepta esos valores del payload.

  En `test_fasttrack_api.py`, añadir una matriz explícita para `truck_stock`, `pricing/by_partner`, `sales/create`, `payments/create`, `my_plan`, `plan/stops`, `stop/checkin` y `stop/checkout`: token ausente, inválido, vencido, revocado, de otro empleado/ruta, compañía/plaza ajena y payload que falsifica IDs. Para ventas, exigir recálculo de precio en servidor, validación de stock de la unidad y misma respuesta/venta ante un segundo `operation_id`; para pagos, exigir idempotencia y que el empleado se derive del token.

- [ ] **Step 2: Ejecutar la prueba de contrato**

  Run: `python3 -m unittest gf_logistics_ops.tests.test_employee_customer_api_contract gf_logistics_ops.tests.test_fasttrack_api`

  Expected: PASS si los contratos ya están desplegados; cualquier fallo de alcance, token, precio, stock o idempotencia es una brecha que se corrige antes de tocar la app.

- [ ] **Step 3: Añadir el contrato del login sin dependencia de API key compartida**

  Escribir una prueba en `os_api/tests/test_employee_signin_security.py` que afirme que la respuesta exitosa incluye `gf_employee_token` y `employee.x_analytic_account_id`, y que los logs de signin no serializan ninguno de los dos secretos. La app no debe requerir `api_key` para rutas `gf/logistics/api/employee/*`.

- [ ] **Step 4: Hacer el cambio mínimo de backend, solo si la prueba falla**

  En `employee_login.py`, mantener la plaza como tupla `[id, nombre]` bajo `employee.x_analytic_account_id`. Si hoy el token no se entrega o no es individual/revocable, reparar la creación/serialización de `gf.employee.mobile.session`; no devolver ni reutilizar una clave de una cuenta fallback para KOLD Field.

- [ ] **Step 5: Ejecutar pruebas Odoo acotadas**

  Run: `python3 -m unittest os_api.tests.test_employee_signin_security gf_logistics_ops.tests.test_employee_customer_api_contract gf_logistics_ops.tests.test_fasttrack_api`

  Expected: PASS; el contrato identifica al empleado solo por su sesión/token y la matriz crítica rechaza toda combinación no autorizada.

- [ ] **Step 6: Commit de backend**

  ```bash
  git -C /Users/sebis/Documents/odoo/GrupoFrio add os_api gf_logistics_ops
  git -C /Users/sebis/Documents/odoo/GrupoFrio commit -m "test(api): lock employee data contracts"
  ```

### Task 3: Crear el cliente REST de datos de empleado y migrar los tres flujos existentes

**Files:**
- Create: `src/services/employeeData.ts`
- Modify: `src/services/loyalty.ts`
- Modify: `src/services/offrouteSearch.ts`
- Modify: `src/services/customerContactUpdate.ts`
- Modify: `src/services/employeeAnalytics.ts`
- Modify: `src/stores/useAuthStore.ts`
- Create: `tests/employeeData.test.ts`
- Modify: `tests/loyaltyWiring.test.mjs`, `tests/customerEditFrontendWiring.test.mjs`, `tests/offrouteSearch.test.ts`, `tests/authOffline.test.ts`

- [ ] **Step 1: Escribir pruebas rojas para los adaptadores REST**

  En `tests/employeeData.test.ts`, mockear `postRest` y comprobar estas transformaciones:

  ```ts
  await searchEmployeeDirectory('oxxo');
  // POST gf/logistics/api/employee/directory/search { query: 'oxxo', limit: 20 }

  await updateEmployeeScopedContact(42, { phone: '5555555555' });
  // POST .../customer/contact/update { partner_id: 42, values: { phone: '5555555555' } }

  await getEmployeeScopedLoyalty(42);
  // POST .../customer/loyalty { partner_id: 42 }
  ```

  Afirmar que nunca se envían `employee_id`, `company_id`, plaza ni token dentro del body.

- [ ] **Step 2: Ejecutar el test y confirmar que está rojo**

  Run: `node --test --experimental-strip-types tests/employeeData.test.ts`

  Expected: FAIL porque `employeeData.ts` no existe.

- [ ] **Step 3: Implementar `employeeData.ts`**

  Centralizar `postRest` y `unwrapEnvelope` en funciones pequeñas. El shape público debe ser:

  ```ts
  export async function searchEmployeeDirectory(query: string, limit = 20): Promise<{ customers: unknown[]; leads: unknown[] }>;
  export async function getEmployeeScopedLoyalty(partnerId: number): Promise<Record<string, unknown> | null>;
  export async function updateEmployeeScopedContact(partnerId: number, values: Record<string, string | false>): Promise<Record<string, unknown> | null>;
  ```

  Validar IDs positivos, recortar query, limitar a 20 y usar `DEFAULT_READ_TIMEOUT_MS` en lecturas. No importar `odooRpc` ni `postRpc`.

- [ ] **Step 4: Migrar consumidores sin cambiar su modelo de UI**

  - `loyalty.ts`: pasar el `customer` REST a `parsePartnerLoyalty`.
  - `offrouteSearch.ts`: enviar solo el query a `searchEmployeeDirectory` y adaptar sus listas a `buildOffrouteResults`; eliminar dominio client-side y ambos fallbacks ORM.
  - `customerContactUpdate.ts`: conservar normalización de teléfono y `buildCustomerContactStopPatch`, pero cambiar sync por `{ partner_id, values }`.
  - `useAuthStore.ts`: importar `extractEmployeeAnalyticPlaza` desde su módulo puro; eliminar `fetchEmployeeAnalyticPlaza` y el llamado de red de `ensureEmployeeAnalytics`. La plaza ausente se muestra como ausente, no se consulta `hr.employee`.
  - Eliminar `src/services/employeeAnalytics.ts` cuando ningún import lo use.

- [ ] **Step 5: Ejecutar pruebas de los cuatro flujos**

  Run: `node --test --experimental-strip-types tests/employeeData.test.ts tests/loyaltyWiring.test.mjs tests/customerEditFrontendWiring.test.mjs tests/offrouteSearch.test.ts tests/authOffline.test.ts`

  Expected: PASS y ningún archivo modificado importa `odooRpc`.

- [ ] **Step 6: Commit de la migración REST existente**

  ```bash
  git add src/services/employeeData.ts src/services/loyalty.ts src/services/offrouteSearch.ts src/services/customerContactUpdate.ts src/stores/useAuthStore.ts tests/employeeData.test.ts tests/loyaltyWiring.test.mjs tests/customerEditFrontendWiring.test.mjs tests/offrouteSearch.test.ts tests/authOffline.test.ts
  git rm src/services/employeeAnalytics.ts
  git commit -m "refactor(api): move employee data to scoped REST"
  ```

### Task 4: Añadir en Odoo endpoints acotados para incidencias e insights KOLD

**Files:**
- Modify: `/Users/sebis/Documents/odoo/GrupoFrio/gf_logistics_ops/controllers/gf_api.py`
- Modify: `/Users/sebis/Documents/odoo/GrupoFrio/gf_logistics_ops/tests/test_employee_customer_api_contract.py`
- Modify: `/Users/sebis/Documents/odoo/GrupoFrio/gf_logistics_ops/tests/test_fasttrack_api.py`

- [ ] **Step 1: Escribir pruebas rojas de rutas nuevas**

  Añadir contratos para estas tres rutas:

  ```text
  POST /gf/logistics/api/employee/incidents/create
  POST /gf/logistics/api/employee/incidents/list
  POST /gf/logistics/api/employee/kold/insights
  ```

  Las pruebas deben verificar `_run_with_session_employee`, rechazo de partner/stop/plan de otra ruta o plaza, y que `employee_id`/`company_id` del payload se ignoran. Para `kold/insights`, comprobar límite de 500 partners, intersección con `_employee_partner_scope_domain(employee)` y respuesta vacía/disponibilidad `false` si los módulos no existen.

- [ ] **Step 2: Ejecutar las pruebas y confirmar el fallo inicial**

  Run: `python3 -m unittest gf_logistics_ops.tests.test_employee_customer_api_contract`

  Expected: FAIL porque aún no existen handlers para incidencias e insights.

- [ ] **Step 3: Implementar incidencias con identidad derivada en servidor**

  En `GFLogisticsAPI` crear `_handle_employee_incident_create` y `_handle_employee_incidents_list`:

  ```python
  def _handle_employee_incident_create(self, employee, payload):
      plan = self._get_plan_for_employee(employee, payload, allow_states=["published", "in_progress"])
      stop = self._get_optional_stop_for_employee(employee, payload)
      # validar que stop pertenece a plan cuando ambos existen
      # crear con employee.id y employee.company_id.id, no con valores del body
      # operation_id es obligatorio y devuelve la incidencia ya creada si se reintenta
      return self._response(True, "Incidencia registrada", {"incident": serialized})
  ```

  La ruta de lista debe filtrar por el empleado autenticado, compañía y alcance de plan opcional. Validar `incident_type`, `severity`, longitud de nota y paginación; no aceptar dominio Odoo arbitrario. Persistir `operation_id` con una restricción/búsqueda por empleado+operación, de forma que un retry responda `200` con el mismo `incident_id` y no cree un duplicado.

- [ ] **Step 4: Implementar insights KOLD con degradación segura**

  Crear `_handle_employee_kold_insights(employee, payload)` que tome `partner_ids`, aplique el dominio de cliente del empleado y consulte únicamente campos allowlisted de `kold.customer.score` y `kold.demand.forecast` si dichos modelos están presentes. Devolver:

  ```python
  {"scores_available": bool, "forecasts_available": bool, "scores": [], "forecasts": []}
  ```

  No usar `sudo()` sin el filtro ya intersectado ni aceptar nombres de modelo, campos, dominio, employee o company provenientes de la app.

- [ ] **Step 5: Probar autorización, límite e idempotencia**

  Run: `python3 -m unittest gf_logistics_ops.tests.test_employee_customer_api_contract gf_logistics_ops.tests.test_fasttrack_api`

  Expected: PASS, incluyendo token incorrecto/revocado, partner ajeno, stop ajeno, payload con employee/company falsificados, reintento de incidencia con mismo `operation_id` y módulos KOLD no instalados.

- [ ] **Step 6: Commit de backend**

  ```bash
  git -C /Users/sebis/Documents/odoo/GrupoFrio add gf_logistics_ops/controllers/gf_api.py gf_logistics_ops/tests
  git -C /Users/sebis/Documents/odoo/GrupoFrio commit -m "feat(api): scope incidents and KOLD insights to employee"
  ```

### Task 5: Migrar incidencias e inteligencia KOLD del móvil

**Files:**
- Modify: `src/services/employeeData.ts`
- Modify: `src/services/routeIncidents.ts`
- Modify: `src/stores/useKoldStore.ts`
- Modify: `src/services/gfLogistics.ts`
- Create: `tests/secureIncidentsAndKold.test.ts`
- Modify: `tests/routeIncidentLogic.test.ts`, `tests/koldOptionalRpcWiring.test.mjs`

- [ ] **Step 1: Escribir tests rojos del contrato móvil**

  Probar que `createIncident` y `getMyIncidents` llaman las rutas de empleado y no añaden employee/company al body; probar que `loadForPartners` consume una sola petición `kold/insights` y conserva `scores_available`/`forecasts_available` por sesión.

- [ ] **Step 2: Ejecutar los tests nuevos**

  Run: `node --test --experimental-strip-types tests/secureIncidentsAndKold.test.ts`

  Expected: FAIL porque el cliente sigue importando `odooRpc`.

- [ ] **Step 3: Implementar los adaptadores y sustituir las llamadas genéricas**

  Añadir a `employeeData.ts` `createEmployeeIncident`, `listEmployeeIncidents` y `getKoldInsights`. En `routeIncidents.ts`, conservar el tipo público si otras pantallas lo usan, pero ignorar cualquier `employeeId`/`companyId` legado y no mandarlos. En `useKoldStore.ts`, transformar la respuesta allowlisted sin pedir modelos o campos al backend. Actualizar `gfLogistics.ts` para no documentar ni ofrecer `odooRpc` como alternativa.

- [ ] **Step 4: Prohibir el antiguo wiring**

  Reemplazar `tests/koldOptionalRpcWiring.test.mjs` por aserciones que exijan `kold/insights` y que `src/stores/useKoldStore.ts` no contiene `koldRead` ni `odooRpc`.

- [ ] **Step 5: Ejecutar pruebas**

  Run: `node --test --experimental-strip-types tests/secureIncidentsAndKold.test.ts tests/routeIncidentLogic.test.ts tests/koldOptionalRpcWiring.test.mjs`

  Expected: PASS.

- [ ] **Step 6: Commit de la migración**

  ```bash
  git add src/services/employeeData.ts src/services/routeIncidents.ts src/stores/useKoldStore.ts src/services/gfLogistics.ts tests/secureIncidentsAndKold.test.ts tests/routeIncidentLogic.test.ts tests/koldOptionalRpcWiring.test.mjs
  git commit -m "refactor(api): secure incidents and KOLD insights"
  ```

### Task 6: Retirar fallbacks de stock, precios y cola RPC genérica

**Files:**
- Modify: `src/stores/useProductStore.ts`
- Modify: `src/services/pricelist.ts`
- Modify: `src/services/serverPricingEndpoint.ts`
- Modify: `src/stores/useSyncStore.ts`
- Modify: `src/services/api.ts`
- Create: `tests/secureInventoryPricing.test.ts`
- Create: `tests/secureSyncTransport.test.ts`
- Modify: `tests/truckStockFallbackWiring.test.mjs`, `tests/pricelistServerEndpoint.test.ts`, `tests/salesMigration.test.ts`, `tests/syncDependencies.test.ts`

- [ ] **Step 1: Escribir pruebas rojas para los fallbacks prohibidos**

  Afirmar que `useProductStore.ts` solo llama `fetchTruckStock` y que, con respuesta ausente o vacía, conserva el último caché contextual o muestra un error bloqueante; nunca consulta `stock.quant` ni `product.product` genéricos. Afirmar que `pricelist.ts` llama `pricing/by_partner` y no contiene `odooRead`, `odooRpc`, `search_read` ni `product.pricelist.item`.

  En `secureSyncTransport.test.ts`, recorrer `useSyncStore.ts` y exigir cero `postRpc('/api/create_update'`. Verificar que los tipos con productores activos (`sale_order`, `payment`, `gps`, `photo`, `prospection`, `customer_update`, checkin/checkout/no_sale/offroute) usan wrappers REST y que los tipos sin productores (`refill`, `unload`, `collection`, `transfer`, `customer_create`) dejan de ser ramas genéricas silenciosas.

- [ ] **Step 2: Ejecutar pruebas y comprobar el fallo**

  Run: `node --test --experimental-strip-types tests/secureInventoryPricing.test.ts tests/secureSyncTransport.test.ts`

  Expected: FAIL por los fallbacks ORM/RPC existentes.

- [ ] **Step 3: Hacer stock fail-closed y sin catálogo global**

  Eliminar `odooRead`, `PRODUCT_FIELDS`, `stock_quant` y `global_legacy` de `useProductStore.ts`. Simplificar `InventorySource` a `truck_stock`. Cuando el endpoint no esté disponible, no inventar stock ni catálogo: conservar caché solo si su `contextKey` coincide y marcar la pantalla como datos sin conexión; con caché ausente, devolver error accionable y deshabilitar la venta hasta sincronizar.

- [ ] **Step 4: Hacer precio de servidor/caché únicamente**

  Retirar de `pricelist.ts` la resolución de partner/pricelist y las reglas client-side. `computeCustomerPrices` debe:

  ```ts
  const serverPrices = await fetchServerSidePrices(partnerId, products, options);
  if (serverPrices !== null) return cacheCustomerPrices(..., serverPrices, options);
  return peekCachedCustomerPrices(partnerId, products, options) ?? new Map();
  ```

  Si no hay red ni caché, la UI muestra precio de catálogo como referencia y la confirmación depende del recálculo de `sales/create`; no se crea una venta offline sin un `operation_id` idempotente.

- [ ] **Step 5: Eliminar transportes genéricos no alcanzables**

  En `useSyncStore.ts`, borrar las cinco ramas `postRpc('/api/create_update')` inventariadas y los tipos de cola sin productor. Si se descubre un productor real durante la ejecución, detener este paso y crear primero su endpoint REST con autorización y prueba Odoo; no reintroducir la rama genérica. En `api.ts`, permitir que `setAuthTokens` reciba `apiKey?: string`; para KOLD Field no persistir ni exigir API key, y hacer que los clientes REST envíen exclusivamente `X-GF-Employee-Token`/`X-GF-Token`.

- [ ] **Step 6: Ejecutar suite focal y typecheck**

  Run: `node --test --experimental-strip-types tests/secureInventoryPricing.test.ts tests/secureSyncTransport.test.ts tests/truckStockFallbackWiring.test.mjs tests/pricelistServerEndpoint.test.ts tests/salesMigration.test.ts tests/syncDependencies.test.ts && npm run typecheck`

  Expected: PASS; venta y pagos continúan usando `sales/create`/`payments/create` con `operation_id`.

- [ ] **Step 7: Commit del retiro de fallbacks**

  ```bash
  git add src/stores/useProductStore.ts src/services/pricelist.ts src/services/serverPricingEndpoint.ts src/stores/useSyncStore.ts src/services/api.ts tests/secureInventoryPricing.test.ts tests/secureSyncTransport.test.ts tests/truckStockFallbackWiring.test.mjs tests/pricelistServerEndpoint.test.ts tests/salesMigration.test.ts tests/syncDependencies.test.ts
  git commit -m "refactor(security): remove generic Odoo fallbacks"
  ```

### Task 7: Aislar la cola offline de tokens, reautorización y logout

**Files:**
- Create: `src/services/syncSecurity.ts`
- Modify: `src/types/sync.ts`
- Modify: `src/stores/useSyncStore.ts`
- Modify: `src/stores/useAuthStore.ts`
- Modify: `src/persistence/storage.ts`
- Modify: `src/services/visitPhotos.ts`
- Modify: `app/profile.tsx`, `app/consignment/[stopId].tsx`
- Create: `tests/syncSecurity.test.ts`, `tests/logoutPrivacy.test.mjs`
- Modify: `tests/authOffline.test.ts`, `tests/syncFailure.test.ts`, `tests/visitPhotos.test.ts`

- [ ] **Step 1: Escribir pruebas rojas de frontera de datos offline**

  Probar `sanitizeSyncPayload` de forma recursiva contra `token`, `api_key`, `authorization`, `password`, `cookie` y sus variantes; debe rechazar el enqueue en vez de persistir o registrar el valor. Probar que una `SyncQueueItem` persistida tiene `ownerEmployeeId`, `operation_id`, payload y metadata permitida, pero ningún token/cabecera/credencial.

  Añadir casos que simulen: (a) token inexistente, (b) token reemplazado por re-login, (c) empleado distinto, (d) 401/403 durante sync y (e) foto pendiente. En todos, la cola no debe enviar la operación hasta reautenticar al **mismo** empleado y nunca debe registrar valores de token. La política de logout será: bloquear logout normal mientras existen pendientes; el usuario puede elegir explícitamente **Sincronizar ahora** o **Descartar pendientes**, y la segunda opción borra cola, referencias/archivos de foto, estado de ruta, cachés de precio/producto y auth local.

- [ ] **Step 2: Ejecutar las pruebas y confirmar el fallo inicial**

  Run: `node --test --experimental-strip-types tests/syncSecurity.test.ts tests/logoutPrivacy.test.mjs`

  Expected: FAIL porque la cola actual no tiene propietario, persiste a través de logout y no valida el límite de credenciales.

- [ ] **Step 3: Implementar la frontera y reautorización**

  Crear `syncSecurity.ts` con una allowlist de claves de payload/meta y funciones puras `sanitizeSyncPayload`, `assertQueueOwner` y `isReauthenticationError`; nunca mutar/ocultar un secreto silenciosamente. En `types/sync.ts` añadir `ownerEmployeeId: number`. En `enqueue`, obtener el empleado autenticado, rechazar enqueue sin él, sanitizar y almacenar solo IDs/datos operativos. En `processQueue`, comprobar `hasAuthTokens()` y que `ownerEmployeeId` coincide antes de enviar; 401/403 deja el item pendiente y devuelve la app a reautenticación, no ejecuta con otra identidad ni lo marca como venta fallida.

- [ ] **Step 4: Implementar borrado explícito y UI de salida**

  Añadir a `useSyncStore` `hasPendingForCurrentEmployee()` y `discardPendingForLogout()`. Esta última debe borrar `STORAGE_KEYS.SYNC_QUEUE`, llamar `deletePhoto` para cada `localUri` de las fotos pendientes, vaciar memoria y eliminar los cachés de la sesión con `storeRemove`; nunca deja una URI ni evidencia de otro empleado. `useAuthStore.logout()` debe rechazar con un estado tipado mientras existan pendientes; `app/profile.tsx` y `app/consignment/[stopId].tsx` muestran las dos acciones explícitas antes de invocar el logout definitivo. `clearAuthTokens()` sigue ejecutándose en toda salida definitiva.

- [ ] **Step 5: Ejecutar pruebas de seguridad offline**

  Run: `node --test --experimental-strip-types tests/syncSecurity.test.ts tests/logoutPrivacy.test.mjs tests/authOffline.test.ts tests/syncFailure.test.ts tests/visitPhotos.test.ts`

  Expected: PASS. La prueba inspecciona el JSON persistido y la captura de logger para comprobar que no contienen tokens; evidencia y cola se eliminan o quedan bloqueadas según la elección explícita de logout.

- [ ] **Step 6: Commit de protección offline**

  ```bash
  git add src/services/syncSecurity.ts src/types/sync.ts src/stores/useSyncStore.ts src/stores/useAuthStore.ts src/persistence/storage.ts src/services/visitPhotos.ts app/profile.tsx app/consignment/[stopId].tsx tests/syncSecurity.test.ts tests/logoutPrivacy.test.mjs tests/authOffline.test.ts tests/syncFailure.test.ts tests/visitPhotos.test.ts
  git commit -m "fix(security): bind offline queue to authenticated employee"
  ```

### Task 8: Eliminar la sesión Odoo y cerrar el guard verde

**Files:**
- Modify: `app/_layout.tsx`
- Modify: `src/stores/useAuthStore.ts`
- Delete: `src/services/odooSession.ts`
- Delete: `src/services/odooRpc.ts`
- Modify: `tests/noPrivilegedOdooClient.test.mjs`
- Modify: `tests/sessionError.test.ts`, `tests/httpDebug.test.ts`, `tests/defaultBaseUrlEnv.test.mjs`

- [ ] **Step 1: Ejecutar una última búsqueda sin imprimir contenido sensible**

  Run: `rg -l 'setServiceCredentials|odooSession|odooRpc|call_kw|execute_kw|/api/create_update' app src tests`

  Expected: lista acotada de consumidores que este task eliminará; no usar `rg -n` ni imprimir las líneas que contengan valores.

- [ ] **Step 2: Eliminar configuración y ciclo de vida de la sesión privilegiada**

  Quitar los imports y llamadas de `setServiceCredentials` de `app/_layout.tsx`. Cambiar logout para no llamar `clearOdooSession`; debe borrar token de empleado protegido, estado autenticado, cachés de ruta/precio y operaciones pendientes según la política actual, sin escribir tokens en logs ni cola.

- [ ] **Step 3: Borrar módulos y actualizar tests de transporte**

  Eliminar `src/services/odooSession.ts` y `src/services/odooRpc.ts`. Sustituir los tests que validaban sesión/RPC por pruebas de que el cliente maneja 401/403 como reautenticación y no reintenta con otro método de autenticación.

- [ ] **Step 4: Ejecutar el guard verde y la suite completa**

  Run: `npm run test:security && npm test && npm run typecheck`

  Expected: PASS. El guard no encuentra sesión web, RPC directo, `execute_kw`, configuración de cuenta de servicio ni imports de los módulos eliminados.

- [ ] **Step 5: Commit de la eliminación irreversible en código**

  ```bash
  git add app/_layout.tsx src/stores/useAuthStore.ts tests/noPrivilegedOdooClient.test.mjs tests/sessionError.test.ts tests/httpDebug.test.ts tests/defaultBaseUrlEnv.test.mjs
  git rm src/services/odooSession.ts src/services/odooRpc.ts
  git commit -m "fix(security): remove Odoo service account from mobile"
  ```

### Task 9: Validar artefactos, producción controlada y preparar TestFlight

**Files:**
- Modify if required: `app.json`, `eas.json`
- Create: `docs/release-evidence/2026-07-16-odoo-credential-cutover.md` (sin secretos ni datos personales)

- [ ] **Step 1: Verificar compatibilidad de build antes de generar un artefacto**

  Run: `npx expo-doctor`

  Then run: `npx eas-cli@latest build:configure -p ios --non-interactive`

  Expected: diagnóstico sin incompatibilidades de SDK/Xcode que impidan el requisito de carga de Apple. Si requiere actualizar Expo, detener la publicación y abrir un plan separado de actualización; no combinar ese upgrade con el corte de credenciales.

- [ ] **Step 2: Configurar únicamente el perfil iOS de distribución**

  Añadir a `eas.json` un perfil `production` iOS de distribución, sin secretos de Odoo ni `EXPO_PUBLIC_*` sensibles. Mantener `version` de `app.json` alineada con el registro de App Store Connect que se vaya a usar (crear la versión `1.3.1` en lugar de intentar subirla a un registro `1.0`). Incrementar solo `ios.buildNumber` respecto de cualquier build ya cargada.

- [ ] **Step 3: Desplegar primero el backend seguro y verificar la revisión activa**

  En Odoo staging, desplegar los commits de Tasks 2 y 4 y actualizar los módulos sin datos de producción:

  ```bash
  python3 /Users/sebis/Documents/odoo/GrupoFrio/odoo-bin -d <staging-db> -u gf_logistics_ops,os_api --stop-after-init
  ```

  Ejecutar la matriz de Task 2 contra staging con dos empleados de datos controlados, incluido token revocado y cruce de ruta. Tras la aprobación del responsable Odoo, desplegar exactamente la misma revisión a producción en la ventana autorizada; registrar hash de commit, fecha y health check de las rutas REST. No ejecutar la prueba física ni generar IPA mientras producción no responda con esos handlers seguros.

- [ ] **Step 4: Ejecutar prueba controlada física antes de build externa**

  En un iPhone de desarrollo, con producción y datos controlados: login, preparación de ruta, stock, precio, venta, pago, evidencia, no venta, reconexión y logout. Probar token vencido/revocado y verificar que la app pide reautenticación sin fallback. Registrar fecha, build, resultado y limpieza de datos en `docs/release-evidence/...`; no registrar cuentas, tokens, ubicaciones precisas ni clientes reales.

- [ ] **Step 5: Construir el IPA de release y escanear el archivo exacto**

  Run: `npx eas-cli@latest build -p ios --profile production --non-interactive`

  Expected: un IPA firmado de la versión/build aprobados. Descargar ese IPA en una ruta ignorada y ejecutar en el entorno CI que contiene los dos secretos de comparación:

  ```bash
  npm run scan:ipa -- /absolute/path/to/KOLDField.ipa
  ```

  Expected: PASS sin mostrar los valores comparados. Conservar ID de build, hash SHA-256 del IPA y resultado del escaneo como evidencia.

- [ ] **Step 6: Aplicar gates externos y el corte de clientes heredados**

  Confirmar por escrito: paridad/QA Odoo aprobada, backend seguro desplegado, cuenta histórica aún activa solo para el canario, Google Maps iOS limitado a `mx.grupofrio.koldfield`, privacidad publicada y la build aprobada por release owner.

  Registrar la política de versión mínima como `1.3.1` con el build exacto libre de credenciales. Inventariar cada instalación heredada que use el camino antiguo, comunicar fecha/efecto del corte y obtener una de estas dos evidencias por dispositivo: actualización/retirada confirmada, o aceptación explícita del release owner de que quedará fuera de servicio. Preparar soporte, dueños de monitoreo y alertas de 401/403/sync para el canario. Si falta una evidencia o aprobación, no usar `eas submit` ni revocar la cuenta histórica.

- [ ] **Step 7: Enviar y habilitar únicamente el tester externo aprobado**

  Run: `npx eas-cli@latest submit -p ios --latest --non-interactive`

  Expected: build procesada en App Store Connect. Crear/usar el grupo de TestFlight con el usuario externo sin rol administrativo; incluir notas de prueba, build y canal de soporte. No habilitar release público.

- [ ] **Step 8: Completar el corte y revocación en una ventana aprobada**

  Tras canario sin alertas durante la ventana acordada y cobertura documentada de clientes heredados: administrador Odoo desactiva/revoca la cuenta histórica, invalida sesiones/tokens asociados y audita integraciones. Volver a ejecutar los flujos controlados y documentar resultado. Un rollback solo puede ser una build ya escaneada sin credenciales o una corrección de backend.

- [ ] **Step 9: Commit final de evidencia no sensible**

  ```bash
  git add app.json eas.json docs/release-evidence/2026-07-16-odoo-credential-cutover.md
  git commit -m "docs(release): record credential-free TestFlight evidence"
  ```

## Verificación final exigida

1. `npm run test:security`, las pruebas de frontera offline, `npm test` y `npm run typecheck` pasan desde una instalación limpia.
2. Las pruebas Odoo de contratos y `gf_logistics_ops` pasan contra la revisión segura desplegada primero en staging y después en producción.
3. La matriz de `truck_stock`, precio, venta, pago, plan y stop rechaza token ausente/inválido/vencido/revocado/ajeno y confirma precio, stock e idempotencia del servidor.
4. `rg -l 'setServiceCredentials|odooSession|odooRpc|call_kw|execute_kw|/api/create_update' app src` no devuelve archivos de release; la cola/logs persistidos no contienen tokens, credenciales ni cabeceras.
5. El IPA firmado exacto supera el escáner completo con los indicadores revocados de CI y el resultado queda conservado.
6. El flujo real con un token válido funciona; tokens vencidos, ajenos o revocados reciben rechazo/reautenticación sin ruta alternativa, y logout sincroniza o elimina explícitamente cola/evidencias antes de borrar credenciales.
7. La política de versión mínima, inventario de clientes heredados y evidencias de actualización/retirada o aceptación de pérdida de servicio quedan aprobados antes de revocar la cuenta histórica.
8. La cuenta de servicio histórica se revoca solo después del canario y de la gestión de clientes heredados; no existe un build externo que pueda reactivarla.
