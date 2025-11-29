// utils/deepLinking.ts
// Free deep linking solution using Universal Links (iOS) and App Links (Android)
// Works with Firebase Hosting to serve verification files

import * as Linking from 'expo-linking';
import { Platform, Share, Clipboard } from 'react-native';

export type DeepLinkType = 'activity' | 'profile' | 'chat' | 'unknown';

export type DeepLinkParseResult = {
  type: DeepLinkType;
  id: string | null;
};

// Your app's domain (will be yourapp.web.app or custom domain)
const APP_DOMAIN = 'sportspal-1b468.web.app'; // Your Firebase Hosting domain

/**
 * Generate a deep link URL for an activity
 */
export function generateActivityLink(activityId: string): string {
  return `https://${APP_DOMAIN}/activity/${activityId}`;
}

/**
 * Generate a deep link URL for a user profile
 */
export function generateProfileLink(userId: string): string {
  return `https://${APP_DOMAIN}/profile/${userId}`;
}

/**
 * Generate a deep link URL for a chat
 */
export function generateChatLink(chatId: string): string {
  return `https://${APP_DOMAIN}/chat/${chatId}`;
}

/**
 * Parse incoming deep link and extract route info
 */
export function parseDeepLink(url: string): DeepLinkParseResult {
  try {
    // Support both universal links and custom schemes (sportspal:/activity/123)
    const parsed = Linking.parse(url);

    // Firebase links may embed the real link in the `link` query param
    const deepLinkParam = parsed.queryParams?.link;
    if (typeof deepLinkParam === 'string' && deepLinkParam.length > 0) {
      return parseDeepLink(decodeURIComponent(deepLinkParam));
    }

    const pathSegments = (parsed.path || '').split('/').filter(Boolean);

    if (pathSegments.length >= 2) {
      const [typeSegment, idSegment] = pathSegments;
      if (typeSegment === 'activity' && idSegment) {
        return { type: 'activity', id: idSegment };
      }
      if (typeSegment === 'profile' && idSegment) {
        return { type: 'profile', id: idSegment };
      }
      if (typeSegment === 'chat' && idSegment) {
        return { type: 'chat', id: idSegment };
      }
    }

    // Some clients may send ?activityId=... style links
    const qp = parsed.queryParams || {};
    if (typeof qp.activityId === 'string') {
      return { type: 'activity', id: qp.activityId };
    }
    if (typeof qp.profileId === 'string') {
      return { type: 'profile', id: qp.profileId };
    }
    if (typeof qp.userId === 'string') {
      return { type: 'profile', id: qp.userId };
    }
    if (typeof qp.chatId === 'string') {
      return { type: 'chat', id: qp.chatId };
    }

    return { type: 'unknown', id: null };
  } catch (error) {
    console.error('Error parsing deep link:', error);
    return { type: 'unknown', id: null };
  }
}

/**
 * Setup deep link listener
 * Call this in your App.tsx on mount
 */
export function setupDeepLinkListener(
  onActivityLink: (activityId: string) => void,
  onProfileLink: (userId: string) => void,
  onChatLink: (chatId: string) => void
) {
  // Handle initial URL (app opened via link)
  Linking.getInitialURL().then((url) => {
    if (url) {
      handleDeepLink(url, onActivityLink, onProfileLink, onChatLink);
    }
  });

  // Handle URLs while app is running
  const subscription = Linking.addEventListener('url', ({ url }) => {
    handleDeepLink(url, onActivityLink, onProfileLink, onChatLink);
  });

  return () => subscription.remove();
}

/**
 * Handle a deep link and route to appropriate screen
 */
function handleDeepLink(
  url: string,
  onActivityLink: (activityId: string) => void,
  onProfileLink: (userId: string) => void,
  onChatLink: (chatId: string) => void
) {
  const { type, id } = parseDeepLink(url);

  if (!id) return;

  switch (type) {
    case 'activity':
      onActivityLink(id);
      break;
    case 'profile':
      onProfileLink(id);
      break;
    case 'chat':
      onChatLink(id);
      break;
    default:
      console.log('Unknown deep link type:', type);
  }
}

/**
 * Share an activity via native share sheet
 */
export async function shareActivity(activityId: string, activityName: string) {
  const url = generateActivityLink(activityId);

  try {
    const result = await Share.share(
      Platform.OS === 'ios'
        ? {
            url: url,
            message: `Check out this activity on SportsPal: ${activityName}`,
          }
        : {
            message: `Check out this activity on SportsPal: ${activityName}\n\n${url}`,
          },
      Platform.OS === 'ios'
        ? {
            subject: `Join me for ${activityName}`,
          }
        : undefined
    );

    if (result.action === Share.sharedAction) {
      console.log('Activity shared successfully');
    } else if (result.action === Share.dismissedAction) {
      console.log('Share dismissed');
    }
  } catch (error: any) {
    console.error('Error sharing activity:', error);
    throw error;
  }
}

/**
 * Share a user profile via native share sheet
 */
export async function shareProfile(userId: string, username: string) {
  const url = generateProfileLink(userId);

  try {
    const result = await Share.share(
      Platform.OS === 'ios'
        ? {
            url: url,
            message: `Check out ${username}'s profile on SportsPal`,
          }
        : {
            message: `Check out ${username}'s profile on SportsPal\n\n${url}`,
          },
      Platform.OS === 'ios'
        ? {
            subject: `${username} on SportsPal`,
          }
        : undefined
    );

    if (result.action === Share.sharedAction) {
      console.log('Profile shared successfully');
    } else if (result.action === Share.dismissedAction) {
      console.log('Share dismissed');
    }
  } catch (error: any) {
    console.error('Error sharing profile:', error);
    throw error;
  }
}

/**
 * Copy link to clipboard
 */
export async function copyLinkToClipboard(url: string) {
  Clipboard.setString(url);
}
