# Verificación de Retenciones — 30/09/2026

- TypeScript: aprobado (`tsc --noEmit`).
- Compilación: cliente Vite y servidor esbuild aprobados.
- PostgreSQL 17 aislado: 17 pruebas de comprobantes aprobadas. Contabilización atómica; varias líneas; cero retenciones; concurrencia/reintentos; errores fiscales y fallo de copia; cierre mediante SQL; roles; RLS; migración repetible; antecedentes/archivos/eventos; revisión manual; saldos netos y disponibles; compatibilidad con NC legítimas.
- Regresión de notas/Tesorería: 35 pruebas PostgreSQL aprobadas, incluyendo anticipos y devoluciones. Este runner conserva su esquema de pruebas anterior y agrega las tablas nuevas; los triggers nuevos se verifican en la suite de 17 casos.
- Regresión contractual: 14 pruebas PostgreSQL aprobadas después de incorporar el esquema nuevo al runner. Total de integración: 66 pruebas aprobadas.
- Suite general: 1.025 aprobadas, 11 omitidas, 4 fallidas. Los mismos cuatro fallos se reprodujeron en una copia temporal independiente de HEAD: asesor de ventas en impresión de OC; expectativa de `expectedStatus` al rechazar factura; dos expectativas antiguas de argumentos de ajustes documentales.
- Revisión real de Chrome con API simulada: 1440, 768, 390 y 320 px; listado, diálogo, estado vacío, error y acceso denegado. Sin desbordamiento de página ni errores JavaScript. Corregidos el ancho interno del diálogo y el listado de tableta. La aplicación está configurada con tema claro fijo; añadir la clase dark no activa una paleta oscura.
- Evidencia: capturas y `review.json` en `output/retention-review/`. Las pruebas visuales usan datos ficticios; la lógica real se probó por separado en PostgreSQL.
- No se aplicaron cambios ni migraciones en bases remotas. El paso de despliegue pendiente es ejecutar `db:migrate-retention-documents` con aplicación detenida y respaldo, y publicar cliente/servidor juntos.

Para repetir la revisión visual desde la raíz: instalar Playwright en `.tmp/retention-visual-tools`, iniciar Vite en 127.0.0.1:4187 y ejecutar `node output/retention-review/visual-check.cjs`. Se usa Chrome instalado y se intercepta toda llamada de API; no inicia sesión en servicios remotos.

## Preparación de despliegue SSH

Se restauró el respaldo completo en un PostgreSQL 17 temporal sin red: 1.988 facturas. Se verificó la excepción histórica autorizada mediante integración: conserva fechas, muestra el aviso, se repite sin duplicados y mantiene estrictas las nuevas contabilizaciones.
