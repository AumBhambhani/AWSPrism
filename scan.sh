#!/usr/bin/env bash
# All scanners run in Docker — no local installs needed beyond Docker itself.
#
# Usage:
#   ./scan.sh              → baseline ZAP (passive only, ~3 min, safe on prod)
#   ./scan.sh --full       → full ZAP active attack scan (~30-60 min, dev/staging only)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPORT_DIR="$SCRIPT_DIR/.scan-reports"
SCAN_DATE=$(date +%Y-%m-%d)
mkdir -p "$REPORT_DIR"

# Parse args
ZAP_MODE="baseline"
for arg in "$@"; do
  case "$arg" in
    --full) ZAP_MODE="full" ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# Docker images for each tool
TRIVY_IMAGE="aquasec/trivy:latest"
SEMGREP_IMAGE="semgrep/semgrep:latest"
NUCLEI_IMAGE="projectdiscovery/nuclei:latest"
ZAP_IMAGE="ghcr.io/zaproxy/zaproxy:stable"

# Read DOJO_TOKEN and DOJO_URL safely from .env
_env_val() {
  python3 -c "
import re, sys
with open('$SCRIPT_DIR/.env') as f:
    for line in f:
        m = re.match(r'^${1}=(.+)', line.strip())
        if m: print(m.group(1).strip()); sys.exit(0)
sys.exit(1)
" 2>/dev/null || echo "${2:-}"
}

DOJO_TOKEN="$(_env_val DOJO_TOKEN "")"
DOJO_URL="$(_env_val DOJO_URL "http://localhost:8888")"

dojo_import() {
  local file="$1" scan_type="$2"
  [ -z "$DOJO_TOKEN" ] && { echo "  [skip] DOJO_TOKEN not set"; return 0; }
  [ -f "$file" ]       || { echo "  [skip] report not found: $file"; return 0; }
  echo "  -> Uploading to DefectDojo: $scan_type"
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$DOJO_URL/api/v2/reimport-scan/" \
    -H "Authorization: Token $DOJO_TOKEN" \
    -F "file=@$file" \
    -F "scan_type=$scan_type" \
    -F "product_name=PRISM" \
    -F "engagement_name=continuous-scan" \
    -F "auto_create_context=true" \
    -F "close_old_findings=true" \
    -F "close_old_findings_product_scope=false" \
    -F "minimum_severity=High")
  if [ "$HTTP" = "201" ]; then
    echo "  -> Imported (new findings added)"
  elif [ "$HTTP" = "200" ]; then
    echo "  -> Reimported (findings synced, fixed ones closed)"
  else
    echo "  [warn] Upload returned HTTP $HTTP (DefectDojo may not be running)"
  fi
}

FINDINGS=0

# ── Scanner auth token ─────────────────────────────────────────────────────
SCAN_EMAIL="$(_env_val SCAN_USER_EMAIL "scanner@prism-scan.local")"
SCAN_PASS="$(_env_val SCAN_USER_PASSWORD "Scanner@Prism2026!")"
API_URL="$(_env_val PRISM_API_URL "http://localhost:4000")"

SCAN_JWT=$(curl -sf -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$SCAN_EMAIL\",\"password\":\"$SCAN_PASS\"}" \
  2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null || true)

if [ -n "$SCAN_JWT" ]; then
  echo "Scanner authenticated as $SCAN_EMAIL"
else
  echo "[warn] Could not authenticate scanner — nuclei/ZAP will run unauthenticated"
  echo "       Run ./scripts/seed-scan-user.sh to create the scan account"
fi

echo "======================================"
echo " PRISM Security Scan — $SCAN_DATE"
echo "======================================"

# ── Trivy: filesystem ──────────────────────────────────────────────────────
echo ""
echo "--- Trivy: filesystem (secrets + CVEs) ---"
docker run --rm \
  -v "$SCRIPT_DIR:/work:ro" \
  -v "$REPORT_DIR:/reports" \
  -v "$HOME/.cache/trivy:/root/.cache/trivy" \
  "$TRIVY_IMAGE" fs /work \
  --scanners vuln,secret \
  --severity CRITICAL,HIGH \
  --skip-dirs node_modules,web/node_modules,api/node_modules,.claude,.scan-reports \
  --skip-files .env,.env.local,.env.production,.env.example \
  --exit-code 0 \
  --format json \
  -o /reports/trivy-fs.json

docker run --rm \
  -v "$SCRIPT_DIR:/work:ro" \
  -v "$HOME/.cache/trivy:/root/.cache/trivy" \
  "$TRIVY_IMAGE" fs /work \
  --scanners vuln,secret \
  --severity CRITICAL,HIGH \
  --skip-dirs node_modules,web/node_modules,api/node_modules,.claude,.scan-reports \
  --skip-files .env,.env.local,.env.production,.env.example \
  --exit-code 0 \
  --format table || true

COUNT=$(python3 -c "
import json
try:
    d = json.load(open('$REPORT_DIR/trivy-fs.json'))
    n = sum(len(r.get('Vulnerabilities') or []) + len(r.get('Secrets') or []) for r in d.get('Results', []))
    print(n)
except: print(0)
" 2>/dev/null)
[ "$COUNT" -gt 0 ] && FINDINGS=1
dojo_import "$REPORT_DIR/trivy-fs.json" "Trivy Scan"

# ── Trivy: Docker images ───────────────────────────────────────────────────
echo ""
echo "--- Building Docker images ---"
docker compose build api web

API_IMAGE="prism-api:latest"
WEB_IMAGE="prism-web:latest"

echo ""
echo "--- Trivy: API image ---"
# Image scanning needs the Docker socket so trivy can read the local image
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$REPORT_DIR:/reports" \
  -v "$HOME/.cache/trivy:/root/.cache/trivy" \
  -v "$SCRIPT_DIR/.trivyignore:/etc/trivy/.trivyignore:ro" \
  "$TRIVY_IMAGE" image "$API_IMAGE" \
  --ignorefile /etc/trivy/.trivyignore \
  --severity CRITICAL,HIGH \
  --ignore-unfixed \
  --exit-code 0 \
  --format json \
  -o /reports/trivy-api.json

docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.cache/trivy:/root/.cache/trivy" \
  -v "$SCRIPT_DIR/.trivyignore:/etc/trivy/.trivyignore:ro" \
  "$TRIVY_IMAGE" image "$API_IMAGE" \
  --ignorefile /etc/trivy/.trivyignore \
  --severity CRITICAL,HIGH \
  --ignore-unfixed \
  --exit-code 0 \
  --format table || true
dojo_import "$REPORT_DIR/trivy-api.json" "Trivy Scan"

echo ""
echo "--- Trivy: Web image ---"
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$REPORT_DIR:/reports" \
  -v "$HOME/.cache/trivy:/root/.cache/trivy" \
  -v "$SCRIPT_DIR/.trivyignore:/etc/trivy/.trivyignore:ro" \
  "$TRIVY_IMAGE" image "$WEB_IMAGE" \
  --ignorefile /etc/trivy/.trivyignore \
  --severity CRITICAL,HIGH \
  --ignore-unfixed \
  --exit-code 0 \
  --format json \
  -o /reports/trivy-web.json

docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.cache/trivy:/root/.cache/trivy" \
  -v "$SCRIPT_DIR/.trivyignore:/etc/trivy/.trivyignore:ro" \
  "$TRIVY_IMAGE" image "$WEB_IMAGE" \
  --ignorefile /etc/trivy/.trivyignore \
  --severity CRITICAL,HIGH \
  --ignore-unfixed \
  --exit-code 0 \
  --format table || true
dojo_import "$REPORT_DIR/trivy-web.json" "Trivy Scan"

# ── Semgrep ────────────────────────────────────────────────────────────────
echo ""
echo "--- Semgrep ---"
docker run --rm \
  -v "$SCRIPT_DIR:/src:ro" \
  "$SEMGREP_IMAGE" \
  semgrep scan --json -o /src/.scan-reports/semgrep.json 2>/dev/null || true

docker run --rm \
  -v "$SCRIPT_DIR:/src:ro" \
  "$SEMGREP_IMAGE" \
  semgrep scan --error || FINDINGS=1

dojo_import "$REPORT_DIR/semgrep.json" "Semgrep JSON Report"

# ── Nuclei ─────────────────────────────────────────────────────────────────
echo ""
echo "--- Nuclei ---"
TARGET_URL="${PRISM_URL:-http://localhost:5173}"
NUCLEI_AUTH_ARGS=()
[ -n "$SCAN_JWT" ] && NUCLEI_AUTH_ARGS=(-H "Authorization: Bearer $SCAN_JWT")

docker run --rm --network host \
  -v "$REPORT_DIR:/reports" \
  "$NUCLEI_IMAGE" \
  -u "$TARGET_URL" \
  -severity critical,high \
  -j -o /reports/nuclei.json \
  "${NUCLEI_AUTH_ARGS[@]}" \
  -silent || true
dojo_import "$REPORT_DIR/nuclei.json" "Nuclei Scan"

# ── ZAP ───────────────────────────────────────────────────────────────────
echo ""
echo "--- OWASP ZAP ($ZAP_MODE) ---"
ZAP_TARGET="${PRISM_API_URL:-http://localhost:4000}"
if docker image inspect "$ZAP_IMAGE" &>/dev/null; then
  # Build ZAP args — inject JWT via replacer addon so authenticated endpoints are scanned
  ZAP_AUTH=""
  if [ -n "$SCAN_JWT" ]; then
    ZAP_AUTH="-config replacer.full_list(0).description=jwt -config replacer.full_list(0).enabled=true -config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstring=Authorization -config replacer.full_list(0).replacement=Bearer\\ ${SCAN_JWT}"
  fi

  if [ "$ZAP_MODE" = "full" ]; then
    echo "  [FULL SCAN] Active attack against $ZAP_TARGET — sends real payloads, do not run on production"
    ZAP_SCRIPT="zap-full-scan.py"
  else
    echo "  [BASELINE] Passive scan against $ZAP_TARGET"
    ZAP_SCRIPT="zap-baseline.py"
  fi

  ZAP_ARGS=("$ZAP_SCRIPT" -t "$ZAP_TARGET" -x zap.xml -I)
  [ -n "$ZAP_AUTH" ] && ZAP_ARGS+=(-z "$ZAP_AUTH")

  docker run --rm --network host \
    -v "$REPORT_DIR:/zap/wrk/:rw" \
    "$ZAP_IMAGE" \
    "${ZAP_ARGS[@]}" || true
  dojo_import "$REPORT_DIR/zap.xml" "ZAP Scan"
else
  echo "  [pulling ZAP image — run again once complete]"
  docker pull "$ZAP_IMAGE" &
fi

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "======================================"
echo " Scans complete."
[ -n "$DOJO_TOKEN" ] && echo " Results uploaded → $DOJO_URL"
echo "======================================"

[ "$FINDINGS" -eq 0 ] || exit 1
