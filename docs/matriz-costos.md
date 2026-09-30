# Matriz de costos

Entrega del 29 de septiembre de 2026 (Honduras). Código local preparado; sin push ni despliegue de la aplicación.

## Uso

Ruta `/matriz-costos`, sección Finanzas, junto a Grupos financieros. Permite consultar, crear, editar, desactivar y reactivar. El menú, la página y el router usan `canManageCostMatrix`: administrador del sistema o Administración Central, con exclusión de Gerente y Superintendente Aprobador incluso si tienen rol general admin. Se respetan las demás restricciones de navegación; la excepción para administradores se limita a esta ruta.

La tabla busca códigos y descripciones y filtra job, nivel 1, actividad y estado en el servidor. Inicia con 25 filas; permite 50 y 100. Orden estable por código e ID. El detalle muestra los campos base, etiquetas y auditoría. Las bajas son lógicas y requieren confirmación; la reactivación conserva el mismo ID.

`999 PROYECTO OPERATIVO` y `001 Oficina Central` son datos del catálogo; no tienen relación con proyectos operativos. No se agregaron importes, presupuestos, asignaciones ni importador web.

## Modelo y API

- Tabla independiente `public."costMatrixEntries"` en `drizzle/cost-matrix-schema.ts`, incluida en la configuración Drizzle.
- ID interno estable, código compuesto único, códigos como texto, cuatro niveles independientes, grupo mayor, identificador/actividad de flujo por fila, estado y fechas/usuarios de creación y modificación.
- `matrixCode` se calcula desde job/n1/n2/n3/n4. Una restricción SQL comprueba la composición y un índice único rechaza colisiones.
- `flow1` a `flow5` se calculan al consultar desde código y descripción de la misma fila. No se almacenan etiquetas redundantes susceptibles a quedar desactualizadas.
- `sourceKey` es una referencia interna única e inmutable para la carga inicial. La API no permite modificarla. Evita reinsertar el código original cuando un usuario edita un registro importado.
- Auditoría inicial con usuarios nulos identifica la carga técnica; las operaciones del CRUD registran al usuario autenticado.
- Router `costMatrix`: `list`, `getById`, `filterOptions`, `create`, `update`, `setActive`.
- PostgreSQL sólo desde backend. RLS habilitado, sin políticas ni privilegios de tabla/secuencia para PUBLIC, anon o authenticated. Se conserva el rol de servicio existente.

## Fuente y normalización

Archivo: `MATRIZ DE COSTOS COMPARTIDA BR (1).xlsx`, hoja Hoja1.

SHA-256 del Excel original:
`d666534a9f5f41e5ce0f171798731ad222316183dc22260f480c083d2cd8eab0`.

La huella del archivo original se volvió a comprobar después de cargar ambas bases: sin cambios.

- 584 filas de origen.
- 45 repeticiones idénticas consolidadas en cinco grupos.
- 539 registros únicos: 208 de job 999 y 331 de job 001.
- 99 etiquetas de flujo recalculadas a partir de los campos base.
- No se exigió que los niveles compartieran prefijos.
- Identificadores de flujo repetidos pueden conservar actividades diferentes.

Datos reproducibles: [initial.json](../data/cost-matrix/initial.json).
Informe de procedencia con huellas, filas duplicadas y valor anterior/corregido de cada etiqueta: [source-report.json](../data/cost-matrix/source-report.json).

Para regenerar, sin modificar el Excel:

```sh
pnpm cost-matrix:normalize "ruta/MATRIZ DE COSTOS COMPARTIDA BR (1).xlsx"
```

El normalizador valida encabezados, rechaza duplicados contradictorios y comprueba las cantidades aprobadas antes de escribir los artefactos.

## Migración y carga explícitas

Migración aditiva: `drizzle/20260930000100_cost_matrix.sql`. No ejecutar un `db:push` global.

Los comandos usan el `DATABASE_URL` del entorno seleccionado, sin imprimir credenciales. Deben ejecutarse individualmente por destino:

```sh
# Simulación: no crea tablas ni inserta registros.
pnpm db:migrate-cost-matrix --expect-host HOST --expect-database postgres

# Aplicación explícita después de revisar el destino y la simulación.
pnpm db:migrate-cost-matrix --expect-host HOST --expect-database postgres --apply
```

Cloud: host `aws-1-us-east-1.pooler.supabase.com`. SSH: host `192.168.10.82` desde el entorno de la aplicación. La selección de credenciales sigue siendo responsabilidad de quien ejecuta; confirmar la instancia correspondiente antes de aplicar. El script verifica host/base y la huella de los datos normalizados.

La migración tiene su propia transacción. La carga usa otra transacción con bloqueo asesor y bloqueo de la tabla del catálogo; se revierte por completo si una fila falla. Una falla de carga puede dejar la tabla vacía ya creada: repetir el comando es seguro. No hay cambios de esquema sobre otras tablas, salvo las relaciones de auditoría con usuarios.

La carga sólo inserta registros ausentes. Omite coincidencias por referencia de origen o código vigente, sin actualizar nombres, códigos, estado ni auditoría de registros existentes. Se probó la repetición después de editar el código compuesto y desactivar una fila, además de dos importaciones simultáneas.

## Aplicación verificada

| Entorno | Registros activos | Job 999 | Job 001 | Códigos únicos | Diferencias con la semilla | Nuevas filas al repetir |
|---|---:|---:|---:|---:|---:|---:|
| Cloud | 539 | 208 | 331 | 539 | 0 | 0 |
| SSH | 539 | 208 | 331 | 539 | 0 | 0 |

En ambos destinos: RLS activo, anon/authenticated sin acceso directo a tabla ni secuencia. Esquemas, restricciones, índices, políticas y permisos de las relaciones preexistentes conservaron la misma huella.

Se compararon datos de 66 tablas existentes. SSH conservó exactamente las 66 huellas. Cloud conservó 65, incluidas todas las tablas financieras y operativas de documentos; `notifications` cambió su huella durante la ventana de ejecución, manteniendo 52,910 filas. No se atribuye esa variación a una causa específica. La migración/importador no escriben en esa tabla y la nueva tabla no tiene triggers de usuario. No se intentó revertir actividad concurrente.

Evidencia local: `output/cost-matrix/verification.json`, `cloud-before.json`, `cloud-after.json` y `ssh-evidence.json`. Contienen recuentos y huellas, sin contenido de documentos ni credenciales.

SSH se ejecutó con artefactos de mantenimiento aislados en `/app/maintenance/cost-matrix-20260930/` del contenedor existente. No se modificó el checkout, no se reconstruyó ni reinició la aplicación; su estado final fue healthy. La base queda lista para un despliegue posterior del código local. Hasta entonces, la aplicación desplegada no mostrará el nuevo menú.

Si un entorno falla, conservar el resultado del otro y repetir únicamente el pendiente con la misma semilla. No borrar la tabla ni ejecutar una restauración global para reintentar. Una reversión futura de interfaz/API puede conservar el catálogo y sus ediciones.

## Validación

- 26 pruebas: 10 de contrato/normalización/permisos y 16 de PostgreSQL con router real, en una base local temporal eliminada al terminar.
- CRUD, colisiones de creación/edición, ID estable, auditoría, búsquedas literales, filtros combinados, 25/50/100 filas, estados, inexistentes y rechazo de las seis operaciones a usuarios sin permisos.
- Importación simulada, repetida/concurrente, duplicados contradictorios, ceros iniciales, ediciones posteriores y rollback después de una primera inserción.
- Acceso directo denegado a roles del navegador; errores internos no exponen SQL al cliente.
- `pnpm check` y `pnpm build`.
- Playwright local con API simulada: crear/editar/desactivar/reactivar, detalle, búsqueda, filtro job, paginación, rechazo de usuarios y acceso admin con rol contable. Capturas a 1440, 768, 390 y 320 px, sin desbordamiento de página/formulario, temas claro y oscuro. Cero errores de JavaScript. Evidencia: `output/cost-matrix/visual-result.json` y capturas adyacentes.
- El tema global actual de la aplicación está fijado en claro. La matriz y sus diálogos tienen estilos oscuros propios, verificados activando la clase dark durante QA; no se añadió un selector global de tema.
- No se repitió toda la suite histórica. La compilación conserva los avisos existentes de tamaño de bundle y script Umami.

Pruebas reproducibles (nunca usan la base de producción):

```sh
# Configurar COST_MATRIX_LOCAL_DATABASE_URL en la sesión para un PostgreSQL local descartable.
pnpm test:cost-matrix:db
pnpm check
pnpm build
```

El runner exige host local, crea una base de nombre aleatorio, aplica dos veces la migración, ejecuta pruebas y elimina exclusivamente esa base. Si necesita crear roles anon/authenticated de prueba, los elimina al terminar.
