#!/bin/sh
set -e
# Fix ownership on named volumes — these are created as root when first mounted
chown -R appuser:appgroup /app/uploads /app/exports 2>/dev/null || true
exec gosu appuser sh /app/start.sh
