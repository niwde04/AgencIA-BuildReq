# Alineamiento de integridad del esquema

`drizzle/20261102110000_schema_integrity_alignment.sql` acompaña los pendientes de `schema.ts` incorporados a main. Recupera definiciones que ya figuraban en migraciones anteriores y que faltaban en el esquema TypeScript; permite reconciliar entornos incompletos sin modificar datos históricos.

Incluye siete claves foráneas de salidas de almacén y saldos iniciales, con las mismas acciones `RESTRICT`/`CASCADE` de `0010_opening_balances.sql` y `0018_warehouse_exits.sql`. Incluye los índices `poi_fixed_asset_status_idx`, `rec_draft_source_idx` y `we_created_page_idx`, ya definidos en `0061`, `0062` y `0132` para estado de activo fijo, borradores de recepción y paginación de salidas.

## Activación

La migración se entrega sin aplicación remota. Ejecutarla explícitamente sobre el entorno elegido, después de revisar su esquema y respaldos, mediante el runner de migraciones o una sesión PostgreSQL que aborte ante errores. No necesita modificar RLS, permisos ni datos, y no altera los tratamientos `legacy_manual` ni la reserva del folio de saldo inicial.

La operación es transaccional, usa un bloqueo asesor y límites locales de espera de bloqueo de cinco segundos y de ejecución de treinta segundos. Reconoce claves foráneas equivalentes aunque tengan otro nombre y conserva su estado de validación. Si un nombre o relación existente tiene otra definición, aborta en lugar de reemplazarlo o crear una restricción duplicada. Los índices con el nombre esperado se verifican antes de aceptar la repetición.

Los índices faltantes se crean con `CREATE INDEX` normal. Esto puede bloquear escrituras durante su construcción; programar la ejecución en una ventana de mantenimiento. En tablas grandes, revisar el plan y preparar previamente los mismos índices mediante `CREATE INDEX CONCURRENTLY` fuera de cualquier transacción; la migración reconocerá su definición. Un índice concurrente inválido requiere revisión explícita antes de reintentar.

## Validación posterior

Las claves foráneas nuevas se crean `NOT VALID`: protegen escrituras nuevas y las acciones sobre los registros padre sin escanear ni corregir automáticamente filas históricas. Las restricciones ya validadas permanecen validadas.

Consultar primero las restricciones pendientes y sus nombres reales, incluidos nombres equivalentes conservados de cada entorno:

```sql
SELECT c.conrelid::regclass AS tabla, c.conname, pg_get_constraintdef(c.oid) AS definicion
FROM pg_constraint c
WHERE c.contype = 'f' AND NOT c.convalidated
  AND c.conrelid IN (
    'public."warehouseExits"'::regclass,
    'public."warehouseExitItems"'::regclass,
    'public."openingBalances"'::regclass,
    'public."openingBalanceItems"'::regclass
  )
ORDER BY c.conrelid::regclass::text, c.conname;
```

Para cada relación, buscar filas huérfanas mediante un `LEFT JOIN` entre la columna hija y el ID del padre. Resolver cualquier inconsistencia mediante un procedimiento autorizado que preserve existencias e historia; esta migración no elimina ni reasigna registros. Cuando el diagnóstico confirme la compatibilidad, ejecutar individualmente:

```sql
ALTER TABLE public."warehouseExits"
  VALIDATE CONSTRAINT "warehouseExits_projectId_projects_id_fk";
```

Sustituir tabla y nombre por los resultados reales de la consulta; repetir para las relaciones pendientes. Verificar `convalidated = true` y repetir la migración para comprobar idempotencia.

## Recuperación

Un fallo revierte toda la migración. Después de confirmar, conservar los índices y restricciones compatibles suele permitir revertir únicamente el código. Si se requiere retirar una adición, identificar primero qué objetos creó esta ejecución y si ya protegen operaciones posteriores; no eliminar restricciones o índices anteriores ni restablecer respaldos sobre una base activa automáticamente.

## Verificación local

El 02/11/2026 se verificaron diez casos en una base sintética desechable de PostgreSQL 17 local: aborto y rollback ante índice incompatible, reconocimiento de FK equivalente con otro nombre, conservación de huérfanos históricos, rechazo de nuevas referencias inválidas, acciones `RESTRICT` y `CASCADE`, repetición sin duplicados, creación de los tres índices, validación posterior fallida y exitosa, conservación de restricciones validadas y rechazo de una restricción homónima incompatible. La base se eliminó al terminar. No se consultaron ni modificaron entornos remotos.
