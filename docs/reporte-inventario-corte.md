# Reporte de inventario a fecha de corte

Disponible desde Inventario, botón **Reporte a fecha de corte**, junto a la
exportación actual. Prepara un XLSX de tres hojas con existencias por ubicación,
entradas y salidas, incluyendo recepciones de traslado, devoluciones y reversos.

## Período y alcance

El primer respaldo identificado y verificado para este Cloud permite ofrecer
cortes desde el **30/09/2026**, aproximadamente seis semanas al preparar esta
entrega del 12/11/2026. No se ofrecen fechas anteriores por suposición. Las hojas
de movimientos muestran como máximo los dos meses anteriores al corte, limitados
por la fecha inicial disponible.

El corte usa el día de Honduras, con límite exclusivo de las 00:00 del siguiente
día. Para hoy, refleja los datos hasta el momento de consulta. Las fechas del
reporte se basan en el registro disponible del movimiento; la fecha de factura
se conserva como dato separado y no retrofecha una afectación de stock.

Una fila de inventario corresponde a **artículo + dueño del stock/proyecto +
almacén físico + ubicación + unidad canónica**. No se suman estantes ni unidades
distintas. Una ubicación vacía acreditada es Sin ubicación; una asignación que no
quedó registrada se identifica como Ubicación histórica no registrada.

## Dos niveles de cobertura

- **Cambios registrados:** desde la apertura de activación, el saldo se calcula
  con imágenes anteriores/posteriores de cada fila de inventario, capturadas en
  la misma transacción del cambio. Incluye altas, consumos, cambios de ubicación,
  reclasificaciones y bajas, sin depender del estado actual del documento.
- **Reconstrucción documental:** antes de esa apertura, usa la copia privada del
  respaldo y los documentos físicos disponibles. La proyección se compara por
  ubicación con la apertura de activación. Las asignaciones desconocidas, las
  diferencias o los saldos documentales negativos se muestran como **N/D**, con
  su motivo. Una coincidencia documental no se presenta como historial completo
  de ajustes que antes no se registraban.

El respaldo tiene una ventana de captura aproximada; los movimientos dentro de
esa ventana impiden acreditar sus ubicaciones por esa fuente. No se inventa una
distribución para completar el Excel.

**Total requeridas y Por recibirse:** para hoy se consultan los totales actuales
del artículo/proyecto y se incluyen una sola vez entre sus ubicaciones. Las otras
filas dejan esos campos vacíos con una referencia. En cortes anteriores se muestra
N/D: el historial físico no reconstruye estados comerciales pasados. Por
recibirse conserva la definición actual de solicitudes y órdenes de compra.

Las etiquetas de descripción, marca, parte y categoría utilizan el catálogo
disponible; no se afirma que su texto reproduzca una versión histórica del
catálogo. Los datos fiscales que no aplican permanecen vacíos.

## Fuentes y límites

- Recepciones: cantidad efectivamente recibida, instantáneas del artículo y
  reverso de recepción en `voidedAt`; servicios y activos fuera del stock se
  excluyen.
- Traslados y reubicaciones: una salida de origen y una entrada de destino por
  cada recepción parcial efectiva. La confirmación de TR no agrega otro egreso.
- Salidas: renglones emitidos, dueño del stock distinto del proyecto solicitante,
  referencia de línea/cabecera/requisición y ubicación explícita cuando existe.
- Devoluciones: vínculo a la salida o recepción de origen; las realizadas por
  traslado no se cuentan dos veces. Una nota de proveedor no equivale a modificar
  retrospectivamente la devolución física por cambios financieros posteriores.
- Saldos iniciales: cantidades documentadas por línea y evidencia de su registro.
- Ajustes sin documento: forman parte del historial de existencias registradas;
  las hojas de entradas/salidas describen los documentos disponibles y lo indican.

Todas las consultas respetan los permisos vigentes por proyecto y almacén. Los
dos extremos de un traslado se autorizan como pares completos, sin combinar el
proyecto de un extremo con la bodega del otro. Se mantiene el inventario que hoy
está en cero o inactivo cuando corresponda a un corte anterior.

Las consultas son planas, sin una llamada por documento. Existe un límite
explícito de 50.000 filas por carga/archivo; al superarlo se solicita acotar
proyecto o almacén y no se truncan resultados silenciosamente.

## Migración e importación

Antes de publicar el servidor:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/migrate-inventory-cutoff-report.ts
node node_modules/tsx/dist/cli.mjs scripts/import-inventory-cutoff-baseline.ts --file PRIVATE_BASELINE.json
```

La migración `20261112170000_inventory_cutoff_report.sql` agrega tres tablas:
cabeceras de copias, filas de copias e historial de cambios. Crea la apertura
actual y el trigger bajo el mismo bloqueo breve de escrituras. No modifica las
existencias originales. El lector y las altas de historial utilizan RLS y acceso
de backend; anon/authenticated no reciben permisos, y service_role tiene solo
SELECT sobre estas tablas.

La historia es inmutable: no admite actualización, borrado ni TRUNCATE. También
se bloquea TRUNCATE de inventario para impedir un vaciado sin captura. Las altas,
cambios y bajas ordinarias de inventario continúan y su historial se revierte si
falla la transacción. Un cambio exclusivo de updatedAt no agrega ruido.

El artefacto privado de apertura proviene del respaldo Cloud identificado con
SHA256. El importador valida proyecto, archivo, filas y unicidad; una repetición
idéntica conserva la misma copia y un contenido conflictivo se rechaza. Los datos
reales de ese archivo **no se guardan en Git ni se incluyen en la imagen**.

La migración es repetible y no reemplaza la primera apertura. Para revertir solo
el código, conservar tablas y captura: protege la historia mientras el código
anterior sigue operando. No borrar las copias ni modificar cantidades para una
reversión de interfaz.

## Verificación

Activado en Cloud el **12/11/2026 a las 11:37 Honduras**. La migración y la
importación conservaron las existencias originales y sus huellas completas bajo
bloqueo; una auditoría independiente confirmó copias, RLS, permisos y triggers.
Se ejecutaron consultas reales de solo lectura para un corte anterior
(31/10/2026) y para el día actual. El primero presenta explícitamente la
cobertura documental parcial; el actual usa los cambios registrados.

Pasaron 49 pruebas focalizadas, 150 comprobaciones de migración/importación en
PostgreSQL desechable y 11 escenarios visuales, además de tipos y compilación.
La evidencia operativa permanece en `output/inventory-cutoff-report/` del
workspace. No contiene una autorización para publicar el respaldo privado.

Pruebas focalizadas de reconstrucción, fuentes SQL, permisos, documentos y XLSX;
pruebas reales sobre PostgreSQL desechable; tipo y compilación; revisión de
escritorio, tableta, móvil y paisaje. Las bases de prueba son locales, nunca
DATABASE_URL del entorno del cliente.

```powershell
node node_modules/vitest/vitest.mjs run server/inventoryCutoffReconstruction.test.ts server/inventoryCutoffDocuments.test.ts server/inventoryCutoffAccess.test.ts server/inventoryCutoffExport.test.ts server/inventoryCutoffSources.test.ts
$env:INVENTORY_CUTOFF_SOURCES_LOCAL_URL = '<PostgreSQL local>'
$env:INVENTORY_REPORT_LOCAL_DATABASE_URL = '<PostgreSQL local>'
node node_modules/vitest/vitest.mjs run server/inventoryCutoffSources.integration.test.ts server/inventoryCutoffReport.integration.test.ts
node node_modules/tsx/dist/cli.mjs scripts/test-inventory-cutoff-report-db.ts
```

El marcador público `capabilities.inventoryCutoffReport: 1` en `/health`
identifica el servidor publicado. Confirmar también el botón del frontend, las
rutas protegidas por autenticación y una consulta del reporte sin escribir
movimientos reales.
