# Niveles de matriz en Pagos efectuados

El Excel de Tesorería agrega cuatro columnas a la hoja **Payments**, inmediatamente después de **COD DE JOB**: **NIVEL 1**, **NIVEL 2**, **NIVEL 3** y **NIVEL 4**. Cada celda contiene código y descripción (`02 · Costos operativos`). La hoja tiene 52 columnas. Lotes de pago conserva su estructura.

La clasificación se obtiene de la matriz activa mediante el código financiero completo del artículo, comparándolo con `n4`. Cuando un código identifica varias clasificaciones, se usa `financialGroups.codN2` para elegir la correspondiente. No se cortan códigos por prefijos, no se infieren niveles desde texto libre y el COD DE JOB original permanece igual: el catálogo no se enlaza a proyectos operativos.

Se conserva la selección vigente del código SAP actual/original y del grupo financiero. Una sola consulta backend obtiene únicamente los ocho campos de niveles de los códigos presentes en el reporte. No hay consultas por artículo ni joins que multipliquen renglones. Los niveles se calculan a partir del catálogo vigente al exportar; no son una nueva instantánea histórica.

## Casos sin correspondencia

- Producto sin código financiero, otro cargo o factura sin detalle: cuatro celdas vacías.
- Código sin entrada activa: `SIN MATRIZ` en Nivel 1.
- Código con varias clasificaciones que codN2 no resuelve: `REVISAR MATRIZ` en Nivel 1.
- Código que identifica una sola fila: prevalece la jerarquía de esa fila, aunque el codN2 del grupo esté desactualizado.

Caso real de Cloud: el grupo `11051001` tiene codN2 `1105`, mientras su única fila de matriz tiene n2 `0105`. El reporte usa esa coincidencia única y muestra Servicios generales / Olimpiadas. No se modificó el catálogo financiero.

Ejemplo para `02020201`:

| Columna | Valor |
|---|---|
| NIVEL 1 | 02 · Costos operativos |
| NIVEL 2 | 0202 · Maquinaria |
| NIVEL 3 | 020202 · Mantenimiento y reparación maquinaria |
| NIVEL 4 | 02020201 · Repuestos maquinaria |

El código `11060101` aparece en asesoría legal e inventario de materiales asfálticos. El codN2 `0106` selecciona Honorarios profesionales; `1106` selecciona Inventario de materiales asfálticos.

## Validación y alcance

- 32 pruebas focalizadas: resolución de niveles, código SAP actual/original, coincidencia única con metadata desactualizada, ambigüedad, importes intactos, permisos de lotes y archivo XLSX serializado/reabierto con 52 columnas.
- 28 pruebas PostgreSQL temporales: incluye consulta real de niveles, proyección acotada, edición/desactivación/reactivación y manejo seguro de fallo de base, además de las regresiones del catálogo.
- `pnpm check` y `pnpm build`.
- Consultas de solo lectura en SSH: los 219 grupos financieros tienen correspondencia inequívoca. En Cloud, 219 tienen correspondencia por código+codN2 y el grupo adicional 11051001 se resuelve por su código único.
- No se cambia el cálculo ni la distribución de pagos, impuestos, retenciones, anticipos o totales. Los permisos de Tesorería y alcance por lote siguen en el endpoint existente.
- Sin migración, escrituras de datos, cambios de RLS, nuevos permisos ni dependencias.
- Requiere la tabla y carga de matriz de costos ya aplicadas en Cloud y SSH; un fallo de consulta detiene la exportación con un mensaje seguro.
- Código preparado en demo, sin push ni despliegue. El Excel descargado previamente no se modifica: después del despliegue debe exportarse nuevamente.

Comandos:

```sh
pnpm test -- server/treasuryPaymentsReport.test.ts server/treasuryPaymentCostLevels.test.ts server/treasuryRouter.test.ts
# COST_MATRIX_LOCAL_DATABASE_URL debe señalar PostgreSQL local descartable.
pnpm test:cost-matrix:db
pnpm check
pnpm build
```

La reversión de este cambio es solo de código. No hay datos nuevos que revertir ni asignaciones persistentes a facturas.
