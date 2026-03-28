# NeztEz API Backend

This backend now supports both Zoho Sign integration and a browser-based admin workflow for inspections.

## What this backend does
- Hosts a Node.js API on Azure App Service.
- Exposes health endpoint.
- Provides admin web app + APIs for signup/login and inspection setup.
- Lets authenticated users create properties with rooms and spaces.
- Lets users create walkthroughs (`movein`, `moveout`, `routine`).
- Generates 24-hour share links and QR codes for walkthrough checklists.
- Accepts public checklist submissions and locks them permanently after first save.
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

Admin auth + setup:
- `POST /admin/auth/signup`
- `POST /admin/auth/login`
- `GET /admin/auth/me`
- `GET /admin/properties`
- `POST /admin/properties`
- `PUT /admin/properties/:propertyId`
- `GET /admin/walkthroughs`
- `POST /admin/walkthroughs`
- `POST /admin/walkthroughs/:walkthroughId/share`
- `GET /admin/walkthroughs/:walkthroughId/submissions`

Public checklist execution:
- `GET /public/checklists/:token`
- `POST /public/checklists/:token/submissions`

Web UI pages:
- `GET /admin-app`
- `GET /checklist/:token`

Zoho endpoints:
- `GET /zoho/oauth/url`
- `GET /zoho/oauth/callback?code=...`
- `POST /zoho/sign/requests`
- `POST /zoho/webhooks/sign`

## Admin web flow
1. Open `/admin-app`.
2. Create an account (email + password) or login.
3. Create properties and define rooms/spaces.
4. Create walkthrough records for a property.
5. Generate a 24h QR share link per walkthrough.
6. Shared users open `/checklist/:token`, submit once, and the response is immutable.

## Data persistence
- Admin data is stored as split JSON files under `./data` (derived from `ADMIN_DATA_FILE_PATH`).
- Auth records are in `./data/admin-auth.json`.
- Walkthrough/share/submission records are in `./data/admin-workflows.json`.
- Each property is stored in its own file under `./data/properties/<propertyId>.json`.
- If a legacy `admin-db.json` exists, it is automatically migrated on startup.
- Session lifetime is configured via `ADMIN_SESSION_TTL_HOURS`.

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
- Move admin persistence from JSON file to a managed database.
- Add email verification + password reset flow.
- Add role-based access controls per organization.
- Add immutable audit logs and digital signature on submissions.
