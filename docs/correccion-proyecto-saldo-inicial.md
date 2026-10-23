# Proyecto de apertura explícito

La bodega El Zamorano está compartida por los proyectos 018 y 024. El formulario agrupaba bodegas conservando el primer proyecto recibido; como el 024 era más reciente, lo enviaba como proyecto del encabezado aunque las líneas fueran del 018.

## Plan y alcance

1. Exigir seleccionar primero el proyecto de apertura y después una bodega asignada a ese proyecto. Usar esa selección para encabezado, consecutivo y destino predeterminado de las líneas. Las líneas siguen permitiendo otros proyectos activos asignados a la misma bodega.
2. Exigir el proyecto en API y persistencia, sin inferirlo de la bodega. Validar sus asignaciones y evitar colisiones globales de folios conservados.
3. Probar selección compartida, rechazo sin proyecto, destinos mixtos, consecutivos, concurrencia, formulario y compilación.
4. Respaldar estructura y datos de aplicación y código antes del despliegue; restaurar la copia en PostgreSQL local aislado para verificarla.
5. Publicar el código y comprobar la capacidad `explicitOpeningBalanceProject` en `/health` antes de regularizar el saldo.
6. Bajo transacción y bloqueo, recapturar el saldo ID 4, sus líneas y el inventario de bodega 23. Cambiar únicamente el proyecto del encabezado de 26/024 a 22/018 y `updatedAt`. Guardar evidencia durable anterior y posterior y comprobar invariantes antes de confirmar.

En la intervención del 22/10/2026 se conservó el folio emitido `SI-024-00000001` por trazabilidad. Las nuevas aperturas usan el proyecto elegido. La autorización posterior de renumeración se describe al final; no cambia notas, fechas históricas, artículos, cantidades, destinos, existencias ni otras operaciones.

## Recuperación

El script puntual requiere respaldo durable anterior a cualquier escritura y rechaza un estado distinto del caso autorizado. Es idempotente. Si falla una guarda o la verificación, la transacción revierte. Para revertir después de confirmar, revisar el snapshot y restaurar solamente el proyecto anterior con comparación del estado actual; no restaurar toda la base activa sobre operaciones posteriores. El código anterior permanece en el bundle de Git. Los respaldos contienen datos privados y están excluidos de Git.

## Evidencia de ejecución

Respaldo `backups/opening-project-20261022T213109Z`: archivo PostgreSQL custom de 33.473.627 bytes, SHA-256 `99c459fc65045ef936abca96f440671435b71638e063d94c699dc3e2b9077f12`, esquemas public/private y bundle del código previo. Se decodificó el archivo completo y se restauraron 73 tablas en una base local desechable.

El ensayo real verificó fallos de respaldo y auditoría con reversión, corrección e idempotencia. Solo difiere la tabla del encabezado; sus otros campos, las 26 líneas y las 1.149 filas de inventario de la bodega permanecen iguales. La copia de ensayo fue eliminada. Informe: `restore-verification/report.json` dentro del respaldo.

Validación: 91 pruebas unitarias/focalizadas y 15 PostgreSQL aprobadas; TypeScript y build aprobados. Chrome local con API simulada verificó selección explícita, encabezado 018 con líneas mixtas, limpieza de destinos obsoletos sin perder artículos/cantidades y ausencia de desbordamiento a 1440/768/390/320 px. Se comprobó también compatibilidad con la clase `.dark`; la app mantiene su tema claro existente.

El CLI usa `--backup-dir RUTA_ABSOLUTA_EXISTENTE` y es de solo lectura salvo `--apply`. Cargar la configuración existente mediante `DOTENV_CONFIG_PATH`; si Node requiere la CA del servidor, proporcionar el certificado de Supabase con `NODE_EXTRA_CA_CERTS`, sin desactivar la verificación TLS. No se guardan credenciales en artefactos ni Git.

Código publicado en main `1f8c71bcbd4fae5ecb625817f0004058ffc70504`. Despliegue automático confirmado el 22/10/2026 a las 21:40 UTC: `/health` HTTP 200 con `explicitOpeningBalanceProject: 1` y bundle público con selector explícito. La protección anterior de anticipos también permanece activa.

Regularización confirmada en Cloud a las 21:41 UTC: saldo ID 4, encabezado 22/018, folio original `SI-024-00000001`. Únicamente se actualizaron `projectId` y `updatedAt`; no hubo cambios de esquema, permisos ni RLS. Las 26 líneas (176,00 unidades acumuladas), notas, fechas históricas y las 1.149 filas del inventario coinciden exactamente con el respaldo bloqueado y la imagen posterior preparada. Listado y detalle reales de la aplicación resuelven el proyecto 018.

Auditoría durable: `opening-project-20261022T214111762Z-9c8c473c/` dentro del respaldo, con antes, después, manifiesto y resultado confirmado. Verificaciones: `deployment.json` y `production-verification.json`. No se crearon saldos ni movimientos de prueba en producción. El cliente solo necesita recargar la aplicación; no debe volver a ingresar las líneas existentes.

## Renumeración autorizada el 23/10/2026

El usuario autorizó cambiar únicamente el folio del saldo ID 4 de `SI-024-00000001` a `SI-018-00000001`, conservando el proyecto 22/018 y la bodega 23. La búsqueda de referencias en las 73 tablas públicas/privadas encontró el folio anterior solamente en `openingBalances`; las líneas y el kardex resuelven su encabezado por ID.

`shared/opening-balance-numbering.ts` reserva el folio anterior para que el generador lo salte. La restricción `ob_no_retired_balance_number` también impide reutilizarlo mediante SQL directo. No se crea un saldo ficticio ni una nueva fila de inventario. Para futuros cambios de la lista de folios retirados, mantener alineados el generador, el esquema y sus pruebas.

El CLI `scripts/repair-opening-balance-number.ts` valida el destino Cloud, el SHA-256 del respaldo restaurado y, con `--apply`, la capacidad publicada `openingBalanceRetiredNumberGuard: 1`. Requiere `--backup-dir` absoluto. Sin `--apply` usa una transacción de solo lectura. Con `--apply` bloquea la bodega, el encabezado y los proyectos involucrados, verifica que el número nuevo esté libre y recaptura las líneas e inventario actuales. Antes de escribir persiste la imagen bloqueada; antes de confirmar persiste la auditoría preparada. Solo modifica `balanceNumber` y `updatedAt`, e instala y valida la restricción dentro de la misma transacción. No ejecutar la migración del folio por separado contra el saldo antiguo.

Respaldo previo: `backups/opening-folio-20261023T155523228Z/application-before.dump`, 33.579.649 bytes, esquemas public/private; excluye los servicios internos de Auth/Storage y los binarios externos. Se restauraron sus 73 tablas en PostgreSQL local aislado. El ensayo real conservó las 169 líneas, las 1.251 filas de inventario de la bodega y todas las demás tablas; únicamente cambió `public.openingBalances`. Se comprobaron fallos de respaldo y auditoría con reversión, repetición sin modificaciones, rechazo del folio retirado y siguiente folio 024 igual a `SI-024-00000002`. La imagen bloqueada en producción se vuelve a capturar para preservar también entradas posteriores al respaldo.

Recuperación: usar la imagen anterior y compararla con el encabezado preparado; restaurar únicamente folio y `updatedAt` mediante una transacción auditada. Para volver al folio retirado se requiere revisar expresamente su reserva y el generador. No restaurar tablas completas sobre movimientos posteriores ni retirar la reserva como una limpieza rutinaria. Los respaldos y auditorías están excluidos de Git.

Protección publicada en main `6226bbd` y desplegada en Cloud: `/health` HTTP 200 con `openingBalanceRetiredNumberGuard: 1`; el bundle público incluye la exportación de saldos iniciales a Excel.

Renumeración confirmada en Cloud el 23/10/2026 a las 16:19 UTC (10:19 Honduras): saldo ID 4, proyecto 22/018 y bodega 23, folio `SI-018-00000001`. Se modificaron únicamente `balanceNumber` y `updatedAt` y se agregó/validó la restricción de reserva. Las imágenes bloqueadas de las 169 líneas, las 1.253 filas de inventario de la bodega y los demás encabezados quedaron idénticas dentro de la transacción. La recaptura preservó las entradas posteriores al respaldo. No se modificaron permisos, RLS, notas ni fechas históricas, ni se crearon movimientos.

Auditoría confirmada: `audit-1792772341370-87a4d5fd/` dentro del respaldo, con `locked-before.json`, `prepared-result.json` y `result.json`; los manifiestos incluyen hashes SHA-256 y la condición `committed`. Verificación independiente a las 16:22 UTC: existe una sola fila con el folio nuevo, ninguna con el anterior, restricción validada y siguiente folio del proyecto 024 `SI-024-00000002`. Las consultas reales de listado y detalle devuelven el folio corregido.

Validación final: 64 pruebas focalizadas, 17 PostgreSQL, TypeScript y compilación aprobadas. El frontend publicado se comprobó en Chrome usando datos reales consultados en solo lectura y respuestas API simuladas para evitar escrituras de autenticación: encabezado correcto y descarga `saldo-inicial-SI-018-00000001.xlsx` con 169 líneas, folio correcto en Resumen, códigos SAP como texto y cantidades numéricas. Se aisló en esa prueba el endpoint analítico preexistente `/umami`, que responde HTML en lugar de JavaScript; no se modificó ese endpoint. Evidencias protegidas: `deployed-guard.json`, `production-verification.json`, el Excel descargado y `corrected-detail.png`.

## PDF del saldo inicial

Preparado localmente en main: botón `Descargar PDF` junto a Excel y consulta protegida `openingBalances.getDocument`, con los mismos permisos de lectura del detalle. `server/openingBalanceDocument.ts` genera el documento desde el estado actual del saldo mediante la plantilla compartida `buildProcurementPdfBase64`: encabezado corporativo, logo, acentos rojos y páginas numeradas. Incluye proyecto, bodega, fecha, responsable del registro, códigos SAP, ubicación, destino cuando difiere del encabezado, cantidades/unidades, notas y observaciones. No inventa marca ni número de parte, que no se guardan en estas líneas.

Las opciones nuevas de la plantilla (`preserveItemText` y `notes`) conservan textos largos y permiten continuarlos entre páginas. Los documentos que no las usan mantienen el resultado anterior: comparación binaria exacta en cuatro variantes existentes con/sin importes y marca de borrador. Se comprobó el saldo real con 169 renglones y 166 códigos SAP distintos, en 15 páginas tamaño carta; el PDF se genera sin escribir encabezados, artículos ni existencias. Esta funcionalidad aún no se ha publicado.
