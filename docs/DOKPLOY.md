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

## Variables opcionales

- `APP_PORT`
- `RUN_DB_PUSH`
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

- Deja `APP_PORT=3000`
- Usa `RUN_DB_PUSH=false` por defecto
- Actívalo en `true` solo si quieres que el contenedor ejecute `pnpm db:push` al arrancar

## Healthcheck

El contenedor expone `GET /health`.

## Notas

- El build del frontend necesita `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, por eso también van como `build args` en `docker-compose.yml`.
- Este despliegue asume PostgreSQL externo, por ejemplo Supabase.
