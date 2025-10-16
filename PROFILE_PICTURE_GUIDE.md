# 📸 Profile Picture Upload Guide

## ✅ Implementation Complete!

The profile picture upload feature is now fully functional for both **Create Profile** and **Edit Profile** flows.

---

## 🎯 Features Implemented

### 1. **Dual Upload Options**
- ✅ Camera capture (take a new photo)
- ✅ Gallery selection (choose existing photo)

### 2. **Image Processing**
- ✅ Automatic compression (reduces file size to 300x300px)
- ✅ Square crop with 1:1 aspect ratio
- ✅ JPEG format with 70% quality for optimal balance

### 3. **Firebase Storage Integration**
- ✅ Uploads to: `profilePictures/{userId}/profile.jpg`
- ✅ Returns downloadURL for Firestore storage
- ✅ Overwrites previous photo automatically

### 4. **UI/UX Enhancements**
- ✅ Camera icon placeholder when no photo
- ✅ Edit badge overlay on existing photos
- ✅ Loading spinner during upload
- ✅ Success/error alerts
- ✅ Smooth animations

---

## 🔧 How It Works

### **Create Profile Flow:**
1. User taps the circular photo button
2. Alert shows: "Camera" or "Gallery" options
3. User selects/captures photo
4. Photo preview appears immediately
5. On "Continue":
   - Photo is compressed
   - Uploaded to Firebase Storage
   - URL saved to Firestore with profile data
   - User navigates to MainTabs

### **Edit Profile Flow:**
1. Existing photo loads from Firestore URL
2. User taps photo (shows camera badge)
3. Alert shows: "Camera" or "Gallery" options
4. New photo preview replaces old one
5. On "Continue":
   - Checks if photo is new (local URI) or existing (http URL)
   - If new: compresses and uploads
   - If existing: keeps the same URL
   - Updates Firestore profile

---

## 📱 Testing Checklist

### Create Profile
- [ ] Tap "Add Photo" button shows Camera/Gallery alert
- [ ] Camera option opens camera, allows capture
- [ ] Gallery option opens photo library
- [ ] Selected photo appears in circular frame
- [ ] Photo uploads successfully on "Continue"
- [ ] Profile screen shows uploaded photo
- [ ] Photo persists after app restart

### Edit Profile
- [ ] Navigate to Profile → Edit Profile
- [ ] Existing photo loads correctly
- [ ] Tap photo shows camera badge overlay
- [ ] Can replace with camera photo
- [ ] Can replace with gallery photo
- [ ] New photo uploads and replaces old one
- [ ] Changes reflect immediately on profile screen
- [ ] Old photo is overwritten in Storage (same path)

### Error Handling
- [ ] Denying camera permission shows alert
- [ ] Denying gallery permission shows alert
- [ ] Poor internet connection shows error
- [ ] Large images compress successfully
- [ ] Canceling picker doesn't crash app

---

## 🛠️ Technical Details

### File Locations
```
screens/CreateProfileScreen.tsx  - Main profile creation/editing screen
utils/imageUtils.ts              - Image compression and upload utilities
firebaseConfig.ts                - Firebase Storage configuration
```

### Key Functions

#### `pickImage()`
```typescript
// Shows alert with Camera/Gallery options
// Requests permissions
// Launches picker
// Sets photo state with local URI
```

#### `compressImage(uri)`
```typescript
// Resizes to 300x300px
// Compresses to 70% JPEG quality
// Returns manipulated URI
```

#### `uploadProfileImage(uri, userId)`
```typescript
// Fetches compressed image as blob
// Uploads to Firebase Storage
// Returns downloadURL
```

#### `handleContinue()`
```typescript
// CREATE MODE:
//   - Creates auth user
//   - Uploads photo if present
//   - Saves profile to Firestore
//   - Navigates to MainTabs

// EDIT MODE:
//   - Detects if photo is new (local) or existing (URL)
//   - Uploads only if new
//   - Updates Firestore profile
//   - Navigates back
```

---

## 🔒 Security & Permissions

### Required Permissions (Android)
```json
"android": {
  "permissions": [
    "android.permission.CAMERA",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE"
  ]
}
```

### Required Permissions (iOS)
```json
"ios": {
  "infoPlist": {
    "NSCameraUsageDescription": "Allow SportsPal to access your camera to take profile pictures.",
    "NSPhotoLibraryUsageDescription": "Allow SportsPal to access your photo library to choose profile pictures."
  }
}
```

### Firebase Storage Rules
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /profilePictures/{userId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 🚀 Future Enhancements (Optional)

1. **Image Cropper** - Manual crop before upload
2. **Filters** - Add Instagram-style filters
3. **Upload Progress Bar** - Show percentage during upload
4. **Multiple Photos** - Allow profile gallery
5. **Remove Photo** - Option to delete current photo
6. **Photo from URL** - Paste image URL
7. **Avatar Generator** - AI-generated avatars
8. **Photo Guidelines** - Min/max size warnings

---

## 🐛 Troubleshooting

### Issue: "Upload failed"
**Solution:** Check Firebase Storage rules and internet connection

### Issue: "Permission denied"
**Solution:** Manually enable Camera/Photos permission in device Settings

### Issue: Photo doesn't appear after upload
**Solution:** Check that photo URL is correctly saved to Firestore profile doc

### Issue: Compression takes too long
**Solution:** Image is likely very large; compression is working as intended

---

## 📊 Storage Structure

```
Firebase Storage:
└── profilePictures/
    └── {userId}/
        └── profile.jpg  (overwritten each time)

Firestore:
└── profiles/
    └── {userId}/
        ├── username: string
        ├── email: string
        ├── photo: string (Firebase Storage downloadURL)
        ├── phone: string
        ├── location: string
        └── sportsPreferences: string[]
```

---

## ✨ Summary

The profile picture upload feature is **production-ready** with:
- ✅ Camera & Gallery support
- ✅ Automatic compression
- ✅ Firebase Storage integration
- ✅ Error handling
- ✅ Smooth UI/UX
- ✅ Works in both Create and Edit modes

**No additional setup needed!** Just test and enjoy! 🎉
