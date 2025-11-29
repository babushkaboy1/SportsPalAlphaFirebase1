import 'dotenv/config';

export default ({ config }: { config: any }) => ({
  ...config,
  name: "SportsPal",
  slug: "SportsPal4",
  owner: "sportspal",
  scheme: "sportspal", // 👈 Add this line
  version: "1.0.6",
  orientation: "portrait",
  // Updated app icon to new turquoise orb asset
  icon: "./assets/app-icon.png",
  userInterfaceStyle: "dark",
  newArchEnabled: true,
  // Root level backgroundColor prevents white flash
  backgroundColor: "#000000",
  // Splash screen shown during app launch
  splash: {
    image: "./assets/splash-logo.png",
    resizeMode: "contain",
    backgroundColor: "#000000"
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.sportspal",
    associatedDomains: ["applinks:sportspal-1b468.web.app"],
    // iOS splash configuration - ensures splash shows immediately, not app icon
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#000000",
      tabletImage: "./assets/splash-icon.png",
      // Prevent white/colored background flash
      dark: {
        image: "./assets/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#000000",
        tabletImage: "./assets/splash-icon.png"
      }
    },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // Prevent app icon flash before splash screen
      UILaunchStoryboardName: "",
      // Ensure splash screen loads immediately without showing app icon
      UILaunchScreen: {
        UIColorName: "SplashScreenBackground",
        UIImageName: "SplashScreenLogo",
        UIImageRespectsSafeAreaInsets: false
      },
      NSCameraUsageDescription: "This app uses the camera to allow you to take and upload profile pictures and share photos with friends.",
      NSPhotoLibraryUsageDescription: "This app needs access to your photo library to let you select and upload images for your profile, activities, and to share with other users.",
      NSPhotoLibraryAddUsageDescription: "This app needs access to save images to your photo library.",
      NSLocationWhenInUseUsageDescription: "This app uses your location to show nearby sports events and friends.",
      NSCalendarsUsageDescription: "This app needs access to your calendar to add and manage sports events.",
      NSMicrophoneUsageDescription: "This app uses the microphone for recording audio messages and calls.",
      NSUserNotificationsUsageDescription: "This app sends you notifications about new messages, activity invites, friend requests, and upcoming sports events so you never miss out.",
      // Handle push notifications in the background (remote notifications)
      UIBackgroundModes: ["remote-notification"]
    }
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#000000" // Changed from #ffffff to match splash screen
    },
    // Android splash configuration - shows immediately on launch
    splash: {
      image: "./assets/splash-logo.png",
      resizeMode: "contain",
      backgroundColor: "#000000",
      // Dark mode variant to prevent flash
      dark: {
        image: "./assets/splash-logo.png",
        resizeMode: "contain",
        backgroundColor: "#000000"
      }
    },
    edgeToEdgeEnabled: true,
    package: "com.sportspal.app",
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "https",
            host: "sportspal-1b468.web.app",
            pathPrefix: "/activity"
          },
          {
            scheme: "https",
            host: "sportspal-1b468.web.app",
            pathPrefix: "/profile"
          },
          {
            scheme: "https",
            host: "sportspal-1b468.web.app",
            pathPrefix: "/chat"
          }
        ],
        category: ["BROWSABLE", "DEFAULT"]
      }
    ],
    permissions: [
      // Notifications
      "POST_NOTIFICATIONS",
      // Location for nearby games
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      // Media capture
      "CAMERA",
      "RECORD_AUDIO",
      // Media library (Android 13+ granular permissions for picking/saving)
      "READ_MEDIA_IMAGES",
      "READ_MEDIA_VIDEO",
      // Legacy fallback for Android 12 and below
      "READ_EXTERNAL_STORAGE",
      // Allow writing for saving images
      "WRITE_EXTERNAL_STORAGE"
    ],
    softwareKeyboardLayoutMode: "resize",
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY
      }
    }
  },
  // Ensure status bar is not translucent so layout resizing behaves as expected on Android
  androidStatusBar: { translucent: false },
  web: {
    favicon: "./assets/favicon.png"
  },
  // Bundle and experiments for performance
  assetBundlePatterns: ["**/*"],
  experiments: {
    tsconfigPaths: true
  },
  plugins: [
    "expo-font",
    "expo-audio",
    "expo-asset",
    "expo-dev-client",
    [
      "expo-notifications",
      {
        "icon": "./assets/notification-icon.png",
        "color": "#1ae9ef",
        "sounds": []
      }
    ]
  ],
  extra: {
    eas: {
      projectId: "c08f930c-531d-4919-ad9b-e99408d8edad"
    }
  },
  updates: {
    url: "https://u.expo.dev/c08f930c-531d-4919-ad9b-e99408d8edad"
  },
  runtimeVersion: {
    policy: "appVersion"
  }
});
