// filepath: c:\Users\Thom\Desktop\SportsPal-Alpha-main\utils\firestoreChats.ts
import { collection, query, where, getDocs, addDoc, serverTimestamp, updateDoc, orderBy, onSnapshot, arrayRemove, doc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';

export async function fetchUserChats(userId: string) {
  const q = query(collection(db, 'chats'), where('participants', 'array-contains', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); // <-- this spreads all fields, including activityId
}

export async function getOrCreateChatForActivity(activityId: string, userId: string) {
  // Check if chat exists for this activity
  const q = query(collection(db, 'chats'), where('activityId', '==', activityId));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) {
    // Chat exists, add user to participants if not already
    const chatDoc = snapshot.docs[0];
    const chatData = chatDoc.data();
    // Defensive: ensure participants is always an array
    const participants = Array.isArray(chatData.participants) ? chatData.participants : [];
    if (!participants.includes(userId)) {
      await updateDoc(chatDoc.ref, {
        participants: [...participants, userId],
      });
    }
    // Always return just the chat ID!
    return chatDoc.id;
  } else {
    // Create new chat
    const newChat = {
      activityId,
      participants: [userId],
      createdAt: serverTimestamp(),
    };
    const docRef = await addDoc(collection(db, 'chats'), newChat);
    return docRef.id;
  }
}

// Listen to messages in real time
export function listenToMessages(chatId: string, callback: (messages: any[]) => void) {
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc'));
  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(messages);
  });
}

// Send a message (text, image, audio)
export async function sendMessage(chatId: string, senderId: string, text: string, type: 'text' | 'image' | 'audio' = 'text') {
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    senderId,
    text,
    type,
    timestamp: serverTimestamp(),
  });
}

// Remove user from chat
export async function removeUserFromChat(activityId: string, userId: string) {
  const q = query(collection(db, 'chats'), where('activityId', '==', activityId));
  const snapshot = await getDocs(q);
  snapshot.forEach(async (chatDoc) => {
    await updateDoc(chatDoc.ref, {
      participants: arrayRemove(userId),
    });
  });
}