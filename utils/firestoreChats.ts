// filepath: c:\Users\Thom\Desktop\SportsPal-Alpha-main\utils\firestoreChats.ts
import { collection, query, where, getDocs, addDoc, serverTimestamp, updateDoc, orderBy, onSnapshot, arrayRemove, arrayUnion, doc, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';

export async function fetchUserChats(userId: string) {
  const q = query(collection(db, 'chats'), where('participants', 'array-contains', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); // <-- this spreads all fields, including activityId
}

export async function getOrCreateChatForActivity(activityId: string, userId: string): Promise<string | null> {
  const chatRef = doc(db, 'chats', activityId);
  const activityRef = doc(db, 'activities', activityId);

  // Helper: small wait
  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

  // Try a few times to overcome propagation/race conditions right after activity creation/join
  for (let attempt = 0; attempt < 3; attempt++) {
    // 1) Try to self-join existing chat
    try {
      await updateDoc(chatRef, { participants: arrayUnion(userId) });
      return chatRef.id;
    } catch (e: any) {
      if (e?.code !== 'not-found' && e?.code !== 'permission-denied') {
        // Unexpected error; break early
        break;
      }
    }

    // 2) Try to create deterministic chat document
    try {
        await setDoc(chatRef, {
          type: 'group',
          activityId,
          participants: [userId],
          createdAt: serverTimestamp(),
          lastMessageTimestamp: serverTimestamp(), // make fresh activity chats float to top
        });
      return chatRef.id;
    } catch (e2: any) {
      if (e2?.code === 'permission-denied') {
        // Ensure our membership is visible to rules, then retry
        try {
          const snap = await getDoc(activityRef);
          const joined = Array.isArray(snap.data()?.joinedUserIds) ? snap.data()!.joinedUserIds : [];
          if (!joined.includes(userId)) {
            // Caller should have joined; wait a bit longer if not visible yet
            await wait(400);
          }
        } catch {}
        await wait(400);
        continue; // next attempt
      }
      // If not-found on setDoc won't happen; other errors give up
    }

    await wait(300);
  }
  return null;
}

// Delete the deterministic activity chat (best-effort). Must be a current participant to pass rules.
export async function deleteActivityChat(activityId: string) {
  try {
    const chatRef = doc(db, 'chats', activityId);
    await updateDoc(chatRef, { participants: arrayRemove('') }).catch(() => {}); // no-op to ensure doc exists
    await setDoc(chatRef, { __meta: 'cleanup', lastMessageTimestamp: serverTimestamp() }, { merge: true }).catch(() => {});
    // Now delete
    await (await import('firebase/firestore')).deleteDoc(chatRef as any);
  } catch {
    // swallow
  }
}

// Listen to messages in real time
export function listenToMessages(
  chatId: string,
  callback: (messages: any[]) => void,
  onError?: (error: any) => void
) {
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(messages);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

// Send a message (text, image, audio)
export async function sendMessage(chatId: string, senderId: string, text: string, type: 'text' | 'image' | 'audio' = 'text') {
  const msgRef = await addDoc(collection(db, 'chats', chatId, 'messages'), {
    senderId,
    text,
    type,
    timestamp: serverTimestamp(),
  });
  // Update chat's last message info for real-time previews in chat list
  let display = '';
  if (type === 'image') display = 'Sent a photo';
  else if (type === 'audio') display = '🎤 Voice message';
  else display = text;
  try {
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessageText: display,
      lastMessageType: type,
      lastMessageSenderId: senderId,
      lastMessageTimestamp: serverTimestamp(),
    });
  } catch (e) {
    // swallow if no permission or chat missing; UI will still show from messages
  }
}

// Mark chat as read for current user
export async function markChatRead(chatId: string) {
  const me = auth.currentUser?.uid;
  if (!me) return;
  try {
    await updateDoc(doc(db, 'chats', chatId), {
      [`lastReadBy.${me}`]: serverTimestamp(),
    } as any);
  } catch (e) {
    // swallow
  }
}

// Remove user from chat
export async function removeUserFromChat(activityId: string, userId: string) {
  // Directly update deterministic chat doc for this activity
  try {
    const chatRef = doc(db, 'chats', activityId);
    await updateDoc(chatRef, { participants: arrayRemove(userId) });
  } catch (e) {
    // swallow (chat may not exist yet for this activity)
  }
}

// Build deterministic DM chat id for two users
export function getDmChatId(uidA: string, uidB: string) {
  const [a, b] = [uidA, uidB].sort();
  return `dm_${a}_${b}`;
}

// Create DM chat only when first message is about to be sent
export async function ensureDmChat(targetUserId: string): Promise<string> {
  const me = auth.currentUser?.uid;
  if (!me) throw new Error('Not authenticated');
  if (me === targetUserId) throw new Error('Cannot DM yourself');

  const chatId = getDmChatId(me, targetUserId);
  const chatRef = doc(db, 'chats', chatId);
  // Unconditionally set; server will treat as create or update depending on existence.
  // This avoids a pre-read that could be blocked by rules.
  await setDoc(chatRef, {
    type: 'dm',
    participants: [me, targetUserId],
    createdAt: serverTimestamp(),
  }, { merge: true });
  return chatId;
}

// Create a non-activity group chat with a title and selected participants
export async function createCustomGroupChat(
  title: string,
  participantIds: string[],
  createdBy: string,
  photoUrl?: string
): Promise<string> {
  // Ensure creator is included
  const unique = Array.from(new Set([...(participantIds || []), createdBy]));
  const ref = await addDoc(collection(db, 'chats'), {
    type: 'group',
    title,
    participants: unique,
    createdAt: serverTimestamp(),
    createdBy,
    ...(photoUrl ? { photoUrl } : {}),
    // Optional: set lastMessageTimestamp to createdAt so it appears on top immediately
    lastMessageTimestamp: serverTimestamp(),
  });
  return ref.id;
}