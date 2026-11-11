import pg from 'pg';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

// npm sets npm_config_local_prefix to the root of the workspace where npm was invoked.
// Fall back to walking up from cwd if the env var isn't set (e.g. running directly).
const root = process.env['npm_config_local_prefix'] ?? resolve(process.cwd(), '..', '..');
dotenv.config({ path: resolve(root, '.env') });

const { Pool } = pg;

if (!process.env['DATABASE_URL']) {
  throw new Error(
    'DATABASE_URL environment variable is not set. Copy .env.example to .env in the repo root.',
  );
}

export const db = new Pool({
  connectionString: process.env['DATABASE_URL'],
});
