#!/usr/bin/env bash
# One-time setup: creates the PRISM product in DefectDojo and writes DOJO_TOKEN to the root .env.
# Run AFTER: cd defectdojo && docker compose up -d
# First boot takes ~2-3 minutes (DB migrations). Run this once migrations complete.

set -e

DOJO_URL="http://localhost:8888"
ADMIN_USER="${DD_ADMIN_USER:-admin}"
ADMIN_PASS="${DD_ADMIN_PASSWORD:-Prism@Dojo2026!}"
ROOT_ENV="$(dirname "$0")/../.env"

echo "Waiting for DefectDojo API to be ready..."
until curl -sf "$DOJO_URL/api/v2/product_types/" \
  -u "$ADMIN_USER:$ADMIN_PASS" -o /dev/null 2>/dev/null; do
  printf "."
  sleep 5
done
echo ""
echo "DefectDojo is up."

# Get API token
TOKEN=$(curl -sf -X POST "$DOJO_URL/api/v2/api-token-auth/" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Write token to root .env without printing it
python3 - "$TOKEN" "$ROOT_ENV" <<'PY'
import sys, re

token = sys.argv[1]
env_path = sys.argv[2]

with open(env_path) as f:
    content = f.read()

if 'DOJO_TOKEN=' in content:
    content = re.sub(r'^DOJO_TOKEN=.*$', 'DOJO_TOKEN=' + token, content, flags=re.MULTILINE)
else:
    content += '\nDOJO_TOKEN=' + token + '\n'

if 'DOJO_URL=' not in content:
    content += 'DOJO_URL=http://localhost:8888\n'

with open(env_path, 'w') as f:
    f.write(content)

print(f"Token written to {env_path}")
PY

# Create PRISM product
echo "Creating PRISM product..."
RESULT=$(curl -sf -X POST "$DOJO_URL/api/v2/products/" \
  -H "Authorization: Token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"PRISM","description":"PRISM Compliance Platform — aggregated security findings","prod_type":1}')

echo "Product created: $(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ID', d['id'], '—', d['name'])")"

echo ""
echo "============================================================"
echo " Setup complete!"
echo " DefectDojo: $DOJO_URL"
echo " Login: $ADMIN_USER / [password in defectdojo/.env]"
echo " DOJO_TOKEN has been written to your root .env"
echo " Now run ./scan.sh to import your first results."
echo "============================================================"
