# App permissions and why we need them

This app uses a small set of platform permissions to enable core features like chat media, activity discovery, and notifications. Below is a concise breakdown for reviewers and for our own auditing.

## iOS

- NSCameraUsageDescription
  - Why: Let users take a profile photo or attach photos to chats.
- NSPhotoLibraryUsageDescription
  - Why: Select existing photos to attach or set as profile.
- NSPhotoLibraryAddUsageDescription
  - Why: Save processed images back to the library (e.g., edited/cropped profile images).
- NSMicrophoneUsageDescription
  - Why: Capture audio for voice notes (if used) or in-app calls.
- NSLocationWhenInUseUsageDescription
  - Why: Show nearby activities and allow location-based discovery.
- NSCalendarsUsageDescription
  - Why: Add created activities to the user’s calendar (optional feature).
- UIBackgroundModes: ["remote-notification"]
  - Why: Deliver and handle remote notifications reliably; e.g., message notifications while app is backgrounded.

Notes:
- File selection via DocumentPicker does not require an additional Info.plist key.
- We do not request always-on or background location. If added in the future, we’ll include NSLocationAlwaysAndWhenInUseUsageDescription.

## Android

Manifest permissions are declared in `app.config.ts` and merged into the Android manifest by Expo.

- POST_NOTIFICATIONS
  - Why: Show message and activity notifications.
- ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION
  - Why: Nearby discovery and map features.
- CAMERA
  - Why: Capture profile photos or chat attachments.
- RECORD_AUDIO
  - Why: Voice notes or calls.
- READ_MEDIA_IMAGES, READ_MEDIA_VIDEO (Android 13+)
  - Why: Allow selecting media from the gallery without broad storage access.
- READ_EXTERNAL_STORAGE (Android 12 and below)
  - Why: Legacy fallback to access user-selected photos/videos in older Android versions.

Notes:
- We don’t request WRITE_EXTERNAL_STORAGE or MANAGE_EXTERNAL_STORAGE.
- Document picker access works without extra permissions; if a system provider is used, the user's selection grants scoped access.

## Where this is configured

- iOS permission usage strings: `app.config.ts > ios.infoPlist`
- Android permissions: `app.config.ts > android.permissions`

If you add a new feature that needs a permission, please:
1) Add it to `app.config.ts` with a clear usage description (iOS) and only the minimal Android permission.
2) Update this file.
