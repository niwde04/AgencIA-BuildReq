# Estado actual

Actualizado: 2026-09-29 (Honduras).

Matriz de costos: CRUD independiente preparado localmente en /matriz-costos, con permisos compartidos entre menú/página/servidor, filtros y paginación en backend, auditoría y desactivación reversible. Migración aditiva y carga inicial aplicadas individualmente en Cloud y SSH: 539 registros activos en cada base (208 job 999 y 331 job 001), códigos únicos, etiquetas recalculadas y RLS sin acceso de navegador. Repetición: 0 inserciones; Excel original intacto. Sin push ni despliegue de aplicación.

Validación de matriz: 26 pruebas focalizadas/PostgreSQL temporal, tipos y build; revisión visual local con API simulada en escritorio/tableta/móvil, claro/oscuro. Esquemas y permisos previos intactos; datos de 66/66 tablas idénticos en SSH y 65/66 en Cloud (variación concurrente en notifications sin cambio de cantidad). Procedimiento, evidencia y límites: [matriz-costos.md](matriz-costos.md).

Facturas ahora envía a una bandeja de Tesorería antes de contabilizar. La bandeja está encima del reporte existente, incluye moneda y las columnas financieras solicitadas; ISV abre el desglose guardado. Contabilizar/rechazar es atómico y enviar no genera notas ni aplica anticipos. Código preparado en demo, sin push ni despliegue. Migración aditiva aplicada en Cloud y SSH, con once tablas financieras y permisos intactos; salud de ambas aplicaciones verificada. Detalles y recuperación: [facturas-contabilizacion.md](facturas-contabilizacion.md).

Impuestos ya tiene una migración aplicada en Cloud y SSH: restaura los cuatro códigos predeterminados ausentes y añade el grupo financiero opcional. Los códigos de todas las líneas existentes de facturas/órdenes/recepciones encuentran su catálogo; las huellas de documentos permanecieron iguales. Selector con buscador y protección contra renombrar códigos preparados en `demo`, sin push ni despliegue. Validación: tipos, build, 63 pruebas y revisión móvil aprobados. Detalles y recuperación: [impuestos.md](impuestos.md).

Retenciones permite asignar o quitar el código financiero desde un combobox con búsqueda remota por código/descripción y paginación. Comparte `financialNoteConcepts.financialGroupCode` con el catálogo de conceptos; no agrega columnas ni altera las notas contabilizadas. Cambio preparado en la rama `demo`, pendiente de push y despliegue en Dokploy por decisión del usuario.

Para este cambio se verificaron en Supabase Cloud y en el servidor SSH las columnas existentes, la clave foránea al grupo financiero y el enlace único de las cinco retenciones a sus conceptos. Ambos entornos están listos sin migración nueva; esto no implica que todas las migraciones antiguas estén alineadas. Las correcciones anteriores de claves foráneas e índices pendientes en Cloud siguen fuera del alcance de esta entrega.

Validación de retenciones: tipos y compilación aprobados; 24 pruebas PostgreSQL en una base temporal local y 13 pruebas focalizadas aprobadas. Revisión visual local con API simulada a 1440, 768, 390 y 320 px, búsqueda, paginación, guardar/quitar selección y tema oscuro. No se repitió la suite general para esta entrega.

Implementados NC, ND y catálogos de conceptos, con integración a Facturas, Devoluciones, Tesorería, anticipos, adjuntos, impresión e historial. No se agregó integración SAP ni envío fiscal externo.

La migración `0142_financial_notes.sql` fue aplicada explícitamente a la base configurada el 22 de septiembre de 2026. Resultado: 35 conceptos NC (30 ordinarios + 5 retenciones), 6 ND. Corte para facturas nuevas: `2026-09-22T16:34:55.334Z`. No se generaron notas históricas ni movimientos de prueba en esa base. Para otros entornos, ejecutar `pnpm db:migrate-financial-notes` antes de desplegar el código.

Validación de NC/ND del 22 de septiembre: `pnpm check` y `pnpm build` completados; 21 pruebas de integración PostgreSQL y 10 pruebas focalizadas aprobadas. La suite general terminó con 963 pruebas aprobadas y el fallo preexistente descrito abajo; las pruebas de integración se ejecutaron por separado.

Pruebas financieras de integración se ejecutan sobre bases temporales independientes y eliminadas al terminar. Revisión visual con datos simulados locales en escritorio, tableta y móvil. Instrucciones reproducibles y límites: [notas-fiscales.md](notas-fiscales.md).

Fallo preexistente conocido de la suite general: `server/buildreq.test.ts`, prueba “prints the preferred supplier contact as the purchase order sales advisor”, espera que el PDF no incluya “Autorizado por:”. Se reprodujo con la prueba original de HEAD; el generador de órdenes de compra no se modificó en este trabajo.

Los documentos fiscales requieren CAI, número/rango, fechas y adjunto propios antes de revisión. Activar/desactivar operaciones nuevas mediante `financialNoteSettings.enabled`; nunca mover el corte ni borrar notas contabilizadas para revertir un despliegue.
