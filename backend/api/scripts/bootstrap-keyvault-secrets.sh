#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <key-vault-name> [resource-group]"
  exit 1
fi

KEY_VAULT_NAME="$1"
RESOURCE_GROUP="${2:-}"

required_env=(
  ZOHO_CLIENT_ID
  ZOHO_CLIENT_SECRET
  ZOHO_REDIRECT_URI
  ZOHO_ACCOUNTS_BASE_URL
  ZOHO_SIGN_API_BASE_URL
  ZOHO_SCOPES
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing env var: $name"
    exit 1
  fi
done

set_secret() {
  local secret_name="$1"
  local value="$2"

  if [[ -n "$RESOURCE_GROUP" ]]; then
    az keyvault secret set \
      --vault-name "$KEY_VAULT_NAME" \
      --name "$secret_name" \
      --value "$value" \
      --resource-group "$RESOURCE_GROUP" \
      --output none
  else
    az keyvault secret set \
      --vault-name "$KEY_VAULT_NAME" \
      --name "$secret_name" \
      --value "$value" \
      --output none
  fi
}

echo "Bootstrapping Key Vault secrets in $KEY_VAULT_NAME"
set_secret "zoho-client-id" "$ZOHO_CLIENT_ID"
set_secret "zoho-client-secret" "$ZOHO_CLIENT_SECRET"
set_secret "zoho-redirect-uri" "$ZOHO_REDIRECT_URI"
set_secret "zoho-accounts-base-url" "$ZOHO_ACCOUNTS_BASE_URL"
set_secret "zoho-sign-api-base-url" "$ZOHO_SIGN_API_BASE_URL"
set_secret "zoho-scopes" "$ZOHO_SCOPES"

if [[ -n "${ZOHO_REFRESH_TOKEN:-}" ]]; then
  set_secret "zoho-sign-refresh-token" "$ZOHO_REFRESH_TOKEN"
fi

if [[ -n "${ZOHO_ACCESS_TOKEN:-}" ]]; then
  set_secret "zoho-sign-access-token" "$ZOHO_ACCESS_TOKEN"
fi

echo "Done. Secrets were set successfully."
