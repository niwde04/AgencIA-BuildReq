# Contexto de BuildReq

Revisado: 2026-10-01.

Aplicación de compras, recepciones, inventario, facturas de proveedores y tesorería. Cliente React/TypeScript con Vite, Tailwind/Radix y tRPC/TanStack Query; servidor Express/tRPC con Drizzle y PostgreSQL. Supabase proporciona autenticación y almacenamiento. Las tablas de negocio se acceden desde el backend confiable, con RLS y sin permisos directos del navegador.

- Rutas y menú: `client/src/App.tsx`, `client/src/components/DashboardLayout.tsx`.
- Autenticación/contexto: `server/_core/context.ts`, `server/_core/supabaseAuth.ts`. Permisos por proyecto: `server/projectAccess.ts`; roles: `shared/buildreq-roles.ts`.
- Esquema base: `drizzle/schema.ts`. Esquema de notas: `drizzle/financial-notes-schema.ts`. Ambos están en `drizzle.config.ts`.
- Facturas, recepciones e inventario: `server/db.ts` y routers específicos en `server/routers/`.
- Envío de facturas a contabilizar: nuevo estado `pendiente_contabilizar`; enviar no contabiliza. Bandeja paginada en `server/invoiceAccounting.ts` y `client/src/components/InvoiceAccountingQueue.tsx`. Flujo, importes y migración: [facturas-contabilizacion.md](facturas-contabilizacion.md).
- Reversión contable exclusiva de Ed administrador activo: `server/invoiceReversals.ts`, función privada PostgreSQL y auditoría inmutable `invoiceAccountingReversals`. Devuelve a Tesorería, anula comprobantes de retención conservando copias/soportes y bloquea dependencias financieras. Tesorería envía a revisión mediante el rechazo existente. Migración y reglas: [reversion-facturas.md](reversion-facturas.md).
- Tesorería: `server/treasury.ts`; anticipos: `server/purchaseOrderAdvances.ts`.
- NC/ND y sus catálogos: `server/financialNotes.ts`, `server/routers/financialNotes.ts`, `shared/financial-notes.ts`, `client/src/pages/Notas.tsx`, `client/src/pages/ConceptosNotas.tsx`.
- Código financiero de retenciones: fuente única en `financialNoteConcepts.financialGroupCode`, enlazada mediante `retentionCatalogId`; Retenciones y Conceptos de notas editan la misma asignación. Omitir el campo preserva el valor y enviar `null` lo quita. Las notas contabilizadas conservan su copia histórica.
- Impuestos: `salesTaxes.taxCode` coincide con el código guardado en las líneas; no reasignar históricos por tasa ni renombrar códigos desde la API. `salesTaxes.financialGroupCode` guarda el grupo opcional. Restauración segura del catálogo y migración: [impuestos.md](impuestos.md).
- Facturas y notas comparten presentación/datos fiscales en `client/src/components/FiscalDocument.tsx`.

Reglas críticas: no duplicar deducción de retenciones al contabilizar su NC; conservar base/ISV originales de facturas; validar disponibilidad dentro de transacciones con bloqueos de factura compartidos entre notas, pagos y anticipos. Las notas contabilizadas y sus copias históricas no se editan. El inventario devuelto pertenece a Devoluciones, no a la anulación financiera de la NC.

Comandos: `pnpm check`, `pnpm test`, `pnpm build`. Migración explícita de notas: `pnpm db:migrate-financial-notes`; pruebas PostgreSQL aisladas: `pnpm test:financial-notes:db`. Si pnpm no está en PATH, usar `node node_modules/pnpm/bin/pnpm.cjs`.

Las NC automáticas de retención aplican a facturas de cualquier fecha de creación al contabilizar definitivamente en Tesorería; la activación histórica no es un filtro. La recuperación de faltantes ya contabilizadas es explícita y no vuelve a descontar retenciones.

Detalles de reglas, activación y recuperación: [notas-fiscales.md](notas-fiscales.md). Estado de entrega: [CURRENT_STATE.md](CURRENT_STATE.md). Consultar código y migraciones si difieren de esta guía.
