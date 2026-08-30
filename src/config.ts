import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  BASE_URL: z.string().url().default('http://localhost:8787'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  SETUP_TOKEN: z.string().min(24),
  MCP_ACCESS_TOKEN: z.string().optional().default(''),
  YOUTUBE_MODE: z.enum(['readonly', 'manager']).default('readonly'),
  MUTATIONS_ENABLED: z.string().default('false').transform(v => v === 'true'),
  DATA_DIR: z.string().default('./data'),
  UPLOAD_ROOT: z.string().default('./uploads'),
  LOG_LEVEL: z.string().default('info')
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(env);
  const key = Buffer.from(parsed.TOKEN_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return {
    ...parsed,
    encryptionKey: key,
    dataDir: path.resolve(parsed.DATA_DIR),
    uploadRoot: path.resolve(parsed.UPLOAD_ROOT),
    googleRedirectUri: `${parsed.BASE_URL.replace(/\/$/, '')}/auth/google/callback`
  };
}
