// @ts-nocheck
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getMessaging } from 'firebase-admin/messaging';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
// @ts-ignore
import * as forge from 'node-forge';
// @ts-ignore - passkit-generator ships without typings
import { PKPass } from 'passkit-generator';

initializeApp();
const db = getFirestore();
const auth = getAuth();
const storage = getStorage();
const messaging = getMessaging();
const expo = new Expo();

// Minimal 1x1 PNG to satisfy required pass assets (icon/logo)
const PASS_ICON = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y2GsH0AAAAASUVORK5CYII=',
  'base64'
);

// Sport to emoji mapping for pass display
const SPORT_EMOJIS: Record<string, string> = {
  basketball: '🏀',
  running: '🏃',
  soccer: '⚽',
  hiking: '🥾',
  gym: '🏋️',
  calisthenics: '💪',
  padel: '🎾',
  tennis: '🎾',
  cycling: '🚴',
  swimming: '🏊',
  badminton: '🏸',
  volleyball: '🏐',
  'table tennis': '🏓',
  'table-tennis': '🏓',
  boxing: '🥊',
  yoga: '🧘',
  'martial arts': '🥋',
  karate: '🥋',
  'american football': '🏈',
  'american-football': '🏈',
  cricket: '🏏',
  golf: '⛳',
  baseball: '⚾',
  'field hockey': '🏑',
  'field-hockey': '🏑',
  'ice hockey': '🏒',
  'ice-hockey': '🏒',
};

function getSportEmojis(sports: string[]): string {
  if (!sports.length) return '🏃';
  return sports
    .slice(0, 5) // max 5 emojis
    .map(s => SPORT_EMOJIS[s.toLowerCase().trim()] || '🎯')
    .join(' ');
}

// Get all push tokens for a user (both Expo and FCM)
async function getTokensForUser(userId: string): Promise<{ expoTokens: string[]; fcmTokens: string[] }> {
  try {
    const snap = await db.doc(`profiles/${userId}`).get();
    const data = snap.data() as any;
    const expoTokens: string[] = Array.isArray(data?.expoPushTokens) 
      ? data.expoPushTokens.filter((t: string) => Expo.isExpoPushToken(t)) 
      : [];
    const fcmTokens: string[] = Array.isArray(data?.fcmPushTokens) 
      ? data.fcmPushTokens 
      : [];
    return { expoTokens, fcmTokens };
  } catch (e) {
    return { expoTokens: [], fcmTokens: [] };
  }
}

// Legacy function for backwards compatibility
async function getExpoTokensForUser(userId: string): Promise<string[]> {
  const { expoTokens } = await getTokensForUser(userId);
  return expoTokens;
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

// Send FCM notifications (for Android - shows "SportsPal" as sender)
async function sendFcmNotifications(
  tokens: string[], 
  title: string, 
  body: string, 
  data?: Record<string, string>
) {
  if (!tokens.length) return;
  
  const message = {
    tokens,
    notification: {
      title,
      body,
    },
    data: data || {},
    android: {
      priority: 'high' as const,
      notification: {
        channelId: 'default',
        priority: 'high' as const,
        defaultSound: true,
        defaultVibrateTimings: true,
      },
    },
  };

  try {
    const response = await messaging.sendEachForMulticast(message);
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          logger.warn(`FCM send failed for token ${idx}:`, resp.error);
        }
      });
    }
    logger.info(`FCM sent: ${response.successCount} success, ${response.failureCount} failed`);
  } catch (e) {
    logger.error('FCM send failed:', e);
  }
}

// Send to all tokens for a user (FCM for Android, Expo for iOS)
async function sendNotificationToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, any>
) {
  const { expoTokens, fcmTokens } = await getTokensForUser(userId);
  
  // Convert data values to strings for FCM
  const stringData: Record<string, string> = {};
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = String(value);
    }
  }

  // Send to FCM tokens (Android)
  if (fcmTokens.length > 0) {
    await sendFcmNotifications(fcmTokens, title, body, stringData);
  }

  // Send to Expo tokens (iOS and fallback)
  if (expoTokens.length > 0) {
    const messages: ExpoPushMessage[] = expoTokens.map((to) => ({
      to,
      title,
      body,
      data: data || {},
      sound: 'default',
      priority: 'high',
    }));
    await sendExpoNotifications(messages);
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
    const notifData = { type: 'chat', chatId, messageId, senderPhoto: senderPhoto || '' };

    // Send notifications to all recipients using the unified function
    await Promise.all(recipients.map((userId) => 
      sendNotificationToUser(userId, senderName, body, notifData)
    ));
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

  const notifData = type === 'activity_invite' && activityId 
    ? { type: 'activity_invite', activityId } 
    : { type };

  await sendNotificationToUser(userId, title, body, notifData);
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
 * Generate Apple Wallet pass (.pkpass) for a user
 * Env (set via functions:config or runtime env):
 *   APPLE_TEAM_ID, APPLE_PASS_TYPE_ID, APPLE_P12_PASSWORD, APPLE_P12_PATH (default ./secrets/apple-pass.p12), optional APPLE_WWDR_PATH
 * Deploy: firebase deploy --only functions:getAppleWalletPass
 */
export const getAppleWalletPass = onRequest({ 
  timeoutSeconds: 20,
  secrets: ["APPLE_TEAM_ID", "APPLE_PASS_TYPE_ID", "APPLE_P12_PASSWORD", "APPLE_P12_PATH"]
}, async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.status(405).send('Method not allowed');
      return;
    }

    const userId = (req.query.userId as string | undefined)?.trim();
    if (!userId) {
      res.status(400).send('Missing userId');
      return;
    }

    const teamId = process.env.APPLE_TEAM_ID;
    const passTypeId = process.env.APPLE_PASS_TYPE_ID;
    const p12Password = process.env.APPLE_P12_PASSWORD;
    const p12Path = process.env.APPLE_P12_PATH || './secrets/apple-pass.p12';
    const wwdrPath = process.env.APPLE_WWDR_PATH || './secrets/wwdr.pem';

    if (!teamId || !passTypeId || !p12Password) {
      res.status(500).send('Missing Apple Wallet configuration. Set APPLE_TEAM_ID, APPLE_PASS_TYPE_ID, APPLE_P12_PASSWORD.');
      return;
    }

    const resolvedP12Path = path.resolve(__dirname, '..', p12Path);
    if (!fs.existsSync(resolvedP12Path)) {
      res.status(500).send('Apple pass certificate not found on server. Upload secrets and redeploy.');
      return;
    }

    let wwdrBuffer: Buffer | undefined;
    const resolvedWwdr = path.resolve(__dirname, '..', wwdrPath);
    if (fs.existsSync(resolvedWwdr)) {
      wwdrBuffer = fs.readFileSync(resolvedWwdr);
    } else {
      logger.warn(`WWDR certificate not found at ${resolvedWwdr}`);
    }



    // Load user profile (users/{id} or fallback profiles/{id})
    const userDoc = await db.doc(`users/${userId}`).get();
    let userData: any = userDoc.data();
    if (!userData) {
      const profileDoc = await db.doc(`profiles/${userId}`).get();
      userData = profileDoc.data();
    }

    if (!userData) {
      res.status(404).send('User not found');
      return;
    }

    const username = userData.username || userData.username_lower || 'Member';
    const sportsArray: string[] = Array.isArray(userData.sports)
      ? userData.sports
      : Array.isArray(userData.selectedSports)
        ? userData.selectedSports
        : [];
    const sportsEmojis = getSportEmojis(sportsArray);
    const sportsValue = sportsArray.length ? sportsArray.slice(0, 3).join(', ') : 'Active Athlete';
    const createdAt = userData.createdAt?.toDate ? userData.createdAt.toDate() : (userData.createdAt?._seconds ? new Date(userData.createdAt._seconds * 1000) : null);
    const memberSinceYear = createdAt ? String(createdAt.getFullYear()) : '2025';
    const memberSinceFormatted = createdAt 
      ? createdAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'Member';
    
    // Parse birthday if available
    let birthdayDisplay = '';
    if (userData.birthday) {
      try {
        const bday = userData.birthday?.toDate ? userData.birthday.toDate() : new Date(userData.birthday);
        birthdayDisplay = bday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } catch { /* ignore */ }
    }

    // Format sports list nicely (capitalize first letter)
    const formatSport = (sport: string) => sport.charAt(0).toUpperCase() + sport.slice(1).toLowerCase();
    const sportsFormatted = sportsArray.length 
      ? sportsArray.slice(0, 3).map(formatSport).join(' • ')
      : 'Active Athlete';

    // Extract cert and key from P12 using node-forge
    const p12Buffer = fs.readFileSync(resolvedP12Path);
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, p12Password);

    // Get certificate
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag]?.[0];
    if (!certBag) {
      throw new Error('No certificate found in P12');
    }
    const cert = certBag.cert;
    const signerCert = forge.pki.certificateToPem(cert);

    // Get private key
    let keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    if (!keyBag) {
      keyBag = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
    }
    if (!keyBag) {
      throw new Error('No private key found in P12');
    }
    const key = keyBag.key;
    const signerKey = forge.pki.privateKeyToPem(key);

    const certificates: any = {
      wwdr: wwdrBuffer,
      signerCert,
      signerKey,
    };

    // Load real logo and icon assets
    const logoPath = path.resolve(__dirname, '..', 'secrets/logo.png');
    const iconPath = path.resolve(__dirname, '..', 'secrets/icon.png');
    const logoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : PASS_ICON;
    const iconBuffer = fs.existsSync(iconPath) ? fs.readFileSync(iconPath) : PASS_ICON;

    // Build the pass.json content - Premium SportsPal Pass
    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: passTypeId,
      teamIdentifier: teamId,
      serialNumber: userId,
      organizationName: 'SportsPal',
      description: 'SportsPal Member Pass',
      backgroundColor: 'rgb(18,18,18)', // Dark theme background #121212
      foregroundColor: 'rgb(26,233,239)', // Primary cyan #1ae9ef
      labelColor: 'rgb(160,160,160)', // Subtle gray for labels
      logoText: 'SportsPal',
      generic: {
        headerFields: [
          { key: 'memberSince', label: 'MEMBER SINCE', value: memberSinceFormatted },
        ],
        primaryFields: [
          { key: 'username', label: '', value: username },
        ],
        secondaryFields: [
          { key: 'sports', label: 'SPORTS', value: sportsFormatted },
        ],
        auxiliaryFields: birthdayDisplay ? [
          { key: 'birthday', label: 'BIRTHDAY', value: birthdayDisplay },
        ] : [],
        backFields: [
          { key: 'uid', label: 'Member ID', value: userId },
          { key: 'appInfo', label: 'About SportsPal', value: 'Find sports partners, join activities, and stay active with your community!' },
          { key: 'website', label: 'Website', value: 'sportspal.app' },
          { key: 'support', label: 'Support', value: 'support@sportspal.app' },
        ],
      },
      barcodes: [
        {
          format: 'PKBarcodeFormatQR',
          message: `https://sportspal.app/profile/${userId}`,
          messageEncoding: 'iso-8859-1',
          altText: `@${username}`,
        },
      ],
    };

    // Try to fetch user's profile picture as thumbnail
    let thumbnailBuffer: Buffer | null = null;
    const photoUrl = userData.photo || userData.photoURL;
    if (photoUrl && typeof photoUrl === 'string') {
      try {
        const response = await fetch(photoUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          thumbnailBuffer = Buffer.from(arrayBuffer);
        }
      } catch (e) {
        logger.warn('Could not fetch profile picture for pass thumbnail', e);
      }
    }

    // Build the pass files
    const passFiles: Record<string, Buffer> = {
      'pass.json': Buffer.from(JSON.stringify(passJson)),
      'icon.png': iconBuffer,
      'icon@2x.png': iconBuffer,
      'logo.png': logoBuffer,
      'logo@2x.png': logoBuffer,
    };

    // Add thumbnail if we have a profile picture
    if (thumbnailBuffer) {
      passFiles['thumbnail.png'] = thumbnailBuffer;
      passFiles['thumbnail@2x.png'] = thumbnailBuffer;
    }

    // Create pass using Buffer model (v3 API)
    const pass = new PKPass(passFiles, certificates);

    const buffer: Buffer = await pass.getAsBuffer();

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', 'attachment; filename="sportspal.pkpass"');
    res.status(200).send(buffer);
  } catch (err: any) {
    logger.error('getAppleWalletPass failed', err);
    res.status(500).send('Failed to generate pass');
  }
});

/**
 * Generate Google Wallet pass (JWT save URL) for a user
 * Returns a URL that opens Google Wallet to save the pass
 * 
 * Required secrets:
 *   GOOGLE_WALLET_ISSUER_ID - Your Google Wallet Issuer ID
 *   GOOGLE_WALLET_KEY_PATH - Path to service account JSON (default: ./secrets/google-wallet-key.json)
 * 
 * Deploy: firebase deploy --only functions:getGoogleWalletPassUrl
 */
export const getGoogleWalletPassUrl = onRequest({ 
  timeoutSeconds: 20,
  cors: true,
}, async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.status(405).send('Method not allowed');
      return;
    }

    const userId = (req.query.userId as string | undefined)?.trim();
    if (!userId) {
      res.status(400).send('Missing userId');
      return;
    }

    // Configuration
    const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID || '3388000000023034306';
    const keyPath = process.env.GOOGLE_WALLET_KEY_PATH || './secrets/google-wallet-key.json';

    // Load service account key
    const resolvedKeyPath = path.resolve(__dirname, '..', keyPath);
    if (!fs.existsSync(resolvedKeyPath)) {
      logger.error(`Google Wallet key not found at ${resolvedKeyPath}`);
      res.status(500).send('Google Wallet configuration not found. Upload service account key and redeploy.');
      return;
    }

    const serviceAccountKey = JSON.parse(fs.readFileSync(resolvedKeyPath, 'utf8'));
    if (!serviceAccountKey.private_key || !serviceAccountKey.client_email) {
      res.status(500).send('Invalid service account key format.');
      return;
    }

    // Load user profile
    const userDoc = await db.doc(`users/${userId}`).get();
    let userData: any = userDoc.data();
    if (!userData) {
      const profileDoc = await db.doc(`profiles/${userId}`).get();
      userData = profileDoc.data();
    }

    if (!userData) {
      res.status(404).send('User not found');
      return;
    }

    const username = userData.username || userData.username_lower || 'Member';
    const sportsArray: string[] = Array.isArray(userData.sports)
      ? userData.sports
      : Array.isArray(userData.selectedSports)
        ? userData.selectedSports
        : [];
    
    // Format sports list nicely (capitalize first letter)
    const formatSport = (sport: string) => sport.charAt(0).toUpperCase() + sport.slice(1).toLowerCase();
    const sportsFormatted = sportsArray.length 
      ? sportsArray.slice(0, 4).map(formatSport).join(' • ')
      : 'Active Athlete';
    
    const createdAt = userData.createdAt?.toDate 
      ? userData.createdAt.toDate() 
      : (userData.createdAt?._seconds ? new Date(userData.createdAt._seconds * 1000) : null);
    const memberSinceFormatted = createdAt 
      ? createdAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'SportsPal Member';
    
    // Parse birthday if available
    let birthdayDisplay = '';
    if (userData.birthday) {
      try {
        const bday = userData.birthday?.toDate ? userData.birthday.toDate() : new Date(userData.birthday);
        birthdayDisplay = bday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } catch { /* ignore */ }
    }

    // Get profile photo URL for header image
    const photoUrl = userData.photo || userData.photoURL || '';

    // Create a unique object ID for this pass
    const objectId = `${issuerId}.sportspal-${userId}`;

    // Build text modules for the pass
    const textModulesData = [
      {
        id: 'sports',
        header: 'SPORTS',
        body: sportsFormatted,
      },
    ];
    
    // Add birthday if available
    if (birthdayDisplay) {
      textModulesData.push({
        id: 'birthday',
        header: 'BIRTHDAY',
        body: birthdayDisplay,
      });
    }
    
    // Add Member ID
    textModulesData.push({
      id: 'memberId',
      header: 'MEMBER ID',
      body: userId.slice(0, 12) + '...',
    });

    // Build the Generic Pass object - Premium Design
    // See: https://developers.google.com/wallet/generic/rest/v1/genericobject
    const genericObject = {
      id: objectId,
      classId: `${issuerId}.sportspal-pass`,
      genericType: 'GENERIC_TYPE_UNSPECIFIED',
      hexBackgroundColor: '#121212', // Dark theme
      logo: {
        sourceUri: {
          uri: 'https://sportspal-1b468.web.app/logo.png',
        },
        contentDescription: {
          defaultValue: {
            language: 'en',
            value: 'SportsPal',
          },
        },
      },
      cardTitle: {
        defaultValue: {
          language: 'en',
          value: 'SportsPal',
        },
      },
      subheader: {
        defaultValue: {
          language: 'en',
          value: `Member since ${memberSinceFormatted}`,
        },
      },
      header: {
        defaultValue: {
          language: 'en',
          value: username,
        },
      },
      textModulesData,
      linksModuleData: {
        uris: [
          {
            uri: 'https://sportspal.app',
            description: 'Visit SportsPal',
            id: 'website',
          },
          {
            uri: `https://sportspal.app/profile/${userId}`,
            description: 'View Profile',
            id: 'profile',
          },
        ],
      },
      barcode: {
        type: 'QR_CODE',
        value: `https://sportspal.app/profile/${userId}`,
        alternateText: `@${username}`,
      },
      heroImage: photoUrl ? {
        sourceUri: {
          uri: photoUrl,
        },
        contentDescription: {
          defaultValue: {
            language: 'en',
            value: `${username}'s profile`,
          },
        },
      } : undefined,
    };

    // Remove undefined heroImage if no photo
    if (!photoUrl) {
      delete genericObject.heroImage;
    }

    // Define the Generic Pass Class (will be created if it doesn't exist)
    const classId = `${issuerId}.sportspal-pass`;
    const genericClass = {
      id: classId,
      issuerName: 'SportsPal',
      reviewStatus: 'DRAFT',  // Use DRAFT for testing, change to UNDER_REVIEW for production
    };

    // Build JWT claims
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: serviceAccountKey.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: now,
      origins: ['https://sportspal-1b468.web.app', 'https://sportspal.app'],
      payload: {
        genericClasses: [genericClass],
        genericObjects: [genericObject],
      },
    };

    // Sign the JWT with RS256 using Node's crypto module
    const header = {
      alg: 'RS256',
      typ: 'JWT',
    };

    const base64UrlEncode = (data: string | Buffer): string => {
      const base64 = Buffer.isBuffer(data) 
        ? data.toString('base64')
        : Buffer.from(data).toString('base64');
      return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    };

    const headerEncoded = base64UrlEncode(JSON.stringify(header));
    const claimsEncoded = base64UrlEncode(JSON.stringify(claims));
    const signatureInput = `${headerEncoded}.${claimsEncoded}`;

    // Create signature using Node's crypto module (RS256 = RSA + SHA256)
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    sign.end();
    const signatureBuffer = sign.sign(serviceAccountKey.private_key);
    const signatureBase64Url = base64UrlEncode(signatureBuffer);

    const jwt = `${signatureInput}.${signatureBase64Url}`;

    // Build the save URL
    const saveUrl = `https://pay.google.com/gp/v/save/${jwt}`;

    logger.info(`Generated Google Wallet pass URL for user ${userId}, objectId: ${objectId}`);

    // Return the URL as JSON
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ saveUrl, objectId });

  } catch (err: any) {
    logger.error('getGoogleWalletPassUrl failed', { error: err.message, stack: err.stack });
    res.status(500).send(`Failed to generate Google Wallet pass URL: ${err.message}`);
  }
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
