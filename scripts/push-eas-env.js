#!/usr/bin/env node
/**
 * Push selected keys from .env.local to EAS project environment variables.
 * - Uses `eas env:list --json` to detect existing vars
 * - Creates or updates keys as needed (project scope)
 * - Never prints secret values
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');

// Keep in sync with generate-env.js required/optional plus Google OAuth IDs
const KEYS_TO_PUSH = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_APP_ID_WEB',
  'FIREBASE_APP_ID_IOS',
  'FIREBASE_APP_ID_ANDROID',
  'FIREBASE_MEASUREMENT_ID',
  'GOOGLE_MAPS_API_KEY',
  'GOOGLE_ANDROID_CLIENT_ID',
  'GOOGLE_IOS_CLIENT_ID',
  'GOOGLE_WEB_CLIENT_ID',
];

function parseEnvFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function runEas(args, opts = {}) {
  try {
    // Build a single command string for cross-shell compatibility on Windows
    const cmd = `npx --yes eas-cli ${args.map(a => {
      if (typeof a !== 'string') return String(a);
      // minimal quoting for values; leave flags as-is
      if (a.startsWith('--')) return a;
      // escape double quotes
      const v = a.replace(/"/g, '\\"');
      return `"${v}"`;
    }).join(' ')}`;
    return execFileSync(cmd, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      ...opts,
    }).toString('utf8');
  } catch (e) {
    const msg = e?.stderr?.toString?.() || e?.message || String(e);
    throw new Error(msg);
  }
}

function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`[push-eas-env] Missing ${ENV_PATH}. Run npm run generate-env or create it manually.`);
    process.exit(1);
  }
  const envVars = parseEnvFile(ENV_PATH);
  const pairs = Object.entries(envVars).filter(([k]) => KEYS_TO_PUSH.includes(k));
  if (pairs.length === 0) {
    console.log('[push-eas-env] No relevant variables found in .env.local. Nothing to push.');
    process.exit(0);
  }

  // Get existing EAS env variables
  let existing = [];
  try {
    const json = runEas(['env:list', 'production', '--json', '--non-interactive']);
    existing = JSON.parse(json || '[]');
  } catch (e) {
    // If parsing fails or no vars, treat as empty list
    existing = [];
  }
  const existingNames = new Set(existing.map((v) => v?.name).filter(Boolean));

  let created = 0, updated = 0, skipped = 0;
  for (const [name, value] of pairs) {
    if (!value) { skipped++; continue; }
    const args = existingNames.has(name)
      ? ['env:update', 'production', '--variable-name', name, '--variable-environment', 'production', '--value', value, '--scope', 'project', '--visibility', 'secret', '--non-interactive']
      : ['env:create', 'production', '--name', name, '--value', value, '--scope', 'project', '--visibility', 'secret', '--non-interactive', '--force'];
    try {
      runEas(args);
      if (existingNames.has(name)) updated++; else created++;
      // Avoid logging secrets
      console.log(`[push-eas-env] ${existingNames.has(name) ? 'Updated' : 'Created'} ${name}`);
    } catch (err) {
      console.error(`[push-eas-env] Failed to set ${name}:`, err.message || err);
    }
  }

  console.log(`[push-eas-env] Done. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
}

main();
