# Corrección del anticipo contractual ICA

Aplicada en Supabase Cloud el 22/10/2026 a las 21:15 UTC. Sitio: buildreq.aibdev.com. Código publicado: bcabd92. SSH y los demás históricos quedaron fuera del alcance.

## Resultado

| Concepto | Importe, L |
|---|---:|
| Anticipo pagado, TES-2026-000169 | 753,987.00 |
| Amortización de FT-017-00000621 | 549,468.03 |
| Pendiente de amortizar | 204,518.97 |
| Disponible para pagar la factura | 3,113,652.15 |

Se actualizaron únicamente el tratamiento del anticipo 21 y la aplicación 71. Se insertaron el control contractual de la factura 2015 y la auditoría 20, con clave única contractual-ica-1058-2015-v1. El ajuste documental 28 conserva su importe y su porcentaje histórico 15.00000008. El control nuevo usa el 15% del subtotal.

Orden, las dos facturas de la orden, deducción, TES, notas y liberaciones se compararon íntegramente contra el respaldo bloqueado y permanecieron iguales. No se generaron pagos ni borradores de prueba en producción.

## Plan ejecutado

1. Aislar el trabajo desde main 39990d0, preservando la rama demo y sus modificaciones anteriores.
2. Respaldar código, esquemas public/private y soportes; calcular SHA256 y comprobar el catálogo. Restaurar en una base local nueva.
3. Cerrar el fallo en applyAvailableAdvancesForPurchaseOrder: antes de consumir fondos, comprobar amortización documental y control contractual de las facturas bloqueadas de esa orden. Una combinación ambigua se rechaza antes de escribir. La aplicación directa válida se conserva.
4. Probar la regularización puntual con comprobaciones exactas de identidad, importes y estados, transacción, bloqueos de orden/anticipos/facturas, beforeimage durable y auditoría idempotente.
5. Publicar la protección y comprobar /health con advanceAmortizationGuard: 1 y legacyManualAdvances: 1. Aplicar sólo el caso autorizado.
6. Verificar los mismos lectores usados por Facturas y Tesorería, los importes finales, el proveedor elegible y la conservación de originales.

## Verificación realizada

- 133 pruebas unitarias focalizadas y 57 pruebas PostgreSQL aprobadas. Cubren la aplicación directa válida, amortización sin vínculo, futuras facturas al 15%, captura/revisión/contabilización, repetición, permisos, concurrencia y rollback ante fallos de respaldo/auditoría.
- TypeScript y compilación de producción aprobados. Sin cambios visuales ni dependencias nuevas. No se ejecutó una revisión visual con la sesión del cliente.
- Dump de aplicación de 33,440,514 bytes. SHA256: 829a12e7564a92574ccd228d81c743ffd6d8daf8c36dd19c8308345000816b4f. Restauración local aprobada con 73 tablas.
- Ensayo sobre la copia real restaurada: sólo cambiaron purchaseOrderAdvances, purchaseOrderAdvanceApplications, invoiceContractualAmortizations y advanceFinancialEvents; las otras 69 tablas conservaron sus huellas. Repetición sin efectos.
- Producción: factura elegible por L3,113,652.15; anticipo pendiente de amortizar L204,518.97; auditoría única 20; pago original conservado; HTTP 200 y protección activa. Comprobación adicional explícitamente de sólo lectura.
- Sin cambios de esquema, RLS, roles, grants ni endpoints públicos de modificación. No se midió rendimiento bajo carga; la nueva consulta está acotada a facturas de una orden.

## Respaldo y operación

Respaldo local fuera de Git: backups/ica-advance-20261022T210357Z. Incluye bundle de código anterior, dump, catálogo, soportes, manifiestos, restauración, ensayo y evidencia final. La copia exacta antes de escribir está en production-apply/locked-before.json, con SHA256 y manifiesto propios.

El ejecutor scripts/reconcile-ica-contractual-advance.ts sólo admite el proyecto Cloud y usuario esperados. Sin --apply es diagnóstico. Con --apply exige despliegue compatible y --backup-root/--output-dir absolutos. La salida debe ser una carpeta hija nueva. Guarda y sincroniza a disco el beforeimage, SHA256 y manifiesto dentro de la transacción antes de modificar filas. Evidencia cambiada, respaldo fallido o auditoría fallida revierten toda la operación.

El proveedor figura en la respuesta de facturas elegibles para proyecto 017/HNL. Recargar Tesorería o cerrar y reabrir el formulario renueva la consulta.

## Recuperación

1. Conservar el beforeimage y verificar su SHA256. Comprobar el estado contra el afterimage de auditoría 20 y la ausencia de pagos, reservas, nuevas facturas o consumo posterior.
2. Si hubo movimientos posteriores, preparar conciliación hacia adelante; nunca restaurar tablas completas sobre una base activa.
3. Si no hubo cambios posteriores y se autoriza reversión, bloquear orden 1058, anticipo 21 y facturas en una transacción. Restituir sólo los campos originales del anticipo 21 y aplicación 71; eliminar únicamente el control 2015 que coincida con esta operación y añadir auditoría de reversión, conservando la auditoría original.
4. Comparar factura, deducción, TES, adjuntos y otras filas contra el respaldo. Mantener lectores contractuales compatibles: revertir código no revierte datos.

El dump se restauró localmente sin owners/ACL de origen. Cubre public/private, no Auth/Storage ni infraestructura; los soportes relevantes se conservaron aparte. No se promete RPO/RTO ni respaldo externo.
