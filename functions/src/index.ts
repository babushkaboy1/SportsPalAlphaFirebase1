// @ts-nocheck
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
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

    // Load sender profile for name and photo
    let senderName = 'New message';
    let senderPhoto: string | undefined;
    try {
      const s = await db.doc(`profiles/${senderId}`).get();
      const sd = s.data() as any;
      if (sd?.username) senderName = sd.username;
      if (sd?.photo) senderPhoto = sd.photo;
      else if (sd?.photoURL) senderPhoto = sd.photoURL;
    } catch {}

    // Build messages for all recipient tokens
    const body = summarizeMessageBody(messageType, messageText);

    const tokenLists = await Promise.all(recipients.map((u) => getExpoTokensForUser(u)));
    const tokens = tokenLists.flat();

    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title: senderName,
      body,
      data: { type: 'chat', chatId, messageId, senderPhoto },
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

/**
 * Deep Link Handler
 * Routes web visitors to app (if installed) or app store (if not)
 * Supports: /activity/:id, /profile/:id, /chat/:id
 */
export const handleDeepLink = onRequest(async (request, response) => {
  const userAgent = request.get("user-agent") || "";
  const path = request.path; // e.g., /activity/abc123
  const host = request.get("host") || "sportspal.web.app";

  // Parse the path to extract type and ID
  const pathParts = path.split("/").filter(Boolean);
  const type = pathParts[0]; // 'activity', 'profile', or 'chat'
  const id = pathParts[1];

  if (!type || !id) {
    response.status(400).send("Invalid deep link format");
    return;
  }

  // Detect platform
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);

  // App Store URLs (REPLACE WITH YOUR ACTUAL URLs)
  const appStoreUrl = "https://apps.apple.com/app/sportspal/id123456789"; // Replace with actual App Store URL
  const playStoreUrl = "https://play.google.com/store/apps/details?id=com.yourusername.sportspal"; // Replace with actual package name

  // Generate fallback HTML page
  const fallbackHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SportsPal - ${type === "activity" ? "Activity" : type === "profile" ? "Profile" : "Chat"}</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          text-align: center;
          padding: 20px;
        }
        .container {
          max-width: 500px;
        }
        h1 {
          font-size: 2.5em;
          margin-bottom: 0.5em;
        }
        p {
          font-size: 1.2em;
          margin-bottom: 2em;
          opacity: 0.9;
        }
        .buttons {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        a {
          display: block;
          padding: 15px 30px;
          background: white;
          color: #667eea;
          text-decoration: none;
          border-radius: 10px;
          font-weight: 600;
          transition: transform 0.2s;
        }
        a:hover {
          transform: scale(1.05);
        }
        .app-icon {
          font-size: 4em;
          margin-bottom: 0.5em;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="app-icon">🏀</div>
        <h1>SportsPal</h1>
        <p>Open this ${type} in the SportsPal app</p>
        <div class="buttons">
          ${isIOS ? `<a href="${appStoreUrl}">Download on App Store</a>` : ""}
          ${isAndroid ? `<a href="${playStoreUrl}">Download on Google Play</a>` : ""}
          ${!isIOS && !isAndroid ? `
            <a href="${appStoreUrl}">Download on App Store</a>
            <a href="${playStoreUrl}">Download on Google Play</a>
          ` : ""}
        </div>
      </div>
    </body>
    </html>
  `;

  // For iOS and Android, try to open the app first via Universal Links / App Links
  // If app not installed, show the fallback page with store links
  response.send(fallbackHtml);
});
