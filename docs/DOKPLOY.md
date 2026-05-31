# Despliegue en Dokploy

## Tipo de despliegue

Usa `Docker Compose` apuntando al archivo `docker-compose.yml` de este repo.

## Variables requeridas

Estas variables deben existir en Dokploy antes del primer deploy:

- `DATABASE_URL`
- `JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SITE_URL`

## Variables opcionales

- `RUN_DB_PUSH`
- `SUPABASE_DOCKER_NETWORK`
- `VITE_APP_ID`
- `OWNER_OPEN_ID`
- `BUILT_IN_FORGE_API_URL`
- `BUILT_IN_FORGE_API_KEY`
- `VITE_ANALYTICS_ENDPOINT`
- `VITE_ANALYTICS_WEBSITE_ID`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET_NAME`

## Recomendación

- Configura el puerto interno de la aplicación en Dokploy como `4000`
- No publiques `4000:4000` manualmente en Docker Compose; Dokploy debe enrutar al puerto interno para evitar conflictos con contenedores anteriores
- Usa `RUN_DB_PUSH=false` por defecto
- Actívalo en `true` solo si quieres que el contenedor ejecute `pnpm db:push` al arrancar
- Si Supabase corre en Docker/Dokploy, usa el hostname interno del contenedor de DB en `DATABASE_URL`, por ejemplo:
  `postgresql://postgres:<password>@covi-supabase-kge7a7-supabase-db:5432/postgres`
- En ese caso define `SUPABASE_DOCKER_NETWORK` con el nombre de la red Docker de Supabase. Para el servidor actual:
  `SUPABASE_DOCKER_NETWORK=covi-supabase-kge7a7`

## Healthcheck

El contenedor expone `GET /health`.

## Notas

- El build del frontend necesita `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, por eso también van como `build args` en `docker-compose.yml`.
- Define `VITE_SITE_URL=https://buildreq.aibdev.com` para que los correos de confirmación de Supabase regresen al dominio público.
- En Supabase Auth también configura:
  - `Site URL`: `https://buildreq.aibdev.com`
  - `Redirect URLs`: `https://buildreq.aibdev.com/**`
- Este despliegue asume PostgreSQL externo, por ejemplo Supabase.
