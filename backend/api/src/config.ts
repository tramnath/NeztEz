import 'dotenv/config';

const required = (value: string | undefined, name: string) => {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  admin: {
    dataFilePath: process.env.ADMIN_DATA_FILE_PATH || './data/admin-db.json',
    sessionTtlHours: Number(process.env.ADMIN_SESSION_TTL_HOURS || 168),
  },
  internal: {
    adminApiKey: process.env.ADMIN_API_KEY || '',
  },
  azure: {
    keyVaultUrl: process.env.AZURE_KEY_VAULT_URL || '',
  },
  zoho: {
    clientId: process.env.ZOHO_CLIENT_ID || '',
    clientSecret: process.env.ZOHO_CLIENT_SECRET || '',
    redirectUri: process.env.ZOHO_REDIRECT_URI || '',
    accountsBaseUrl: process.env.ZOHO_ACCOUNTS_BASE_URL || 'https://accounts.zoho.com',
    signApiBaseUrl: process.env.ZOHO_SIGN_API_BASE_URL || 'https://sign.zoho.com/api/v1',
    scopes: process.env.ZOHO_SCOPES || 'ZohoSign.documents.ALL',
    accessToken: process.env.ZOHO_ACCESS_TOKEN || '',
    keyVaultAccessTokenSecretName:
      process.env.ZOHO_KV_ACCESS_TOKEN_SECRET_NAME || 'zoho-sign-access-token',
    keyVaultRefreshTokenSecretName:
      process.env.ZOHO_KV_REFRESH_TOKEN_SECRET_NAME || 'zoho-sign-refresh-token',
    keyVaultExpirySecretName:
      process.env.ZOHO_KV_ACCESS_TOKEN_EXPIRY_SECRET_NAME || 'zoho-sign-access-token-expiry',
    webhookSecret: process.env.ZOHO_WEBHOOK_SECRET || '',
    webhookSignatureHeader: process.env.ZOHO_WEBHOOK_SIGNATURE_HEADER || 'x-zs-signature',
  },
};

export const requireZohoOauthConfig = () => {
  required(config.zoho.clientId, 'ZOHO_CLIENT_ID');
  required(config.zoho.redirectUri, 'ZOHO_REDIRECT_URI');
};

export const requireZohoApiConfig = () => {
  required(config.zoho.signApiBaseUrl, 'ZOHO_SIGN_API_BASE_URL');
};
