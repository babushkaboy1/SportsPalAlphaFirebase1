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
    bundleIdentifier: "com.sportspal",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: "This app uses the camera to allow you to take and upload profile pictures and share photos with friends.",
      NSPhotoLibraryUsageDescription: "This app needs access to your photo library to let you select and upload images.",
      NSPhotoLibraryAddUsageDescription: "This app needs access to save images to your photo library.",
      NSLocationWhenInUseUsageDescription: "This app uses your location to show nearby sports events and friends.",
      NSCalendarsUsageDescription: "This app needs access to your calendar to add and manage sports events.",
      NSMicrophoneUsageDescription: "This app uses the microphone for recording audio messages and calls."
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
