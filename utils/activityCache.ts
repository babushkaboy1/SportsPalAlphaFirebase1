// utils/activityCache.ts
// Smart caching system to minimize Firestore reads
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'activities_cache';
const CACHE_TIMESTAMP_KEY = 'activities_cache_timestamp';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Historical activities cache (decorative, low priority)
const HISTORY_CACHE_KEY = 'activities_history_cache';
const HISTORY_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CachedActivity {
  id: string;
  activity: string;
  location: string;
  date: string;
  time: string;
  creator: string;
  creatorId: string;
  joinedCount: number;
  maxParticipants: number;
  latitude: number;
  longitude: number;
  description?: string;
  joinedUserIds?: string[];
  [key: string]: any;
}

interface CacheData {
  activities: CachedActivity[];
  timestamp: number;
}

/**
 * Save activities to cache
 */
export async function saveActivitiesToCache(activities: CachedActivity[]): Promise<void> {
  try {
    const cacheData: CacheData = {
      activities,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  } catch (error) {
    console.error('Failed to save activities to cache:', error);
  }
}

/**
 * Load activities from cache
 * Returns null if cache is expired or invalid
 */
export async function loadActivitiesFromCache(): Promise<CachedActivity[] | null> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const cacheData: CacheData = JSON.parse(cached);
    const age = Date.now() - cacheData.timestamp;

    // Cache expired after 5 minutes
    if (age > CACHE_DURATION) {
      return null;
    }

    return cacheData.activities;
  } catch (error) {
    console.error('Failed to load activities from cache:', error);
    return null;
  }
}

/**
 * Check if cache is still valid
 */
export async function isCacheValid(): Promise<boolean> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return false;

    const cacheData: CacheData = JSON.parse(cached);
    const age = Date.now() - cacheData.timestamp;

    return age <= CACHE_DURATION;
  } catch {
    return false;
  }
}

/**
 * Update a single activity in cache (optimistic update)
 */
export async function updateActivityInCache(
  activityId: string,
  updates: Partial<CachedActivity>
): Promise<void> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return;

    const cacheData: CacheData = JSON.parse(cached);
    const index = cacheData.activities.findIndex(a => a.id === activityId);

    if (index !== -1) {
      cacheData.activities[index] = {
        ...cacheData.activities[index],
        ...updates,
      };
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    }
  } catch (error) {
    console.error('Failed to update activity in cache:', error);
  }
}

/**
 * Clear cache (use when logging out or major data changes)
 */
export async function clearActivityCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch (error) {
    console.error('Failed to clear cache:', error);
  }
}

/**
 * Get cache age in seconds
 */
export async function getCacheAge(): Promise<number | null> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const cacheData: CacheData = JSON.parse(cached);
    return Math.floor((Date.now() - cacheData.timestamp) / 1000);
  } catch {
    return null;
  }
}

/**
 * Save historical activities to long-term cache (7 days TTL)
 * These are decorative and don't need frequent updates
 */
export async function saveHistoricalActivitiesToCache(activities: CachedActivity[]): Promise<void> {
  try {
    const cacheData: CacheData = {
      activities,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(cacheData));
    console.log(`💾 Cached ${activities.length} historical activities (7-day TTL)`);
  } catch (error) {
    console.error('Failed to save historical activities to cache:', error);
  }
}

/**
 * Load historical activities from long-term cache
 * Returns null if cache is expired (>7 days) or invalid
 */
export async function loadHistoricalActivitiesFromCache(): Promise<CachedActivity[] | null> {
  try {
    const cached = await AsyncStorage.getItem(HISTORY_CACHE_KEY);
    if (!cached) return null;

    const cacheData: CacheData = JSON.parse(cached);
    const age = Date.now() - cacheData.timestamp;

    // Cache expired after 7 days
    if (age > HISTORY_CACHE_DURATION) {
      console.log('📅 Historical cache expired (>7 days old)');
      return null;
    }

    const ageInDays = Math.floor(age / (24 * 60 * 60 * 1000));
    console.log(`📦 Loaded ${cacheData.activities.length} historical activities from cache (${ageInDays}d old)`);
    return cacheData.activities;
  } catch (error) {
    console.error('Failed to load historical activities from cache:', error);
    return null;
  }
}

/**
 * Check if historical cache is still valid
 */
export async function isHistoricalCacheValid(): Promise<boolean> {
  try {
    const cached = await AsyncStorage.getItem(HISTORY_CACHE_KEY);
    if (!cached) return false;

    const cacheData: CacheData = JSON.parse(cached);
    const age = Date.now() - cacheData.timestamp;

    return age <= HISTORY_CACHE_DURATION;
  } catch {
    return false;
  }
}

/**
 * Clear historical cache
 */
export async function clearHistoricalCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HISTORY_CACHE_KEY);
    console.log('🗑️ Cleared historical activities cache');
  } catch (error) {
    console.error('Failed to clear historical cache:', error);
  }
}
