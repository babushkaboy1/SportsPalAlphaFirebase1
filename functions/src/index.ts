// @ts-nocheck
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

initializeApp();
const db = getFirestore();
const expo = new Expo();

async function getExpoTokensForUser(userId: string): Promise<string[]> {
  try {
    const snap = await db.doc(`profiles/${userId}`).get();
    const data = snap.data() as any;
    const tokens: string[] = Array.isArray(data?.expoPushTokens) ? data.expoPushTokens : [];
    return tokens.filter((t) => Expo.isExpoPushToken(t));
  } catch (e) {
    return [];
  }
}

async function sendExpoNotifications(messages: ExpoPushMessage[]) {
  if (!messages.length) return;
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (e) {
      logger.warn('Expo push send failed for chunk', e);
    }
  }
}

function summarizeMessageBody(type?: string, text?: string): string {
  if (type === 'image') return 'sent a photo';
  if (type === 'audio') return 'sent a voice message';
  const trimmed = (text || '').trim();
  return trimmed.length ? trimmed : 'New message';
}

// New chat message -> notify chat participants (except sender)
export const onChatMessageCreated = onDocumentCreated(
  'chats/{chatId}/messages/{messageId}',
  async (event: any) => {
    const { chatId, messageId } = event.params as { chatId: string; messageId: string };
    const msg = event.data?.data() as any;
    if (!msg) return;

    const senderId: string = msg.senderId;
    const messageType: string | undefined = msg.type;
    const messageText: string | undefined = msg.text || msg.content;

    // Load chat to get participants and title
    const chatSnap = await db.doc(`chats/${chatId}`).get();
    if (!chatSnap.exists) return;
    const chat = chatSnap.data() as any;
    const participants: string[] = Array.isArray(chat.participants) ? chat.participants : [];
    const recipients = participants.filter((p) => p && p !== senderId);

    // Load sender profile
    let senderName = 'New message';
    try {
      const s = await db.doc(`profiles/${senderId}`).get();
      const sd = s.data() as any;
      if (sd?.username) senderName = sd.username;
    } catch {}

    // Build messages for all recipient tokens
    const body = summarizeMessageBody(messageType, messageText);

    const tokenLists = await Promise.all(recipients.map((u) => getExpoTokensForUser(u)));
    const tokens = tokenLists.flat();

    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title: senderName,
      body,
      data: { type: 'chat', chatId, messageId },
      sound: 'default',
      priority: 'high',
    }));

    await sendExpoNotifications(messages);
  }
);

// New notification doc -> notify target user (friend requests/accepts, activity invites)
export const onAppNotificationCreated = onDocumentCreated('notifications/{id}', async (event: any) => {
  const notif = event.data?.data() as any;
  if (!notif) return;
  const userId: string = notif.userId;
  const type: string = notif.type;
  const fromUsername: string | undefined = notif.fromUsername || undefined;
  const activityId: string | undefined = notif.activityId || undefined;

  const tokens = await getExpoTokensForUser(userId);
  if (!tokens.length) return;

  let title = 'Notification';
  let body = 'You have a new notification';
  if (type === 'friend_request') {
    title = fromUsername ? `${fromUsername}` : 'New connection request';
    body = 'sent you a request to connect';
  } else if (type === 'friend_accept') {
    title = fromUsername ? `${fromUsername}` : 'Request accepted';
    body = 'accepted your request to connect';
  } else if (type === 'activity_invite') {
    title = fromUsername ? `${fromUsername}` : 'Activity invite';
    body = 'invited you to join an activity';
  }

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title,
    body,
    data: type === 'activity_invite' && activityId ? { type: 'activity_invite', activityId } : { type },
    sound: 'default',
    priority: 'high',
  }));

  await sendExpoNotifications(messages);
});
