# Datos adicionales de usuarios

El formulario de **Crear Usuario** y **Editar Usuario** permite registrar número
de teléfono, cargo y número de identidad. Los tres datos son opcionales; las
cuentas existentes continúan siendo válidas sin completarlos.

Teléfono e identidad se guardan como texto para conservar ceros iniciales,
prefijos internacionales y guiones. Sus límites son 50 caracteres; cargo admite 150. La API elimina espacios al inicio/final, convierte valores vacíos en `null`
y conserva el valor anterior cuando una petición de edición omite el campo.
Estos datos no cambian roles ni permisos.

Las referencias a usuarios en documentos operativos usan una proyección que
excluye estos tres campos. Su consulta completa se conserva en gestión de
usuarios y en la sesión del propio usuario.

En el listado, cargo aparece debajo del nombre, teléfono debajo del correo e
identidad en su propia columna. La búsqueda y la exportación de Excel incluyen
los tres datos. La tabla permite desplazamiento horizontal y los formularios se
adaptan a móvil con desplazamiento vertical cuando es necesario.

## Activación

Aplicar primero la migración aditiva en el entorno elegido, antes de publicar el
servidor que consulta las nuevas columnas de `users`:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/migrate-user-profile-fields.ts
```

El script usa `DATABASE_URL` del entorno y verifica las tres columnas después de
ejecutar `drizzle/20261112000000_user_profile_fields.sql`. La migración es
repetible: agrega columnas anulables sin modificar usuarios anteriores, índices,
RLS ni permisos. No agrega datos a Supabase Auth ni a sus metadatos.

La migración se aplicó al Cloud autorizado el 12/11/2026 a las 08:49 Honduras,
proyecto `ovaergjxbzrirmdwnwot`. La verificación transaccional conservó los 75
usuarios, sus datos originales, RLS, permisos, políticas e índices. No se crearon
cuentas de prueba. Evidencia del workspace:
`output/user-profile/cloud-activation-20261112T144947414Z.json`.

Para revertir la aplicación se pueden conservar las columnas; no se deben
eliminar si ya contienen datos capturados. Esta activación corresponde solamente
a Cloud; el servidor SSH conserva su configuración.

La entrega se preparó sobre `main`, preservando los cambios pendientes de `demo`.
La imagen Docker incluye el runner de migración. La publicación se realiza por
el flujo existente de `main`/Dokploy y se verifica en
`https://buildreq.aibdev.com/health` mediante `capabilities.userProfileFields: 1`,
las etiquetas del frontend publicado y la autenticación de la API.

## Verificación local

Preparación del 12/11/2026: 37 pruebas focalizadas aprobadas, migración y
persistencia verificadas en PostgreSQL temporal, chequeo de tipos y compilación
aprobados. La revisión de interfaz cubrió 21 escenarios de creación/edición en
escritorio, tableta, móvil y paisaje, con API simulada, búsqueda y exportación
real de Excel. La identidad exportada conserva sus ceros iniciales como texto.

```powershell
node node_modules/vitest/vitest.mjs run server/userProfileFields.test.ts server/userActiveStatus.test.ts server/userPublicProjection.test.ts
node node_modules/vitest/vitest.mjs run server/buildreq.test.ts -t "BuildReq - User Management"
node node_modules/typescript/bin/tsc --noEmit
node node_modules/pnpm/bin/pnpm.cjs build
```

Las capturas de interfaz con usuarios simulados se guardan en
`output/user-profile/`. No se crean usuarios reales para revisar el diseño.

La prueba de persistencia y migración requiere una instancia PostgreSQL local:

```powershell
$env:USER_PROFILE_LOCAL_DATABASE_URL = '<URL de PostgreSQL local>'
node node_modules/tsx/dist/cli.mjs scripts/test-user-profile-fields-db.ts
```

Este verificador crea y elimina su propia base temporal. Rechaza conexiones que
no apunten a `localhost`, `127.0.0.1` o `::1`, y no usa `DATABASE_URL` como
conexión de destino para sus datos de prueba.
