/**
 * load-env.js
 *
 * This file MUST be imported first in app.js.
 * It loads .env into process.env BEFORE Prisma initializes.
 * Uses stderr for logging (visible in stderr.log on cPanel/lsnode).
 * Falls back to manual parser if process.loadEnvFile is unavailable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const log = (msg) => process.stderr.write('[load-env] ' + msg + '\n');

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');

log('envPath: ' + envPath);
log('DATABASE_URL before load: ' + (process.env.DATABASE_URL || 'NOT SET'));

// --- Manual .env parser (works in all Node.js environments) ---
const loadEnvFile = (filePath) => {
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) {
      process.env[key] = val; // Force overwrite
    }
  }
};

if (existsSync(envPath)) {
  try {
    loadEnvFile(envPath);
    log('Loaded .env file successfully');
  } catch (e) {
    log('Error loading .env: ' + e.message);
  }
} else {
  log('.env file NOT found at: ' + envPath);
}

// --- Hard fallback: ensure DATABASE_URL is always set ---
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('sqlite')) {
  process.env.DATABASE_URL = 'postgresql://goeasify_om:Ambre1429@127.0.0.1:5432/goeasify_rto_db';
  log('Applied DATABASE_URL hard fallback');
}

log('DATABASE_URL after load: ' + process.env.DATABASE_URL);

