import 'dotenv/config';

export default ({ config }: { config: any }) => ({
  ...config,
  name: "SportsPal",
  slug: "SportsPal4",
  scheme: "sportspal", // 👈 Add this line
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/logo.png",
  userInterfaceStyle: "dark",
  newArchEnabled: true,
  splash: {
    image: "./assets/logo.png",
    resizeMode: "contain",
    backgroundColor: "#121212"
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.thom.sportspal",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false
    }
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff"
    },
    edgeToEdgeEnabled: true,
    package: "com.sportspal.app",
    permissions: [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "CAMERA",
      "RECORD_AUDIO"
    ],
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY
      }
    }
  },
  web: {
    favicon: "./assets/favicon.png"
  },
  extra: {
    eas: {
      projectId: "c08f930c-531d-4919-ad9b-e99408d8edad"
    }
  }
});
