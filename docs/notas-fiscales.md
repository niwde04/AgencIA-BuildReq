# Notas de crédito y débito

Implementado el 22 de septiembre de 2026. Las rutas son `/notas-credito`, `/notas-debito`, `/conceptos-notas-credito` y `/conceptos-notas-debito`.

## Flujo

- Administración prepara y envía a revisión; Contabilidad contabiliza, rechaza y anula. El administrador puede realizar ambas funciones. Se conserva la restricción por proyectos y la visibilidad de Bodega según el flujo de Facturas.
- Una NC manual distribuye su total entre facturas contabilizadas del mismo proveedor, proyecto y moneda. Una ND tiene exactamente una factura y su botón de creación está en Notas de crédito.
- Cada nota tiene sus propios datos fiscales y adjuntos. Los conceptos, clasificación financiera e impuestos se guardan como copias históricas. Cambiar el catálogo o completar datos fiscales no recalcula líneas existentes.
- Los importes se guardan con cuatro decimales. La suma aplicada debe coincidir exactamente con base más ISV. Los conceptos de corrección de impuesto permiten base cero.
- Los conceptos sin uso se eliminan; los utilizados se desactivan, incluidos los de retención. Si se elimina un concepto automático sin uso, se recrea por su identificador de retención cuando vuelva a necesitarse. La generación automática respeta la desactivación para selección manual, pero sigue documentando retenciones vigentes de la factura.
- Los borradores manuales se eliminan lógicamente; documentos contabilizados se anulan con motivo. Ninguna operación reutiliza un consecutivo.

## Integridad financiera

`invoices.netPayable` incorpora `creditNoteTotal` y `debitNoteTotal`: total original menos retenciones y descuentos, menos NC ordinarias contabilizadas, más ND contabilizadas. La base e ISV originales permanecen intactos. Los pagos, reservas activas y anticipos aplicados se descuentan al calcular disponibilidad.

Las operaciones bloquean las facturas en orden de ID dentro de la transacción. La contabilización/anulación de notas vuelve a calcular y validar compromisos. Tesorería hace lo mismo al crear/modificar reservas, registrar respuesta bancaria, resolver diferencias, contabilizar y reabrir o restaurar lotes. Tesorería y anticipos redondean el neto pagable una sola vez a centavos (half-up), igual que la pantalla, antes de restar pagos/reservas/aplicaciones también expresados en centavos. Las notas conservan su límite y montos exactos de cuatro decimales; un pago completo redondeado no produce un déficit ficticio ni permite otro crédito. Detalles: [saldos-tesoreria.md](saldos-tesoreria.md). Una ND puede reabrir saldo de una factura pagada; no se puede anular si ese saldo ya está comprometido.

Las secuencias se identifican por proyecto y tipo, no por el código visible del proyecto. Inicializan después del máximo histórico, incluidas referencias NC de Devoluciones. El formato es `NC-CÓDIGO-00000001` o `ND-CÓDIGO-00000001`.

## Retenciones

`accountInvoice` genera una NC en borrador dentro de su propia transacción. Aplica a facturas de cualquier fecha de creación con retenciones fiscales válidas y el módulo habilitado. `financialNoteSettings.activatedAt` conserva la fecha histórica de activación, pero no limita la generación. Agrupa importes persistidos de `invoiceRetentions` por `retentionCatalogId`, sin recalcular porcentajes ni agregar ISV. Calidad, amortización, pronto pago y descuento TC pertenecen a otro catálogo y no participan.

El origen automático no se acepta desde el cliente. Una restricción única permite una sola NC de retenciones vigente por factura. Correcciones sincronizan la pendiente y la devuelven a borrador; una NC contabilizada obliga a anularla primero. Anulación por corrección de recepción también invalida la NC pendiente. Sustituciones conservan las notas anuladas y eventos.

**La NC de retenciones tiene efecto adicional cero sobre el saldo.** Su registro fiscal documenta una deducción ya incluida en la factura.


### Recuperación puntual de una NC omitida

La eliminación del límite por fecha no genera notas retroactivas en lote. La recuperación de FT-018-00000443 en SSH usa `scripts/recover-invoice-retention-note.ts --dry-run` y después `--apply`, ejecutados con el entorno de la aplicación SSH. El script está limitado a su ID 1837, RT15 y L 4,568.4000; rechaza otro destino, estado o importe.

El procedimiento bloquea la factura, usa su responsable original de contabilización y reutiliza la generación normal. Si encuentra una NC de retenciones vigente, devuelve `already_exists` sin modificarla. Compara huellas de la factura, retenciones, pagos y anticipos antes/después y registra un evento de recuperación técnica. No ejecuta `accountInvoice`, no reaplica anticipos ni descuenta otra vez la retención.

La imagen actual incluye el código de servidor pero no los scripts ni `tsconfig.json`. Para ejecutar este mantenimiento con `tsx`, copiar únicamente ese script a `/app/scripts/` y `tsconfig.json` a `/app/` desde el checkout del mismo commit desplegado. Ambos archivos quedan disponibles en Git para reproducir el procedimiento. La recuperación crea un borrador; conserva el flujo fiscal normal de revisión y contabilización.

## Devoluciones

`generateSupplierReturnCreditNote` bloquea la devolución, crea la NC, consume existencias y actualiza la devolución en una sola transacción. Usa `reverseLogisticsItems.sourceReceiptItemId` y los importes de su renglón de factura para proponer base/ISV proporcionales bajo NC-C01. Valida cantidades acumuladas devueltas.

Las pendientes antiguas necesitan selección explícita de renglones desde el detalle de Devoluciones. Las referencias históricas ya procesadas se conservan sin generar documentos nuevos ni repetir inventario. Una nota puede prepararse con factura en borrador; revisión requiere factura contabilizada. Anular la NC no repone existencias.

## Migración y despliegue

1. Ejecutar `pnpm db:migrate-financial-notes` con `DATABASE_URL` del entorno destino. Aplica `drizzle/0142_financial_notes.sql` explícitamente; `db:push` no carga los conceptos. La migración es transaccional e idempotente y no mueve la fecha de activación al repetirse.
2. Desplegar cliente y servidor juntos después del esquema. No hay generación retroactiva ni envío fiscal externo.
3. Verificar catálogos: 30 conceptos ordinarios NC, 6 ND y uno por cada retención existente. Nuevas retenciones crean su concepto desde el servidor.

La migración habilita RLS y revoca acceso directo a las siete tablas y sus secuencias a `PUBLIC`, `anon` y `authenticated`. El backend utiliza su conexión confiable y valida permisos/proyecto; los adjuntos y la impresión se consultan mediante el mismo detalle autorizado.

Para detener nuevas operaciones conservando documentos y saldos:

```sql
UPDATE "financialNoteSettings" SET enabled = false WHERE id = 1;
```

La consulta y los efectos de notas ya contabilizadas permanecen. Se permiten anulaciones y eliminación de borradores manuales. Rehabilitar con `enabled = true`, sin cambiar `activatedAt`. No eliminar tablas ni resetear secuencias como procedimiento de reversión.

## Verificación

- `pnpm check`, `pnpm test`, `pnpm build`.
- `pnpm exec vitest run server/financialNotes.test.ts` cubre precisión, validación, permisos, límites del API e impresión segura.
- `pnpm test:financial-notes:db` crea una base temporal aleatoria en el servidor configurado, construye el esquema previo, aplica la migración dos veces, ejecuta pruebas reales y elimina exclusivamente esa base. Requiere permiso `CREATEDB`; nunca ejecuta fixtures sobre la base de `DATABASE_URL`.
- Pruebas de integración incluyen varias facturas, conceptos utilizados, conservación de snapshots, secuencias históricas, RLS, fiscal/adjuntos, roles/proyectos, retenciones/corte/correcciones, stock y rollback, notas y reservas concurrentes, anticipos y ND sobre facturas pagadas.

La revisión visual se realizó en Chromium a 1440, 820 y 390 píxeles con respuestas API simuladas locales. Comprueba disposición y navegación; la persistencia y concurrencia se verifican por separado contra PostgreSQL.
