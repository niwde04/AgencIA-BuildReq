# Inventario: unidades y pendientes por proyecto

Preparado el 10/11/2026 sobre main `99f4be4`. Conserva los ajustes locales del modal de reubicación. Sin migración, tablas nuevas ni cambios de permisos. La publicación y la regularización real se registran por separado; preparar o probar el código no modifica Cloud.

El usuario autorizó el 10/11/2026 hacer commit y push a main, publicar y verificar la versión y después aplicar la regularización respaldada. También confirmó que el saldo de 1 und representa físicamente 1 galón. Esta autorización no permite ampliar el alcance a otros artículos o modificar antecedentes.

## Comportamiento corregido

- `normalizeInventoryUnitValue` en `shared/units.ts` es la normalización común de etiquetas. Reconoce GALON/galón/galones→gal y los aliases anteriores de und, incluidos los puntos; conserva unidades históricas desconocidas y no convierte und→gal.
- Inventario y kardex muestran esas etiquetas canónicas sin reescribir documentos históricos. Altas, modificaciones explícitas de unidad, entradas de stock e importaciones futuras las normalizan al escribir. La importación normaliza antes de elegir unidades por mayoría, evitando dividir los votos entre aliases equivalentes.
- Un pendiente pertenece a un artículo/proyecto. `shared/inventory-pending.ts` define su clave y evita repetir la consulta por almacén/estante cuando el proyecto es el mismo. `inventory.pendingQuantities` y el listado añaden `pendingScopeKey`; conservan las fórmulas documentales, filtros y autorizaciones anteriores.
- La pantalla suma cada ámbito una vez dentro del grupo y explica que los pendientes del proyecto son referencias compartidas entre sus almacenes. No distribuye arbitrariamente pedidos entre almacenes.
- El Excel agrupa las existencias sin perder cantidades, mínimos, proyectos ni ubicaciones. Después de excluir grupos con stock no positivo, contabiliza cada pendiente del artículo/proyecto una vez en todo el archivo. Las filas repetidas tienen celdas de pendientes vacías y la columna **Alcance de pendientes** explica que el total ya aparece en otra fila. Los encabezados existentes se conservan.
- Los fallos de consulta de pendientes muestran **—**, aviso y **Reintentar consulta**; no presentan un cero como dato confirmado. La página no retrocede al recibir datos temporales de la página anterior. El paginador se adapta al ancho de tableta/móvil.

El ámbito legacy sin proyecto conserva la consulta por almacén. Una mezcla futura de ámbitos sin proyecto y proyectos explícitos podría superponer referencias; la auditoría encontró cero filas activas sin proyecto. No se cambió esa regla legacy dentro de esta corrección.

## Caso 010200003 — ACEITE 2 TIEMPOS

Investigación de origen: `output/oil-unit-investigation/informe.md` en el workspace. El maestro ya estaba en gal. Ocho existencias sumaban **12 gal + 1 und**; tres etiquetas GALON tenían saldo cero. REQ-004-00000068 y SC-004-00000033 conservan cada una un remanente de 27, en columnas diferentes. Dos registros del mismo proyecto/almacén mostraban 54 al sumar el mismo pendiente repetido.

La reproducción con los datos auditados ahora exporta cuatro filas con saldo positivo y contabiliza **27** una vez por columna. Las ocho filas originales y sus cantidades se conservan. El usuario confirmó el 10/11/2026: **«me dicen que es 1 galon»**, referido al saldo de 1 und de Ojo de Agua. La regularización propuesta es una corrección de etiqueta, conservando cantidad 1; no es una conversión de volumen.

### Alcance de la regularización

`server/inventoryUnitRegularization.ts` y `scripts/regularize-inventory-unit.ts` delimitan el proyecto Cloud, artículo, maestro y ocho IDs existentes. El alcance **all** cambia únicamente `unit` y `updatedAt` en cuatro filas:

| ID    | Proyecto | Almacén | Antes | Después | Existencia conservada |
| ----- | -------- | ------- | ----- | ------- | --------------------: |
| 21331 | 004      | 001     | GALON | gal     |                     0 |
| 21332 | 018      | 018     | GALON | gal     |                     0 |
| 21333 | 020      | 20      | GALON | gal     |                     0 |
| 30645 | 023      | 023     | und   | gal     |                     1 |

El resultado proyectado es **13 gal**, con los mismos proyectos, almacenes, estantes y cantidades. No se fusionan ni borran existencias. La cadena REQ-020-00000082 → ST-020-00000004 → TR-020-00000003 → RE-023-00000074 conserva sus antecedentes originales en und, vinculados por la auditoría de la regularización. Las tres OC y facturas ya estaban en gal; no se cambian importes, pagos, retenciones ni documentos contabilizados.

## Orden de publicación y operación

1. Publicar frontend y servidor juntos. **No normalizar las cuatro filas con lectores antiguos:** al agrupar GALON/gal podrían volver a sumar 54. No se requiere `db:push`.
2. Comprobar `https://buildreq.aibdev.com/health`: deben aparecer `capabilities.inventoryPendingScopes: 1` e `inventoryUnitAliases: 1`. Verificar también el frontend y recargar la aplicación. La consulta anterior a la publicación no anunciaba esas capacidades.
3. Generar un dry-run fresco con `pnpm db:regularize-inventory-unit -- --dry-run --scope all --confirm-one-und-is-one-gal --backup-dir <carpeta-absoluta-existente>`. Cargar explícitamente el `.env` del proyecto mediante `DOTENV_CONFIG_PATH` si no se ejecuta en su directorio. El modo predeterminado es dry-run.
4. Revisar IDs, estado, plan y SHA256. Una actualización posterior del artículo, cantidades, mínimos, ubicaciones o documentos invalida el plan. Se usa JSON nativo de PostgreSQL para preservar precisión y timestamps sin zona; no se convierten fechas del respaldo mediante el huso horario del equipo.
5. Aplicar solo ese plan revisado, pasando `--apply --scope all`, ruta y SHA256 del manifiesto, el token exacto generado, responsable/motivo, `--confirm-one-und-is-one-gal`, `--confirm-compatible-readers` y evidencia concreta del lector publicado. Las guardas rechazan una aplicación sin esas condiciones.
6. Verificar el recibo confirmado, las cuatro etiquetas, suma 13 gal y hashes de antecedentes; comprobar pantalla/Excel con pendiente 27. No registrar recepciones o salidas de prueba en producción.

El alcance **aliases** prepara/aplica solo las tres etiquetas GALON con saldo cero y tiene sus propios tokens/manifiestos. No sustituye la verificación de lectores.

## Respaldo, privacidad y recuperación

Los artefactos de operación van a una carpeta absoluta controlada por el operador. Contienen imágenes exactas de las ocho existencias, maestro mínimo y hashes SHA256 calculados en PostgreSQL de los documentos relacionados. Únicamente los siete antecedentes indispensables de la cadena incluyen sus campos operativos mínimos. No se exportan precios, importes, impuestos, proveedores ni documentos fiscales completos. El diseño inicial de respaldo completo fue rechazado por revisión automática y se reemplazó por esta versión minimizada antes de cualquier aplicación.

Antes de modificar se verifica el respaldo durable y su SHA256; antes del commit se persiste el resultado preparado. Se bloquean las existencias y se comparan imágenes completas contra el plan. Una ejecución repetida compatible no duplica cambios. Ante un commit incierto se conserva la evidencia y se verifica el estado antes de reintentar.

La restauración requiere el recibo confirmado y su SHA256. Solo restaura `unit/updatedAt` de las filas registradas si todavía coinciden exactamente con las imágenes posteriores; cualquier movimiento o edición posterior detiene la restauración automática. No se restauran tablas completas ni cantidades para revertir una etiqueta.

El CLI exige TLS con verificación completa. Si falta la CA del proveedor, proporcionar su certificado público validado mediante `NODE_EXTRA_CA_CERTS`; no desactivar la validación ni cambiar la configuración SSL del servidor. Fuente: [documentación oficial de SSL de Supabase](https://supabase.com/docs/guides/platform/ssl-enforcement).

## Verificación y evidencia

- **164 pruebas únicas focalizadas/regresión aprobadas:** 22 de exportación, 23 de ámbitos, 36 de regularización, 32 internas, tres de descripciones, 15 regresiones seleccionadas de inventario y 33 PostgreSQL reales (ocho de pendientes y 25 de regularización). El último lote conjunto sin base ejecutó 116 pruebas; esas repeticiones no se cuentan nuevamente. No es toda la suite del repositorio.
- Regresiones de exportación y pendientes: `server/inventoryExport.test.ts`, `server/inventoryPendingScopes.test.ts` y su integración PostgreSQL.
- Regularización aislada: `server/inventoryUnitRegularization.test.ts` y su integración PostgreSQL, con guardas, privacidad del respaldo, idempotencia, concurrencia, rollback y restauración.
- Comandos de PostgreSQL local: `pnpm test:inventory-pending:db` y `pnpm test:inventory-unit-regularization:db`. Requieren sus variables `*_TEST_ADMIN_URL` de loopback y crean/eliminan bases nuevas con token. No usar `.env` de producción para ejecutar pruebas.
- Reproducción de datos reales en memoria: `output/oil-unit-fix/replay-after.json`.
- QA con APIs simuladas: `output/oil-unit-fix/ui/qa.json`, 16 comprobaciones, 11 capturas y seis XLSX descargados/leídos; 1440/768/390/320 px y oscuro, filtros, ámbitos distintos, fila inicial sin stock, seguimiento, paginación, vacío y errores/reintentos. No creó documentos ni movimientos reales.
- Dry-run Cloud v2 minimizado aprobado en modo de solo lectura: `output/oil-unit-regularization/backups/inventory-unit-20261110T165629377Z-13c1365c/plan.json` en el workspace; SHA256 `906d0acafb2015025bd1902f027d7b18612e4a52a48d0d64b08e6d2f8f3acc74`. Clasificación pending y cuatro IDs esperados. Se comprobaron los hashes y que OC/facturas exportadas contengan únicamente ID/huella. No se aplicaron cambios. Generar un plan fresco si el estado cambió antes de publicar/aplicar.

Las verificaciones focalizadas no equivalen a ejecutar toda la suite del repositorio. Los resultados finales, respaldo de producción y publicación se deben registrar al completar cada etapa.
