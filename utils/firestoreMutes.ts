// utils/firestoreMutes.ts
import { doc, updateDoc, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';

/**
 * Mute a chat
 * @param chatId - The chat ID to mute
 */
export async function muteChat(chatId: string): Promise<void> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) throw new Error('Not authenticated');

  const userProfileRef = doc(db, 'profiles', currentUserId);
  
  await updateDoc(userProfileRef, {
    mutedChats: arrayUnion(chatId)
  });
}

/**
 * Unmute a chat
 * @param chatId - The chat ID to unmute
 */
export async function unmuteChat(chatId: string): Promise<void> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) throw new Error('Not authenticated');

  const userProfileRef = doc(db, 'profiles', currentUserId);
  
  await updateDoc(userProfileRef, {
    mutedChats: arrayRemove(chatId)
  });
}

/**
 * Check if a chat is muted
 * @param chatId - The chat ID to check
 * @returns true if muted, false otherwise
 */
export async function isChatMuted(chatId: string): Promise<boolean> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) return false;

  const userProfileRef = doc(db, 'profiles', currentUserId);
  const userProfile = await getDoc(userProfileRef);
  
  if (!userProfile.exists()) return false;
  
  const mutedChats: string[] = userProfile.data()?.mutedChats || [];
  return mutedChats.includes(chatId);
}

/**
 * Get list of muted chat IDs
 * @returns Array of muted chat IDs
 */
export async function getMutedChats(): Promise<string[]> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) return [];

  const userProfileRef = doc(db, 'profiles', currentUserId);
  const userProfile = await getDoc(userProfileRef);
  
  if (!userProfile.exists()) return [];
  
  return userProfile.data()?.mutedChats || [];
}
