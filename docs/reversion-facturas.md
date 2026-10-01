# Reversión de facturas contabilizadas

## Flujo y permisos

`ed_barah@hotmail.com`, activo y con rol `admin`, puede usar **Revertir a Tesorería** desde el detalle de una factura contabilizada. Debe registrar un motivo de 5 a 2.000 caracteres. La autorización se comprueba en cliente, servidor y PostgreSQL; el actor procede de la sesión, nunca de un campo enviado por el navegador.

La factura pasa de `registrada` a `pendiente_contabilizar` y vuelve a la bandeja de Tesorería. Se conservan datos, líneas e importes; la contabilización anterior queda en una copia inmutable de auditoría. Tesorería puede contabilizar de nuevo o usar **Enviar a revisión** con motivo obligatorio. Esta segunda acción usa el rechazo existente de Tesorería (`rechazada`), permite corregir en Facturas y exige repetir revisión y envío a contabilizar.

El endpoint antiguo `returnToReview` permanece cerrado: no permite saltarse Tesorería. La nueva operación es `invoices.revertToTreasury`; el historial, acotado a los últimos 25 eventos, usa `invoices.reversalHistory` con los mismos permisos por proyecto y contabilidad que el detalle.

## Retención y dependencias

La misma transacción registra `invoiceAccountingReversals`, anula los comprobantes de retención asociados y devuelve la factura a Tesorería. El comprobante conserva número, copia original, antecedentes y soportes. Se agregan estado `anulada`, fecha, usuario, motivo y vínculo a la reversión; listado, detalle e impresión muestran **Anulado / No vigente**. Los totales vigentes consideran únicamente `registrada`.

Las líneas de retención de la factura se conservan para revisión. Al contabilizar otra vez se crea un nuevo comprobante vigente si corresponde; el índice parcial permite exactamente uno por factura. El comprobante no vuelve a descontar dinero. Las NC antiguas de retención quedan como antecedentes inmutables; su enlace resuelve al comprobante, cuyo estado refleja la anulación.

Se bloquea la reversión si existen pagos realizados, reservas activas, anticipos aplicados, amortización contractual comprometida, NC/ND ordinarias activas (incluidos borradores), liberaciones de calidad activas o devoluciones activas. Los bloqueos de orden, anticipos y factura siguen el orden de los escritores financieros existentes. Una segunda solicitud simultánea encuentra la factura pendiente y se rechaza sin duplicar el evento. Un fallo revierte también la anulación del comprobante.

## Migración y despliegue

Aplicar `20261001155841_invoice_accounting_reversal.sql` mediante `pnpm db:migrate-invoice-reversals`, después de la migración de comprobantes de retención. Es transaccional y repetible. No actualiza facturas ni saldos existentes. Crea la auditoría con RLS sin políticas/permisos de navegador, agrega metadatos de anulación y reemplaza los guardas para permitir únicamente esta transición auditada. La función privada usa privilegios del invocador; `anon` y `authenticated` no pueden ejecutarla.

Cloud `ovaergjxbzrirmdwnwot`: migración confirmada el 01/10/2026 a las 10:30:46 de Honduras; aplicada dos veces dentro de la misma transacción. Se bloquearon escrituras y compararon las huellas de **72 tablas originales**, todas iguales. Permanecen **2.041 facturas, 322 comprobantes registrados y cero reversiones**. FT-018-00000450 (id 1884) conserva estado contabilizado, neto L15.640 y retención cero. El usuario Ed está activo y es administrador. Accesos directos de navegador a auditoría/función denegados.

Respaldo lógico completo de 30.581.589 bytes, SHA-256 `a718d10c18b70f4af6cf18c1ff469a9d6b64d2e0571f15a4570604c2f1c02e0a`, sin binarios de Storage. Esquemas de aplicación restaurados en PostgreSQL 17 local aislado; migración ensayada dos veces conservando todas las facturas. Respaldo e informes fuera de Git en `.codex-dev/invoice-reversal-cloud-20261001T162448352Z/`; evidencia de operación y pantallas en `output/invoice-reversal-investigation/` del checkout original.

El usuario publicará la aplicación desde main mediante Dokploy. Mantener `RUN_DB_PUSH=false`. Cliente y servidor deben desplegarse juntos; la migración ya está aplicada en Cloud. SSH queda fuera de esta entrega. Si se vuelve a ejecutar la migración anterior de retenciones, ejecutar inmediatamente esta después, pues aquella reemplaza los mismos guardas. Ante un problema, preferir una corrección compatible; no borrar auditorías/comprobantes ni restaurar automáticamente sobre operaciones posteriores.

## Validación

- 36 pruebas en PostgreSQL 17 temporal, eliminando la base al terminar: reversión, anulación, corrección/nueva contabilización, conservación de antecedentes, permisos, dependencias, concurrencia y rollback.
- 46 pruebas focalizadas aprobadas: 11 de autorización/rutas de reversión, 26 de contabilización y 9 de revisión. TypeScript y compilaciones de cliente/servidor aprobados.
- Chrome local con API simulada a 1440, 768, 390 y 320 px: botón exclusivo, motivo obligatorio, error conserva el diálogo, envío a Tesorería/revisión y comprobante anulado. Sin errores de página. Las mutaciones de estas pruebas no alcanzan Cloud.
- Consultas del servidor nuevo contra Cloud dentro de una transacción de solo lectura: detalle de FT-018-00000450, historial vacío, listado/detalle de comprobantes y bandeja de Tesorería. Otro administrador rechazado antes de cualquier escritura. Esto verifica compatibilidad del código con Cloud; no implica que Dokploy ya tenga la nueva aplicación.
- Dos fallos previos en `invoiceDocumentAdjustmentsRouter.test.ts` se reprodujeron en HEAD: expectativas antiguas omiten actor y `overrideReason` del llamado existente. No se cambió ese comportamiento ni se declara aprobada la suite general.
