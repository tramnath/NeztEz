# NeztEz Zoho Sign API Backend

This backend is designed for secure Zoho Sign integration from the mobile inspection app.

## What this backend does
- Hosts a Node.js API on Azure App Service.
- Exposes health endpoint.
- Builds Zoho OAuth authorize URL.
- Handles OAuth callback token exchange and stores tokens in Key Vault when configured.
- Proxies Zoho Sign request creation and attempts access-token refresh on 401.
- Verifies Zoho webhook signatures using an HMAC shared secret.

## Local run
1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:
   - `npm install`
3. Start in dev mode:
   - `npm run dev`

## Endpoints
- `GET /health`
- `GET /internal/keyvault/health` (requires `x-admin-key` header)
- `GET /zoho/oauth/url`
- `GET /zoho/oauth/callback?code=...`
- `POST /zoho/sign/requests`
- `POST /zoho/webhooks/sign`

## Token storage behavior
- If `AZURE_KEY_VAULT_URL` is set, Zoho tokens are written/read from Key Vault.
- If Key Vault is not configured, API falls back to `ZOHO_ACCESS_TOKEN` for request creation.

## Webhook verification
- Configure `ZOHO_WEBHOOK_SECRET` and `ZOHO_WEBHOOK_SIGNATURE_HEADER`.
- The endpoint validates `HMAC-SHA256(raw-body)` using the shared secret.

## Bootstrap Key Vault secrets
1. Export required values in your terminal (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, etc.)
2. Run:
   - `bash scripts/bootstrap-keyvault-secrets.sh <key-vault-name> [resource-group]`

## Key Vault connectivity check
Call this endpoint with admin key:
- `GET /internal/keyvault/health`
- Header: `x-admin-key: <ADMIN_API_KEY>`

## Azure resources (from infra)
- App Service (Node 24 LTS)
- App Service Plan (Linux B1)
- Key Vault (RBAC)
- Application Insights + Log Analytics
- Storage account with private containers:
  - `inspection-pdfs`
  - `original-photos`

## Next hardening tasks
- Persist Zoho refresh/access tokens in Key Vault.
- Add webhook signature validation + idempotency.
- Add auth for mobile app to backend.
- Add document upload endpoint and signed URL workflow for blobs.
