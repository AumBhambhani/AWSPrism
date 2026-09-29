#!/bin/sh
set -e

# In production, fetch secrets from AWS SSM Parameter Store before starting.
# Locally, docker-compose supplies the env via env_file — this is a no-op.
if [ "$NODE_ENV" = "production" ]; then
  echo "[startup] Fetching secrets from SSM (${SSM_PATH:-/prism/prod/})..."
  eval "$(node /app/load-secrets.mjs)"
  echo "[startup] Secrets loaded."
fi

# Wait for DB
./wait-for-db.sh db

# Start Node API in foreground
node src/index.js
