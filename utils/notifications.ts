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

    const projectId = getProjectId();
    // If projectId is undefined in dev web/preview, this will still work on device builds
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined as any
    );
    const expoPushToken = tokenResp.data;

    const uid = auth.currentUser?.uid;
    if (!uid || !expoPushToken) return expoPushToken || null;

    // Save token to profile.expoPushTokens (array)
    const profileRef = doc(db, 'profiles', uid);
    const snap = await getDoc(profileRef);
    if (!snap.exists()) {
      await setDoc(profileRef, { expoPushTokens: [expoPushToken] }, { merge: true });
    } else {
      await updateDoc(profileRef, { expoPushTokens: arrayUnion(expoPushToken) as any }).catch(async () => {
        await setDoc(profileRef, { expoPushTokens: [expoPushToken] }, { merge: true });
      });
    }

    // Persist locally to allow cleanup on logout
    try { await AsyncStorage.setItem(TOKEN_KEY, expoPushToken); } catch {}

    return expoPushToken;
  } catch (e) {
    // Fail silently; app should continue to work without push
    return null;
  }
}

export async function removeCurrentDevicePushToken(expoPushToken: string) {
  try {
    const uid = auth.currentUser?.uid;
    if (!uid || !expoPushToken) return;
    await updateDoc(doc(db, 'profiles', uid), { expoPushTokens: arrayRemove(expoPushToken) as any });
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
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) await removeCurrentDevicePushToken(token);
  } catch {}
  try { await AsyncStorage.removeItem(TOKEN_KEY); } catch {}
}
