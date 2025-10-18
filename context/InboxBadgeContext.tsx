import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  getDocs,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

type ChatMeta = {
  lastReadTs: number; // millis
  participants: string[];
};

type InboxBadgeContextValue = {
  unreadNotifications: number;
  unreadChatMessages: number;
  totalUnread: number;
  markNotificationsRead: () => Promise<void>;
};

const InboxBadgeContext = createContext<InboxBadgeContextValue | undefined>(undefined);

export const InboxBadgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChatMessages, setUnreadChatMessages] = useState(0);
  const notificationsCacheRef = useRef<any[]>([]);
  const chatMetaRef = useRef<Record<string, ChatMeta>>({});
  const messageUnsubsRef = useRef<Record<string, () => void>>({});
  const notifsUnsubRef = useRef<undefined | (() => void)>(undefined);

  useEffect(() => {
    let mounted = true;
    const offAuth = onAuthStateChanged(auth, (fbUser) => {
      // cleanup old subs
      if (notifsUnsubRef.current) {
        notifsUnsubRef.current();
        notifsUnsubRef.current = undefined;
      }
      Object.values(messageUnsubsRef.current).forEach((fn) => fn());
      messageUnsubsRef.current = {};
      chatMetaRef.current = {};
      notificationsCacheRef.current = [];
      if (!fbUser) {
        setUnreadNotifications(0);
        setUnreadChatMessages(0);
        return;
      }
      const uid = fbUser.uid;

      // Notifications subscription with index fallback
      const baseRef = collection(db, 'notifications');
      const qWithOrder = query(baseRef, where('userId', '==', uid), orderBy('createdAt', 'desc'));
      const qNoOrder = query(baseRef, where('userId', '==', uid));

      let usedFallback = false;
      const attachNotifs = (qRef: any, isFallback: boolean) => onSnapshot(
        qRef,
        (snap: any) => {
          let items = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
          if (isFallback) {
            items = items.sort((a: any, b: any) => {
              const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
              const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
              return tb - ta;
            });
          }
          // Exclude canceled notifications (e.g., revoked friend requests)
          notificationsCacheRef.current = items;
          const unread = items.filter((n: any) => !n.read && !n.canceled).length;
          if (mounted) setUnreadNotifications(unread);
        },
        (error: any) => {
          const msg = String((error as any)?.message || '');
          const needsIndex = (error as any)?.code === 'failed-precondition' || msg.includes('requires an index');
          if (needsIndex && !usedFallback) {
            usedFallback = true;
            // switch to fallback by reattaching
            if (notifsUnsubRef.current) {
              notifsUnsubRef.current();
              notifsUnsubRef.current = undefined;
            }
            notifsUnsubRef.current = attachNotifs(qNoOrder, true);
            return;
          }
          if ((error as any)?.code !== 'permission-denied') {
            console.warn('Notifications subscription error:', error);
          } else {
            if (mounted) setUnreadNotifications(0);
          }
        }
      );
      notifsUnsubRef.current = attachNotifs(qWithOrder, false);
    });
    return () => {
      mounted = false;
      if (notifsUnsubRef.current) notifsUnsubRef.current();
      Object.values(messageUnsubsRef.current).forEach((fn) => fn());
      messageUnsubsRef.current = {};
    };
  }, []);

  // Keep a per-chat unread count map to compute totals efficiently
  const perChatCountsRef = useRef<Record<string, number>>({});

  // Bridge to update per-chat counts when message snapshots fire
  // We expose a small internal API by monkey-patching the ref during runtime
  // Implement as effect that attaches a global listener to Firestore that triggers updates via closures
  // But since we already created the listeners above, we need a way to receive updates.
  // To avoid overengineering, we’ll use a simple event emitter-like pattern:
  const updateChatCount = (chatId: string, count: number) => {
    perChatCountsRef.current[chatId] = count;
    const total = Object.values(perChatCountsRef.current).reduce((a, b) => a + b, 0);
    setUnreadChatMessages(total);
  };

  // Patch message listeners to use updateChatCount
  // Since we can’t pass updateChatCount into the earlier effect easily without rerunning it,
  // we redefine the chats listener here to include the counting and avoid duplication.
  useEffect(() => {
    let offChats: undefined | (() => void);
    const offAuth = onAuthStateChanged(auth, (fbUser) => {
      if (offChats) {
        offChats();
        offChats = undefined;
      }
      Object.values(messageUnsubsRef.current).forEach((fn) => fn());
      messageUnsubsRef.current = {};
      perChatCountsRef.current = {};
      setUnreadChatMessages(0);
      if (!fbUser) return;
      const uid = fbUser.uid;
      const chatsRef = query(collection(db, 'chats'), where('participants', 'array-contains', uid));
      offChats = onSnapshot(chatsRef, (snap) => {
        const me = auth.currentUser?.uid || uid;
        const presentIds = new Set<string>();
        snap.docs.forEach((d) => {
          const data: any = d.data();
          const chatId = d.id;
          presentIds.add(chatId);
          const lastRead = data?.lastReadBy?.[me];
          const lastReadTs = lastRead?.toMillis ? lastRead.toMillis() : 0;
          chatMetaRef.current[chatId] = {
            lastReadTs,
            participants: Array.isArray(data?.participants) ? data.participants : [],
          };
          // If we already have a message listener, recalc count using new lastRead
          if (messageUnsubsRef.current[chatId]) {
            (async () => {
              try {
                const msgsRef = collection(db, 'chats', chatId, 'messages');
                const qMsgs = query(msgsRef, orderBy('timestamp', 'desc'), limit(30));
                const mSnap = await getDocs(qMsgs);
                const myUid = auth.currentUser?.uid || uid;
                let count = 0;
                for (const md of mSnap.docs) {
                  const m: any = md.data();
                  const ts = m.timestamp?.toMillis ? m.timestamp.toMillis() : 0;
                  if (lastReadTs && ts <= lastReadTs) break;
                  if (m.senderId && m.senderId !== myUid) count++;
                }
                updateChatCount(chatId, count);
              } catch (e) {
                // swallow
              }
            })();
            return; // keep existing listener
          }
          // Otherwise, attach a listener to update counts on new messages
          {
            const msgsRef = collection(db, 'chats', chatId, 'messages');
            const qMsgs = query(msgsRef, orderBy('timestamp', 'desc'), limit(30));
            messageUnsubsRef.current[chatId] = onSnapshot(qMsgs, (mSnap) => {
              const meta = chatMetaRef.current[chatId];
              const myUid = auth.currentUser?.uid || uid;
              const myLast = meta?.lastReadTs || 0;
              let count = 0;
              for (const md of mSnap.docs) {
                const m: any = md.data();
                const ts = m.timestamp?.toMillis ? m.timestamp.toMillis() : 0;
                if (myLast && ts <= myLast) break;
                if (m.senderId && m.senderId !== myUid) count++;
              }
              updateChatCount(chatId, count);
            });
          }
        });
        // cleanup removed
        Object.keys(messageUnsubsRef.current).forEach((id) => {
          if (!presentIds.has(id)) {
            messageUnsubsRef.current[id]();
            delete messageUnsubsRef.current[id];
            delete perChatCountsRef.current[id];
            delete chatMetaRef.current[id];
          }
        });
        // update total after cleanup
        const total = Object.values(perChatCountsRef.current).reduce((a, b) => a + b, 0);
        setUnreadChatMessages(total);
      }, (error) => {
        if ((error as any)?.code !== 'permission-denied') {
          console.warn('Chats subscription error (badge 2):', error);
        } else {
          setUnreadChatMessages(0);
        }
      });
    });
    return () => {
      if (offChats) offChats();
      offAuth();
      Object.values(messageUnsubsRef.current).forEach((fn) => fn());
      messageUnsubsRef.current = {};
    };
  }, []);

  const markNotificationsRead = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unread = notificationsCacheRef.current.filter((n) => !n.read);
    try {
      await Promise.all(
        unread.map((n) => updateDoc(doc(db, 'notifications', n.id), { read: true }))
      );
    } catch (e) {
      console.warn('markNotificationsRead failed', e);
    }
  };

  const value: InboxBadgeContextValue = useMemo(() => ({
    unreadNotifications,
    unreadChatMessages,
    totalUnread: unreadNotifications + unreadChatMessages,
    markNotificationsRead,
  }), [unreadNotifications, unreadChatMessages]);

  return (
    <InboxBadgeContext.Provider value={value}>{children}</InboxBadgeContext.Provider>
  );
};

export const useInboxBadge = () => {
  const ctx = useContext(InboxBadgeContext);
  if (!ctx) throw new Error('useInboxBadge must be used within InboxBadgeProvider');
  return ctx;
};
