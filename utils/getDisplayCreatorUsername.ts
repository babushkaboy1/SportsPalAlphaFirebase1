import { auth, db } from '../firebaseConfig';
import { getDoc, doc } from 'firebase/firestore';

/**
 * Returns the display username for an activity creator.
 * If the current user is the creator, returns 'You'.
 * Otherwise, fetches the username from Firestore.
 */
export async function getDisplayCreatorUsername(creatorId: string | undefined, creator: string | undefined): Promise<string> {
  if (!creatorId && !creator) return 'Unknown';
  if (auth.currentUser?.uid && creatorId && auth.currentUser.uid === creatorId) {
    return 'You';
  }
  if (creatorId) {
    try {
      const profileSnap = await getDoc(doc(db, 'profiles', creatorId));
      if (profileSnap.exists()) {
        const data = profileSnap.data();
        return data.username || 'Unknown';
      }
    } catch {}
  }
  return creator || 'Unknown';
}
