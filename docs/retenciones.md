# Comprobantes de retención

## Decisión de arquitectura

Tesorería es el único evento de creación. accountInvoice registra la factura y su comprobante en una transacción. El comprobante conserva el encabezado y las líneas originales de la factura, datos fiscales, proveedor, proyecto, retenciones y usuario en una copia JSON fija; los campos de búsqueda están indexados. Una restricción única por factura impide duplicados. El documento no participa en el cálculo del saldo.

La API retentionDocuments es de consulta y exige Contabilidad, Superusuario o Administración Central. /retenciones muestra documentos; /tipos-retencion conserva el catálogo y su API. Las notas automáticas antiguas se conservan como antecedentes inmutables. Los conceptos vinculados al catálogo siguen almacenados para conservar su grupo financiero, pero no se ofrecen para nuevas notas.

La migración de esquema y reclasificación se ejecuta con db:migrate-retention-documents. Es transaccional y repetible; bloquea escrituras en las tablas origen, compara los saldos de todas las facturas antes/después y aborta si hay inconsistencias o faltan datos para producir un comprobante actual completo. Reporta por separado las notas manuales con conceptos de retención. Nunca corrige datos fiscales ni recalcula saldos.

Las facturas contabilizadas quedan cerradas mediante controles del servidor y triggers. Se permiten cambios de saldos derivados de notas fiscales/pagos; los datos documentales, líneas y retenciones quedan fijos. Los adjuntos referenciados se preservan y la API rechaza su eliminación antes de tocar almacenamiento.

## Despliegue

Aplicar la migración con la aplicación detenida, después de respaldo verificable. Si informa facturas históricas incompletas, revisar el informe y corregirlas mediante un procedimiento auditado antes de reintentar. Para fechas históricas completas donde la emisión supera el límite registrado, el usuario autorizó conservar los datos exactos y marcar «Revisión contable pendiente». El aviso queda en la copia fija, listado, detalle, impresión e informe de migración. Las contabilizaciones nuevas mantienen validación estricta y los demás datos faltantes siguen bloqueando la migración. No borrar las notas originales ni convertir notas manuales automáticamente. Desplegar servidor y cliente juntos después de completar la migración. La reversión de aplicación requiere evaluar la compatibilidad de los bloqueos; no eliminar comprobantes para volver atrás.

## Validación local

TypeScript y compilaciones de cliente/servidor aprobados. 66 pruebas en PostgreSQL 17 aislado: 17 del módulo, 35 de notas/Tesorería y 14 de anticipos contractuales. Revisión visual con API simulada en Chrome a 1440, 768, 390 y 320 px, incluyendo estado vacío, error y acceso denegado. La aplicación usa tema claro fijo.

La suite general tiene 1.025 pruebas aprobadas, 11 omitidas y 4 fallos previos, reproducidos también sobre HEAD sin estos cambios. Detalle, límites y capturas: [informe de verificación](retenciones-verificacion.md). No se aplicó esta migración a Cloud ni SSH.
