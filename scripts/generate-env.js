/*
  Generate a .env.local file for react-native-dotenv from environment variables.
  This runs on EAS builds (via eas-build-pre-install) and can be run locally with `npm run generate-env`.
*/
const fs = require('fs');
const path = require('path');

const REQUIRED_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID_WEB',
  'FIREBASE_APP_ID_IOS',
  'FIREBASE_APP_ID_ANDROID',
  'FIREBASE_MEASUREMENT_ID',
  'GOOGLE_MAPS_API_KEY',
];

function main() {
  const missing = [];
  const lines = [];

  for (const key of REQUIRED_KEYS) {
    const value = process.env[key];
    if (value === undefined || value === null || String(value).length === 0) {
      missing.push(key);
    } else {
      // Escape any newlines and ensure no quotes issues
      const sanitized = String(value).replace(/\r?\n/g, '');
      lines.push(`${key}=${sanitized}`);
    }
  }

  if (missing.length > 0) {
    console.error('\n[generate-env] Missing required environment variables:');
    for (const k of missing) console.error(`  - ${k}`);
    console.error('\nSet them as EAS project secrets or in your local shell before running this script.');
    process.exit(1);
  }

  const envPath = path.join(__dirname, '..', '.env.local');
  const contents = lines.join('\n') + '\n';

  fs.writeFileSync(envPath, contents, { encoding: 'utf8' });
  console.log(`[generate-env] Wrote ${REQUIRED_KEYS.length} keys to ${envPath}`);
}

main();
