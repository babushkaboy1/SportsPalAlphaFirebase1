import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, FirebaseApp } from "firebase/app";
import { getReactNativePersistence, initializeAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage } from 'firebase/storage';
import { getFunctions, Functions } from 'firebase/functions';
import { Platform } from 'react-native';
import {
  FIREBASE_API_KEY,
  FIREBASE_API_KEY_WEB,
  FIREBASE_API_KEY_IOS,
  FIREBASE_API_KEY_ANDROID,
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_PROJECT_ID,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID,
  FIREBASE_APP_ID_WEB,
  FIREBASE_APP_ID_IOS,
  FIREBASE_APP_ID_ANDROID,
  FIREBASE_MEASUREMENT_ID
} from '@env';

// Dynamically select the correct API Key and APP_ID based on the platform
let currentApiKey: string;
let currentAppId: string;

if (Platform.OS === 'ios') {
  currentApiKey = FIREBASE_API_KEY_IOS || FIREBASE_API_KEY;
  currentAppId = FIREBASE_APP_ID_IOS;
} else if (Platform.OS === 'android') {
  currentApiKey = FIREBASE_API_KEY_ANDROID || FIREBASE_API_KEY;
  currentAppId = FIREBASE_APP_ID_ANDROID;
} else {
  currentApiKey = FIREBASE_API_KEY_WEB || FIREBASE_API_KEY;
  currentAppId = FIREBASE_APP_ID_WEB;
}

function toGsUrl(bucket: string) {
  if (!bucket) return bucket;
  return bucket.startsWith('gs://') ? bucket : `gs://${bucket}`;
}

const firebaseConfig = {
  apiKey: currentApiKey,
  authDomain: FIREBASE_AUTH_DOMAIN,
  projectId: FIREBASE_PROJECT_ID,
  storageBucket: FIREBASE_STORAGE_BUCKET, // no gs:// here
  messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
  appId: currentAppId,
  measurementId: FIREBASE_MEASUREMENT_ID
};

const app: FirebaseApp = initializeApp(firebaseConfig);

export const auth: Auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage),
});
export const db: Firestore = getFirestore(app);
// Use gs:// only in getStorage
export const storage = getStorage(app, toGsUrl(FIREBASE_STORAGE_BUCKET));
export const functions: Functions = getFunctions(app);