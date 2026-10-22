# Proyecto de apertura explícito

La bodega El Zamorano está compartida por los proyectos 018 y 024. El formulario agrupaba bodegas conservando el primer proyecto recibido; como el 024 era más reciente, lo enviaba como proyecto del encabezado aunque las líneas fueran del 018.

## Plan y alcance

1. Exigir seleccionar primero el proyecto de apertura y después una bodega asignada a ese proyecto. Usar esa selección para encabezado, consecutivo y destino predeterminado de las líneas. Las líneas siguen permitiendo otros proyectos activos asignados a la misma bodega.
2. Exigir el proyecto en API y persistencia, sin inferirlo de la bodega. Validar sus asignaciones y evitar colisiones globales de folios conservados.
3. Probar selección compartida, rechazo sin proyecto, destinos mixtos, consecutivos, concurrencia, formulario y compilación.
4. Respaldar estructura y datos de aplicación y código antes del despliegue; restaurar la copia en PostgreSQL local aislado para verificarla.
5. Publicar el código y comprobar la capacidad `explicitOpeningBalanceProject` en `/health` antes de regularizar el saldo.
6. Bajo transacción y bloqueo, recapturar el saldo ID 4, sus líneas y el inventario de bodega 23. Cambiar únicamente el proyecto del encabezado de 26/024 a 22/018 y `updatedAt`. Guardar evidencia durable anterior y posterior y comprobar invariantes antes de confirmar.

Se conserva el folio emitido `SI-024-00000001` por trazabilidad. Las nuevas aperturas usan el proyecto elegido; el generador comprueba todos los folios existentes para no reutilizar el conservado. No se cambian notas, fechas históricas, artículos, cantidades, destinos, existencias ni otras operaciones.

## Recuperación

El script puntual requiere respaldo durable anterior a cualquier escritura y rechaza un estado distinto del caso autorizado. Es idempotente. Si falla una guarda o la verificación, la transacción revierte. Para revertir después de confirmar, revisar el snapshot y restaurar solamente el proyecto anterior con comparación del estado actual; no restaurar toda la base activa sobre operaciones posteriores. El código anterior permanece en el bundle de Git. Los respaldos contienen datos privados y están excluidos de Git.

## Evidencia de ejecución

Respaldo `backups/opening-project-20261022T213109Z`: archivo PostgreSQL custom de 33.473.627 bytes, SHA-256 `99c459fc65045ef936abca96f440671435b71638e063d94c699dc3e2b9077f12`, esquemas public/private y bundle del código previo. Se decodificó el archivo completo y se restauraron 73 tablas en una base local desechable.

El ensayo real verificó fallos de respaldo y auditoría con reversión, corrección e idempotencia. Solo difiere la tabla del encabezado; sus otros campos, las 26 líneas y las 1.149 filas de inventario de la bodega permanecen iguales. La copia de ensayo fue eliminada. Informe: `restore-verification/report.json` dentro del respaldo.

Validación: 91 pruebas unitarias/focalizadas y 15 PostgreSQL aprobadas; TypeScript y build aprobados. Chrome local con API simulada verificó selección explícita, encabezado 018 con líneas mixtas, limpieza de destinos obsoletos sin perder artículos/cantidades y ausencia de desbordamiento a 1440/768/390/320 px. Se comprobó también compatibilidad con la clase `.dark`; la app mantiene su tema claro existente.

El CLI usa `--backup-dir RUTA_ABSOLUTA_EXISTENTE` y es de solo lectura salvo `--apply`. Cargar la configuración existente mediante `DOTENV_CONFIG_PATH`; si Node requiere la CA del servidor, proporcionar el certificado de Supabase con `NODE_EXTRA_CA_CERTS`, sin desactivar la verificación TLS. No se guardan credenciales en artefactos ni Git.

Simulación en Cloud aprobada: encabezado 26/024, 26 líneas explícitas 22/018 e inventario de 1.149 filas. Publicación y regularización final pendientes de la comprobación de `/health`.
