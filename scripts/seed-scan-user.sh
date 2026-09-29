#!/usr/bin/env bash
# Creates a read-only scanner account for nuclei/ZAP authenticated scanning.
# Safe to run multiple times (uses INSERT ... ON CONFLICT DO NOTHING).
# Usage: ./scripts/seed-scan-user.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Read creds from .env
DB_USER=$(python3 -c "
import re
with open('$SCRIPT_DIR/../.env') as f:
    for line in f:
        m = re.match(r'^POSTGRES_USER=(.+)', line.strip())
        if m: print(m.group(1).strip()); exit()
print('postgres')
")
DB_NAME=$(python3 -c "
import re
with open('$SCRIPT_DIR/../.env') as f:
    for line in f:
        m = re.match(r'^POSTGRES_DB=(.+)', line.strip())
        if m: print(m.group(1).strip()); exit()
print('prism')
")

SCAN_EMAIL="scanner@prism-scan.local"
SCAN_PASS="${SCAN_USER_PASSWORD:-Scanner@Prism2026!}"

# bcrypt hash the password using local api/node_modules (CJS require works regardless of project type)
HASH=$(node -e "
const b = require('$SCRIPT_DIR/../api/node_modules/bcryptjs');
b.hash('$SCAN_PASS', 10).then(h => process.stdout.write(h));
" 2>/dev/null)

docker compose -f "$SCRIPT_DIR/../docker-compose.yml" exec -T db psql \
  -U "$DB_USER" -d "$DB_NAME" <<SQL
-- Create a placeholder scan company if it doesn't exist
INSERT INTO companies (name, domain, industry, company_size, admin_email, status)
VALUES ('PRISM Scanner', 'prism-scan.local', 'Technology', '1-10', '$SCAN_EMAIL', 'active')
ON CONFLICT (domain) DO NOTHING;

-- Create the scanner user (CONTRIBUTOR = can submit forms/API calls for active scan coverage)
INSERT INTO users (email, password_hash, full_name, role, company_id, onboarding_completed)
SELECT
  '$SCAN_EMAIL',
  '$HASH',
  'Security Scanner',
  'CONTRIBUTOR',
  id,
  true
FROM companies WHERE domain = 'prism-scan.local'
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

SELECT 'Scanner user ready: $SCAN_EMAIL' AS status;
SQL

echo ""
echo "Done. Add to your .env if you want a custom password:"
echo "  SCAN_USER_PASSWORD=your-password"
