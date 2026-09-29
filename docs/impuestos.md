# Impuestos y vínculo con documentos

Las líneas de órdenes, recepciones y facturas guardan `taxCode` y, para impuestos con importe, un `taxBreakdown` histórico. El vínculo con el catálogo es el mismo código de `salesTaxes`; crear otro impuesto no reasigna documentos existentes. No reconstruir esta relación solo por porcentaje.

La aplicación tenía un catálogo predeterminado en `shared/purchase-orders.ts`, usado cuando el catálogo activo estaba vacío. La migración `drizzle/20260929035318_sales_tax_financial_groups.sql` registra los códigos exactos `exe`, `isv_15`, `isv_18` e `isv_4` que faltan, mediante `ON CONFLICT DO NOTHING`. Conserva tasas, etiquetas, activación y asignaciones ya existentes. No ejecuta actualizaciones de facturas, retenciones, órdenes, recepciones ni notas. No volver a ejecutar `0059_sales_taxes.sql` para poblar el catálogo: esa migración antigua también recalcula documentos.

El código financiero opcional se guarda en `salesTaxes.financialGroupCode`, con clave foránea a `financialGroups.financialGroupCode`. Se selecciona mediante búsqueda remota paginada por código o descripción. El backend valida grupos activos y permite conservar una asignación que posteriormente fue desactivada. Omitir el campo lo conserva; `null` lo quita. No se asignan grupos automáticamente.

La API impide renombrar `taxCode` para conservar las referencias existentes; para otro código se crea otro impuesto. Quitar un impuesto usado lo desactiva. La comprobación de uso incluye órdenes, facturas, recepciones, notas y dependencias de impuestos adicionales. Los importes y desgloses guardados en documentos no cambian al editar su grupo financiero.

## Migración y recuperación

Aplicación explícita: `pnpm db:migrate-sales-tax-financial-groups`, apuntando `DATABASE_URL` al entorno revisado. Usa una transacción, bloqueo asesor, espera de bloqueo máxima de 5 segundos y límite de sentencia de 60 segundos. Solo agrega una columna nullable, una clave foránea y las filas ausentes del catálogo; no modifica RLS ni grants. No agrega índices para este catálogo pequeño.

Aplicada el 28 de septiembre de 2026 (hora de Honduras) a Supabase Cloud `ovaergjxbzrirmdwnwot` y al Supabase de `192.168.10.82` por SSH. La verificación transaccional comparó huellas de ocho tablas de documentos antes/después, sin diferencias. Todas las líneas existentes de facturas, órdenes y recepciones encontraron su código en ambos catálogos. RLS y permisos permanecieron iguales. La revisión del Advisor por MCP no estuvo disponible por permisos; se verificaron directamente RLS/grants y el rechazo del rol `authenticated` en pruebas locales.

El esquema ampliado es compatible con el código anterior. Para revertir la interfaz basta desplegar el código previo y conservar la columna y el catálogo; no borrar impuestos ni reescribir documentos como parte de una reversión. No se hizo push ni despliegue del nuevo selector en esta entrega.

## Verificación

- `pnpm check` y `pnpm build`.
- `pnpm test:sales-taxes:db`, exclusivamente sobre PostgreSQL local; crea y elimina una base temporal propia. Comprueba migración repetida, datos anteriores intactos, enlaces, grupos válidos/inválidos, eliminación y permisos.
- Pruebas focalizadas de impuestos, retenciones y notas; integración de notas y regresiones existentes de ISV: 63 pruebas aprobadas en total. La suite general no se repitió.
- Revisión visual con datos simulados en 1440, 768, 390 y 320 px, tema oscuro, búsqueda por código/descripción, paginación, guardar y quitar selección. Producción respondió HTTP 200 en `/health` tras la migración.
