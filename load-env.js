/**
 * load-env.js
 *
 * This file MUST be imported first in app.js.
 * It loads the .env file (if it exists) into process.env BEFORE
 * the React Router build/Prisma client is initialized.
 *
 * In production (cPanel), environment variables may not be injected
 * before module initialization, so we read them from .env explicitly.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
  console.log('[load-env] Loaded environment from .env file');
} else {
  console.log('[load-env] No .env file found, using process environment');
}
