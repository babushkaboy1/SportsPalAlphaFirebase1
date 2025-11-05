# Environment and secrets workflow (Expo + EAS)

We keep API keys and secrets out of Git. The app reads them from a local `.env.local` generated at build time from environment variables.

## Files and tooling

- `.gitignore` ignores `.env`, `.env.local`, and all `.env.*` variants.
- Babel loads environment values from `.env.local` via `react-native-dotenv` (see `babel.config.js`).
- `scripts/generate-env.js` writes `.env.local` using values from the process environment.
- `eas-build-pre-install` hook runs `node scripts/generate-env.js` on EAS builds to ensure `.env.local` exists.

## Required variables

The script expects these variables to be present:

- FIREBASE_API_KEY
- FIREBASE_AUTH_DOMAIN
- FIREBASE_PROJECT_ID
- FIREBASE_STORAGE_BUCKET
- FIREBASE_MESSAGING_SENDER_ID
- FIREBASE_APP_ID_WEB
- FIREBASE_APP_ID_IOS
- FIREBASE_APP_ID_ANDROID
- FIREBASE_MEASUREMENT_ID
- GOOGLE_MAPS_API_KEY

### Google OAuth client IDs (recommended)

To avoid Google sign-in "invalid credential / audience mismatch" errors, set platform-specific client IDs and link them in your Google Cloud Console and Firebase Auth provider:

- GOOGLE_ANDROID_CLIENT_ID
- GOOGLE_IOS_CLIENT_ID
- GOOGLE_WEB_CLIENT_ID

These are included in the build if present. For production TestFlight builds, you should set them.

## Setting secrets in Expo (Terminal)

Use the EAS CLI to create project-level secrets that your builds can read. Replace the example values with your real secrets.

```powershell
# Login (if needed)
npx expo login

# Initialize EAS if not already
npx eas login
npx eas whoami

# Set secrets (repeat per key)
npx eas secret:create --scope project --name FIREBASE_API_KEY --value "<your-api-key>"
npx eas secret:create --scope project --name FIREBASE_AUTH_DOMAIN --value "<your-auth-domain>"
npx eas secret:create --scope project --name FIREBASE_PROJECT_ID --value "<your-project-id>"
npx eas secret:create --scope project --name FIREBASE_STORAGE_BUCKET --value "<your-storage-bucket>"
npx eas secret:create --scope project --name FIREBASE_MESSAGING_SENDER_ID --value "<your-sender-id>"
npx eas secret:create --scope project --name FIREBASE_APP_ID_WEB --value "<your-web-app-id>"
npx eas secret:create --scope project --name FIREBASE_APP_ID_IOS --value "<your-ios-app-id>"
npx eas secret:create --scope project --name FIREBASE_APP_ID_ANDROID --value "<your-android-app-id>"
npx eas secret:create --scope project --name FIREBASE_MEASUREMENT_ID --value "<your-measurement-id>"
npx eas secret:create --scope project --name GOOGLE_MAPS_API_KEY --value "<your-maps-key>"

# Google OAuth client IDs (recommended)
npx eas secret:create --scope project --name GOOGLE_ANDROID_CLIENT_ID --value "<your-android-client-id>"
npx eas secret:create --scope project --name GOOGLE_IOS_CLIENT_ID --value "<your-ios-client-id>"
npx eas secret:create --scope project --name GOOGLE_WEB_CLIENT_ID --value "<your-web-client-id>"

# List secrets
npx eas secret:list
```

Locally, you can either set these in your PowerShell session before starting the app or create a `.env.local` manually for development (it is gitignored):

```powershell
# Example (temporary for this session only)
$env:FIREBASE_API_KEY = "..."; $env:GOOGLE_MAPS_API_KEY = "..."
# Generate .env.local from current env
npm run generate-env
```

## Building for TestFlight

For production TestFlight builds we recommend EAS Build, and then submitting to App Store Connect.

```powershell
# iOS Dev Client (optional for testing push/SDK behavior)
npx eas build -p ios --profile development

# iOS Production build for TestFlight
npx eas build -p ios --profile production

# Submit build (after it completes)
npx eas submit -p ios
```

Tips:
- Make sure your `bundleIdentifier` in `app.config.ts` matches your App ID in Apple Developer.
- Ensure Push Notifications capability is enabled for the app ID and APNs key/cert is configured in Expo if needed.
- Facebook, Google, and Apple auth redirect URIs must be configured in their respective consoles.
