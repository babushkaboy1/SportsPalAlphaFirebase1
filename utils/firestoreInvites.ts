import { addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { getOrCreateChatForActivity } from './firestoreChats';
import { joinActivity } from './firestoreActivities';

// Send one or more activity invites to targetUserId. Returns { sentIds, skippedAlreadyJoined }
export async function sendActivityInvites(targetUserId: string, activityIds: string[]) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const sentIds: string[] = [];
  const skippedAlreadyJoined: string[] = [];

  // Load inviter profile for notification enrichment
  let fromUsername: string | null = null;
  let fromPhoto: string | null = null;
  try {
    const me = await getDoc(doc(db, 'profiles', uid));
    if (me.exists()) {
      const data: any = me.data();
      fromUsername = data.username || null;
      fromPhoto = data.photo || data.photoURL || null;
    }
  } catch {}

  for (const activityId of activityIds) {
    try {
      const aRef = doc(db, 'activities', activityId);
      const aSnap = await getDoc(aRef);
      if (!aSnap.exists()) continue;
      const a: any = aSnap.data();
      const joined: string[] = Array.isArray(a.joinedUserIds) ? a.joinedUserIds : [];
      if (joined.includes(targetUserId)) {
        skippedAlreadyJoined.push(activityId);
        continue;
      }
      // Create invite notification
      await addDoc(collection(db, 'notifications'), {
        userId: targetUserId,
        type: 'activity_invite',
        fromUserId: uid,
        fromUsername,
        fromPhoto,
        activityId,
        activityType: a.activity || null,
        activityDate: a.date || null,
        activityTime: a.time || null,
        text: 'invited you to join an activity',
        createdAt: serverTimestamp(),
        read: false,
      } as any);
      sentIds.push(activityId);
    } catch (e) {
      // skip errors per-activity
    }
  }
  return { sentIds, skippedAlreadyJoined };
}

export async function acceptActivityInvite(notificationId: string, activityId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  // Join the activity and ensure chat exists
  try {
    await joinActivity(activityId, uid);
  } catch (e) {
    // If already joined, ignore
  }
  try {
    await getOrCreateChatForActivity(activityId, uid);
  } catch {}
  // Remove the notification
  try {
    await deleteDoc(doc(db, 'notifications', notificationId));
  } catch {
    try { await updateDoc(doc(db, 'notifications', notificationId), { read: true }); } catch {}
  }
}

export async function declineActivityInvite(notificationId: string) {
  try {
    await deleteDoc(doc(db, 'notifications', notificationId));
  } catch {
    try { await updateDoc(doc(db, 'notifications', notificationId), { read: true }); } catch {}
  }
}
