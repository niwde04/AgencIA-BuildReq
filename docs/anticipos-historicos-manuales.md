# Amortización manual de anticipos históricos

La modalidad `legacy_manual` permite capturar monto o porcentaje por factura sin inventar una regla contractual. Se habilita exclusivamente mediante mantenimiento auditado, nunca desde la solicitud de nuevos anticipos ni por fecha de creación.

## Caso aprobado y comportamiento

Orden CD-018-00000527 (2202), factura inicial FT-018-00000542 (2198), proveedor 111, proyecto 22, HNL. Anticipos ANT-2026-000114/115/116: L36,502.39, L21,155.06 y L71,705.15, total L129,362.60. Pagos cerrados TES-2026-000556/557/558 conservados. La modalidad aplica también a las siguientes facturas de esa orden; las demás órdenes y las facturas cerradas no se regularizan.

- Edición sólo en borrador/rechazada y con los permisos existentes. Campos inicialmente vacíos; vacío o cero no amortiza. Porcentaje sobre subtotal, sin propuesta ni motivo de excepción contractual.
- Importe monetario redondeado a centavos, limitado al subtotal y al anticipo pagado disponible. Otros compromisos revisados, pendientes o registrados restan únicamente su porción no consumida; las aplicaciones ya consumidas no se descuentan dos veces.
- Revisar y enviar reservan el importe; rechazar libera el compromiso y permite corregirlo. Guardado, revisión, envío y contabilización usan bloqueos orden → anticipos → facturas.
- Contabilizar consume lo guardado, empezando por el anticipo pagado más antiguo. Las aplicaciones `legacy_manual` quedan vinculadas al ajuste documental y al control por factura. Se conserva el resto para futuras facturas.
- La amortización ya está dentro del neto: no se cuenta nuevamente como pago directo de factura, ni en Tesorería, notas, impresión o disponibilidad de calidad.

`invoiceContractualAmortizations.treatment` distingue `contractual` y `legacy_manual`; el valor predeterminado contractual conserva los registros existentes. El contexto de detalle mantiene el nombre `contractualAmortization` por compatibilidad e incluye `treatment`; en históricos no contiene regla fija. Los resúmenes de anticipos agregan `legacyManualAmortizationAmount`, separado de aplicación directa y contractual. El campo previo `treasuryPaymentItems.contractualAmortizationAmount` conserva la deducción documental informativa de ambos tratamientos y nunca reduce nuevamente el disponible.

## Migración y habilitación

La migración `20261005223104_legacy_manual_advances.sql` amplía las restricciones y el control de origen. Repetirla no reclasifica anticipos. El comando anterior de migración contractual aplica después esta migración para conservar el control de origen más reciente.

```sh
pnpm db:migrate-legacy-manual-advances
pnpm db:enable-legacy-manual-advances
# Después de publicar y verificar servidor y cliente compatibles:
pnpm db:enable-legacy-manual-advances -- --apply --compatible-app-installed
```

El mantenimiento está limitado al proyecto Cloud `ovaergjxbzrirmdwnwot`. Antes de aplicar exige `/health` con capacidad histórica versión 1 y captura habilitada, y verifica el formulario publicado en buildreq.aibdev.com. Dentro de la transacción vuelve a comprobar identificadores, montos, pagos cerrados, estado y cálculo iniciales, y ausencia de aplicaciones, ajustes y dependencias nuevas. Cualquier diferencia detiene la operación; no intenta reparar automáticamente otros casos.

Sólo cambia `applicationMode` de los tres anticipos y agrega el evento `legacy-manual-2202-114-115-116-v1`, con evidencia anterior y posterior. Conserva fechas, montos, estados, documentos y pagos. Repetir la habilitación reconoce la auditoría y no agrega otra operación.

## Verificación y recuperación

Migración instalada en Cloud el 05/10/2026. Huellas SHA-256 comparadas dentro de la transacción: once tablas financieras intactas, excluyendo únicamente la columna nueva con valor predeterminado; RLS y permisos originales intactos. No se exportaron filas completas de esas tablas. Evidencia local en `output/legacy-manual-advances/cloud-migration.json`.

Publicación y habilitación verificadas el 05/10/2026: código `889fb62` en main y Cloud, `/health` con capacidad versión 1 y captura habilitada, y paquete del cliente con el formulario manual. Los tres anticipos están habilitados; factura 2198 permanece en borrador con neto L185,387.60 y sin amortización capturada. Un único evento de habilitación, cero aplicaciones nuevas y cero controles por factura. Comparación de once tablas dentro de la transacción confirma conservación fuera de las tres clasificaciones y ese evento; repetición sin efectos. Evidencia resumida en `output/legacy-manual-advances/cloud-activation.json`.

Validación: 131 pruebas focalizadas y 68 casos de integración PostgreSQL (19 históricos, 14 contractuales y 35 de notas), tipos y compilación. Cubren monto/porcentaje, vacío/cero, límites, saldo pagado, revisión/rechazo/corrección, reservas de Tesorería, consumo FIFO, futuras facturas, contabilización simultánea/repetida y origen a nivel PostgreSQL. Las pruebas de base sólo admiten PostgreSQL desechable en localhost. Revisión visual con API simulada a 320/390/768/844/1440 px, claro/oscuro; evidencia en `output/legacy-manual-advances/visual-results.json`.

Para pausar capturas nuevas, establecer `LEGACY_MANUAL_ADVANCES_ENABLED=false` y volver a publicar/reiniciar según el entorno. Los lectores y la contabilización de importes ya guardados siguen compatibles. La bandera contractual existente conserva su comportamiento independiente. Después de registrar consumos no volver a código antiguo, borrar vínculos, ni reclasificar a directa: conservar lectores compatibles y corregir hacia adelante.
