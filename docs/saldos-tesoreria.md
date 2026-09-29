# Precisión del saldo en Tesorería

Corregido el 29 de septiembre de 2026.

## Incidente y regla de pago

El formulario Nuevo lote de abonos ofrecía el saldo redondeado a centavos, pero la validación final comparaba los compromisos contra el neto original con cuatro decimales. FT-018-00000131 tenía 216733.1055 HNL y proponía un abono de 216733.11 HNL; la diferencia de 0.0045 bloqueaba el lote completo.

El neto pagable, después de notas y retenciones, se redondea una sola vez a dos decimales (half-up), como hace la pantalla. De ese importe se deducen pagos, reservas y anticipos expresados en centavos. Cada movimiento histórico se redondea antes de sumar, igual que los mapas de Tesorería. No se añade una tolerancia: un centavo por encima del límite se sigue rechazando.

Un pago contabilizado se cuenta una sola vez, incluso si un registro antiguo conserva la bandera de reserva. El límite se comprueba dentro de la transacción con los bloqueos de factura existentes; un fallo revierte el lote y todos sus renglones. Los errores de la validación final identifican factura, moneda, neto pagable y compromisos.

## Documentos y notas

Los importes originales de factura, impuestos y notas conservan sus cuatro decimales. No se reescriben datos históricos ni se altera el efecto de la NC automática de retenciones.

El crédito disponible conserva precisión de cuatro decimales y nunca permite acreditar más que el importe original sin pagar. Si un pago completo redondeado deja una diferencia negativa menor a un centavo contra el importe original, se presenta disponibilidad cero; esto evita bloquear una NC de retenciones sin efecto adicional. Un exceso real contra el neto redondeado sigue siendo negativo y se rechaza. El detalle de nota, sus selectores y la validación usan el mismo cálculo.

Los anticipos aplicados usan la misma conversión a centavos, con aritmética entera, para coincidir con la vista previa y el pago final.

## Entrega y verificación

- Sin migraciones, cambios de permisos/RLS ni escrituras en Cloud/SSH para esta corrección. El diagnóstico de Cloud fue de solo lectura; la validación se hizo en PostgreSQL local desechable.
- 108 pruebas focalizadas: Tesorería, notas, anticipos, flujo contable y Excel.
- 38 pruebas PostgreSQL aprobadas: caso original en HNL y USD, creación/edición/contabilización del lote, conservación de los cuatro decimales, pago parcial, exceso real de un centavo, saldo después de NC, anticipos, NC de retenciones posterior al pago, importes bancarios históricos, permisos y concurrencia.
- TypeScript y compilación de producción aprobados.
- Evidencia del diagnóstico: output/treasury-abono-balance/cloud-audit.json. Pruebas reproducibles: pnpm test:financial-notes:db con una instancia PostgreSQL local.

Código principal: server/invoiceMoney.ts, server/treasury.ts, server/financialNotes.ts y server/purchaseOrderAdvances.ts. Revertir el código vuelve a introducir la comparación incoherente; no debe intentarse revertir pagos reales ni modificar documentos para compensar un rollback de aplicación.
