# Reversión de pagos de anticipos

En el detalle de un lote de anticipos pendiente de contabilización o rechazado por Contabilidad, Administración Central puede solicitar la reversión completa de una o más líneas. La solicitud exige un motivo por línea y un comprobante de que el desembolso se registró por error o de que el banco devolvió el importe completo seleccionado. Contabilidad comprueba ese soporte y decide con un usuario distinto. Mientras hay una solicitud pendiente, el lote conserva sus reservas y queda en pausa para corregir o contabilizar.

La aprobación conserva la fecha, referencia, importe y comprobantes bancarios originales. Retira del pago vigente las líneas revertidas y las reconoce como terminales. Una reversión parcial conserva el flujo de las líneas vigentes. Una reversión total deja el lote anulado y conserva el acceso a la constancia y al soporte. La evidencia de reversión se archiva con una categoría propia.

El anticipo queda retenido y fuera de nuevos lotes. Contabilidad puede levantar la retención con un motivo y una nota de evidencia si el anticipo sigue siendo elegible. Compras puede tramitar la anulación según las reglas vigentes de la orden y del anticipo. Anular o reemitir la orden sigue siendo una acción de Compras.

## Activación

1. Aplicar la migración aditiva con el comando del proyecto indicado abajo. El paso de enums se confirma antes de instalar los objetos que los usan.
2. Desplegar en pruebas con la bandera deshabilitada y confirmar que la interfaz lee lotes y pagos históricos. Mantener `RUN_DB_PUSH=false` para este despliegue.
3. Habilitar la bandera en pruebas después de actualizar todas las instancias que consultan Tesorería. Verificar con cuentas distintas que Administración Central solicita y Contabilidad decide. Revisar que detalle, listado, XLSX y PDF o constancia presenten importes coherentes.
4. Tras la autorización de despliegue, aplicar el mismo orden en el entorno autorizado. La activación y la revisión de expedientes reales se hacen por separado.

- Aplicar la migración con `pnpm db:migrate-treasury-payment-reversals`.
- Habilitar con `TREASURY_PAYMENT_REVERSALS_ENABLED=true`.
- Para pausar, desactivar la bandera. Se conservan la lectura del historial y la posibilidad de rechazar solicitudes pendientes y resolver retenciones ya aplicadas. Al desactivarla, conservar el esquema, los registros aplicados y una versión de BuildReq que reconozca las líneas revertidas.

## Caso de aceptación

Usar datos sintéticos con pagos de L 1,575.50, L 2,499.00 y L 14,156.99. El importe original es L 18,231.49. Al revertir la tercera línea deben quedar L 4,074.50 vigentes. Al revertir las tres, el importe vigente queda en L 0.00. Verificar que la OC conserva su flujo de Compras y que el anticipo revertido queda retenido.
