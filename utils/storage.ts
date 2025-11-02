import AsyncStorage from '@react-native-async-storage/async-storage';

// Normalize date to dd-mm-yyyy format
export const normalizeDateFormat = (date: string): string => {
  // If already dd-mm-yyyy, return as is
  if (/^\d{2}-\d{2}-\d{4}$/.test(date)) return date;
  // If yyyy-mm-dd, convert to dd-mm-yyyy
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [yyyy, mm, dd] = date.split('-');
    return `${dd}-${mm}-${yyyy}`;
  }
  // If mm/dd/yyyy or other, try to parse
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
    const [mm, dd, yyyy] = date.split('/');
    return `${dd}-${mm}-${yyyy}`;
  }
  console.warn(`Unrecognized date format: ${date}`);
  return date;
};

// Always return dd-mm-yyyy for calendar and display
export const convertToCalendarFormat = (date: string): string => {
  return normalizeDateFormat(date);
};

// Save Profile
export const saveProfile = async (profileData: any) => {
  try {
    await AsyncStorage.setItem('profileData', JSON.stringify(profileData));
    console.log('Profile saved successfully!');
  } catch (error) {
    console.error('Error saving profile data:', error);
  }
};

// Load Profile
export const loadProfile = async () => {
  try {
    const jsonValue = await AsyncStorage.getItem('profileData');
    return jsonValue != null ? JSON.parse(jsonValue) : null;
  } catch (error) {
    console.error('Error loading profile data:', error);
    return null;
  }
};
// Upload a GPX file (given a local URI) to Firebase Storage and return metadata
export const uploadGpxFile = async (fileUri: string, destPath: string) => {
  try {
    // Dynamic import of firebase storage helper to avoid cycles
    const { storage } = await import('../firebaseConfig');
    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    // Try fetching as blob first (works in many cases)
    try {
      const resp = await fetch(fileUri);
      const blob = await resp.blob();
      const sref = ref(storage, destPath);
      await uploadBytes(sref, blob);
      const url = await getDownloadURL(sref);
      return {
        storagePath: destPath,
        downloadUrl: url,
      };
    } catch (firstErr) {
      console.warn('uploadGpxFile: fetch->blob failed, trying XHR fallback', firstErr, 'fileUri=', fileUri);
      // Try XMLHttpRequest to obtain a blob (works for many content:// and file:// URIs)
      try {
        if (!fileUri) throw new Error('Empty fileUri');
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
            xhr.open('GET', fileUri, true);
            // @ts-ignore
            xhr.responseType = 'blob';
            xhr.send(null);
          } catch (e) {
            reject(e);
          }
        });
        const sref = ref(storage, destPath);
        await uploadBytes(sref, blobFromXhr as any);
        const url = await getDownloadURL(sref);
        return { storagePath: destPath, downloadUrl: url };
      } catch (xhrErr) {
        console.warn('uploadGpxFile: XHR fallback failed, trying FileSystem fallback', xhrErr, 'fileUri=', fileUri);
        // Final fallback: use Expo FileSystem to read base64 and upload as Uint8Array
        try {
          if (!fileUri) throw new Error('Empty fileUri');
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fsMod: any = await import('expo-file-system');
          const FileSystem: any = fsMod.default || fsMod;
          // read as base64 (handle different API shapes)
          if (!FileSystem || typeof FileSystem.readAsStringAsync !== 'function') {
            throw new Error('expo-file-system readAsStringAsync is not available. Make sure expo-file-system is installed and rebuild the app (restart Metro / reinstall the native app).');
          }
          const enc = FileSystem.EncodingType?.Base64 || FileSystem.EncodingTypeBase64 || 'base64';
          const b64 = await FileSystem.readAsStringAsync(fileUri, { encoding: enc });
          // convert base64 to Uint8Array
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const base64 = require('base-64');
          const binaryString = base64.decode(b64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const sref2 = ref(storage, destPath);
          await uploadBytes(sref2, bytes);
          const url2 = await getDownloadURL(sref2);
          return { storagePath: destPath, downloadUrl: url2 };
        } catch (fsErr) {
          console.error('uploadGpxFile FileSystem fallback error', fsErr);
          throw fsErr;
        }
      }
    }
  } catch (err) {
    console.error('uploadGpxFile error', err);
    throw err;
  }
};

// Update Profile
export const updateProfile = async (newData: any) => {
  try {
    const currentData = await loadProfile();
    const updatedData = { ...currentData, ...newData };
    await saveProfile(updatedData);
    console.log('Profile updated successfully!');
  } catch (error) {
    console.error('Error updating profile data:', error);
  }
};

// Clear Profile
export const clearProfile = async () => {
  try {
    await AsyncStorage.removeItem('profileData');
    console.log('Profile cleared successfully!');
  } catch (error) {
    console.error('Error clearing profile data:', error);
  }
};