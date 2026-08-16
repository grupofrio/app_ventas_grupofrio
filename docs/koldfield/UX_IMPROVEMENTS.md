# Kold Field — UX Improvements

| Mejora | Clase | Beneficio | Complejidad | Riesgo | Dependencia |
|---|---|---|---|---|---|
| UUID v4 en mutaciones (invisible UX, evita duplicados) | IMPLEMENT_NOW | Cero doble cobro | Baja | Bajo | gf UUID gate |
| Copy regalo ≠ merma | IMPLEMENT_NOW | Menos confusión | Baja | Bajo | — |
| Exchange no infla stock vendible | IMPLEMENT_NOW | Inventario honesto | Baja | Bajo | — |
| payment_policy visible en check-in/mapa | IMPLEMENT_NOW (parcial backend) | No preguntar lo que Odoo sabe | Media | Med | bundle policy |
| Quitar selector forma de pago en venta normal | NEXT_ITERATION | Menos toques | Media | Med | policy 100% + permiso excepción |
| Alertas/Tareas dentro de Mi día | NEXT_ITERATION | Menos pestañas sin perder función | Media | Med | investigar tabs actuales |
| Ranking seguro Bearer | NEXT_ITERATION | Motivación | Alta | Alto | endpoint nuevo |
| Repetir última compra | NEXT_ITERATION | Velocidad | Media | Med | historial confiable |
| Alerta “quedan N piezas vs visitas” | NEXT_ITERATION | Evita quiebre | Media | Med | ledger local |
| Reactivar ranking legacy RPC | DO_NOT_IMPLEMENT | — | — | Alto | inseguro |
| Inferir crédito por nombre de payment term | DO_NOT_IMPLEMENT | — | — | Alto | prohibido |
