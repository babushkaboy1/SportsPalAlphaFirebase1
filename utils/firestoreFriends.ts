import { db, auth } from '../firebaseConfig';
import { collection, addDoc, serverTimestamp, doc, updateDoc, arrayUnion, arrayRemove, getDoc, setDoc, deleteDoc, query, where, getDocs, writeBatch } from 'firebase/firestore';

// Send a friend request by creating a notification for the recipient and marking it in sender's profile
export async function sendFriendRequest(targetUserId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  if (uid === targetUserId) return;

  // Create a notification to the target
  // Enrich with sender username/photo for easier rendering
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

  await addDoc(collection(db, 'notifications'), {
    userId: targetUserId,
    type: 'friend_request',
    fromUserId: uid,
    fromUsername,
    fromPhoto,
    text: 'sent you a request to connect',
    createdAt: serverTimestamp(),
    read: false,
  });

  // Mark request as sent on sender profile
  await updateDoc(doc(db, 'profiles', uid), {
    requestsSent: arrayUnion(targetUserId),
  }).catch(async (e) => {
    // If profile missing, create minimal doc
    await setDoc(doc(db, 'profiles', uid), { requestsSent: [targetUserId] }, { merge: true });
  });
}

// Accept a friend request: mark both users as friends and mark notification read or remove
export async function acceptFriendRequest(notificationId: string, fromUserId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');

  // Add each other to friends list
  await updateDoc(doc(db, 'profiles', uid), { friends: arrayUnion(fromUserId) }).catch(async () => {
    await setDoc(doc(db, 'profiles', uid), { friends: [fromUserId] }, { merge: true });
  });
  // Update sender's profile in a single write: add to friends AND remove pending request
  await updateDoc(doc(db, 'profiles', fromUserId), {
    friends: arrayUnion(uid),
    requestsSent: arrayRemove(uid),
  }).catch(async () => {
    await setDoc(
      doc(db, 'profiles', fromUserId),
      { friends: [uid] },
      { merge: true }
    );
    // Best-effort cleanup for requestsSent if doc didn't exist previously
    await updateDoc(doc(db, 'profiles', fromUserId), { requestsSent: arrayRemove(uid) }).catch(() => {});
  });

  // Mark notification as read by deleting it (simplest) or set read: true
  await deleteDoc(doc(db, 'notifications', notificationId)).catch(async () => {
    await updateDoc(doc(db, 'notifications', notificationId), { read: true }).catch(() => {});
  });

  // Optional: notify sender that request was accepted
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
  await addDoc(collection(db, 'notifications'), {
    userId: fromUserId,
    type: 'friend_accept',
    fromUserId: uid,
    fromUsername,
    fromPhoto,
    text: 'accepted your request to connect',
    createdAt: serverTimestamp(),
    read: false,
  });
}

// Decline a friend request: remove the notification and clean pending state
export async function declineFriendRequest(notificationId: string, fromUserId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  await deleteDoc(doc(db, 'notifications', notificationId)).catch(async () => {
    await updateDoc(doc(db, 'notifications', notificationId), { read: true }).catch(() => {});
  });
  // Remove any pending sent marker on sender (in case we use it)
  await updateDoc(doc(db, 'profiles', fromUserId), { requestsSent: arrayRemove(uid) }).catch(() => {});
}

// Accept an incoming request when on the sender's profile (no notification id available)
export async function acceptIncomingRequestFromProfile(fromUserId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');

  // Atomically add each other to friends and remove my uid from sender's requestsSent
  const batch = writeBatch(db);
  const meRef = doc(db, 'profiles', uid);
  const themRef = doc(db, 'profiles', fromUserId);

  batch.set(meRef, {}, { merge: true } as any);
  batch.set(themRef, {}, { merge: true } as any);
  batch.update(meRef, { friends: arrayUnion(fromUserId) as any });
  batch.update(themRef, { friends: arrayUnion(uid) as any, requestsSent: arrayRemove(uid) as any });
  await batch.commit();

  // Remove any pending friend_request notifications addressed to me from this user (best-effort)
  try {
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', uid),
      where('fromUserId', '==', fromUserId),
      where('type', '==', 'friend_request')
    );
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
  } catch {}

  // Notify the sender that we accepted
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
  await addDoc(collection(db, 'notifications'), {
    userId: fromUserId,
    type: 'friend_accept',
    fromUserId: uid,
    fromUsername,
    fromPhoto,
    text: 'accepted your request to connect',
    createdAt: serverTimestamp(),
    read: false,
  });
}

// Decline an incoming request from profile view
export async function declineIncomingRequestFromProfile(fromUserId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');

  // Remove any pending friend_request notifications addressed to me from this user (best-effort)
  try {
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', uid),
      where('fromUserId', '==', fromUserId),
      where('type', '==', 'friend_request')
    );
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
  } catch {}

  // Remove my uid from sender's requestsSent
  await updateDoc(doc(db, 'profiles', fromUserId), { requestsSent: arrayRemove(uid) }).catch(() => {});
}

// Cancel a previously sent friend request
export async function cancelFriendRequest(targetUserId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  if (uid === targetUserId) return;

  // Remove the pending notification(s) addressed to target from current user
  try {
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', targetUserId),
      where('fromUserId', '==', uid),
      where('type', '==', 'friend_request')
    );
    const snap = await getDocs(q);
    await Promise.all(
      snap.docs.map(async (d) => {
        try {
          // First try to delete the notification
          await deleteDoc(d.ref);
        } catch (e) {
          // If delete fails, try to mark as canceled only (simpler update)
          try {
            await updateDoc(d.ref, { canceled: true });
          } catch {
            // If that fails too (maybe read is false), try with both read and canceled
            try {
              await updateDoc(d.ref, { read: true, canceled: true });
            } catch {}
          }
        }
      })
    );
  } catch {}

  // Remove marker from sender profile
  await updateDoc(doc(db, 'profiles', uid), {
    requestsSent: arrayRemove(targetUserId),
  }).catch(async () => {
    await setDoc(doc(db, 'profiles', uid), { requestsSent: [] }, { merge: true });
  });
}

// Remove an existing friend connection (both directions)
export async function removeFriend(targetUserId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  if (uid === targetUserId) return;

  const batch = writeBatch(db);
  const meRef = doc(db, 'profiles', uid);
  const themRef = doc(db, 'profiles', targetUserId);

  // Ensure docs exist to avoid missing-doc errors
  const [meSnap, themSnap] = await Promise.all([getDoc(meRef), getDoc(themRef)]);
  if (!meSnap.exists()) {
    batch.set(meRef, { friends: [] }, { merge: true } as any);
  }
  if (!themSnap.exists()) {
    batch.set(themRef, { friends: [] }, { merge: true } as any);
  }

  batch.update(meRef, { friends: arrayRemove(targetUserId) as any });
  batch.update(themRef, { friends: arrayRemove(uid) as any });

  // Commit atomically; if rules prevent the cross-user write, this will throw
  await batch.commit();
}

// Fetch multiple user profiles by their IDs
export async function fetchUsersByIds(userIds: string[]): Promise<any[]> {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const profileRefs = userIds.map(id => doc(db, 'profiles', id));
  const profileSnaps = await Promise.all(profileRefs.map(ref => getDoc(ref)));
  return profileSnaps
    .map((snap, idx) => snap.exists() ? { uid: userIds[idx], ...snap.data() } : null)
    .filter(Boolean);
}
