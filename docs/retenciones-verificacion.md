# Verificación de Retenciones

## Impresión normal y compatibilidad de main — 05/10/2026

- `pnpm check` y `pnpm build` en el checkout main: aprobados. Las advertencias de Vite sobre /umami y tamaño del bundle permanecen.
- `pnpm test:retention-documents:db`: **52 pruebas aprobadas**. Conserva los casos de reversión de main y agrega impresión normal desde borrador, actualización por rechazo/corrección, concurrencia, no duplicados, cierre, soportes, rollback, permisos, migración repetida, dirección seleccionada, reimpresión de snapshots antiguos y productor histórico de fecha contable.
- `pnpm test:contractual-advances:db`: **49 pruebas aprobadas**, 35 de notas/Tesorería y 14 contractuales. Total único PostgreSQL: **101**. Bases locales desechables eliminadas al terminar; no se usaron datos ni credenciales Cloud para fixtures.
- Vitest focalizado: **93 aprobadas** en retentionPreprintedPrint, retentionPrint, invoiceAccounting, invoiceReversalsRouter, invoiceReview, invoiceReceiptFiscalSync, invoiceDocumentAdjustments y projectAccess. Tres fixtures del manejador original en `5260a3c^` comprueban el HTML normal byte por byte para HNL, USD y límite de ocho conceptos.
- Chrome con API simulada, versión main: 1440/768/390/320 px, impresión desde factura borrador/rechazada, listado/detalle, fallo que cierra ventana, cambios sin guardar bloqueados y comprobante anulado identificado correctamente. Sin errores JavaScript ni desbordamientos. Evidencia `output/retention-normal/main-ui/visual-review.json`; reproducción local en 127.0.0.1:4192 con `node .tmp/retention-main-ui.mjs`. No se verificó impresora física.
- Migración Cloud por `.env`: **73 tablas con huellas idénticas antes/después dentro de la transacción**; funciones de reversión, RLS y grants originales iguales. Se verificaron tipos de fecha, 328 copias anteriores con interpretación histórica de Honduras y su compatibilidad sin reescribirlas. SQL aplicado: `20261005120000_retention_print.sql`, SHA-256 `40f152c042b4f2920a56d91373aaea05e711be95a68b1aa48541315737a076ee`. Guard nuevo activo. Verificación posterior y deny real de anon/authenticated en `cloud-verification.json`.
- Recuperación conservada: definiciones SQL previas de los objetos modificados, sin datos ni credenciales. El respaldo completo fue rechazado por revisión automática por exportar datos fuera del alcance; se utilizó la alternativa limitada a definiciones. Detalle de compatibilidad y recuperación en [retenciones.md](retenciones.md).
- Seguridad: sesión, rol y proyecto validados en el backend bajo bloqueo de factura; HTML escapado; anulados preservados y marcados; funciones invoker con search_path explícito y sin permisos de lectura directa para navegador. No hay dependencias nuevas ni cambios de permisos.
- Rendimiento: no medido. Listado paginado y operaciones limitadas a una factura. No se ejecutó de nuevo la suite general; las limitaciones/fallos históricos siguientes corresponden a sus entregas anteriores.
- Alcance operativo: migración Cloud y commit de código en main; sin push ni despliegue de aplicación ni intervención en SSH. Riesgo medio de publicación por requerir cliente/servidor compatibles.

## Verificación anterior — 30/09/2026

- TypeScript: aprobado (`tsc --noEmit`).
- Compilación: cliente Vite y servidor esbuild aprobados.
- PostgreSQL 17 aislado: 17 pruebas de comprobantes aprobadas. Contabilización atómica; varias líneas; cero retenciones; concurrencia/reintentos; errores fiscales y fallo de copia; cierre mediante SQL; roles; RLS; migración repetible; antecedentes/archivos/eventos; revisión manual; saldos netos y disponibles; compatibilidad con NC legítimas.
- Regresión de notas/Tesorería: 35 pruebas PostgreSQL aprobadas, incluyendo anticipos y devoluciones. Este runner conserva su esquema de pruebas anterior y agrega las tablas nuevas; los triggers nuevos se verifican en la suite de 17 casos.
- Regresión contractual: 14 pruebas PostgreSQL aprobadas después de incorporar el esquema nuevo al runner. Total de integración: 66 pruebas aprobadas.
- Suite general: 1.025 aprobadas, 11 omitidas, 4 fallidas. Los mismos cuatro fallos se reprodujeron en una copia temporal independiente de HEAD: asesor de ventas en impresión de OC; expectativa de `expectedStatus` al rechazar factura; dos expectativas antiguas de argumentos de ajustes documentales.
- Revisión real de Chrome con API simulada: 1440, 768, 390 y 320 px; listado, diálogo, estado vacío, error y acceso denegado. Sin desbordamiento de página ni errores JavaScript. Corregidos el ancho interno del diálogo y el listado de tableta. La aplicación está configurada con tema claro fijo; añadir la clase dark no activa una paleta oscura.
- Evidencia: capturas y `review.json` en `output/retention-review/`. Las pruebas visuales usan datos ficticios; la lógica real se probó por separado en PostgreSQL.
- Despliegue SSH: migración repetida sin duplicados, 317 comprobantes y 3 antecedentes; 21 tablas originales sin cambios. Ver [procedimiento y limitación de Storage](retenciones.md).

Para repetir la revisión visual desde la raíz: instalar Playwright en `.tmp/retention-visual-tools`, iniciar Vite en 127.0.0.1:4187 y ejecutar `node output/retention-review/visual-check.cjs`. Se usa Chrome instalado y se intercepta toda llamada de API; no inicia sesión en servicios remotos.

## Preparación de despliegue SSH

Se restauró el respaldo completo en un PostgreSQL 17 temporal sin red: 1.988 facturas. Se verificó la excepción histórica autorizada mediante integración: conserva fechas, muestra el aviso, se repite sin duplicados y mantiene estrictas las nuevas contabilizaciones.

## Verificación Cloud — 01/10/2026 (Honduras)

Migración confirmada: 317 comprobantes, 3 antecedentes, 2.039 facturas y 21 tablas originales intactas; repetición sin duplicados. Roles permitidos y denegados comprobados con perfiles existentes, seis accesos SQL de anon/authenticated rechazados, importes coincidentes, tres enlaces antiguos resueltos y tres soportes descargados correctamente. Servidor y rutas HTTP 200; API sin sesión 401. Detalle del respaldo y método de bloqueo transaccional en [retenciones.md](retenciones.md).
