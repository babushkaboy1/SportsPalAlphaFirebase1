// utils/firestoreBlocks.ts
import { doc, updateDoc, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';

// In-memory cache for blocked users (reduces Firestore reads)
let blockedUsersCache: string[] | null = null;
let blockedByCacheMap: Map<string, boolean> = new Map();
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

/**
 * Clear the blocked users cache (call after blocking/unblocking)
 */
export function clearBlockedUsersCache(): void {
  blockedUsersCache = null;
  blockedByCacheMap.clear();
  cacheTimestamp = 0;
}

/**
 * Block a user
 * @param targetUserId - The user ID to block
 */
export async function blockUser(targetUserId: string): Promise<void> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) throw new Error('Not authenticated');
  if (currentUserId === targetUserId) throw new Error('Cannot block yourself');

  const myProfileRef = doc(db, 'profiles', currentUserId);
  
  // Add to blocked list
  await updateDoc(myProfileRef, {
    blockedUsers: arrayUnion(targetUserId)
  });
  
  // Remove from friends if they were friends
  await updateDoc(myProfileRef, {
    friends: arrayRemove(targetUserId),
    requestsSent: arrayRemove(targetUserId)
  });
  
  // Remove from their friends/requests too
  const theirProfileRef = doc(db, 'profiles', targetUserId);
  try {
    await updateDoc(theirProfileRef, {
      friends: arrayRemove(currentUserId),
      requestsSent: arrayRemove(currentUserId)
    });
  } catch (e) {
    // Ignore if we can't update their profile (privacy rules)
    console.log('Could not update blocked user profile (expected)');
  }
  
  // Clear cache to reflect changes
  clearBlockedUsersCache();
}

/**
 * Unblock a user
 * @param targetUserId - The user ID to unblock
 */
export async function unblockUser(targetUserId: string): Promise<void> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) throw new Error('Not authenticated');

  const myProfileRef = doc(db, 'profiles', currentUserId);
  
  await updateDoc(myProfileRef, {
    blockedUsers: arrayRemove(targetUserId)
  });
  
  // Clear cache to reflect changes
  clearBlockedUsersCache();
}

/**
 * Check if a user is blocked by current user
 * @param targetUserId - The user ID to check
 * @returns true if blocked, false otherwise
 */
export async function isUserBlocked(targetUserId: string): Promise<boolean> {
  const blockedUsers = await getBlockedUsers();
  return blockedUsers.includes(targetUserId);
}

/**
 * Check if current user is blocked by another user
 * Uses cache to minimize Firestore reads
 * @param targetUserId - The user ID to check
 * @returns true if blocked by them, false otherwise
 */
export async function isBlockedByUser(targetUserId: string): Promise<boolean> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) return false;
  
  // Check cache first
  if (blockedByCacheMap.has(targetUserId)) {
    return blockedByCacheMap.get(targetUserId) || false;
  }

  try {
    const theirProfileRef = doc(db, 'profiles', targetUserId);
    const theirProfile = await getDoc(theirProfileRef);
    
    if (!theirProfile.exists()) {
      blockedByCacheMap.set(targetUserId, false);
      return false;
    }
    
    const theirBlockedUsers: string[] = theirProfile.data()?.blockedUsers || [];
    const isBlocked = theirBlockedUsers.includes(currentUserId);
    blockedByCacheMap.set(targetUserId, isBlocked);
    return isBlocked;
  } catch (e) {
    // If we can't read their profile, assume not blocked
    return false;
  }
}

/**
 * Check if there's a block relationship in either direction
 * @param targetUserId - The user ID to check
 * @returns true if either user blocked the other
 */
export async function hasBlockRelationship(targetUserId: string): Promise<boolean> {
  const [iBlocked, theyBlocked] = await Promise.all([
    isUserBlocked(targetUserId),
    isBlockedByUser(targetUserId)
  ]);
  return iBlocked || theyBlocked;
}

/**
 * Get list of blocked user IDs (with caching)
 * @returns Array of blocked user IDs
 */
export async function getBlockedUsers(): Promise<string[]> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) return [];
  
  // Check cache first
  const now = Date.now();
  const cached = blockedUsersCache;
  if (cached !== null && (now - cacheTimestamp) < CACHE_TTL) {
    return cached;
  }

  const myProfileRef = doc(db, 'profiles', currentUserId);
  const myProfile = await getDoc(myProfileRef);
  
  if (!myProfile.exists()) {
    blockedUsersCache = [];
    cacheTimestamp = now;
    return [];
  }
  
  const blockedUsers: string[] = myProfile.data()?.blockedUsers || [];
  blockedUsersCache = blockedUsers;
  cacheTimestamp = now;
  return blockedUsers;
}

/**
 * Get cached blocked users synchronously (returns empty if not cached)
 * Useful for filtering in render functions
 */
export function getBlockedUsersCached(): string[] {
  return blockedUsersCache ?? [];
}

/**
 * Check if user ID is in blocked list (synchronous, uses cache)
 */
export function isUserBlockedCached(targetUserId: string): boolean {
  return (blockedUsersCache || []).includes(targetUserId);
}
