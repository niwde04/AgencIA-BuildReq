# Saldos iniciales: proyecto y ubicación por ítem

## Comportamiento

- Al crear un saldo o agregar líneas a uno existente, cada ítem permite seleccionar un proyecto activo asignado a la bodega del documento.
- La ubicación es el lugar físico dentro de la bodega (estante, zona o plantel). Es opcional y permite escribir un valor nuevo o elegir una sugerencia del inventario del mismo proyecto y bodega.
- El proyecto de apertura permanece como referencia del documento y valor predeterminado. Los nuevos ingresos se contabilizan según el proyecto de cada línea.
- El detalle muestra ambos campos. Los filtros por proyecto y el kardex utilizan el proyecto de cada ítem; los totales filtrados corresponden a esas líneas.
- Las cantidades admiten hasta dos decimales, de acuerdo con la precisión de la base.

## Persistencia y controles

La migración 0141 agrega projectId y storageLocation a openingBalanceItems. Completa el proyecto de las líneas históricas con el de su documento; deja su ubicación sin especificar porque no existe evidencia histórica. No mueve inventario.

Se conservan los permisos existentes de saldos iniciales. La API valida el proyecto activo y su relación con la bodega. El documento, sus líneas y las existencias se escriben en una transacción. Las operaciones de saldo de una misma bodega se serializan y los incrementos de stock son atómicos. Esto protege operaciones concurrentes; no introduce una clave de idempotencia para reenvíos manuales de la misma solicitud.

Las sugerencias se consultan al enfocar el campo, con búsqueda diferida, hasta 50 resultados y caché de 30 segundos; la caché se invalida al guardar. No se midió rendimiento bajo carga.

## Publicación y recuperación

1. Aplicar drizzle/0141_opening_balance_item_destinations.sql antes de desplegar la aplicación. La migración fue probada en PostgreSQL local aislado, incluida una segunda ejecución.
2. Desplegar API y frontend juntos y comprobar una apertura y una adición en el ambiente de pruebas.
3. Verificar el formulario en escritorio y móvil antes de publicar: la automatización del navegador falló en esta sesión, por lo que no hay verificación visual.

La migración se aplicó y verificó el 17 de septiembre de 2026 a las 20:38 UTC, usando DATABASE_URL del .env. Se completó el proyecto de las tres líneas históricas; se verificaron la clave foránea, la conservación de los datos originales y las existencias, y la continuidad de RLS y los permisos. Si se necesita revertir la aplicación, conservar las columnas nuevas y sus datos. Una versión anterior no interpreta el proyecto por línea: pausar las escrituras de saldos y priorizar una corrección hacia adelante si ya existen movimientos nuevos. No eliminar las columnas ni reasignar existencias para volver atrás.

## Verificación

Pasaron 44 pruebas focalizadas en seis archivos: openingBalances.test.ts, openingBalances.integration.test.ts, receiptInventory.test.ts, receiptSubstitutions.test.ts, receiptSubstitutionsMigration.test.ts e inventoryExport.test.ts.

Las ocho pruebas de integración utilizaron una base desechable local, nunca Supabase. Cubren separación de stock por proyecto y ubicación, rechazo de proyectos inválidos, compatibilidad de entradas anteriores, reversión total ante error, concurrencia, sugerencias acotadas, filtros y kardex, y migración repetible sin mover stock.

El archivo de integración se omite salvo que se defina OPENING_BALANCES_TEST_DATABASE_URL. Exige localhost y el nombre buildreq_opening_balances_test; requiere inicializar esa base con el esquema de Drizzle. Sus pruebas vacían exclusivamente esa base aislada.

## Registro de aplicación

- Archivo ejecutado: drizzle/0141_opening_balance_item_destinations.sql.
- SHA-256 del archivo ejecutado: ac43dc49d3fc00d6667786d1bbabec7f40186aab5ed7093f07b87526b910d584.
- Aplicación mediante una transacción con límite de espera de bloqueo de 5 segundos y de sentencia de 30 segundos.
- Antes del commit se compararon huellas de los datos originales de saldos y del inventario; permanecieron iguales.
- Después del commit se confirmó la persistencia de los proyectos en las tres líneas existentes.
- No se crearon permisos nuevos para anon/authenticated ni se modificaron políticas RLS.
- La base no tiene un registro de migraciones de la aplicación; este documento y el SQL versionado registran la ejecución.
- Comprobación posterior con las funciones reales de la aplicación: listado y detalle de los dos saldos existentes, con tres líneas y sus proyectos resueltos correctamente.
