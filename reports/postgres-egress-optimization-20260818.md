# Auditoría y optimización de Shared Pooler Egress

Fecha de inicio UTC: `2026-08-18T02:55:02Z`

## Barrera de seguridad

- Rama remota: `backup/pre-postgres-egress-optimization-20260818-025502Z`
- Commit respaldado: `bb2b7be38209c25f0a55a9a60f09079edec8500e`
- Dump custom PostgreSQL 17.9: `backups/buildreq-pre-postgres-egress-optimization-20260818-025502Z.dump`
- Tamaño: `11,580,103` bytes
- SHA-256: `34391c6e24bcc6ae3a94232d9170864a33c35f454d0527cb8821784b18d80be4`
- Catálogo de restauración: `89,282` bytes; `pg_restore --list` finalizó correctamente.
- Metadatos, checksum, catálogo, línea base y planes `EXPLAIN` permanecen en `backups/` y no contienen credenciales.
- No se eliminó ni modificó ningún dato, tabla, columna, relación o índice. No se reiniciaron estadísticas.

## Línea base

`pg_stat_statements` conserva estadísticas desde `2026-05-27T06:23:44Z`.

| Hallazgo                                         |                 Línea base acumulada |
| ------------------------------------------------ | -----------------------------------: |
| Lectura de asignaciones de proyecto del usuario  | 1,463,173 llamadas / 7,033,521 filas |
| Lectura de usuario por `openId`                  |                   1,463,147 llamadas |
| UPSERT de usuario durante autenticación          |                     731,569 llamadas |
| Ítems de requisición por requisición             | 1,396,282 llamadas / 4,114,957 filas |
| Cantidad comprometida por ítem                   |                     443,241 llamadas |
| Catálogo completo de proveedores                 |   23,989 llamadas / 27,537,123 filas |
| Consultas de solicitudes de compra con documento |   409,407 llamadas / 8,347,785 filas |
| Consultas de órdenes de compra con documento     |   453,479 llamadas / 7,685,730 filas |
| Consultas de salidas con documento               |      11,122 llamadas / 268,689 filas |

Tamaño de documentos almacenados:

| Tabla              | Filas con documento |     Promedio |    Total |
| ------------------ | ------------------: | -----------: | -------: |
| `purchaseRequests` |                 995 | 15,901 bytes | 15.80 MB |
| `purchaseOrders`   |                 963 | 15,850 bytes | 15.26 MB |
| `warehouseExits`   |                 867 | 13,751 bytes | 11.92 MB |

El snapshot completo incluye 94 tablas, 300 índices y los 100 fingerprints con más filas transferidas.

## Cambios implementados

1. Observabilidad request-scoped mediante `AsyncLocalStorage`:
   - conteo de consultas, filas y tiempo SQL;
   - usuario numérico y endpoint tRPC;
   - top 10 de fingerprints repetidos;
   - advertencia configurable sobre 25 consultas;
   - no registra SQL, parámetros, JWT, cookies ni contenidos.
2. Autenticación:
   - una sola carga normal de usuario y asignaciones;
   - el UPSERT queda reservado para usuarios nuevos;
   - `lastSignedIn` se actualiza como máximo cada 15 minutos por usuario con caché limitada a 5,000 claves;
   - invitaciones y bootstrap conservan sus recargas especiales.
3. Configuración de aprobaciones:
   - caché single-flight de 60 segundos;
   - invalidación inmediata tras actualizar la configuración.
4. Sidebar:
   - todos los contadores se calculan en una sola sentencia SQL de agregados;
   - conserva alcance por rol, usuario y proyectos;
   - no carga PDFs, listas, detalles ni inventario;
   - polling cada 30 segundos solo con pestaña visible y sin refetch por foco.
5. N+1:
   - detalle de requisición: cantidades comprometidas, stock SAP, stock por proyecto y bodegas en batch;
   - cola de flujos agrupada por proyecto;
   - bodegas, stock y destinos de traslados en batch;
   - inventario de salidas de bodega en batch;
   - caché request-scoped single-flight para proyectos y bodegas con invalidación tras escrituras relacionadas.
6. Documentos:
   - `includePrintedDocumentContent?: boolean` mantiene `true` como comportamiento predeterminado;
   - los listados optimizados envían `false` y reciben `printedDocumentContent: null` más `hasPrintedDocument`;
   - endpoints protegidos `getDocument({ id })` en solicitudes, órdenes y salidas;
   - no se modificó ningún documento almacenado.
7. Proveedores:
   - `supplierOptions({ search?, limit? })`, máximo 50;
   - búsqueda remota con debounce y 30 resultados en órdenes de compra;
   - TTL de 2 minutos, máximo 100 claves, single-flight e invalidación en creación, actualización e importación;
   - el endpoint histórico permanece disponible y compatible.
8. Paginación:
   - se conserva OFFSET y el contrato de número de página;
   - la precarga de IDs fuera del alcance de proyectos se sustituyó por `NOT EXISTS` correlacionado.

## Verificación previa al despliegue

- `pnpm check`: correcto.
- Prueba focalizada de observabilidad/caché: 2/2 correcta.
- Suite completa: 869 pruebas correctas, 11 omitidas y únicamente los 2 fallos previos conocidos (PDF y comparación CRLF); no hay fallos nuevos.
- Proyección ligera: una solicitud real devolvió contenido `null`, `hasPrintedDocument: true` y el endpoint compatible devolvió el PDF almacenado de 12,645 bytes con los mismos metadatos.
- Proveedores: dos búsquedas idénticas devolvieron los mismos 30 IDs y realizaron una sola consulta SQL.
- Requisiciones reales:

| Ítems | Consultas SQL |
| ----: | ------------: |
|    48 |             8 |
|    51 |             9 |
|    52 |             8 |
|    67 |             8 |
|    98 |             8 |

El conteo ya no crece con el número de ítems; la consulta adicional opcional aparece únicamente cuando existen metadatos de bodega extra.

## EXPLAIN e índices

Se ejecutó `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` sobre batching de cantidades, inventario, opciones de proveedores y el nuevo `NOT EXISTS`.

| Consulta                                | Tiempo observado | Resultado                        |
| --------------------------------------- | ---------------: | -------------------------------- |
| Cantidades comprometidas batch          |        18.115 ms | 9 códigos agregados              |
| Inventario batch                        |        94.445 ms | 96 filas                         |
| Opciones de proveedor                   |         8.183 ms | 16 filas                         |
| Alcance de solicitudes con `NOT EXISTS` |         1.925 ms | 0 filas para el alcance ensayado |

No se creó ningún índice. Aunque algunos planes recorren más de 1,000 filas, las tablas actuales son pequeñas y las llamadas repetidas quedaron consolidadas. Sin una medición que demuestre una reducción de al menos 20% en buffers o tiempo frente a una alternativa, crear un índice incumpliría el criterio del plan.

## Medición de 24 horas pendiente de operación

La aplicación debe desplegarse primero con:

```env
DATABASE_QUERY_OBSERVABILITY_ENABLED=true
DATABASE_QUERY_WARN_THRESHOLD=25
```

Al completar 24 horas:

1. Capturar un segundo snapshot sin ejecutar `pg_stat_statements_reset()`.
2. Calcular deltas de `calls`, `rows`, `avg_rows_per_call`, `total_exec_time`, requests y usuarios activos.
3. Exportar Shared Pooler Egress del panel para la misma ventana.
4. Normalizar egress por request y usuario activo.
5. Si la reducción es menor de 70%, continuar con el endpoint de mayor costo del nuevo ranking.

La reducción final de 70% no puede certificarse antes del despliegue y de completar una ventana comparable de 24 horas.
