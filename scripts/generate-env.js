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
  // We accept either FIREBASE_APP_ID (single) or the platform-specific trio below
  // The trio will be synthesized from FIREBASE_APP_ID if provided solo
  'FIREBASE_MEASUREMENT_ID',
  'GOOGLE_MAPS_API_KEY',
];

function main() {
  const missing = [];
  const lines = [];

  // Backward/forwards compatibility for appId config:
  // If a single FIREBASE_APP_ID is provided (common in Expo/EAS envs),
  // populate WEB/IOS/ANDROID with that value unless already set.
  const singleAppId = process.env.FIREBASE_APP_ID;
  const env = { ...process.env };
  if (singleAppId) {
    env.FIREBASE_APP_ID_WEB = env.FIREBASE_APP_ID_WEB || singleAppId;
    env.FIREBASE_APP_ID_IOS = env.FIREBASE_APP_ID_IOS || singleAppId;
    env.FIREBASE_APP_ID_ANDROID = env.FIREBASE_APP_ID_ANDROID || singleAppId;
  }

  for (const key of REQUIRED_KEYS) {
    const value = env[key];
    if (value === undefined || value === null || String(value).length === 0) {
      missing.push(key);
    } else {
      // Escape any newlines and ensure no quotes issues
      const sanitized = String(value).replace(/\r?\n/g, '');
      lines.push(`${key}=${sanitized}`);
    }
  }

  // Always include the appId variables expected by firebaseConfig.ts
  if (!env.FIREBASE_APP_ID_WEB && !env.FIREBASE_APP_ID_IOS && !env.FIREBASE_APP_ID_ANDROID) {
    if (!singleAppId) {
      missing.push('FIREBASE_APP_ID or FIREBASE_APP_ID_WEB/IOS/ANDROID');
    }
  }
  const appIds = {
    FIREBASE_APP_ID_WEB: env.FIREBASE_APP_ID_WEB,
    FIREBASE_APP_ID_IOS: env.FIREBASE_APP_ID_IOS,
    FIREBASE_APP_ID_ANDROID: env.FIREBASE_APP_ID_ANDROID,
  };
  for (const [k, v] of Object.entries(appIds)) {
    if (v) lines.push(`${k}=${String(v).replace(/\r?\n/g, '')}`);
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
