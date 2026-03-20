import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { checkKeyVaultAccess } from '../keyVault.js';

export const internalRouter = Router();

const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

const requireAdminKey = (provided: string | undefined) => {
  if (!config.internal.adminApiKey) {
    return { ok: false, reason: 'ADMIN_API_KEY is not configured.' };
  }

  if (!provided || !safeEqual(provided, config.internal.adminApiKey)) {
    return { ok: false, reason: 'Invalid admin key.' };
  }

  return { ok: true };
};

internalRouter.get('/keyvault/health', async (req, res) => {
  const auth = requireAdminKey(req.header('x-admin-key'));
  if (!auth.ok) {
    res.status(401).json({ error: auth.reason });
    return;
  }

  const probeSecretName = req.query.secret as string | undefined;
  const result = await checkKeyVaultAccess(
    probeSecretName || config.zoho.keyVaultAccessTokenSecretName,
  );

  res.status(result.canAccess ? 200 : 500).json({
    keyVaultEnabled: result.enabled,
    canAccess: result.canAccess,
    probeSecretName: probeSecretName || config.zoho.keyVaultAccessTokenSecretName,
    foundProbeSecret: result.foundProbeSecret,
    detail: result.detail,
  });
});
