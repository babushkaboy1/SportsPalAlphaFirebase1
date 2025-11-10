// utils/firestoreBlocks.ts
import { doc, updateDoc, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';

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
  await updateDoc(theirProfileRef, {
    friends: arrayRemove(currentUserId),
    requestsSent: arrayRemove(currentUserId)
  });
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
}

/**
 * Check if a user is blocked
 * @param targetUserId - The user ID to check
 * @returns true if blocked, false otherwise
 */
export async function isUserBlocked(targetUserId: string): Promise<boolean> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) return false;

  const myProfileRef = doc(db, 'profiles', currentUserId);
  const myProfile = await getDoc(myProfileRef);
  
  if (!myProfile.exists()) return false;
  
  const blockedUsers: string[] = myProfile.data()?.blockedUsers || [];
  return blockedUsers.includes(targetUserId);
}

/**
 * Get list of blocked user IDs
 * @returns Array of blocked user IDs
 */
export async function getBlockedUsers(): Promise<string[]> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) return [];

  const myProfileRef = doc(db, 'profiles', currentUserId);
  const myProfile = await getDoc(myProfileRef);
  
  if (!myProfile.exists()) return [];
  
  return myProfile.data()?.blockedUsers || [];
}
