// @ts-nocheck
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

initializeApp();
const db = getFirestore();
const auth = getAuth();
const storage = getStorage();
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

  // App Store URLs (REPLACE WITH YOUR ACTUAL URLs WHEN PUBLISHED)
  const appStoreUrl = "https://apps.apple.com/app/sportspal/id123456789"; // TODO: Replace when app is published
  const playStoreUrl = "https://play.google.com/store/apps/details?id=com.babushkaboy1.sportspal"; // Update with your actual package name

  // App scheme for direct opening
  const appScheme = `sportspal://${type}/${id}`;

  // Generate fallback HTML page with auto-redirect attempt
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
        #status {
          margin-top: 20px;
          font-size: 0.9em;
          opacity: 0.8;
        }
      </style>
      <script>
        // Try to open the app automatically
        setTimeout(() => {
          window.location.href = '${appScheme}';
        }, 100);

        // If app doesn't open in 2.5 seconds, user will see the download buttons
        setTimeout(() => {
          document.getElementById('status').innerHTML = 'App not installed? Download below:';
        }, 2500);
      </script>
    </head>
    <body>
      <div class="container">
        <div class="app-icon">🏀</div>
        <h1>SportsPal</h1>
        <p>Opening ${type} in the SportsPal app...</p>
        <div id="status">Please wait...</div>
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

/**
 * Delete User Account
 * Callable function that deletes:
 * - User's Firebase Auth account
 * - User's Firestore profile document
 * - All activities created by the user
 * - All chats where user is the only participant
 * - All notifications related to the user
 * - All user's storage files (profile pictures, chat images, audio messages)
 */
export const deleteAccount = onCall(async (request) => {
  const uid = request.auth?.uid;
  
  if (!uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to delete account');
  }

  try {
    logger.info(`Starting account deletion for user: ${uid}`);

    // 1. Delete user's activities (where they are the creator)
    const activitiesSnap = await db.collection('activities')
      .where('creatorId', '==', uid)
      .get();
    
    const activitiesBatch = db.batch();
    activitiesSnap.docs.forEach(doc => {
      activitiesBatch.delete(doc.ref);
    });
    await activitiesBatch.commit();
    logger.info(`Deleted ${activitiesSnap.size} activities for user ${uid}`);

    // 2. Remove user from other activities' joinedUserIds
    const joinedActivitiesSnap = await db.collection('activities')
      .where('joinedUserIds', 'array-contains', uid)
      .get();
    
    const joinedBatch = db.batch();
    joinedActivitiesSnap.docs.forEach(doc => {
      const currentJoined = doc.data().joinedUserIds || [];
      const updated = currentJoined.filter((id: string) => id !== uid);
      joinedBatch.update(doc.ref, { joinedUserIds: updated });
    });
    await joinedBatch.commit();
    logger.info(`Removed user ${uid} from ${joinedActivitiesSnap.size} activities`);

    // 3. Handle chats - delete if user is only participant, otherwise remove user
    const chatsSnap = await db.collection('chats')
      .where('participants', 'array-contains', uid)
      .get();
    
    const chatsBatch = db.batch();
    for (const chatDoc of chatsSnap.docs) {
      const participants = chatDoc.data().participants || [];
      if (participants.length <= 1) {
        // Delete chat and all its messages
        chatsBatch.delete(chatDoc.ref);
        const messagesSnap = await chatDoc.ref.collection('messages').get();
        messagesSnap.docs.forEach(msgDoc => {
          chatsBatch.delete(msgDoc.ref);
        });
      } else {
        // Remove user from participants
        const updated = participants.filter((id: string) => id !== uid);
        chatsBatch.update(chatDoc.ref, { participants: updated });
      }
    }
    await chatsBatch.commit();
    logger.info(`Processed ${chatsSnap.size} chats for user ${uid}`);

    // 4. Delete all notifications (sent by user or sent to user)
    const sentNotificationsSnap = await db.collection('notifications')
      .where('fromUserId', '==', uid)
      .get();
    
    const receivedNotificationsSnap = await db.collection('notifications')
      .where('userId', '==', uid)
      .get();
    
    const notifBatch = db.batch();
    [...sentNotificationsSnap.docs, ...receivedNotificationsSnap.docs].forEach(doc => {
      notifBatch.delete(doc.ref);
    });
    await notifBatch.commit();
    logger.info(`Deleted ${sentNotificationsSnap.size + receivedNotificationsSnap.size} notifications for user ${uid}`);

    // 5. Remove user from friends lists in other profiles
    const friendsSnap = await db.collection('profiles')
      .where('friends', 'array-contains', uid)
      .get();
    
    const friendsBatch = db.batch();
    friendsSnap.docs.forEach(doc => {
      const currentFriends = doc.data().friends || [];
      const updated = currentFriends.filter((id: string) => id !== uid);
      friendsBatch.update(doc.ref, { friends: updated });
    });
    await friendsBatch.commit();
    logger.info(`Removed user ${uid} from ${friendsSnap.size} friends lists`);

    // 6. Remove user from requestsSent lists
    const requestsSentSnap = await db.collection('profiles')
      .where('requestsSent', 'array-contains', uid)
      .get();
    
    const requestsBatch = db.batch();
    requestsSentSnap.docs.forEach(doc => {
      const currentRequests = doc.data().requestsSent || [];
      const updated = currentRequests.filter((id: string) => id !== uid);
      requestsBatch.update(doc.ref, { requestsSent: updated });
    });
    await requestsBatch.commit();
    logger.info(`Removed user ${uid} from ${requestsSentSnap.size} friend requests`);

    // 7. Delete user's Firestore profile
    await db.doc(`profiles/${uid}`).delete();
    logger.info(`Deleted profile document for user ${uid}`);

    // 8. Delete user's storage files
    try {
      const bucket = storage.bucket();
      
      // Delete profile pictures
      const [profilePictures] = await bucket.getFiles({ prefix: `profilePictures/${uid}/` });
      await Promise.all(profilePictures.map(file => file.delete()));
      logger.info(`Deleted ${profilePictures.length} profile pictures for user ${uid}`);

      // Delete chat images
      const [chatImages] = await bucket.getFiles({ prefix: `chatImages/${uid}/` });
      await Promise.all(chatImages.map(file => file.delete()));
      logger.info(`Deleted ${chatImages.length} chat images for user ${uid}`);

      // Delete audio messages
      const [audioMessages] = await bucket.getFiles({ prefix: `audioMessages/${uid}/` });
      await Promise.all(audioMessages.map(file => file.delete()));
      logger.info(`Deleted ${audioMessages.length} audio messages for user ${uid}`);

      // Delete GPX files
      const [gpxFiles] = await bucket.getFiles({ prefix: `gpx/${uid}/` });
      await Promise.all(gpxFiles.map(file => file.delete()));
      logger.info(`Deleted ${gpxFiles.length} GPX files for user ${uid}`);

      // Delete debug files
      const [debugFiles] = await bucket.getFiles({ prefix: `debug/${uid}/` });
      await Promise.all(debugFiles.map(file => file.delete()));
      logger.info(`Deleted ${debugFiles.length} debug files for user ${uid}`);
    } catch (storageError) {
      logger.warn(`Storage deletion warning for user ${uid}:`, storageError);
      // Continue with auth deletion even if storage fails
    }

    // 9. Finally, delete the Firebase Auth user
    await auth.deleteUser(uid);
    logger.info(`Successfully deleted Firebase Auth account for user ${uid}`);

    return { 
      success: true, 
      message: 'Account and all associated data have been permanently deleted' 
    };

  } catch (error) {
    logger.error(`Error deleting account for user ${uid}:`, error);
    throw new HttpsError('internal', `Failed to delete account: ${error}`);
  }
});
