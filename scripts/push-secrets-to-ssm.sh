#!/usr/bin/env bash
# One-time script: pushes your local .env values to AWS SSM Parameter Store.
# Run this from your local machine (needs AWS CLI configured with admin rights).
# After this, the server only needs an IAM role — no .env file on the server.
#
# Usage:
#   ./scripts/push-secrets-to-ssm.sh              # uses /prism/prod/ prefix
#   SSM_PATH=/prism/staging/ ./scripts/push-secrets-to-ssm.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
SSM_PATH="${SSM_PATH:-/prism/prod/}"
REGION="${AWS_REGION:-eu-north-1}"

# These are not stored in SSM:
#   - AWS credentials → provided by IAM role on the server
#   - VITE_* → frontend build vars, not runtime secrets
#   - Local-only overrides
SKIP_VARS="AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|VITE_API_URL|DOJO_TOKEN|DOJO_URL|SCAN_USER_EMAIL|SCAN_USER_PASSWORD"

echo "Pushing secrets to SSM path: $SSM_PATH (region: $REGION)"
echo ""

while IFS= read -r line || [ -n "$line" ]; do
  # Skip blank lines and comments
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  [[ "$line" =~ ^# ]]            && continue

  KEY="${line%%=*}"
  VAL="${line#*=}"

  # Skip vars that shouldn't be in SSM
  if echo "$KEY" | grep -qE "^($SKIP_VARS)$"; then
    echo "  [skip] $KEY"
    continue
  fi

  echo "  Pushing $KEY ..."
  aws ssm put-parameter \
    --region "$REGION" \
    --name "${SSM_PATH}${KEY}" \
    --value "$VAL" \
    --type SecureString \
    --overwrite \
    --no-cli-pager \
    > /dev/null

done < "$ENV_FILE"

echo ""
echo "Done. Parameters are at: $SSM_PATH"
echo "Verify with:"
echo "  aws ssm get-parameters-by-path --path $SSM_PATH --with-decryption --region $REGION"
