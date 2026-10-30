# Liquidación por conceptos documentales en centavos

## Objetivo y alcance

La nueva liquidación calcula con importes ya redondeados a dos decimales y usa
ese mismo importe en saldo, validaciones, pagos y reportes operativos. Conserva
los valores originales de cuatro decimales de recepción, factura, retenciones y
notas, así como inventario, costos y documentos fiscales originales.

Política `document_cents_v1`:

`max(0, round(total,2) - round(retentionTotal,2) - round(otherRetentionTotal,2) - round(documentDiscountTotal,2) - round(creditNoteTotal,2) + round(debitNoteTotal,2))`.

El piso cero permite cerrar con una nota de crédito por el saldo original
completo cuando la suma de conceptos redondeados resulta un centavo negativa.
El límite original de la nota y la validación de compromisos siguen vigentes.

Se redondea cada total documental de encabezado, no cada línea ni precio
unitario. La ausencia de una política persistida conserva la regla anterior:
`round(netPayable,2)`. No hay una tolerancia de un centavo ni se acepta un exceso
real. La diferencia entre ambos métodos puede ser positiva o negativa.

## Persistencia y compatibilidad

Tablas laterales aditivas: política inmutable por factura, configuración global
inicialmente deshabilitada y auditoría de activación. No agregar columnas al
encabezado contabilizado ni modificar sus guardas de inmutabilidad. La política
se conserva después del primer abono y de NC/ND/reversiones.

El backend asigna la nueva política automáticamente a facturas creadas después
de activar la configuración. El mantenimiento habilita en un lote las existentes
sin historial de pagos/lotes, aplicaciones de anticipos ni dependencias que
impidan una transición segura. Las pagadas, reservadas o con historia de lote
conservan la regla anterior. El diagnóstico del 29/10/2026 encontró 36 diferencias
de un centavo: 11 sin pagos/lotes, 2 pagadas por banco pendientes de contabilizar
y 23 liquidadas. Se vuelve a evaluar bajo bloqueos antes de activar.

## Flujos y límites

- Un cálculo TypeScript exacto en centavos y una expresión SQL equivalente.
- Todos los lectores operativos usan el importe liquidable; DMC y originales
  fiscales conservan los valores documentales. Nuevas líneas de lote capturan el
  importe efectivo; los snapshots de líneas existentes no se reemplazan.
- Anticipo directo limitado al neto liquidable; amortización contractual/manual
  limitada a su snapshot, sin volver a descontarla del neto.
- NC/ND conservan precisión y límite de crédito originales. El cierre completo
  deja disponibilidad cero y cualquier exceso de compromisos se rechaza contra
  el importe liquidable dentro de la transacción.
- Calidad reconoce el mismo cierre para la política nueva y conserva legacy.
- Cliente, PDF y Excel operativos reciben el mismo saldo efectivo, sin botones
  adicionales ni cambios de captura. El cálculo documental original sigue
  disponible para trazabilidad.

## Seguridad, rendimiento y errores

Activación sólo mediante mantenimiento administrativo del proyecto Cloud exacto,
con respaldo durable, operación idempotente y auditoría antes/después. RLS y
grants niegan acceso directo a navegador. Las políticas no se cambian una vez
hay compromisos; la app no recibe el tratamiento financiero desde el cliente.
Consultas por lote de IDs, sin N+1 ni nuevos servicios/dependencias.

Un cliente antiguo que solicite un centavo adicional recibe el límite vigente
y debe actualizar. No se reserva ni contabiliza un importe superior.

## Validación y entrega

Pruebas JS/SQL equivalentes: deltas -0.01/0/+0.01, HNL/USD, pagos completos y
parciales, repetición/concurrencia, NC/ND antes/después del pago, anticipos,
calidad, snapshots históricos, permisos y fallo de respaldo/auditoría.
Restaurar respaldo real en base local aislada y comparar tablas ajenas.
Verificar TypeScript, build cliente/servidor y flujo UI con base local/simulada.

Publicación: respaldo -> migración inerte -> aplicación compatible -> verificar
capacidad de servidor/cliente -> habilitación auditada y lote -> verificar
lectores reales en solo lectura. Nunca iniciar app de prueba contra producción.

Recuperación: desactivar nuevas adopciones y conservar lectores compatibles.
Después de pagos v1 no volver a lectores legacy ni borrar políticas. Las
reversiones de datos requieren comprobar movimientos posteriores y conservar
auditoría; de ser necesario se concilia hacia adelante.
