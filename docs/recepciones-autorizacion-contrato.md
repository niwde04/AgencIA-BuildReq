# Autorización de facturación posterior al vencimiento

## Alcance

Una obra puede continuar después del vencimiento registrado del contrato. Administración Central puede autorizar recepciones adicionales para una OC contractual concreta, conservando las condiciones originales y las fechas reales de las facturas. El registro sigue creando una factura borrador y conserva el flujo habitual de revisión, contabilización y pago.

La autorización contiene fecha límite, motivo, respaldo adjunto a la misma OC, cupo adicional sobre la programación original e importe máximo acumulado opcional en moneda de la OC. La fecha límite controla tanto la vigencia de la autorización como la fecha máxima del documento. El importe limita el total vigente de las facturas no anuladas admitidas excepcionalmente, incluidos impuestos y otros cargos; no redefine precios ni presupuesto de la OC. Los usos conservan además el importe y fecha originales recibidos para auditoría.

## Uso

1. Abrir la OC contractual emitida o recibida en Órdenes de Compra. En el bloque **Facturación posterior al contrato**, Administración Central puede crear la autorización.
2. Adjuntar el respaldo o seleccionar un archivo existente de la misma OC, indicar motivo, vigencia, facturas adicionales e importe opcional. Usar cero facturas adicionales cuando basta habilitar nuevas fechas y todavía queda programación original disponible.
3. Registrar la recepción con la fecha real de la factura. Recepciones muestra el vencimiento original y la autorización separados, junto al cupo y saldo disponibles. El importe final se vuelve a comprobar en el servidor.
4. Para cerrar el permiso, revocarlo con motivo. El historial, respaldo y facturas ya recibidas se conservan. Antes de crear una autorización sucesora debe revocarse la anterior, incluso si ya venció.

La fecha y el importe de una factura excepcional pueden corregirse dentro del alcance que la admitió, aun después de revocarlo para nuevas recepciones. Un trigger comprueba el saldo acumulado vigente bajo bloqueo de la OC. No se puede trasladar su vínculo OC/recepción ni reactivar una factura excepcional anulada. Una factura contractual ordinaria tampoco puede convertirse en posterior al vencimiento cambiando su fecha: requiere anular y registrar una recepción autorizada mediante el flujo correspondiente.

## Diseño de implementación

- Módulos: detalle de órdenes de compra, Recepciones, validación compartida, servicio de autorizaciones y transacción de registro de recepción.
- Datos: tablas aditivas de autorizaciones y usos asociados a factura/recepción, con claves foráneas, restricciones e índices para una sola autorización activa por OC. El respaldo queda protegido contra eliminación.
- Permisos: autorización y revocación reservadas a Administración Central y al administrador técnico según las convenciones del sistema; lectura sujeta al acceso a la OC/proyecto. La subida de respaldo posterior a emisión tiene un permiso específico y no habilita edición comercial ni borrado.
- Integridad: vigencia y programación originales permanecen intactas. El límite total es programación original más cupo adicional explícito. Los documentos no anulados, incluidos borradores, ocupan cupo. Las recepciones excepcionales guardan su autorización y el importe recibido para auditoría.
- Concurrencia: autorización, revocación y registro serializan la decisión con bloqueo de la misma OC dentro de transacciones. Una lectura anterior de la pantalla no concede permiso para superar el saldo disponible.
- Fallos: fecha ausente/posterior, autorización vencida/revocada, cupo o importe agotado, respaldo ajeno, rol/proyecto incorrecto y esquema pendiente se comunican sin habilitar un registro excepcional.
- Consultas: los resúmenes de lista se cargan por lote; el detalle incluye historial acotado. No se agrega una consulta por cada fila ni acceso directo del navegador a tablas de negocio.

## Activación y recuperación

La migración es explícita y aditiva. Debe aplicarse en el entorno elegido antes de habilitar nuevas autorizaciones. Este trabajo prepara código, migración y commits locales; no aplica cambios a las bases remotas ni despliega la aplicación.

Con `DATABASE_URL` configurada para el entorno elegido, inspeccionar el destino y luego aplicar explícitamente:

```text
pnpm db:migrate-purchase-order-billing --expect-host HOST --expect-database BASE
pnpm db:migrate-purchase-order-billing --expect-host HOST --expect-database BASE --apply
```

Sustituir `HOST` y `BASE` por los valores exactos del destino. El primer comando es de solo lectura; el segundo instala `drizzle/20261102120000_purchase_order_billing_authorizations.sql` en una transacción y verifica tablas, RLS y ausencia de grants al navegador. Las tablas pendientes mantienen el flujo original y la interfaz informa que falta activar la migración. No hay migración automática al arrancar.

Para deshabilitar una autorización se utiliza la revocación con motivo, conservando el historial y los documentos ya recibidos. Un rollback de aplicación conserva las tablas y datos de auditoría; no se deben borrar usos ni modificar facturas históricas para volver a la regla original.

## Verificación

Verificar fechas inclusivas y horario de Honduras; autorización solo para roles permitidos; acceso por proyecto; respaldo perteneciente a la OC; vigencia original preservada; límites de número e importe; anulación y revocación; dos recepciones simultáneas por el último cupo; restricciones/RLS con roles sin privilegios; comprobación de tipos y compilación; interfaz en móvil, tableta y escritorio con datos simulados.

Verificación ejecutada el 02/11/2026:

- `tsc --noEmit`, formato de archivos nuevos/modificados y `pnpm build`: aprobados. El build conserva avisos de tamaño de bundle y variables de analítica ausentes en el checkout local sin `.env`.
- 45 pruebas focalizadas: 28 de decisión/API, 11 de respaldo y seis regresiones contractuales existentes, aprobadas.
- `BILLING_TEST_ADMIN_URL` local y `pnpm test:purchase-order-billing:db`: diez pruebas PostgreSQL aprobadas, con migración repetida, límites precisos, carreras por el último cupo y por importes, revocación, historial, correcciones de fecha, anulación y denegación de roles de navegador. El runner crea y elimina una base aleatoria local; no usa bases remotas.
- Prueba PostgreSQL de retenciones pendiente de demo, `enforces the document at commit`, aprobada mediante su runner desechable. Alineamiento de esquema previo: diez casos aprobados; detalle en [alineamiento-integridad-esquema.md](alineamiento-integridad-esquema.md).
- Navegador con API simulada: 17 escenarios en 320, 390, 768 y 1440 px, roles, respaldo, alta/revocación, cupo cero, importe opcional y límites de recepción; sin errores JavaScript ni desbordes finales. Evidencia local fuera de Git: `output/receipt-billing/visual-review.json`.
- Suite general final: 1.157 pruebas aprobadas, 207 omitidas y ocho fallos preexistentes. Los mismos ocho se reprodujeron sobre el main original `0d0473b`: tres expectativas sensibles a CRLF en migraciones, fecha de documento de proveedor, texto del PDF de asesor, firma del rechazo de Contabilidad y dos expectativas de ajustes documentales. No se modificaron esas funcionalidades ni sus pruebas para ocultar los fallos.
