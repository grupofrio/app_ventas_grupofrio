# Kold Field: pago automático por cliente

## Objetivo

Eliminar la elección manual de contado/crédito de la pantalla de venta Kold Field. El servidor decide el método a partir de la política comercial del cliente ya autorizado por la parada; la app sólo lo muestra como orientación.

## Alcance

- Kold Field móvil y su endpoint Bearer `/gf/logistics/api/employee/sales/create`.
- No cambiar la PWA administrativa `/pwa-admin/sale-create`.
- No modificar ni duplicar el arreglo ya integrado del day bundle para métricas de crédito negativas.

## Regla comercial

| Política canónica del partner | Método persistido | Estado visible |
| --- | --- | --- |
| `cash_only` | `cash` | Contado |
| `credit_allowed` | `credit` | Crédito |
| `blocked` | `credit` | Crédito · revisar |
| modo ausente/desconocido | `cash` | Contado · revisar |

Una métrica de crédito anómala, por ejemplo `credit_used < 0`, es una advertencia por cliente: no invalida el bundle ni detiene ventas. No se normaliza inventando un valor de crédito. Un `blocked` conserva la venta a crédito y debe quedar marcado de forma explícita para revisión de Corte.

## Autoridad y flujo

1. La pantalla obtiene la política de la parada/cliente desde el day bundle validado para mostrar el método derivado y la advertencia, sin selector.
2. La cola offline congela líneas, parada y `operation_id`, pero no transmite método de pago ni `create_invoice` como decisión móvil.
3. Al sincronizar, el endpoint Bearer resuelve employee, compañía, plan, parada y partner; calcula de nuevo la política canónica en el servidor.
4. El backend persiste `payment_method` y la marca de revisión derivadas. El resultado del servidor es la autoridad para ticket, lista y liquidación.
5. Durante el despliegue, una versión antigua que aún envíe aliases de método o `create_invoice` no puede cambiar el resultado: el endpoint los ignora y calcula el resultado canónico. Cuando la app nueva esté distribuida se podrá auditar la ausencia de esos campos sin bloquear ventas.

## Límites

- No se permite a la app enviar `partner_id`, compañía, journal, método de pago ni decisión de facturación como autoridad.
- La excepción de crédito no bloquea la ruta ni la visita; se conserva como señal explícita para Corte.
- La integridad estructural, sesión, ruta, parada, catálogo e inventario conserva sus validaciones bloqueantes actuales.
