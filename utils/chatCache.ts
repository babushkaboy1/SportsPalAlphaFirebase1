// utils/chatCache.ts
// Smart caching system for chats to minimize Firestore reads
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHAT_LIST_CACHE_KEY = 'chatListCache';
const CHAT_MESSAGES_CACHE_PREFIX = 'chatMessages_';
const PROFILE_CACHE_KEY = 'profileCache';
const CHAT_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const MESSAGE_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes for messages
const PROFILE_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes for profiles

// ==================== TYPES ====================
export type CachedChat = {
  id: string;
  lastMessage?: string;
  lastMessageTime?: any;
  participants: string[];
  dmPeerId?: string;
  activityId?: string;
  groupTitle?: string;
  groupPhotoUrl?: string;
  isActivityChat?: boolean;
  isDm?: boolean;
  [key: string]: any;
};

export type CachedMessage = {
  id: string;
  senderId: string;
  text: string;
  type: 'text' | 'image' | 'audio' | 'system';
  timestamp: any;
  replyToId?: string;
  [key: string]: any;
};

export type CachedProfile = {
  uid: string;
  username: string;
  photo?: string;
  photoURL?: string;
  bio?: string;
  selectedSports?: string[];
  [key: string]: any;
};

type ChatListCache = {
  chats: CachedChat[];
  timestamp: number;
};

type ChatMessagesCache = {
  messages: CachedMessage[];
  timestamp: number;
};

type ProfileCache = {
  profiles: Record<string, CachedProfile>;
  timestamp: number;
};

// ==================== CHAT LIST CACHING ====================

/**
 * Save chat list to cache (first 5 chats for performance)
 */
export async function saveChatListToCache(chats: CachedChat[]): Promise<void> {
  try {
    // Only cache first 5 chats to keep cache small
    const chatsToCache = chats.slice(0, 5);
    const cache: ChatListCache = {
      chats: chatsToCache,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(CHAT_LIST_CACHE_KEY, JSON.stringify(cache));
    console.log('💾 Chat list cached (first 5 chats)');
  } catch (error) {
    console.error('Failed to save chat list to cache:', error);
  }
}

/**
 * Load chat list from cache if valid (< 5 minutes old)
 */
export async function loadChatListFromCache(): Promise<CachedChat[] | null> {
  try {
    const cached = await AsyncStorage.getItem(CHAT_LIST_CACHE_KEY);
    if (!cached) return null;

    const cache: ChatListCache = JSON.parse(cached);
    const age = Date.now() - cache.timestamp;

    if (age < CHAT_CACHE_DURATION) {
      console.log(`📦 Chat list loaded from cache (${Math.round(age / 1000)}s old)`);
      return cache.chats;
    } else {
      console.log('⏰ Chat list cache expired');
      return null;
    }
  } catch (error) {
    console.error('Failed to load chat list from cache:', error);
    return null;
  }
}

/**
 * Update a single chat in the cache (optimistic update)
 */
export async function updateChatInCache(chatId: string, updates: Partial<CachedChat>): Promise<void> {
  try {
    const cached = await AsyncStorage.getItem(CHAT_LIST_CACHE_KEY);
    if (!cached) return;

    const cache: ChatListCache = JSON.parse(cached);
    const chatIndex = cache.chats.findIndex(c => c.id === chatId);

    if (chatIndex !== -1) {
      cache.chats[chatIndex] = { ...cache.chats[chatIndex], ...updates };
      await AsyncStorage.setItem(CHAT_LIST_CACHE_KEY, JSON.stringify(cache));
      console.log('⚡ Chat updated in cache:', chatId);
    }
  } catch (error) {
    console.error('Failed to update chat in cache:', error);
  }
}

/**
 * Clear chat list cache
 */
export async function clearChatListCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CHAT_LIST_CACHE_KEY);
    console.log('🗑️ Chat list cache cleared');
  } catch (error) {
    console.error('Failed to clear chat list cache:', error);
  }
}

// ==================== MESSAGE CACHING ====================

/**
 * Save last 20 messages for a chat
 */
export async function saveMessagesToCache(chatId: string, messages: CachedMessage[]): Promise<void> {
  try {
    // Only cache last 20 messages
    const messagesToCache = messages.slice(-20);
    const cache: ChatMessagesCache = {
      messages: messagesToCache,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(
      `${CHAT_MESSAGES_CACHE_PREFIX}${chatId}`,
      JSON.stringify(cache)
    );
    console.log(`💾 Messages cached for chat ${chatId} (${messagesToCache.length} messages)`);
  } catch (error) {
    console.error('Failed to save messages to cache:', error);
  }
}

/**
 * Load messages from cache if valid (< 10 minutes old)
 */
export async function loadMessagesFromCache(chatId: string): Promise<CachedMessage[] | null> {
  try {
    const cached = await AsyncStorage.getItem(`${CHAT_MESSAGES_CACHE_PREFIX}${chatId}`);
    if (!cached) return null;

    const cache: ChatMessagesCache = JSON.parse(cached);
    const age = Date.now() - cache.timestamp;

    if (age < MESSAGE_CACHE_DURATION) {
      console.log(`📦 Messages loaded from cache for ${chatId} (${Math.round(age / 1000)}s old)`);
      return cache.messages;
    } else {
      console.log(`⏰ Message cache expired for ${chatId}`);
      return null;
    }
  } catch (error) {
    console.error('Failed to load messages from cache:', error);
    return null;
  }
}

/**
 * Add a new message to cache (optimistic update)
 */
export async function addMessageToCache(chatId: string, message: CachedMessage): Promise<void> {
  try {
    const cached = await AsyncStorage.getItem(`${CHAT_MESSAGES_CACHE_PREFIX}${chatId}`);
    let messages: CachedMessage[] = [];

    if (cached) {
      const cache: ChatMessagesCache = JSON.parse(cached);
      messages = cache.messages;
    }

    // Add new message and keep only last 20
    messages.push(message);
    messages = messages.slice(-20);

    const cache: ChatMessagesCache = {
      messages,
      timestamp: Date.now(),
    };

    await AsyncStorage.setItem(
      `${CHAT_MESSAGES_CACHE_PREFIX}${chatId}`,
      JSON.stringify(cache)
    );
    console.log(`⚡ Message added to cache for ${chatId}`);
  } catch (error) {
    console.error('Failed to add message to cache:', error);
  }
}

/**
 * Clear messages cache for a specific chat
 */
export async function clearMessagesCache(chatId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${CHAT_MESSAGES_CACHE_PREFIX}${chatId}`);
    console.log(`🗑️ Messages cache cleared for ${chatId}`);
  } catch (error) {
    console.error('Failed to clear messages cache:', error);
  }
}

/**
 * Clear all message caches
 */
export async function clearAllMessageCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const messageKeys = keys.filter(k => k.startsWith(CHAT_MESSAGES_CACHE_PREFIX));
    await AsyncStorage.multiRemove(messageKeys);
    console.log(`🗑️ All message caches cleared (${messageKeys.length} chats)`);
  } catch (error) {
    console.error('Failed to clear all message caches:', error);
  }
}

// ==================== PROFILE CACHING ====================

/**
 * Save profiles to cache (for chat avatars and usernames)
 */
export async function saveProfilesToCache(profiles: Record<string, CachedProfile>): Promise<void> {
  try {
    // Validate and normalize all profiles
    const normalizedProfiles: Record<string, CachedProfile> = {};
    Object.entries(profiles).forEach(([uid, profile]) => {
      normalizedProfiles[uid] = {
        uid: profile.uid || uid,
        username: profile.username || 'User',
        photo: profile.photo || profile.photoURL,
        photoURL: profile.photoURL || profile.photo,
        bio: profile.bio,
        selectedSports: profile.selectedSports,
      };
    });
    
    const cache: ProfileCache = {
      profiles: normalizedProfiles,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(cache));
    console.log(`💾 Profiles cached (${Object.keys(normalizedProfiles).length} profiles)`);
  } catch (error) {
    console.error('Failed to save profiles to cache:', error);
  }
}

/**
 * Load profiles from cache if valid (< 30 minutes old)
 */
export async function loadProfilesFromCache(): Promise<Record<string, CachedProfile> | null> {
  try {
    const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (!cached) return null;

    const cache: ProfileCache = JSON.parse(cached);
    const age = Date.now() - cache.timestamp;

    if (age < PROFILE_CACHE_DURATION) {
      console.log(`📦 Profiles loaded from cache (${Math.round(age / 1000)}s old, ${Object.keys(cache.profiles).length} profiles)`);
      return cache.profiles;
    } else {
      console.log('⏰ Profile cache expired');
      return null;
    }
  } catch (error) {
    console.error('Failed to load profiles from cache:', error);
    return null;
  }
}

/**
 * Update or add a single profile in cache
 */
export async function updateProfileInCache(profile: CachedProfile): Promise<void> {
  try {
    const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    let profiles: Record<string, CachedProfile> = {};

    if (cached) {
      const cache: ProfileCache = JSON.parse(cached);
      profiles = cache.profiles;
    }

    // Ensure profile has all required fields
    profiles[profile.uid] = {
      uid: profile.uid,
      username: profile.username || 'User',
      photo: profile.photo || profile.photoURL,
      photoURL: profile.photoURL || profile.photo,
      bio: profile.bio,
      selectedSports: profile.selectedSports,
    };

    const cache: ProfileCache = {
      profiles,
      timestamp: Date.now(),
    };

    await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(cache));
    console.log(`⚡ Profile updated in cache: ${profile.username}`);
  } catch (error) {
    console.error('Failed to update profile in cache:', error);
  }
}

/**
 * Get a single profile from cache
 */
export async function getProfileFromCache(uid: string): Promise<CachedProfile | null> {
  try {
    const profiles = await loadProfilesFromCache();
    return profiles?.[uid] || null;
  } catch (error) {
    console.error('Failed to get profile from cache:', error);
    return null;
  }
}

/**
 * Clear profile cache
 */
export async function clearProfileCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PROFILE_CACHE_KEY);
    console.log('🗑️ Profile cache cleared');
  } catch (error) {
    console.error('Failed to clear profile cache:', error);
  }
}

// ==================== CACHE MANAGEMENT ====================

/**
 * Get cache age in seconds
 */
export async function getChatCacheAge(): Promise<number | null> {
  try {
    const cached = await AsyncStorage.getItem(CHAT_LIST_CACHE_KEY);
    if (!cached) return null;

    const cache: ChatListCache = JSON.parse(cached);
    return Math.round((Date.now() - cache.timestamp) / 1000);
  } catch (error) {
    return null;
  }
}

/**
 * Check if chat list cache is valid
 */
export async function isChatCacheValid(): Promise<boolean> {
  try {
    const cached = await AsyncStorage.getItem(CHAT_LIST_CACHE_KEY);
    if (!cached) return false;

    const cache: ChatListCache = JSON.parse(cached);
    const age = Date.now() - cache.timestamp;
    return age < CHAT_CACHE_DURATION;
  } catch (error) {
    return false;
  }
}

/**
 * Clear all chat-related caches (on logout)
 */
export async function clearAllChatCaches(): Promise<void> {
  try {
    await clearChatListCache();
    await clearAllMessageCaches();
    await clearProfileCache();
    console.log('🗑️ All chat caches cleared');
  } catch (error) {
    console.error('Failed to clear all chat caches:', error);
  }
}
