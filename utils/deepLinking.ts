// utils/deepLinking.ts
// Free deep linking solution using Universal Links (iOS) and App Links (Android)
// Works with Firebase Hosting to serve verification files

import * as Linking from 'expo-linking';
import { Platform, Share, Clipboard } from 'react-native';

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
export function parseDeepLink(url: string): {
  type: 'activity' | 'profile' | 'chat' | 'unknown';
  id: string | null;
} {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    if (pathParts.length < 2) {
      return { type: 'unknown', id: null };
    }

    const [type, id] = pathParts;

    if (type === 'activity' && id) {
      return { type: 'activity', id };
    }

    if (type === 'profile' && id) {
      return { type: 'profile', id };
    }

    if (type === 'chat' && id) {
      return { type: 'chat', id };
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
    await Share.share({
      message: Platform.OS === 'ios' 
        ? `Check out this activity on SportsPal: ${activityName}`
        : `Check out this activity on SportsPal: ${activityName}\n\n${url}`,
      url: Platform.OS === 'ios' ? url : undefined,
      title: `Join me for ${activityName}`,
    });
  } catch (error) {
    console.error('Error sharing activity:', error);
  }
}

/**
 * Share a user profile via native share sheet
 */
export async function shareProfile(userId: string, username: string) {
  const url = generateProfileLink(userId);

  try {
    await Share.share({
      message: Platform.OS === 'ios'
        ? `Check out ${username}'s profile on SportsPal`
        : `Check out ${username}'s profile on SportsPal\n\n${url}`,
      url: Platform.OS === 'ios' ? url : undefined,
      title: `${username} on SportsPal`,
    });
  } catch (error) {
    console.error('Error sharing profile:', error);
  }
}

/**
 * Copy link to clipboard
 */
export async function copyLinkToClipboard(url: string) {
  Clipboard.setString(url);
}
