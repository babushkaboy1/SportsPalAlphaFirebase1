// filepath: c:\Users\Thom\Desktop\SportsPal-Alpha-main\utils\firestoreChats.ts
import { collection, query, where, getDocs, addDoc, serverTimestamp, updateDoc, orderBy, onSnapshot, arrayRemove, arrayUnion, doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';

export async function fetchUserChats(userId: string) {
  const q = query(collection(db, 'chats'), where('participants', 'array-contains', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); // <-- this spreads all fields, including activityId
}

export async function getOrCreateChatForActivity(activityId: string, userId: string): Promise<string | null> {
  const chatRef = doc(db, 'chats', activityId);
  // Try to self-join existing deterministic chat without reading
  try {
    await updateDoc(chatRef, { participants: arrayUnion(userId) });
    return chatRef.id;
  } catch (e: any) {
    if (e?.code === 'not-found') {
      // Create deterministic chat
      try {
        await setDoc(chatRef, {
          activityId,
          participants: [userId],
          createdAt: serverTimestamp(),
        });
        return chatRef.id;
      } catch (e2: any) {
        if (e2?.code === 'permission-denied') {
          // Wait briefly and retry, allowing activity join to propagate
          await new Promise(res => setTimeout(res, 500));
          try {
            await setDoc(chatRef, {
              activityId,
              participants: [userId],
              createdAt: serverTimestamp(),
            });
            return chatRef.id;
          } catch {
            return null;
          }
        }
        return null;
      }
    } else if (e?.code === 'permission-denied') {
      // Existing deterministic chat but we’re not a participant yet; rules allow self-join, so retry after small delay
      await new Promise(res => setTimeout(res, 500));
      try {
        await updateDoc(chatRef, { participants: arrayUnion(userId) });
        return chatRef.id;
      } catch {
        return null;
      }
    }
    return null;
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