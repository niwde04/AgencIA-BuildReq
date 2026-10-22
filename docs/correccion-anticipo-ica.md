# Plan de corrección: anticipo contractual ICA

Objetivo: habilitar FT-017-00000621 con neto documental L3,113,652.15 y prevenir una aplicación directa adicional cuando una factura contiene amortización sin vínculo contractual.

## Alcance autorizado

- Entorno: Supabase Cloud ovaergjxbzrirmdwnwot; sitio buildreq.aibdev.com. SSH fuera de alcance.
- Orden OC-017-00000233 (1058), factura2015, anticipo21 y aplicación71.
- Conservar íntegros TES-2026-000169/L753,987.00, factura y deducción28/L549,468.03, adjuntos y documentos ajenos.
- Anticipo21: contractual, amortización15% subtotal. Aplicación71: contractual/L549,468.03 enlazada a deducción28. Insertar control de amortización y auditoría única. Restante L204,518.97.
- No regularizar otros históricos ni generar pagos/borradores de prueba en producción.

## Secuencia

1. Respaldar código main39990d0, esquemas public/private y soportes originales; SHA256, catálogo pg_restore y ensayo de restauración aislada.
2. Implementar prevalidación en aplicación común de anticipos, manteniendo anticipos directos legítimos y captura contractual existente. Rechazar una amortización documental sin control antes de consumir anticipos directos.
3. Implementar regularización puntual con comprobaciones de identidad/estado/importes, transacción, bloqueos orden→anticipos→factura, respaldo de filas bajo bloqueo antes de escribir y auditoría idempotente.
4. Probar regresiones financieras, concurrencia, repetición y conservación en PostgreSQL desechable; tipos y compilación. Revisar diff independiente.
5. Publicar la protección por main siguiendo despliegue Cloud existente; verificar salud/capacidad. Aplicar únicamente la regularización autorizada y comprobar funciones reales de consulta sin crear pagos.
6. Verificar que Tesorería ofrezca L3,113,652.15, que anticipo pagado permanezca753,987.00 y pendiente de amortizar204,518.97; comparar huellas de documentos y permisos.

## Recuperación

- Copia exacta de filas dentro de la transacción, conservada con SHA256 antes de cambios.
- El dump es respaldo de recuperación, nunca se restaura completo sobre una base activa. Ensayo exclusivamente local.
- Reversión puntual sólo si no hubo consumos/pagos posteriores y conservando auditoría; preferir corrección hacia adelante si hay movimientos posteriores.
- Revertir código no revierte automáticamente datos. Conservar lectores contractuales compatibles y columnas existentes.

## Seguridad y límites

Sin cambios de esquema, RLS, roles o grants. Sin dependencias nuevas. Archivos de respaldo fuera de Git, sin secretos en manifiesto. Consultas acotadas; sin promesas de RPO/RTO ni cambios de infraestructura.

## Verificación previa a publicación

- 133 pruebas unitarias focalizadas y 57 pruebas PostgreSQL aprobadas. Incluyen preservación de aplicación directa válida, rechazo de amortización sin vínculo, consumo contractual futuro del15%, idempotencia, fallos de respaldo/auditoría y reversión transaccional.
- TypeScript y compilación de producción aprobados; sin cambios visuales ni dependencias nuevas.
- Respaldo custom de public/private:33,440,514bytes, SHA256829a12e7564a92574ccd228d81c743ffd6d8daf8c36dd19c8308345000816b4f. Restauración aislada aprobada con73tablas.
- Ensayo de regularización sobre esa copia real: sólo cambiaron las tablas de anticipos/aplicaciones/control/auditoría; las otras69tablas conservaron sus huellas. Repetición sin efectos. Tesorería ofreceL3,113,652.15; anticipo pendiente de amortizarL204,518.97.
- Vista previa Cloud completada sin cambios; antes de aplicar se exige /health con advanceAmortizationGuard1 y lectores legacyManualAdvances1.

## Operación y respaldo

El ejecutor scripts/reconcile-ica-contractual-advance.ts sólo admite el proyectoCloud y usuario esperados. Sin --apply es diagnóstico. Con --apply exige aplicación compatible y --backup-root/--output-dir absolutos; la salida debe ser una carpeta hija nueva. Dentro de la transacción guarda locked-before.json, SHA256 y manifiesto mediante fsync antes de modificar filas. Cualquier diferencia de evidencia, respaldo fallido o fallo de auditoría revierte la transacción completa.

El respaldo local de esta entrega está en backups/ica-advance-20261022T210357Z (fuera deGit): bundle de código, dump, soportes, catálogo, restauración y comparación del ensayo. No se exponen conexiones ni claves en estos documentos.
