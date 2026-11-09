# Reporte de Facturas: trazabilidad de anticipos aplicados

Preparado el 9 de noviembre de 2026 en el checkout de main. Corrige Lote de pago, Referencia bancaria y Fecha de pago en el reporte de Facturas y en la hoja de Facturas del libro general. No requiere migración ni cambios de datos.

## Comportamiento

El reporte combina pagos directos a la factura y referencias bancarias de los anticipos directos realmente aplicados. Solo incluye anticipos no cancelados con pagos positivos contabilizados. La consulta recibe exclusivamente los identificadores de facturas obtenidos después de los filtros y permisos existentes; no busca anticipos por proveedor u orden sin una aplicación vinculada.

Los lotes y referencias se muestran sin repetir valores, y Fecha de pago corresponde a la fecha bancaria más reciente de los pagos incluidos. Un desembolso anterior a la fecha de factura sigue siendo válido. La fecha de aplicación del anticipo no sustituye a la fecha bancaria.

Una misma aplicación puede aumentar de importe sin actualizar `appliedAt`; la base no asigna una aplicación a un desembolso bancario individual. Por ello se muestran las referencias contabilizadas del anticipo vinculado, sin atribuir un importe bancario a cada factura ni filtrar desembolsos por `appliedAt`. Si el anticipo financia varias facturas, su trazabilidad puede aparecer en cada una.

Las amortizaciones contractuales permanecen fuera de esta consulta de aplicaciones directas. Los anticipos sin aplicación a la factura, cancelados o con desembolsos pendientes de contabilizar no generan metadatos de pago por esta vía.

## Implementación y límites

- `server/invoiceReportPayments.ts`: consulta adicional por conjunto de facturas y combinación/deduplicación de metadatos. Su retorno contiene únicamente lote, referencia y fecha; no contiene importes.
- `server/routers/reports.ts`: `systemInvoices` y `systemWorkbook` usan el nuevo lector. Se conserva el tratamiento de liquidación oficial en centavos y los filtros/autorizaciones existentes.
- `shared/system-workbook-report.ts`: elige la máxima fecha real, independientemente del orden de los pagos, y conserva fechas bancarias sin hora como `YYYY-MM-DD` hasta el navegador.
- `client/src/lib/dmc-export.ts`: solo la columna Fecha de pago se normaliza a mediodía de calendario al construir el XLSX. Esto evita que SheetJS muestre el día anterior al convertir medianoche UTC/local o datos serializados por JSON.

El lector financiero original `getTreasuryInvoiceReportPayments`, los importes de Tesorería, las aplicaciones, saldos, tablas y permisos de base de datos no se modifican. No se agregan pagos ni se vuelven a restar anticipos. No cambia el reporte fiscal DMC ni el resumen financiero de Tesorería.

## Evidencia

Caso confirmado con consultas de solo lectura mediante la conexión configurada en el `.env` del workspace: FT-010-00000302 (1938), CYME S DE RL, OC-010-00000248, factura del proveedor 000-001-01-00409048. Aplicación directa de ANT-2026-000050 por L90,898.27. El pago contabilizado del anticipo pertenece a TES-2026-000240, referencia FT26253PPMML y fecha bancaria 10/09/2026. Saldo pendiente mostrado: cero. Las seis líneas del reporte antes carecían de los tres metadatos.

Alcance previo observado: 104 facturas no anuladas con aplicación directa y pago bancario del anticipo; 102 sin metadatos en la exportación y dos con pagos mixtos incompletos. La nueva consulta recuperó metadatos para las 104. No es una afirmación de pago completo de todas ellas.

Se ejecutaron las funciones actuales extraídas sin modificarlas, con Drizzle real y un cliente dedicado dentro de una transacción PostgreSQL `REPEATABLE READ READ ONLY`; se comprobó `transaction_read_only=on` antes de consultar y se cerró mediante `ROLLBACK`. El XLSX del caso se construyó en memoria, se serializó como datos servidor/navegador, se escribió y volvió a leer bajo `America/Tegucigalpa`. Las seis líneas conservaron TES-2026-000240 / FT26253PPMML / 10/09/2026, con resumen financiero idéntico y sin importes en los metadatos. No se escribieron datos ni archivos XLSX de cliente.

## Verificación local

- 53 pruebas focalizadas aprobadas: `invoiceReportPayments.test.ts` (14) y `dmcReport.test.ts` (39).
- 33 regresiones aprobadas: `purchaseOrderAdvances.test.ts` (12) y `treasuryRouter.test.ts` (21).
- Pruebas con conexiones DB deshabilitadas y zona horaria Honduras. Cubren pagos directos/mixtos, varios desembolsos, anticipos compartidos, alcance por factura, filtros de contabilización, deduplicación, ausencia de importes, ambas rutas, seis líneas y conservación de centavos oficiales.
- XLSX probado con medianoche local, medianoche UTC y fechas sin hora después de JSON, usando `cellDates` tanto activado como desactivado.
- TypeScript, formato, compilación de cliente/servidor y revisión independiente aprobados. La compilación conserva avisos de configuración de analítica y tamaño de paquete que ya existían.

Estado de entrega: implementación local en main; publicación pendiente (push y despliegue). No se verificó una descarga desde la aplicación publicada. Publicar frontend y servidor juntos; no hay migración. Revertir el cambio de código restaura la presentación anterior y no requiere revertir datos.
