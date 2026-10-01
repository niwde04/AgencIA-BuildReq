# Comprobantes de retención

## Decisión de arquitectura

Tesorería es el único evento de creación. accountInvoice registra la factura y su comprobante en una transacción. El comprobante conserva el encabezado y las líneas originales de la factura, datos fiscales, proveedor, proyecto, retenciones y usuario en una copia JSON fija; los campos de búsqueda están indexados. Una restricción única por factura impide duplicados. El documento no participa en el cálculo del saldo.

La API retentionDocuments es de consulta y exige Contabilidad, Superusuario o Administración Central. /retenciones muestra documentos; /tipos-retencion conserva el catálogo y su API. Las notas automáticas antiguas se conservan como antecedentes inmutables. Los conceptos vinculados al catálogo siguen almacenados para conservar su grupo financiero, pero no se ofrecen para nuevas notas.

La migración de esquema y reclasificación se ejecuta con db:migrate-retention-documents. Es transaccional y repetible; bloquea escrituras en las tablas origen, compara los saldos de todas las facturas antes/después y aborta si hay inconsistencias o faltan datos para producir un comprobante actual completo. Reporta por separado las notas manuales con conceptos de retención. Nunca corrige datos fiscales ni recalcula saldos.

Las facturas contabilizadas quedan cerradas mediante controles del servidor y triggers. Se permiten cambios de saldos derivados de notas fiscales/pagos; los datos documentales, líneas y retenciones quedan fijos. Los adjuntos referenciados se preservan y la API rechaza su eliminación antes de tocar almacenamiento.

Excepción controlada (01/10/2026): el administrador activo `ed_barah@hotmail.com` puede revertir una factura a Tesorería con motivo, cuando no tiene dependencias financieras bloqueantes. La misma transacción anula los comprobantes asociados, preserva sus copias/soportes y registra auditoría inmutable. Una nueva contabilización puede crear un nuevo comprobante, manteniendo uno vigente por factura. La migración de reversión debe ejecutarse después de esta migración de retenciones, pues reemplaza los mismos guardas. Detalle: [reversion-facturas.md](reversion-facturas.md).

## Despliegue

Aplicar la migración con la aplicación detenida, después de respaldo verificable. Si informa facturas históricas incompletas, revisar el informe y corregirlas mediante un procedimiento auditado antes de reintentar. Para fechas históricas completas donde la emisión supera el límite registrado, el usuario autorizó conservar los datos exactos y marcar «Revisión contable pendiente». El aviso queda en la copia fija, listado, detalle, impresión e informe de migración. Las contabilizaciones nuevas mantienen validación estricta y los demás datos faltantes siguen bloqueando la migración. No borrar las notas originales ni convertir notas manuales automáticamente. Desplegar servidor y cliente juntos después de completar la migración. La reversión de aplicación requiere evaluar la compatibilidad de los bloqueos; no eliminar comprobantes para volver atrás.

## Validación local

TypeScript y compilaciones de cliente/servidor aprobados. 66 pruebas en PostgreSQL 17 aislado: 17 del módulo, 35 de notas/Tesorería y 14 de anticipos contractuales. Revisión visual con API simulada en Chrome a 1440, 768, 390 y 320 px, incluyendo estado vacío, error y acceso denegado. La aplicación usa tema claro fijo.

La suite general tiene 1.025 pruebas aprobadas, 11 omitidas y 4 fallos previos, reproducidos también sobre HEAD sin estos cambios. Detalle, límites y capturas: [informe de verificación](retenciones-verificacion.md). Migración aplicada y verificada en SSH y Cloud.

## Despliegue SSH — 30/09/2026 (Honduras)

- Código del módulo: `5260a3c`, rama `demo`; imagen `sha256:0f9d7aeb5ba8c0f7848d4fe24394d869ada05049293ea2e4bfd6b7c2fe857123`.
- Entorno: `http://192.168.10.82:4000/retenciones`. Cloud no recibió esta migración.
- Respaldo completo restaurado en PostgreSQL 17 aislado sin red antes del cambio. Imagen construida desde el commit exacto y configuración de Compose conservada; `RUN_DB_PUSH=false`.
- Con la app detenida se creó otro respaldo, se aplicó `db:migrate-retention-documents` y se repitió: **317 comprobantes, 3 notas vinculadas como antecedentes, 1.988 facturas comparadas, cero duplicados**. Saldos sin cambios y huellas de 21 tablas originales idénticas (facturas, notas, retenciones, pagos, anticipos y adjuntos). No hubo notas manuales con conceptos de retención para revisar.
- Facturas con fechas originales conservadas y aviso de revisión: FT-017-00000038, FT-023-00000004, FT-023-00000007, FT-010-00000055 y FT-023-00000008. La excepción se aplica únicamente durante reclasificación histórica; las nuevas contabilizaciones mantienen validación estricta.
- Salud HTTP 200 y contenedor healthy. Consultas y detalle comprobados con perfiles existentes de Superusuario, Contabilidad y Administración Central; otros perfiles rechazados. API sin sesión: 401. Tres enlaces de notas antiguas resueltos al nuevo documento; importes de todas las líneas coinciden.
- **Limitación detectada:** varios soportes históricos devuelven 500 en Storage porque su archivo físico no existe (`ENOENT`). Sus claves y metadatos sí existen y quedaron intactos. Se comprobó también mediante el servicio original de archivos, independientemente de Retenciones. No se restauraron los binarios ausentes.

### Respaldo y recuperación

Directorio protegido del servidor: `/etc/dokploy/compose/covi-buildreq-cwn1lc/retention-documents-20261001T045723Z/`. Contiene `database.frozen.dump` (respaldo con app detenida), su SHA-256 e índice de restauración; configuración previa; código previo; informes `production.migration.json`, `production.repeat.json`, `production.before.json`, `production.after.json` y `production.smoke.json`.

Imagen anterior conservada: `covi-buildreq-cwn1lc-buildreq:before-retention-documents-20261001T045723Z`. Si la migración aborta antes de confirmar, es posible volver a esa imagen. Después de confirmar, preferir corrección compatible: volver solo al código anterior no revierte los cierres de documentos. Una restauración exige detener escrituras y evaluar las operaciones posteriores; no borrar comprobantes ni sobrescribir datos nuevos automáticamente.

## Despliegue Cloud — 01/10/2026 (Honduras)

- Main publicado por el usuario: ed5832a. La nueva aplicación y su endpoint protegido de Retenciones se verificaron antes de migrar.
- La aplicación nueva ya estaba desplegada. Se aplicó la migración con bloqueos de escritura de las 21 tablas origen dentro de una sola transacción, sin pausa manual de Dokploy. Si la validación o la comparación fallaba, la transacción revertía todo.
- Resultado confirmado: **317 comprobantes, 3 notas originales vinculadas como antecedentes, 2.039 facturas comparadas; saldos y 21 tablas originales intactos**. Repetición dentro de la misma transacción: cero documentos o antecedentes nuevos. No se reclasificaron notas manuales.
- Se conservaron exactamente las cinco fechas históricas señaladas en el despliegue SSH, con aviso de revisión. Las contabilizaciones nuevas conservan validación estricta.
- Listado y detalle consultados con perfiles existentes de Superusuario, Contabilidad y Administración Central; perfiles ajenos y consultas sin sesión rechazados. Tres redirecciones antiguas correctas y todos los importes de líneas iguales a la factura.
- Las tres tablas tienen RLS y carecen de permisos anon/authenticated. Se probaron seis accesos directos con esas identidades y todos fueron rechazados.
- Salud y rutas `/retenciones` y `/tipos-retencion`: HTTP 200. API sin sesión: 401. Tres soportes de Cloud muestreados descargaron mediante enlaces firmados (206); la incidencia de archivos ausentes detectada en SSH no apareció en esta muestra.

Respaldo lógico completo verificado, sin binarios de Storage. Los respaldos y los informes operativos se conservaron localmente fuera de Git. Los esquemas de la aplicación de un respaldo previo se restauraron en PostgreSQL 17 local aislado y la migración se ensayó dos veces: 317 comprobantes, 3 antecedentes y 21 tablas originales intactas.

La evidencia incluye comparación dentro de la transacción y comprobaciones de roles, rutas, RLS, importes y soportes. Como en SSH, volver únicamente al código anterior después de migrar requiere evaluar su compatibilidad con los cierres; preferir una corrección compatible y no eliminar comprobantes ni sobrescribir operaciones posteriores automáticamente.
