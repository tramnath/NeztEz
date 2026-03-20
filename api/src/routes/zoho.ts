import axios from 'axios';
import crypto from 'node:crypto';
import { Request, Response, Router } from 'express';
import { config, requireZohoApiConfig, requireZohoOauthConfig } from '../config.js';
import { getSecretValue, isKeyVaultEnabled, setSecretValue } from '../keyVault.js';

export const zohoRouter = Router();

const upsertZohoTokenSecrets = async (tokens: {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}) => {
  if (!isKeyVaultEnabled()) {
    return;
  }

  if (tokens.accessToken) {
    await setSecretValue(config.zoho.keyVaultAccessTokenSecretName, tokens.accessToken);
  }

  if (tokens.refreshToken) {
    await setSecretValue(config.zoho.keyVaultRefreshTokenSecretName, tokens.refreshToken);
  }

  if (tokens.expiresAt) {
    await setSecretValue(config.zoho.keyVaultExpirySecretName, tokens.expiresAt);
  }
};

const getZohoAccessToken = async () => {
  if (isKeyVaultEnabled()) {
    const kvToken = await getSecretValue(config.zoho.keyVaultAccessTokenSecretName);
    if (kvToken) {
      return kvToken;
    }
  }

  return config.zoho.accessToken || null;
};

const refreshZohoAccessToken = async () => {
  const refreshToken = isKeyVaultEnabled()
    ? await getSecretValue(config.zoho.keyVaultRefreshTokenSecretName)
    : null;

  if (!refreshToken) {
    return null;
  }

  const response = await axios.post(
    `${config.zoho.accountsBaseUrl}/oauth/v2/token`,
    null,
    {
      params: {
        grant_type: 'refresh_token',
        client_id: config.zoho.clientId,
        client_secret: config.zoho.clientSecret,
        refresh_token: refreshToken,
      },
    },
  );

  const accessToken = response.data?.access_token as string | undefined;
  const expiresIn = Number(response.data?.expires_in || 0);

  if (!accessToken) {
    return null;
  }

  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined;
  await upsertZohoTokenSecrets({ accessToken, expiresAt });
  return accessToken;
};

zohoRouter.get('/oauth/url', (_req, res) => {
  try {
    requireZohoOauthConfig();

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.zoho.clientId,
      redirect_uri: config.zoho.redirectUri,
      scope: config.zoho.scopes,
      access_type: 'offline',
      prompt: 'consent',
    });

    const authorizeUrl = `${config.zoho.accountsBaseUrl}/oauth/v2/auth?${params.toString()}`;
    res.status(200).json({ authorizeUrl });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

zohoRouter.get('/oauth/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).json({ error: 'Missing OAuth code' });
    return;
  }

  if (!config.zoho.clientId || !config.zoho.clientSecret || !config.zoho.redirectUri) {
    res.status(400).json({
      error: 'Missing ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REDIRECT_URI',
    });
    return;
  }

  try {
    const tokenResponse = await axios.post(
      `${config.zoho.accountsBaseUrl}/oauth/v2/token`,
      null,
      {
        params: {
          grant_type: 'authorization_code',
          client_id: config.zoho.clientId,
          client_secret: config.zoho.clientSecret,
          redirect_uri: config.zoho.redirectUri,
          code,
        },
      },
    );

    const accessToken = tokenResponse.data?.access_token as string | undefined;
    const refreshToken = tokenResponse.data?.refresh_token as string | undefined;
    const expiresIn = Number(tokenResponse.data?.expires_in || 0);
    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined;

    await upsertZohoTokenSecrets({ accessToken, refreshToken, expiresAt });

    res.status(200).json({
      message: isKeyVaultEnabled()
        ? 'OAuth token exchange successful. Tokens stored in Key Vault.'
        : 'OAuth token exchange successful. Configure Key Vault to store tokens securely.',
      tokenMetadata: {
        hasAccessToken: Boolean(accessToken),
        hasRefreshToken: Boolean(refreshToken),
        expiresAt,
        keyVaultEnabled: isKeyVaultEnabled(),
      },
    });
  } catch (error) {
    const details = axios.isAxiosError(error) ? error.response?.data : undefined;
    res.status(500).json({ error: 'Zoho token exchange failed', details });
  }
});

zohoRouter.post('/sign/requests', async (req, res) => {
  try {
    requireZohoApiConfig();

    let accessToken = await getZohoAccessToken();
    if (!accessToken) {
      res.status(400).json({
        error: 'No Zoho access token available. Complete OAuth callback or set ZOHO_ACCESS_TOKEN.',
      });
      return;
    }

    let response;

    try {
      response = await axios.post(
        `${config.zoho.signApiBaseUrl}/requests`,
        req.body,
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (statusCode !== 401) {
        throw error;
      }

      const refreshedAccessToken = await refreshZohoAccessToken();
      if (!refreshedAccessToken) {
        throw error;
      }

      accessToken = refreshedAccessToken;
      response = await axios.post(
        `${config.zoho.signApiBaseUrl}/requests`,
        req.body,
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    res.status(200).json(response.data);
  } catch (error) {
    const details = axios.isAxiosError(error) ? error.response?.data : undefined;
    res.status(500).json({ error: 'Zoho Sign request creation failed', details });
  }
});

export const zohoWebhookHandler = (req: Request, res: Response) => {
  const headerName = config.zoho.webhookSignatureHeader.toLowerCase();
  const signature = req.header(headerName) || req.header('x-zoho-signature') || '';

  if (!config.zoho.webhookSecret) {
    res.status(500).json({ error: 'Webhook secret is not configured.' });
    return;
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const expected = crypto
    .createHmac('sha256', config.zoho.webhookSecret)
    .update(rawBody)
    .digest('hex');

  const normalizedSignature = signature.replace(/^sha256=/i, '').trim();
  const isMatch =
    normalizedSignature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(normalizedSignature), Buffer.from(expected));

  if (!isMatch) {
    res.status(401).json({ error: 'Invalid webhook signature.' });
    return;
  }

  let payload: unknown = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = { rawBody };
  }
  console.log('Zoho webhook verified payload:', JSON.stringify(payload));
  res.status(200).json({ received: true });
};
