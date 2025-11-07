import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
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
  // Resize + compress aggressively for avatars (reduce storage + egress cost)
  // Keep JPEG for broad compatibility and stable content-type.
  const originalInfo = await FileSystem.getInfoAsync(uri);
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 640 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
  const manipulatedInfo = await FileSystem.getInfoAsync(manipulated.uri);
  const originalBytes = (originalInfo as any)?.size as number | undefined;
  const manipulatedBytes = (manipulatedInfo as any)?.size as number | undefined;
  let uploadUri = manipulated.uri;
  if (originalBytes && manipulatedBytes) {
    if (manipulatedBytes > originalBytes) {
      // Do not upsize: keep the original file if compression made it bigger
      uploadUri = uri;
      console.log(`📦 Avatar kept original: ${(originalBytes/1024).toFixed(0)}KB (processed would be ${(manipulatedBytes/1024).toFixed(0)}KB)`);
    } else {
      const savings = (((originalBytes - manipulatedBytes) / originalBytes) * 100).toFixed(1);
      console.log(`📦 Avatar size: ${(originalBytes/1024).toFixed(0)}KB → ${(manipulatedBytes/1024).toFixed(0)}KB (${savings}% smaller)`);
    }
  }

  const filePath = `profilePictures/${userId}/profile.jpg`;
  const imageRef = ref(storage, filePath);

  // A) Try DATA-URL first → avoids ArrayBuffer/Blob paths entirely
  try {
    const base64 = await FileSystem.readAsStringAsync(uploadUri, {
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
    const blob = await getBlobFromUri(uploadUri);
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
  // Resize + compress chat images to keep quality while controlling size
  const originalInfo = await FileSystem.getInfoAsync(uri);
  const processed = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1280 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
  const processedInfo = await FileSystem.getInfoAsync(processed.uri);
  const originalBytes2 = (originalInfo as any)?.size as number | undefined;
  const processedBytes = (processedInfo as any)?.size as number | undefined;
  let uploadUri2 = processed.uri;
  if (originalBytes2 && processedBytes) {
    if (processedBytes > originalBytes2) {
      uploadUri2 = uri; // keep original if our processing increased size
      console.log(`📦 Chat image kept original: ${(originalBytes2/1024).toFixed(0)}KB (processed would be ${(processedBytes/1024).toFixed(0)}KB)`);
    } else {
      const savings = (((originalBytes2 - processedBytes) / originalBytes2) * 100).toFixed(1);
      console.log(`📦 Chat image: ${(originalBytes2/1024).toFixed(0)}KB → ${(processedBytes/1024).toFixed(0)}KB (${savings}% smaller)`);
    }
  }

  const filePath = `chatImages/${userId}/${imageId}.jpg`;
  const imageRef = ref(storage, filePath);

  // A) Try DATA-URL first
  try {
    const base64 = await FileSystem.readAsStringAsync(uploadUri2, {
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
    const blob = await getBlobFromUri(uploadUri2);
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

export async function uploadAudioMessage(uri: string, userId: string, audioId: string) {
  console.log("🎤 Starting audio upload for user:", userId);

  const filePath = `audioMessages/${userId}/${audioId}.m4a`;
  const audioRef = ref(storage, filePath);

  // Strategy A: Try fetch -> Blob (works in many cases on iOS/Android)
  try {
    console.log('📦 Attempting blob upload (fetch)...');
    const blob = await getBlobFromUri(uri);
    await uploadBytes(audioRef, blob, {
      contentType: 'audio/m4a',
      cacheControl: 'public,max-age=604800',
    });
    (blob as any)?.close?.();
    const url = await getDownloadURL(audioRef);
    console.log('✅ Audio upload complete via fetch->blob');
    return url;
  } catch (firstErr) {
    console.warn('⚠️ blob upload (fetch) failed, trying XHR fallback', firstErr);
  }

  // Strategy B: XHR to get a Blob
  try {
    console.log('📦 Attempting blob upload (XHR)...');
    if (!uri) throw new Error('Empty audio uri');
    const blobFromXhr = await new Promise<Blob>((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.onerror = () => reject(new Error('XHR failed'));
        xhr.onreadystatechange = () => {
          if (xhr.readyState === 4) {
            if (xhr.status === 200 || xhr.response) {
              resolve(xhr.response);
            } else {
              reject(new Error('XHR status ' + xhr.status));
            }
          }
        };
        xhr.open('GET', uri, true);
        // @ts-ignore
        xhr.responseType = 'blob';
        xhr.send(null);
      } catch (e) {
        reject(e);
      }
    });
    await uploadBytes(audioRef, blobFromXhr as any, {
      contentType: 'audio/m4a',
      cacheControl: 'public,max-age=604800',
    });
    const url = await getDownloadURL(audioRef);
    console.log('✅ Audio upload complete via XHR blob');
    return url;
  } catch (xhrErr) {
    console.warn('⚠️ XHR blob upload failed, trying FileSystem base64 fallback', xhrErr);
  }

  // Strategy C: Base64 via pre-imported FileSystem (no dynamic import to avoid Metro issues)
  try {
    console.log('📦 Attempting base64 upload (FileSystem fallback)...');
    if (!FileSystem || typeof FileSystem.readAsStringAsync !== 'function') {
      throw new Error('expo-file-system readAsStringAsync unavailable');
    }
    const enc = (FileSystem as any).EncodingType?.Base64 || (FileSystem as any).EncodingTypeBase64 || 'base64';
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: enc as any });
    await uploadString(
      audioRef,
      `data:audio/m4a;base64,${b64}`,
      'data_url',
      { contentType: 'audio/m4a', cacheControl: 'public,max-age=604800' }
    );
    const url = await getDownloadURL(audioRef);
    console.log('✅ Audio upload complete via base64 (FS fallback)');
    return url;
  } catch (fsErr) {
    console.error('❌ Audio upload failed after all strategies:', fsErr);
    throw fsErr;
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
