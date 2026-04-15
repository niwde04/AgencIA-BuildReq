#!/bin/sh
set -eu

if [ "${RUN_DB_PUSH:-false}" = "true" ]; then
  echo "Running database sync with drizzle-kit push..."
  pnpm db:push
fi

exec node dist/index.js
