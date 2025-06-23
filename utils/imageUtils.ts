import * as ImageManipulator from 'expo-image-manipulator';
import { storage } from '../firebaseConfig';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export async function compressImage(uri: string) {
  const manipResult = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 300, height: 300 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
  return manipResult.uri;
}

export async function uploadProfileImage(uri: string, userId: string) {
  const response = await fetch(uri);
  const blob = await response.blob();
  const imageRef = ref(storage, `profilePictures/${userId}/profile.jpg`);
  await uploadBytes(imageRef, blob, { contentType: 'image/jpeg' });
  return await getDownloadURL(imageRef);
}

export async function uploadChatImage(uri: string, userId: string, imageId: string) {
  const response = await fetch(uri);
  const blob = await response.blob();
  const imageRef = ref(storage, `chatImages/${userId}/${imageId}.jpg`);
  await uploadBytes(imageRef, blob, { contentType: 'image/jpeg' });
  return await getDownloadURL(imageRef);
}