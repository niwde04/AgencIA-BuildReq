# Reubicaciones internas entre ubicaciones

Implementación integrada en main local el 9 de noviembre de 2026 desde `10d2d97`, conservando la corrección del reporte de anticipos. Sin migración, nuevas tablas ni movimientos de producción. Sin push ni despliegue.

## Proceso operativo

1. En Solicitudes de traslado, pulsar **Nueva reubicación**. Seleccionar proyecto, bodega asignada, artículos del catálogo SAP, cantidades y motivo.
2. Abrir la solicitud y confirmar la ubicación de origen de cada artículo. Proyecto y bodega se conservan; la ubicación destino se define al recibir. Confirmar genera los documentos existentes y no mueve stock.
3. Mover los artículos físicamente y registrar la recepción indicando una ubicación destino identificable y diferente. Recepciones conserva el comprobante adjunto que exige el flujo actual.
4. Al registrar, se descuenta el origen y se agrega al destino dentro de la misma transacción. Las recepciones parciales mueven solo lo recibido; el remanente permanece en origen.

Ejemplo: 4B4 tiene 10 y 4B5 tiene 2; reubicar 3 deja 7 y 5, total 12. Se admite origen sin ubicación. `4B4` y ` 4b4 ` representan la misma ubicación y no pueden ser origen y destino del movimiento.

La primera versión usa solicitudes independientes, sin requisición ni devolución logística, y no mezcla reubicaciones con traslados normales en un mismo documento. Crear solicitudes mantiene los permisos actuales: admin, Bodega Central y Administración Central. Confirmación, recepción, cierre y anulación conservan sus permisos existentes y el acceso por proyecto/bodega.

Una reubicación recibida se corrige con otro movimiento interno en sentido contrario, sujeto al stock disponible. No se editan los antecedentes ni se inventa saldo si las unidades ya se consumieron. Los pendientes de otros traslados o salidas conservan su origen: las pantallas lo advierten y sus validaciones de disponibilidad continúan vigentes.

## Integridad y documentación

- Clasificación por línea según el proyecto y bodega reales, con solicitud explícitamente independiente. Un proyecto origen nulo no se confunde con uno omitido en datos antiguos.
- Motivo obligatorio, proyecto activo, bodega asignada y cantidades de hasta dos decimales. El servidor mantiene la identidad SAP, nombre y unidad del origen.
- La conversión interna es transaccional, bloquea la solicitud y vuelve a comprobar que siga pendiente. La edición de destino usa actualización condicionada a `pendiente`, por lo que no puede cambiarlo después de una confirmación concurrente.
- La recepción bloquea el traslado y serializa reubicaciones de la misma bodega, valida stock agregado y usa los bloqueos existentes de inventario. Cualquier fallo revierte documentos y saldos.
- El navegador envía el saldo ya recibido y la ubicación de origen observados. El servidor rechaza el reenvío de una recepción parcial con estado obsoleto y detecta cambios de origen mientras el formulario estaba abierto. Esos valores de control no se insertan como columnas de recepción.
- La corrección auditada de origen antes de la primera recepción se limita al mismo proyecto y bodega para internos. El historial de una línea recibida permanece inmutable; el selector de cambio de proyecto no se ofrece en la interfaz interna.
- Los mínimos no se trasladan ni duplican automáticamente. Se conserva la suma del mínimo existente, incluido el registro de origen cuando queda en cero.
- Traslado e impresión muestran tipo interno, motivo, origen, bodega y referencias. El destino real queda en la recepción; el traslado no inventa una ubicación que todavía no se eligió.
- El kardex interno muestra un par de salida/entrada por cada recepción efectiva, con cantidad y fecha iguales, ambas ubicaciones y referencias a traslado/recepción. Se excluye para esas líneas la salida documental por toda la cantidad solicitada. Un traslado confirmado sin recepción no mueve stock ni genera un egreso físico interno en el kardex.

## Archivos principales

`shared/internal-relocations.ts` comparte clasificación y reglas de ubicación. Servidor: `server/transferConversionValidation.ts`, routers de traslados/recepciones, `server/transferReceiptSource.ts` y bloques específicos de `server/db.ts`. Pantallas: `TransferRequests.tsx`, `Recepciones.tsx`, `Transfers.tsx` e `Inventario.tsx`.

Se reutilizan los documentos y campos existentes. La consulta de compatibilidad en modo PostgreSQL `READ ONLY` encontró cero líneas históricas con el mismo proyecto y bodega de origen/destino; no se reescribió ningún registro. No se modificaron esquema, RLS, grants, dependencias ni datos financieros.

## Verificación ejecutada

- **74 pruebas nuevas:** 32 unitarias y 42 con PostgreSQL local desechable. Cubren flujo API completo, proyecto inactivo, alcance/permisos, destino distinto, origen sin ubicación, parciales, decimales, mínimo, stock agregado, rollback después del descuento, concurrencia, reenvío, origen obsoleto, conversión simultánea, edición concurrente de destino, kardex y desactivación operativa.
- **18 regresiones PostgreSQL** del selector de origen anterior, sin modificar esas pruebas.
- **53 regresiones seleccionadas** del módulo existente de traslados/recepciones, y **49 pruebas** de clasificación, sustituciones, auditoría, saldos iniciales, exportación, numeración y anulación.
- **86 regresiones** del reporte de anticipos y Tesorería conservadas tras integrar en main. Las 32 reglas nuevas también se repitieron en ese checkout.
- Total sin contar repeticiones: **280 comprobaciones**, incluidas **60 PostgreSQL**. Todas aprobadas. No equivale a una ejecución de toda la suite del repositorio.
- **24 escenarios visuales** con API simulada: creación, selección SAP, varios artículos, reintento conservando datos, confirmación, validación de ubicación, origen sin ubicación, recepción con comprobante y permisos; detalle/impresión/kardex y regresión de traslado normal. Verificados a 1440, 768, 390 y 320 px, además de variantes oscuras existentes. Se corrigieron recortes y desbordamientos móviles en las pantallas afectadas.
- TypeScript, compilación cliente/servidor y revisión de diff aprobados. Formato aplicado a los archivos nuevos y bloques modificados, conservando el formato ajeno en los archivos grandes. Los avisos de analítica y tamaño de paquete de la compilación son previos.

Las bases de prueba fueron creadas y eliminadas exclusivamente en un cluster local nuevo; ese cluster y el servidor Vite de la tarea se detuvieron al terminar. No se crearon documentos ni movimientos de prueba en la base real. Evidencia visual local: `output/internal-relocations/ui-forms/qa.json` en el workspace y `.tmp/output/relocations-documents/qa.json` en el checkout de pruebas.

## Pruebas reproducibles y operación

`pnpm test:internal-relocations:db` requiere `INTERNAL_RELOCATIONS_TEST_ADMIN_URL` de un servidor PostgreSQL local desechable. El ejecutor rechaza hosts remotos, genera una base nueva aleatoria con token, instala el esquema de prueba y elimina exclusivamente esa base al finalizar. No usar `DATABASE_URL` de producción para probar.

Publicar frontend y API juntos; no ejecutar `db:push` ni una migración para este cambio. Para detener nuevas conversiones y recepciones internas, configurar **`INTERNAL_RELOCATIONS_ENABLED=false`** en el servidor. La lectura de documentos, saldos y kardex histórico sigue disponible. Sin la variable o con `true`, las operaciones están habilitadas bajo los permisos existentes.

Si ya hay reubicaciones registradas, conservar este lector compatible del kardex al detener operaciones. Una reversión completa a código antiguo puede volver a mostrar un egreso documental por la cantidad solicitada; no restaurar saldos ni rehacer movimientos para resolver una diferencia de presentación.
