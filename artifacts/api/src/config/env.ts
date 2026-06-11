import 'dotenv/config';
import { z } from 'zod';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

const Schema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.string().default('development'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  TZ: z.string().default('Asia/Kolkata'),
  AUTH0_DOMAIN: z.string(),
  AUTH0_AUDIENCE: z.string(),
  SUPABASE_URL: z.string(),
  SUPABASE_SERVICE_KEY: z.string(),
  ACS_CONNECTION_STRING: z.string().default(''),
  ACS_SENDER: z.string().default(''),
  AI_SERVICE_URL: z.string().default('http://localhost:8000'),
  INTERNAL_SHARED_SECRET: z.string(),
  KEY_VAULT_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

async function hydrateFromKeyVault() {
  if (!process.env.KEY_VAULT_URL) return;
  const client = new SecretClient(process.env.KEY_VAULT_URL, new DefaultAzureCredential());
  const map: Record<string, string> = {
    'supabase-url': 'SUPABASE_URL',
    'supabase-service-key': 'SUPABASE_SERVICE_KEY',
    'auth0-domain': 'AUTH0_DOMAIN',
    'auth0-audience': 'AUTH0_AUDIENCE',
    'acs-connection-string': 'ACS_CONNECTION_STRING',
    'acs-sender-address': 'ACS_SENDER',
    'internal-shared-secret': 'INTERNAL_SHARED_SECRET',
    'sentry-dsn': 'SENTRY_DSN',
  };
  for (const [name, envKey] of Object.entries(map)) {
    try {
      const s = await client.getSecret(name);
      if (s.value) process.env[envKey] = s.value;
    } catch { /* secret not present — skip */ }
  }
}

await hydrateFromKeyVault();
export const env = Schema.parse(process.env);
