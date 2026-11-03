# Origen de traslados en almacenes compartidos

Recepciones permite **Cambiar proyecto de origen** por línea antes de su primera recepción. El usuario elige una existencia positiva del mismo artículo y del almacén origen ya indicado en el traslado, con proyecto y ubicación reales. **Usar este origen** guarda la selección; registrar la recepción descuenta ese origen y agrega el inventario al destino mediante la transacción existente.

Ejemplo: TR-018-00000007 busca el filtro 090200598 del proyecto 001, La Barca/4B4, con saldo cero. La unidad disponible del proyecto 004, en La Barca y sin ubicación, puede seleccionarse explícitamente; no se modifica ninguna existencia hasta registrar la recepción.

## Integridad y autorización

- Se requieren permisos de recepción y acceso al proyecto destino. La excepción entre proyectos se limita al artículo y al almacén origen de esa línea; no habilita acceso general a otros inventarios.
- Se mantiene el almacén, código SAP y cantidad del traslado. Se cambian únicamente el proyecto y la ubicación de origen, dejando fecha, usuario y origen anterior/nuevo en las notas de la línea.
- No se puede cambiar una línea recibida, devuelta, cerrada o con recepciones históricas, incluso anuladas. Las devoluciones de logística inversa conservan su origen original.
- Se rechaza usar el mismo proyecto y almacén de destino como origen. Los proyectos deben estar activos y la existencia elegida disponible.
- Selección y recepción se serializan con el bloqueo del traslado. El consumo bloquea las filas de inventario y vuelve a validar el saldo, evitando doble descuento entre traslados concurrentes. Si el stock se agotó, se revierte toda la recepción.
- El selector consulta hasta 50 existencias por página y conserva los datos escritos en la recepción al guardar el origen.

## Código y verificación

`server/transferReceiptSource.ts`, procedimientos `receipts.transferSourceOptions` y `receipts.changeTransferSource`, y `client/src/components/TransferReceiptSourceSelector.tsx`. La recepción usa el proyecto/ubicación persistidos en `transferRequestItems`; no requiere migración, cambios de RLS, grants ni regularización de inventario existente.

18 pruebas PostgreSQL en `server/transferReceiptSource.integration.test.ts`: recepción 004→018, permisos, manipulación de IDs, estados, historial, faltante, paginación y concurrencia. Solo se ejecutan con `TRANSFER_SOURCES_TEST_DATABASE_URL` apuntando a PostgreSQL local y a la base exacta `buildreq_transfer_source_test`, con el esquema vigente inicializado; nunca usar una base compartida. Comando: `pnpm exec vitest run server/transferReceiptSource.integration.test.ts`.

Tipos y build aprobados. Se verificó Chrome con API simulada a 1440, 768, 390 y 320 px, móvil horizontal, variante oscura, vacío, error/reintento y conservación del formulario. Las pruebas existentes filtradas por `transfer|traslado|receipt` dan 69 aprobadas y los mismos seis fallos reproducidos sin el cambio en main 3be35aa (mocks de requisiciones incompletos). Evidencia local: `output/transfer-stock-review/`.

## Publicación y recuperación

Se publica desde main mediante el despliegue de Dokploy. `/health` anuncia `capabilities.transferReceiptSourceSelection: 1` cuando el servidor incluye el cambio; comprobar también el nuevo selector en el frontend publicado. No registrar movimientos de prueba en producción.

Para revertir el código, desplegar la revisión anterior. Las líneas que ya eligieron un origen conservan esa asignación y su auditoría, compatibles con el receptor anterior. No restaurar inventario ni reasignar automáticamente los orígenes.
