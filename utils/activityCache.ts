// utils/activityCache.ts
// Smart caching system to minimize Firestore reads
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'activities_cache';
const CACHE_TIMESTAMP_KEY = 'activities_cache_timestamp';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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
