# Facturas pendientes de contabilizar

Flujo: borrador/rechazada → revisada → pendiente_contabilizar → registrada o rechazada.

- Administración conserva el registro y envío a revisión actuales. Contable/Superusuario usa **Enviar a contabilizar** en Facturas. El envío guarda fecha, usuario y comentario; no genera NC ni aplica anticipos.
- Tesorería presenta **Facturas pendientes de contabilizar** encima de Reporte de Facturas. Contable/Superusuario contabiliza o rechaza; el rechazo exige motivo y permite corregir y enviar nuevamente. Los demás roles autorizados de Tesorería consultan según su alcance de proyectos.
- La bandeja inicia en pendientes. El filtro de estado permite consultar documentos enviados y luego contabilizados, rechazados o anulados. Los históricos nunca enviados no se incluyen. Una corrección y nuevo envío a revisión limpian los datos del envío anterior.
- La consulta reutiliza la búsqueda de Facturas (factura, OC, recepción, REQ, artículo, requiriente, creador, proveedor y proyecto), fecha del documento, proyecto y moneda. Pagina en SQL y carga impuestos/retenciones/pagos/anticipos solamente para los documentos de esa página.
- Moneda también filtra Facturas, su libro interno y el Reporte de Facturas existente (vista y exportaciones).

## Importes y concurrencia

Una sola columna ISV muestra el total guardado. Al abrirla se agrupan las copias históricas de impuestos por código/tasa; los registros sin desglose y las diferencias por ajustes/exoneración se identifican expresamente. No se recalculan impuestos usando el catálogo actual.

Las retenciones se desglosan en 1%, 10%, 12.5%, 15%, 25% y otras. Otras incluye el resto de retenciones fiscales y las retenciones por documento. Neto usa el valor guardado, que ya incluye descuentos y NC/ND. Saldo pendiente = neto − anticipos realmente aplicados − pagos reales; no se deducen notas ni retenciones por segunda vez. Anticipos disponibles sin aplicar no se presentan como aplicados.

Enviar exige estado revisada. Contabilizar y rechazar exigen pendiente_contabilizar en el UPDATE, por lo que decisiones concurrentes no pueden sobrescribirse. Contabilizar conserva la transacción de notas de retención y aplicación de anticipos. Los enviados no permiten editar sus ajustes financieros; deben rechazarse antes de corregir.

## Migración y despliegue

Migración explícita: `drizzle/20260929052542_invoice_accounting_queue.sql`; comando `pnpm db:migrate-invoice-accounting` contra el DATABASE_URL del entorno. Añade un valor a invoice_status y dos columnas nullable (submittedForAccountingAt y submittedForAccountingById). Es repetible y no reclasifica documentos existentes. Aplicarla antes de desplegar el código; no ejecutar un push global de migraciones para esta entrega.

Aplicada el 29 de septiembre de 2026 UTC en Supabase Cloud (ovaergjxbzrirmdwnwot) y Supabase SSH (192.168.10.82:50505). Se compararon huellas de once tablas financieras y los permisos/RLS antes/después dentro de la transacción: sin cambios de datos ni permisos. Cloud conservó 1,967 facturas y SSH 1,754; estados previos intactos. Producción respondió HTTP 200 y los contenedores SSH quedaron healthy. Evidencia local sin credenciales: output/invoice-accounting-queue/cloud-applied.json y ssh-applied.json.

Código preparado en demo, sin push ni despliegue de aplicación. Al desplegar, las revisadas existentes deben enviarse explícitamente desde Facturas. No borrar columnas, estados, notas ni aplicaciones de anticipos para revertir. Antes de volver a una versión antigua de la app, resolver las facturas pendientes con el flujo nuevo o mantener una versión que pueda procesarlas; la versión antigua desconoce ese estado.

## Verificación

- TypeScript y compilación de producción.
- Pruebas focalizadas de flujo, roles, proyectos, fechas, moneda, exportaciones, desglose histórico y saldos; regresiones de facturas, Tesorería, DMC y CPC.
- 28 pruebas PostgreSQL en una base temporal local: migración aplicada dos veces, envío sin movimientos, contabilización con anticipo real, doble envío/contabilización, contabilización frente a rechazo simultáneo y corrección con reenvío obligatorio.
- UI local con API simulada: botón de envío, pendiente de solo lectura, confirmación contable, rechazo con motivo, filtro por moneda y paginación, historial, estado vacío, desglose ISV y anchos 1440/768/390/320 px, incluido tema oscuro. No se crearon movimientos de prueba en producción.

Código principal: server/invoiceAccounting.ts, shared/invoice-accounting.ts, client/src/components/InvoiceAccountingQueue.tsx, server/routers/invoices.ts y server/db.ts. Pruebas reproducibles: pnpm test:financial-notes:db requiere PostgreSQL local; nunca usa una base real de Cloud/SSH para fixtures.
