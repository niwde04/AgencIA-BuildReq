# Estado actual

Actualizado: 2026-09-22.

Implementados NC, ND y catálogos de conceptos, con integración a Facturas, Devoluciones, Tesorería, anticipos, adjuntos, impresión e historial. No se agregó integración SAP ni envío fiscal externo.

La migración `0142_financial_notes.sql` fue aplicada explícitamente a la base configurada el 22 de septiembre de 2026. Resultado: 35 conceptos NC (30 ordinarios + 5 retenciones), 6 ND. Corte para facturas nuevas: `2026-09-22T16:34:55.334Z`. No se generaron notas históricas ni movimientos de prueba en esa base. Para otros entornos, ejecutar `pnpm db:migrate-financial-notes` antes de desplegar el código.

Validación final: `pnpm check` y `pnpm build` completados; 21 pruebas de integración PostgreSQL y 10 pruebas focalizadas aprobadas. La suite general terminó con 963 pruebas aprobadas y el fallo preexistente descrito abajo; las pruebas de integración se ejecutaron por separado.

Pruebas financieras de integración se ejecutan sobre bases temporales independientes y eliminadas al terminar. Revisión visual con datos simulados locales en escritorio, tableta y móvil. Instrucciones reproducibles y límites: [notas-fiscales.md](notas-fiscales.md).

Fallo preexistente conocido de la suite general: `server/buildreq.test.ts`, prueba “prints the preferred supplier contact as the purchase order sales advisor”, espera que el PDF no incluya “Autorizado por:”. Se reprodujo con la prueba original de HEAD; el generador de órdenes de compra no se modificó en este trabajo.

Los documentos fiscales requieren CAI, número/rango, fechas y adjunto propios antes de revisión. Activar/desactivar operaciones nuevas mediante `financialNoteSettings.enabled`; nunca mover el corte ni borrar notas contabilizadas para revertir un despliegue.
