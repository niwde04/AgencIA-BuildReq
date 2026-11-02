# Anticipos contractuales y conciliación de GEO

Los históricos de CD-018-00000527 tienen un mecanismo separado de captura manual sin regla contractual fija. La habilitación es puntual y auditada; no modifica el comportamiento de nuevos anticipos directos o contractuales. Ver [anticipos históricos manuales](anticipos-historicos-manuales.md).

El neto de la factura ya incluye la amortización contractual y la retención de calidad. La aplicación contractual consume el anticipo sin descontarse otra vez del neto. La aplicación directa conserva su deducción posterior.

Disponible = neto de factura − aplicaciones directas − pagos contabilizados − reservas activas. Las notas conservan su efecto financiero existente. `appliedAmount` del resumen del anticipo es el consumo total; `directAppliedAmount` y `contractualAmortizationAmount` desglosan sus tratamientos. El saldo pendiente de amortizar es cobertura contabilizada menos consumo.

## Captura y controles

- En Tesorería, cargar la orden y seleccionar aplicación directa o amortización contractual. El importe solicitado admite un monto o un porcentaje del total oficial; la regla de amortización es independiente y no presupone 25%.
- La regla contractual es porcentaje o monto fijo, con base subtotal (inicial) o total. Las solicitudes adicionales de la misma orden heredan el tratamiento y la regla; no hay edición ordinaria de reglas con movimientos.
- En Facturas, revisar la propuesta y el saldo disponible en Retenciones y descuentos por documento. Una variación, incluso cero, exige motivo. Se conserva la decisión, usuario, fecha, base y deducción vinculada.
- Las facturas revisadas o enviadas a contabilizar comprometen amortización. La contabilización fija el importe; si falta cobertura, la aplicación queda pendiente. Los pagos posteriores del anticipo aplican únicamente esos importes.
- Mantener bloqueado el pago ordinario hasta cubrir y contabilizar todos los anticipos activos de la orden. Evitar cruces de proveedor, proyecto, moneda u orden mediante validaciones de servidor y de base.
- Bloqueos por orden, anticipo y factura serializan consumo y borradores. Rechazar un monto que ya no cabe y solicitar actualización, sin reducir silenciosamente lo contabilizado.
- La calidad retenida sigue en su módulo de liberación. La amortización contractual no cuenta como pago del neto para habilitar esa liberación.
- Las amortizaciones documentales históricas sin vínculo contractual bloquean nuevos borradores hasta su conciliación. No se modifican automáticamente pagos cerrados, reservas ni otras facturas.

## GEO: regularización aplicada en Cloud

Orden CD-010-00000150 (897), anticipo ANT-2026-000010 (10), factura FT-010-00000306 (1953), proyecto 010 (18), proveedor PROV-000749 (749), HNL. Regularizada en Cloud el 30/09/2026 a las 19:51:21 UTC, después de que el usuario confirmó su despliegue y se comprobó el paquete publicado con soporte contractual.

| Movimiento conservado | Importe L |
|---|---:|
| TES-2026-000140: pago | 809,456.56 |
| TES-2026-000392: pago | 223,104.80 |
| TES-2026-000501: compensación documentada, sin nuevo efectivo | 130,490.39 |
| Anticipo cubierto | 1,163,051.75 |

| Concepto | Antes L | Después L |
|---|---:|---:|
| Total factura | 2,061,372.47 | 2,061,372.47 |
| Amortización documental | 515,343.12 | 515,343.12 |
| Calidad retenida | 103,068.62 | 103,068.62 |
| Neto documental | 1,442,960.73 | 1,442,960.73 |
| Aplicación directa adicional al neto | 1,163,051.75 | 0.00 |
| Aplicación contractual vinculada | 0.00 | 515,343.12 |
| Disponible de factura, sin pagos/reservas/notas posteriores | 279,908.98 | 1,442,960.73 |
| Anticipo por entregar | 0.00 | 0.00 |
| Anticipo pendiente de amortizar | 0.00 | 647,708.63 |

No se crea otro anticipo, no se repiten pagos y no se cambia la deducción documental. El 25% sobre subtotal configura próximas facturas de esta orden. La regularización verifica los identificadores, tres TES, deducciones, inexistencia de notas/liberaciones/pagos adicionales, y conserva una auditoría antes/después. Clave idempotente: `contractual-geo-897-1953-v1`. Cualquier discrepancia detiene la operación.

## Instalación y recuperación

1. Respaldar base y código; conservar los secretos fuera de imágenes y evidencia pública. Revisar diagnóstico y estado real de GEO.
2. Aplicar `pnpm db:migrate-contractual-advances`. Migración aditiva, idempotente y transaccional; antiguos registros siguen directos. No usar `db:push` para desplegarla.
3. Instalar todos los lectores compatibles con `CONTRACTUAL_ADVANCES_ENABLED=false`. Verificar `/health`, migración, acceso y servicios financieros.
4. Ejecutar `pnpm db:audit-contractual-advances` para revisión y respaldo JSON. Para aplicar la corrección autorizada: `pnpm db:audit-contractual-advances -- --apply-geo --compatible-app-installed`. Se vuelve a verificar dentro de la transacción antes de escribir.
5. Verificar importes, conservación e idempotencia; activar nuevas operaciones contractuales con `CONTRACTUAL_ADVANCES_ENABLED=true`. Entregar `other-reconciliation-candidates.json` para conciliación individual.

Reversión operativa: desactivar nuevas capturas contractuales mediante la variable y conservar este lector compatible. No restaurar directamente una aplicación que reste todas las aplicaciones del neto después de haber registrado operaciones contractuales. No revertir TES reales ni borrar amortizaciones para resolver diferencias. Una recuperación de base requiere mantenimiento y conciliación de movimientos posteriores; los respaldos de esta entrega no sustituyen un esquema de respaldo externo ni garantizan RPO/RTO.

## Validación

147 pruebas focalizadas aprobadas y 62 de integración PostgreSQL (48 de notas y 14 de anticipos) aprobadas; migración ejecutada dos veces; tipos y compilación aprobados. Revisión visual de flujos reales con APIs simuladas a 1440, 768, 390, 320 y 844 px, sin desbordamiento de página ni diálogo. También se activó la clase dark; el tema global existente conserva fondos claros. No se crean borradores de pago de prueba en producción.

Comando de integración: `DATABASE_URL=<PostgreSQL local desechable> pnpm test:contractual-advances:db`. El ejecutor rechaza bases remotas y elimina únicamente la base temporal que creó. Casos: GEO, exacto/+centavo, concurrencia, idempotencia, cobertura pendiente, nuevas solicitudes heredadas, porcentaje distinto de 25%, base total, cero justificado, remanente, notas, calidad, RLS y permisos por proyecto.

Existe un fallo previo documentado de la suite general en el texto «Autorizado por» del PDF de órdenes; esta entrega no cambia ese generador.

## Estado por entorno

Consulta: 30 de septiembre de 2026. Los entornos tienen datos diferentes.

- **SSH / http://192.168.10.82:4000:** migración instalada y lectores compatibles desplegados sobre base Git `b134474`, con archivos identificados en `contractual-release.json`. Salud HTTP 200. `CONTRACTUAL_ADVANCES_ENABLED=false` persistido en la configuración del servidor. GEO detenido por el control previo: solo existen TES-000140 y TES-000392, cobertura L1,032,561.36; falta TES-000501 por L130,490.39. Aplicación directa actual L1,032,561.36 y saldo documental menos aplicación L410,399.37. No se regularizó ni se creó ningún pago. Se compararon 14 tablas financieras/documentales sin diferencias, excluyendo metadatos nuevos y las dos filas reservadas para la corrección, que el diagnóstico confirma intactas.
- **Cloud / https://buildreq.aibdev.com:** migración aditiva aplicada el 30/09/2026 y verificada a las 19:41 UTC en Supabase `ovaergjxbzrirmdwnwot`; ocho columnas, dos tablas con RLS y control de origen. El usuario confirmó su despliegue y se verificó el paquete `/assets/index-ueT5mz2q.js` con los campos contractuales; salud HTTP 200 y API protegida con HTTP 401 sin sesión. GEO regularizado a las 19:51:21 UTC: aplicación contractual L515,343.12, disponible de factura L1,442,960.73, anticipo por entregar L0.00 y pendiente de amortizar L647,708.63. Los tres TES, factura, retenciones y adjuntos se conservaron; comparación de 16 tablas sin diferencias fuera de los cuatro registros autorizados (anticipo, aplicación, vínculo documental y auditoría). Las funciones de detalle, resumen del anticipo y elegibilidad de Tesorería del código compatible consultaron Cloud y confirmaron los importes. La revisión posterior reconoce `alreadyApplied=true`; existe un solo evento de auditoría. No se crearon borradores ni pagos de prueba. No se realizó una sesión autenticada de navegador contra Cloud. El commit de código `e628bca` permanece en main y demo locales; no se ejecutó push desde esta sesión.

Evidencia de la regularización Cloud: `output/contractual-advances/geo-cloud-20260930T195054Z/`, con la conciliación previa, resultado aplicado y conservación antes/después; resumen en `geo-cloud-verification.json`. Los seis casos adicionales identificados entonces conservan revisión individual; ICA 621 fue regularizado posteriormente según [corrección de anticipo ICA](correccion-anticipo-ica.md).

Respaldo Cloud local: `output/contractual-advances/cloud-migration-20260930T193936Z/`, con esquema público y datos de las tres tablas alteradas, archivos PostgreSQL, SHA-256 y listados de restauración verificados. No es un respaldo completo de la base ni una prueba de restauración. Resultado: `output/contractual-advances/cloud-migration-verification.json`. El conector MCP no tiene acceso a este proyecto; la migración y las verificaciones de RLS, permisos y conservación se ejecutaron mediante la conexión PostgreSQL configurada. No se ejecutaron los Advisors administrados.

Respaldo SSH protegido: `/etc/dokploy/compose/covi-buildreq-cwn1lc/contractual-20260930T190918Z/`. Archivo completo PostgreSQL de 29,644,925 bytes, SHA-256 y listado de restauración verificados; no se restauró sobre producción. Incluye código y configuración previos. Imagen previa: `covi-buildreq-cwn1lc-buildreq:before-contractual-20260930`. No se promete una prueba completa de recuperación ni respaldo externo.

Entrega de código en un commit local, sin push desde esta sesión; el usuario confirmó haber realizado el despliegue Cloud. Los comandos de migración y conciliación se ejecutan desde el checkout con la configuración del entorno correspondiente. Se preservó el Compose propio del servidor y los cambios locales previos ajenos. Antes de un futuro despliegue automático, integrar estos cambios de forma controlada; no sustituir lectores compatibles por una versión anterior después de registrar datos contractuales.

Conciliación y otras facturas: [anticipos-contractuales-conciliacion.md](anticipos-contractuales-conciliacion.md). Evidencia local: `output/contractual-advances/`, con lectura Cloud, diagnóstico detenido SSH, conservación, revisión visual y manifiesto de entrega.
