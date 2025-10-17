import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { ref, uploadString, uploadBytes, getDownloadURL, listAll, getStorage } from 'firebase/storage';
import { storage, auth } from '../firebaseConfig';

// Modern Expo: use fetch for Blob
async function getBlobFromUri(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  // @ts-ignore – Expo supplies Blob at runtime
  return await res.blob();
}

function normalizeBucket(bucket?: string): string {
  if (!bucket) return '';
  return bucket.startsWith('gs://') ? bucket.replace('gs://', '') : bucket;
}

// Diagnostic function to test storage connection
export async function testStorageConnection() {
  try {
    console.log("🧪 Testing Firebase Storage connection...");
    console.log("👤 Current user:", auth.currentUser?.uid);
    console.log("📧 User email:", auth.currentUser?.email);
    const storageRef = ref(storage, 'profilePictures');
    console.log("📍 Storage bucket:", storageRef.bucket);
    console.log("📁 Testing path:", storageRef.fullPath);
    const result = await listAll(storageRef);
    console.log("✅ Storage connected! Existing files:", result.items.length);
    console.log("✅ Storage test PASSED!");
    return true;
  } catch (error: any) {
    console.error("❌ Storage test FAILED!");
    console.error("❌ Error:", error.message);
    console.error("❌ Code:", error.code);
    return false;
  }
}

export async function compressImage(uri: string) {
  const manipResult = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 300, height: 300 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
  return manipResult.uri;
}

export async function uploadProfileImage(uri: string, userId: string) {
  console.log("🚀 Starting upload for user:", userId);
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [], // or { resize: { width: 1024 } }
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
  );

  const filePath = `profilePictures/${userId}/profile.jpg`;
  const imageRef = ref(storage, filePath);

  // A) Try DATA-URL first → avoids ArrayBuffer/Blob paths entirely
  try {
    const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await uploadString(
      imageRef,
      `data:image/jpeg;base64,${base64}`,
      'data_url',
      { contentType: 'image/jpeg', cacheControl: 'public,max-age=604800' }
    );
    const url = await getDownloadURL(imageRef);
    console.log('✅ Upload complete via uploadString(data_url)');
    return url;
  } catch (e) {
    console.warn('⚠️ data_url upload failed, trying Blob:', (e as any)?.message || e);
  }

  // B) Fallback: Blob
  try {
    const blob = await getBlobFromUri(manipulated.uri);
    await uploadBytes(imageRef, blob, {
      contentType: 'image/jpeg',
      cacheControl: 'public,max-age=604800',
    });
    (blob as any)?.close?.();
    const url = await getDownloadURL(imageRef);
    console.log('✅ Upload complete via uploadBytes');
    return url;
  } catch (e) {
    console.error('❌ Upload failed after both attempts:', (e as any)?.message || e);
    throw e;
  }
}

export async function uploadChatImage(uri: string, userId: string, imageId: string) {
  const filePath = `chatImages/${userId}/${imageId}.jpg`;
  const imageRef = ref(storage, filePath);

  // A) Try DATA-URL first
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await uploadString(
      imageRef,
      `data:image/jpeg;base64,${base64}`,
      'data_url',
      { contentType: 'image/jpeg', cacheControl: 'public,max-age=604800' }
    );
    const url = await getDownloadURL(imageRef);
    console.log('✅ Chat image upload complete via uploadString(data_url)');
    return url;
  } catch (e) {
    console.warn('⚠️ Chat image data_url upload failed, trying Blob:', (e as any)?.message || e);
  }

  // B) Fallback: Blob
  try {
    const blob = await getBlobFromUri(uri);
    await uploadBytes(imageRef, blob, {
      contentType: 'image/jpeg',
      cacheControl: 'public,max-age=604800',
    });
    (blob as any)?.close?.();
    const url = await getDownloadURL(imageRef);
    console.log('✅ Chat image upload complete via uploadBytes');
    return url;
  } catch (e) {
    console.error('❌ Chat image upload failed after both attempts:', (e as any)?.message || e);
    throw e;
  }
}

// Storage healthcheck utility
export async function storageHealthcheck() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated yet');

  const st = getStorage(); // same app
  await listAll(ref(st, 'profilePictures'));
  await uploadString(ref(st, `debug/${user.uid}/ping.txt`), 'ok', 'raw');
  console.log('✅ Storage healthcheck OK');
}
