# 🐛 Firebase Storage Upload Error - Debugging Guide

## Error Message
```
ERROR  ❌ Error saving profile: [FirebaseError: Firebase Storage: An unknown error occurred, 
please check the error payload for server response. (storage/unknown)]
```

---

## ✅ Checklist - What to Check

### 1. **Firebase Storage Rules** ⚠️ MOST COMMON ISSUE

Go to Firebase Console → Storage → Rules

**Current Rules (Default - BLOCKING):**
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;  // ❌ BLOCKS ALL UPLOADS
    }
  }
}
```

**✅ CORRECT RULES (For Development):**
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Profile Pictures - only authenticated users can upload their own
    match /profilePictures/{userId}/{allPaths=**} {
      allow read: if true;  // Anyone can view profile pictures
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Chat Images - only authenticated users can upload their own
    match /chatImages/{userId}/{allPaths=**} {
      allow read: if true;  // Anyone can view chat images
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

**🧪 TEMPORARY RULES (For Testing Only - Remove Before Production):**
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if true;  // ⚠️ WARNING: Allows all uploads
    }
  }
}
```

---

### 2. **Firebase Storage Bucket Configuration**

#### Check if Storage is Enabled:
1. Go to Firebase Console
2. Navigate to **Build → Storage**
3. If you see "Get Started" button → **Storage is NOT enabled**
4. Click "Get Started" to enable it

#### Check Storage Location:
- Go to Storage → Files tab
- Note the bucket name at top (e.g., `your-project.appspot.com`)
- Should match your `.env` file: `FIREBASE_STORAGE_BUCKET`

---

### 3. **Environment Variables (.env file)**

Create/check `.env` file in project root:

```env
FIREBASE_API_KEY=your-api-key-here
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com  # ← CHECK THIS!
FIREBASE_MESSAGING_SENDER_ID=your-sender-id
FIREBASE_APP_ID=your-app-id
FIREBASE_MEASUREMENT_ID=your-measurement-id
GOOGLE_MAPS_API_KEY=your-maps-key
```

**⚠️ Common Mistake:**
```env
FIREBASE_STORAGE_BUCKET=your-project.appspot.com  # ✅ CORRECT
FIREBASE_STORAGE_BUCKET=gs://your-project.appspot.com  # ❌ WRONG - Remove gs://
```

---

### 4. **User Authentication**

Profile pictures require a logged-in user:

```typescript
// Check if user is authenticated
console.log("Current user:", auth.currentUser?.uid);
console.log("User email:", auth.currentUser?.email);
```

If `auth.currentUser` is `null` → User not logged in → Upload will fail

---

### 5. **Storage Bucket Permissions (Firebase Console)**

1. Firebase Console → Storage
2. Click on the three dots (⋮) → "Usage and Billing"
3. Ensure you're on **Spark (Free) plan** or higher
4. Check storage quota: should show usage (e.g., "12 MB / 5 GB")

---

### 6. **Network & CORS Issues**

#### Test Storage Connection:
```typescript
import { ref, listAll } from 'firebase/storage';

// Add this test function to CreateProfileScreen
const testStorageConnection = async () => {
  try {
    const storageRef = ref(storage, 'profilePictures');
    const result = await listAll(storageRef);
    console.log("✅ Storage connected! Files:", result.items.length);
  } catch (error) {
    console.error("❌ Storage connection failed:", error);
  }
};
```

---

### 7. **Image Format & Size**

Check compressed image details:
```typescript
// In CreateProfileScreen.tsx, add logs:
const compressedUri = await compressImage(photo);
console.log("📸 Compressed URI:", compressedUri);

// Check file size
const response = await fetch(compressedUri);
const blob = await response.blob();
console.log("📦 Blob size:", blob.size, "bytes");
console.log("📦 Blob type:", blob.type);
```

**Expected:**
- Size: < 100 KB (typically 20-50 KB)
- Type: `image/jpeg`

---

### 8. **Firebase SDK Version Compatibility**

Check `package.json`:
```json
{
  "dependencies": {
    "firebase": "^10.x.x"  // Should be version 10 or higher
  }
}
```

If older version, update:
```bash
npm install firebase@latest
```

---

## 🔧 Quick Fix - Step by Step

### **Step 1: Enable Storage**
1. Open Firebase Console
2. Go to **Build → Storage**
3. Click **"Get Started"**
4. Select location (e.g., us-central1)
5. Click **"Done"**

### **Step 2: Update Rules**
1. Go to **Storage → Rules** tab
2. Replace with:
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
3. Click **"Publish"**

### **Step 3: Verify .env**
Ensure `.env` has correct bucket name without `gs://` prefix

### **Step 4: Restart Expo**
```bash
# Stop current server (Ctrl+C)
npx expo start --clear
```

### **Step 5: Test Upload**
Try uploading a profile picture again

---

## 🧪 Enhanced Error Logging

Update `uploadProfileImage` in `utils/imageUtils.ts`:

```typescript
export async function uploadProfileImage(uri: string, userId: string) {
  try {
    console.log("🚀 Starting upload for user:", userId);
    console.log("📸 Image URI:", uri);
    
    const response = await fetch(uri);
    console.log("✅ Fetch successful");
    
    const blob = await response.blob();
    console.log("✅ Blob created. Size:", blob.size, "Type:", blob.type);
    
    const imageRef = ref(storage, `profilePictures/${userId}/profile.jpg`);
    console.log("✅ Storage ref created:", imageRef.fullPath);
    
    await uploadBytes(imageRef, blob, { contentType: 'image/jpeg' });
    console.log("✅ Upload complete!");
    
    const downloadURL = await getDownloadURL(imageRef);
    console.log("✅ Download URL:", downloadURL);
    
    return downloadURL;
  } catch (error: any) {
    console.error("❌ Upload failed at:", error.message);
    console.error("❌ Error code:", error.code);
    console.error("❌ Full error:", JSON.stringify(error, null, 2));
    throw error;
  }
}
```

---

## 📊 Common Error Codes

| Error Code | Meaning | Solution |
|------------|---------|----------|
| `storage/unauthorized` | Rules deny upload | Update Storage rules |
| `storage/unknown` | Generic error | Check all above steps |
| `storage/retry-limit-exceeded` | Network issue | Check internet connection |
| `storage/invalid-checksum` | Corrupted file | Re-compress image |
| `storage/canceled` | User canceled | Not an error |
| `storage/unauthenticated` | User not logged in | Check auth status |

---

## 🎯 Most Likely Solution

**99% of the time, it's Storage Rules!**

1. Go to Firebase Console
2. Storage → Rules
3. Change `if false` to `if request.auth != null`
4. Publish
5. Try again

---

## ✅ Success Indicators

When working correctly, you'll see:
```
LOG  📸 Uploading new profile photo...
LOG  🚀 Starting upload for user: abc123...
LOG  ✅ Fetch successful
LOG  ✅ Blob created. Size: 45678 Type: image/jpeg
LOG  ✅ Storage ref created: profilePictures/abc123/profile.jpg
LOG  ✅ Upload complete!
LOG  ✅ Download URL: https://firebasestorage.googleapis.com/...
LOG  ✅ Profile saved successfully!
```

---

## 🆘 Still Not Working?

1. Share Firebase Console Storage Rules screenshot
2. Share `.env` file content (remove sensitive keys)
3. Share full error log from console
4. Verify user is logged in: `console.log(auth.currentUser)`
