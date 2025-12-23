import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform, AppState } from 'react-native';
import { arrayUnion, arrayRemove, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../firebaseConfig';

// Store the in-app notification handler
let inAppNotificationHandler: ((notification: any) => void) | null = null;

export function setInAppNotificationHandler(handler: (notification: any) => void) {
  inAppNotificationHandler = handler;
}

// Configure how notifications are handled when received in foreground
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const appState = AppState.currentState;
    const isAppActive = appState === 'active';

    // If app is in foreground, show in-app notification instead of system notification
    if (isAppActive && inAppNotificationHandler) {
      const data = notification.request.content.data as any;
      const title = notification.request.content.title || 'Notification';
      const body = notification.request.content.body || '';
      
      inAppNotificationHandler({
        id: notification.request.identifier,
        title,
        body,
        image: data?.senderPhoto,
        type: data?.type || 'chat',
        chatId: data?.chatId,
        activityId: data?.activityId,
        userId: data?.userId,
      });

      // Don't show system notification
      return {
        shouldShowAlert: false,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }

    // If app is in background, show system notification as normal
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

export type PushData = {
  type?: 'chat' | 'activity_invite' | 'friend_request' | 'friend_accept';
  chatId?: string;
  messageId?: string;
  activityId?: string;
};

const TOKEN_KEY = 'expoPushToken';
const FCM_TOKEN_KEY = 'fcmPushToken';

// Get Expo projectId from config in dev and production
function getProjectId(): string | undefined {
  // Prefer runtime EAS project Id when in a standalone build
  const easId = (Constants as any)?.easConfig?.projectId as string | undefined;
  const configId = (Constants as any)?.expoConfig?.extra?.eas?.projectId as string | undefined;
  return easId || configId;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Messages & Alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1AE9EF',
    sound: 'default',
    bypassDnd: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function registerPushNotificationsForCurrentUser(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      return null; // Simulators don't support push
    }

    await ensureAndroidChannel();

    // Check/request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const ask = await Notifications.requestPermissionsAsync();
      finalStatus = ask.status;
    }
    if (finalStatus !== 'granted') return null;

    const uid = auth.currentUser?.uid;
    if (!uid) return null;

    // We store BOTH token types when possible:
    // - FCM token (Android) lets Firebase show the app name as sender
    // - Expo token gives a reliable fallback and works well on iOS
    let fcmToken: string | null = null;
    let expoToken: string | null = null;

    if (Platform.OS === 'android') {
      try {
        const fcmTokenResp = await Notifications.getDevicePushTokenAsync();
        if (fcmTokenResp.data) {
          fcmToken = fcmTokenResp.data;
          console.log('📱 Got FCM token for Android');
        }
      } catch (e) {
        console.warn('Failed to get FCM token:', e);
      }
    }

    try {
      const projectId = getProjectId();
      const tokenResp = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : (undefined as any)
      );
      expoToken = tokenResp.data;
      console.log('📱 Got Expo push token');
    } catch (e) {
      console.warn('Failed to get Expo push token:', e);
    }

    if (!fcmToken && !expoToken) return null;

    // Save tokens to profile
    const profileRef = doc(db, 'profiles', uid);

    if (fcmToken) {
      await setDoc(profileRef, { fcmPushTokens: arrayUnion(fcmToken) as any }, { merge: true });
      try {
        await AsyncStorage.setItem(FCM_TOKEN_KEY, fcmToken);
      } catch {}
    }
    if (expoToken) {
      await setDoc(profileRef, { expoPushTokens: arrayUnion(expoToken) as any }, { merge: true });
      try {
        await AsyncStorage.setItem(TOKEN_KEY, expoToken);
      } catch {}
    }

    return fcmToken || expoToken;
  } catch (e) {
    console.error('Push registration failed:', e);
    return null;
  }
}

export async function removeCurrentDevicePushToken(token: string) {
  try {
    const uid = auth.currentUser?.uid;
    if (!uid || !token) return;
    // Remove from both token arrays (we don't know which type it is)
    await updateDoc(doc(db, 'profiles', uid), { 
      expoPushTokens: arrayRemove(token) as any,
      fcmPushTokens: arrayRemove(token) as any,
    });
  } catch {}
}

export function subscribeNotificationResponses(onNavigate: (data: PushData) => void) {
  // Handle taps on notifications
  const sub = Notifications.addNotificationResponseReceivedListener((response: Notifications.NotificationResponse) => {
    const data = (response?.notification?.request?.content?.data || {}) as PushData;
    if (data) onNavigate(data);
  });
  return () => sub.remove();
}

export async function getLastNotificationResponseData(): Promise<PushData | null> {
  try {
    const resp = await Notifications.getLastNotificationResponseAsync();
    const data = (resp?.notification?.request?.content?.data || null) as PushData | null;
    return data || null;
  } catch {
    return null;
  }
}

export async function removeSavedTokenAndUnregister() {
  try {
    const expoToken = await AsyncStorage.getItem(TOKEN_KEY);
    if (expoToken) await removeCurrentDevicePushToken(expoToken);
  } catch {}
  try {
    const fcmToken = await AsyncStorage.getItem(FCM_TOKEN_KEY);
    if (fcmToken) await removeCurrentDevicePushToken(fcmToken);
  } catch {}
  try { await AsyncStorage.removeItem(TOKEN_KEY); } catch {}
  try { await AsyncStorage.removeItem(FCM_TOKEN_KEY); } catch {}
}
