# Alta seguida de venta especial

Diseño aprobado: docs/testing/lead-to-special-sale-reevaluation.md. Reusar PR109/213; horario independiente.

1. Probar captura GPS nueva/precisa y rechazar coordenadas vencidas o inventadas. Mostrar confirmación de estar en negocio; dirección textual independiente.
2. Implementar controlador de intake con dependencias inyectables y borrador cifrado por sesión. Persistir UUID/formulario/GPS antes de encolar. Reintentar la misma operación. Recuperar borrador al volver.
3. Añadir endpoint empleado lead/start-sale con lead_operation_id y operation_id. Resolver lead scoped, validar contacto/canal/GPS, inicio+conversión+respuesta idempotente en savepoint. Si hay conflicto/duplicado, rollback sin visita huérfana. No crear pedido.
4. Integrar popup y botones de recuperación en Nuevo Prospecto. Venta requiere confirmación de alta y conexión. Preparar copia virtual de parada vinculada y abrir /sale con precios de cliente. No sobrescribir visita distinta activa.
5. Tests de recuperación, no venta, doble toque/replay, identidad de visita, GPS y autorización. Suite app/typecheck, contratos backend y TransactionCase/CI. Revisión independiente y actualizar PRs.
