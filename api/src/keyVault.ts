import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { config } from './config.js';

let client: SecretClient | null = null;

const getClient = () => {
  if (!config.azure.keyVaultUrl) {
    return null;
  }

  if (!client) {
    client = new SecretClient(config.azure.keyVaultUrl, new DefaultAzureCredential());
  }

  return client;
};

export const isKeyVaultEnabled = () => Boolean(config.azure.keyVaultUrl);

export const getSecretValue = async (secretName: string) => {
  const kvClient = getClient();
  if (!kvClient) {
    return null;
  }

  try {
    const secret = await kvClient.getSecret(secretName);
    return secret.value || null;
  } catch {
    return null;
  }
};

export const setSecretValue = async (secretName: string, value: string) => {
  const kvClient = getClient();
  if (!kvClient) {
    return;
  }

  await kvClient.setSecret(secretName, value);
};

export const checkKeyVaultAccess = async (probeSecretName: string) => {
  const kvClient = getClient();
  if (!kvClient) {
    return {
      enabled: false,
      canAccess: false,
      foundProbeSecret: false,
      detail: 'AZURE_KEY_VAULT_URL is not configured.',
    };
  }

  try {
    const secret = await kvClient.getSecret(probeSecretName);
    return {
      enabled: true,
      canAccess: true,
      foundProbeSecret: Boolean(secret.value),
      detail: 'Key Vault access succeeded.',
    };
  } catch (error) {
    return {
      enabled: true,
      canAccess: false,
      foundProbeSecret: false,
      detail: error instanceof Error ? error.message : 'Failed to access Key Vault.',
    };
  }
};
