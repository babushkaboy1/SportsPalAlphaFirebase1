// screens/ChatsScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  StatusBar,
  Platform,
  Animated,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Swipeable, RectButton } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchUserChats } from '../utils/firestoreChats';
import { acceptFriendRequest, declineFriendRequest } from '../utils/firestoreFriends';
import { doc, getDoc, collection, query, onSnapshot, where, orderBy, deleteDoc, getDocs, limit } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebaseConfig';
import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';
import { useActivityContext } from '../context/ActivityContext';
import { ActivityIcon } from '../components/ActivityIcons'; // <-- Add this import
import { useInboxBadge } from '../context/InboxBadgeContext';
import { acceptActivityInvite, declineActivityInvite } from '../utils/firestoreInvites';

type Chat = {
  id: string;
  activityId?: string;
  [key: string]: any; // for other fields
};

const sportIconMap: Record<string, React.ReactNode> = {
  football: <MaterialCommunityIcons name="soccer" size={28} color="#1ae9ef" />,
  basketball: <MaterialCommunityIcons name="basketball" size={28} color="#1ae9ef" />,
  tennis: <MaterialCommunityIcons name="tennis" size={28} color="#1ae9ef" />,
  // Add more mappings as needed
};

const TURQUOISE = '#1ae9ef';

// Format a human-friendly relative time (minutes/hours/days/months/years ago)
function formatTimeAgo(tsMillis?: number) {
  if (!tsMillis) return '';
  const diff = Date.now() - tsMillis;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;
  if (diff < minute) return 'just now';
  if (diff < hour) {
    const m = Math.floor(diff / minute);
    return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  }
  if (diff < day) {
    const h = Math.floor(diff / hour);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  if (diff < month) {
    const d = Math.floor(diff / day);
    return d === 1 ? '1 day ago' : `${d} days ago`;
  }
  if (diff < year) {
    const mo = Math.floor(diff / month);
    return mo === 1 ? '1 month ago' : `${mo} months ago`;
  }
  const y = Math.floor(diff / year);
  return y === 1 ? '1 year ago' : `${y} years ago`;
}

const ChatsScreen = ({ navigation }: any) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const [showActivity, setShowActivity] = useState(false); // notifications view toggle
  const [notificationCount, setNotificationCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [chatUnreadTotal, setChatUnreadTotal] = useState<number>(0);
  const latestNotificationText = notifications.length > 0
    ? `${notifications[0]?.fromUsername || 'Someone'} ${notifications[0]?.text || ''}`
    : '';
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const notifFade = useRef(new Animated.Value(0));
  const insets = useSafeAreaInsets();
  const { joinedActivities } = useActivityContext();
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const { totalUnread, unreadNotifications, unreadChatMessages, markNotificationsRead } = useInboxBadge();

  // Real-time subscription to user's chats; cleanly rewire on auth changes and swallow permission-denied on logout
  useEffect(() => {
  let unsubChats: undefined | (() => void);
  let unsubNotifs: undefined | (() => void);
    const offAuth = onAuthStateChanged(auth, (fbUser) => {
      // Tear down previous subscription
      if (unsubChats) {
        unsubChats();
        unsubChats = undefined;
      }
      if (unsubNotifs) {
        unsubNotifs();
        unsubNotifs = undefined;
      }
      if (!fbUser) {
        setChats([]);
        setNotifications([]);
        setNotificationCount(0);
        setIsReady(true);
        return;
      }
      const uid = fbUser.uid;
      const q = query(collection(db, 'chats'), where('participants', 'array-contains', uid));
      unsubChats = onSnapshot(
        q,
        async (snapshot) => {
          const baseChats: Chat[] = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
          // Enrich with activity details and use chat doc lastMessage* for instant updates
          const chatsWithDetails = await Promise.all(baseChats.map(async (chat: Chat) => {
            let activityName = 'Group Chat';
            let activityImage = 'https://via.placeholder.com/50';
            let activityType = '';
            let activityDate = '';
            let activityTime = '';
            // Determine chat type robustly: prefer explicit 'dm', else activityId implies group,
            // else fall back to participants-length check for legacy docs
            let type: 'dm' | 'group';
            if ((chat as any).type === 'dm') {
              type = 'dm';
            } else if ((chat as any).activityId) {
              type = 'group';
            } else {
              const parts = Array.isArray((chat as any).participants) ? (chat as any).participants : [];
              type = parts.length === 2 ? 'dm' : 'group';
            }
            let dmPeerName = '';
            let dmPeerPhoto = '';
            let dmPeerId: string | null = null;
            if (type === 'dm') {
              const me = auth.currentUser?.uid;
              const peerId = ((chat as any).participants || []).find((p: string) => p !== me);
              if (peerId) {
                dmPeerId = peerId;
                const peerDoc = await getDoc(doc(db, 'profiles', peerId));
                if (peerDoc.exists()) {
                  const p: any = peerDoc.data();
                  dmPeerName = p.username || 'User';
                  dmPeerPhoto = p.photo || p.photoURL || '';
                }
              }
            }
            if (chat.activityId) {
              const activityDoc = await getDoc(doc(db, 'activities', chat.activityId));
              if (activityDoc.exists()) {
                const activityData: any = activityDoc.data();
                activityName = activityData.activity || activityData.name || 'Group Chat';
                activityImage = activityData.image || 'https://via.placeholder.com/50';
                activityType = activityData.activity || '';
                activityDate = activityData.date || '';
                activityTime = activityData.time || '';
              }
            }
            let lastMessage = 'No messages yet';
            let lastSender = '';
            let unreadFromPeer = 0;
            let unreadCount = 0;
            if ((chat as any).lastMessageText) {
              lastMessage = (chat as any).lastMessageText;
            } else if ((chat as any).lastMessageType === 'image') {
              lastMessage = 'Sent a photo';
            } else if ((chat as any).lastMessageType === 'audio') {
              lastMessage = '🎤 Voice message';
            }
            const senderId = (chat as any).lastMessageSenderId;
            if (senderId) {
              const senderDoc = await getDoc(doc(db, 'profiles', senderId));
              lastSender = senderDoc.exists() ? (senderDoc.data() as any).username || '' : '';
            }

            const lastTsMillis = (chat as any).lastMessageTimestamp?.toMillis ? (chat as any).lastMessageTimestamp.toMillis() : 0;
            const timeAgo = formatTimeAgo(lastTsMillis);

            // Compute unread count for all chats (messages not sent by me since my last read)
            try {
              const me = auth.currentUser?.uid || '';
              const lastReadBy = (chat as any).lastReadBy || {};
              const myReadVal = me && lastReadBy && lastReadBy[me];
              const myReadTs = (myReadVal && myReadVal.toMillis) ? myReadVal.toMillis() : 0;
              const msgsRef = collection(db, 'chats', chat.id, 'messages');
              const qMsgs = query(msgsRef, orderBy('timestamp', 'desc'), limit(30));
              const snap = await getDocs(qMsgs);
              let count = 0;
              for (const d of snap.docs) {
                const m: any = d.data();
                const ts = m.timestamp?.toMillis ? m.timestamp.toMillis() : 0;
                if (myReadTs && ts <= myReadTs) break;
                if (m.senderId && m.senderId !== me) count++;
              }
              unreadCount = count;
              if (type === 'dm') unreadFromPeer = count;
            } catch {}
            return {
              ...chat,
              type,
              name: type === 'dm' ? dmPeerName : activityName,
              image: type === 'dm' ? dmPeerPhoto : activityImage,
              activityType,
              lastMessage,
              lastSender,
              unreadFromPeer,
              unreadCount,
              date: activityDate,
              time: activityTime,
              timeAgo,
              lastTsMillis,
            };
          }));
          // Hide DMs until there is at least one message
          const filtered = chatsWithDetails.filter((c: any) => {
            if (c.type === 'dm') {
              return !!c.lastMessageText || !!c.lastMessageType || !!c.lastMessageSenderId;
            }
            return true;
          });
          // Sort by latest message time (desc) for both DM and group
          const sorted = filtered.sort((a: any, b: any) => (b.lastTsMillis || 0) - (a.lastTsMillis || 0));
          setChats(sorted);
          // Aggregate unread counts for badge
          const totalUnread = filtered.reduce((acc: number, c: any) => acc + (c.type === 'dm' ? (c.unreadFromPeer || 0) : 0), 0);
          setChatUnreadTotal(totalUnread);
          setIsReady(true);
        },
        (error) => {
          // Swallow permission denied (e.g., during logout) to avoid uncaught error logs
          if ((error as any)?.code !== 'permission-denied') {
            console.error('Chats subscription error:', error);
          } else {
            setChats([]);
            setIsReady(true);
          }
        }
      );

      // Notifications subscription
      // Notifications subscription with index fallback
      const startNotificationsSub = () => {
        const baseRef = collection(db, 'notifications');
        const qWithOrder = query(baseRef, where('userId', '==', uid), orderBy('createdAt', 'desc'));
        const qNoOrder = query(baseRef, where('userId', '==', uid));
        let usedFallback = false;

        const attach = (q: any, isFallback: boolean) => onSnapshot(
          q,
          (snap: any) => {
            let items = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
            // If we couldn't order on the server, sort by createdAt desc locally
            if (isFallback) {
              items = items.sort((a: any, b: any) => {
                const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                return tb - ta;
              });
            }
            // Add human-friendly timeAgo for notifications
            items = items.map((n: any) => ({
              ...n,
              timeAgo: formatTimeAgo(n.createdAt?.toMillis ? n.createdAt.toMillis() : 0),
            }));
            // Hide canceled notifications (e.g., revoked friend requests)
            setNotifications(items.filter((n: any) => !n.canceled));
            const unread = items.filter((n: any) => !n.read && !n.canceled).length;
            setNotificationCount(unread);
          },
          (error: any) => {
            const msg = String((error as any)?.message || '');
            const needsIndex = (error as any)?.code === 'failed-precondition' || msg.includes('requires an index');
            if (needsIndex && !usedFallback) {
              usedFallback = true;
              if (unsubNotifs) unsubNotifs();
              unsubNotifs = attach(qNoOrder, true);
              return;
            }
            if ((error as any)?.code !== 'permission-denied') {
              console.error('Notifications subscription error:', error);
            } else {
              setNotifications([]);
              setNotificationCount(0);
            }
          }
        );

        unsubNotifs = attach(qWithOrder, false);
      };
      startNotificationsSub();
    });
    return () => {
      if (unsubChats) unsubChats();
      if (unsubNotifs) unsubNotifs();
      offAuth();
    };
  }, []);

  // Restore persisted view (intra-session) from route params
  useEffect(() => {
    if (route?.params?.inboxView === 'notifications') {
      setShowActivity(true);
    }
  }, [route?.params]);

  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // In real-time mode, just briefly toggle the spinner; data will come from snapshot
    // Optionally, you could force-refresh any derived data here
    setTimeout(() => {
      setRefreshing(false);
      setRefreshLocked(false);
    }, 1500);
  };

  // Already filtered by subscription (participants contains current user); apply search filter
  const filteredChats = chats.filter((chat) => chat.name?.toLowerCase().includes(searchQuery.toLowerCase()));

  const renderChatItem = ({ item }: any) => (
    <TouchableOpacity
      style={styles.chatItem}
      onPress={() => navigation.navigate('ChatDetail', { chatId: item.id })}
    >
      {item.type === 'dm' ? (
        <>
          {/* DM avatar */}
          <Image
            source={{ uri: item.image || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.name || 'User') }}
            style={{ width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: TURQUOISE, marginRight: 12 }}
          />
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={styles.chatInfo}>
              <Text style={styles.chatName}>
                <Text style={{ color: TURQUOISE, fontWeight: 'bold', fontSize: 18 }}>
                  {item.name}
                </Text>
              </Text>
              <Text style={styles.lastMessage} numberOfLines={1}>
                {item.unreadFromPeer > 1 && item.lastSender ? (
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>{item.lastSender} sent {item.unreadFromPeer} messages</Text>
                ) : item.lastMessageSenderId && item.lastMessageSenderId !== auth.currentUser?.uid && item.lastSender ? (
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>{item.lastSender}: </Text>
                ) : null}
                {!(item.unreadFromPeer > 1) && (
                  <Text style={{ color: item.unreadCount === 1 ? '#fff' : '#ccc', fontWeight: item.unreadCount === 1 ? '700' : 'normal' }}>
                    {item.lastMessage}
                  </Text>
                )}
              </Text>
            </View>
            {/* Right-side block: unread badge (if >1) stacked above timeAgo; otherwise just timeAgo */}
            <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
              {item.unreadCount > 1 && (
                <View style={styles.unreadBadge}><Text style={styles.unreadBadgeText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View>
              )}
              {!!item.timeAgo && (
                <Text style={{ color: '#aaa', fontSize: 12, marginTop: item.unreadCount > 1 ? 4 : 0 }}>{item.timeAgo}</Text>
              )}
            </View>
          </View>
        </>
      ) : (
        <>
          {/* Group chat icon */}
          <View style={{ marginRight: 10 }}>
            <Ionicons name="people" size={32} color={TURQUOISE} />
          </View>
          {/* Sport/activity icon */}
          <View style={{ marginRight: 10 }}>
            <ActivityIcon activity={item.activityType} size={28} color={TURQUOISE} />
          </View>
          {/* Chat info and date/time */}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={styles.chatInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[styles.chatName, { color: TURQUOISE, fontWeight: 'bold', fontSize: 18 }]}>
                  {item.name}
                </Text>
                {item.unreadCount > 0 && (
                  <View style={[styles.unreadBadgeSmall, { marginLeft: 6 }]}>
                    <Text style={styles.unreadBadgeText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.lastMessage} numberOfLines={1}>
                {item.lastSender ? (
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>{item.lastSender}: </Text>
                ) : null}
                <Text style={{ color: item.unreadCount === 1 ? '#fff' : '#ccc', fontWeight: item.unreadCount === 1 ? '700' : 'normal' }}>{item.lastMessage}</Text>
              </Text>
              {!!item.timeAgo && (
                <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{item.timeAgo}</Text>
              )}
            </View>
            {/* Right side: schedule block */}
            <View style={{ alignItems: 'flex-end', marginLeft: 8, maxWidth: 120 }}>
              {item.activityId && item.date && item.time && (
                <>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '500', textAlign: 'right' }}>
                    Activity scheduled for
                  </Text>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '500', textAlign: 'right' }}>
                    {formatDate(item.date)} at {item.time}
                  </Text>
                </>
              )}
            </View>
            {/* (Removed duplicate schedule block) */}
          </View>
        </>
      )}
    </TouchableOpacity>
  );

  // Helper to format date as dd-mm-yyyy
  function formatDate(dateStr: string) {
    if (!dateStr) return '';
    const [yyyy, mm, dd] = dateStr.split('-');
    return `${dd}-${mm}-${yyyy}`;
  }

  useEffect(() => {
    if (isReady) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  }, [isReady]);

  useEffect(() => {
    if (showActivity) {
      notifFade.current.setValue(0);
      Animated.timing(notifFade.current, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
      // mark notifications as read when viewing
      markNotificationsRead().catch(() => {});
    }
    // Persist current view in route params (tab lifetime)
    nav.setParams?.({ inboxView: showActivity ? 'notifications' : 'chats' });
  }, [showActivity]);

  // Update tab badge with combined count (notifications + unread chats when available)
  useEffect(() => {
    const chatUnreadCount = unreadChatMessages || chatUnreadTotal || 0;
    const total = (unreadNotifications || notificationCount || 0) + chatUnreadCount;
    nav.setOptions?.({
      tabBarBadge: total > 0 ? (total > 99 ? '99+' : total) : undefined,
      tabBarBadgeStyle: { backgroundColor: '#e74c3c', color: '#fff' },
    });
  }, [unreadNotifications, unreadChatMessages, notificationCount, chatUnreadTotal, nav]);

  if (!isReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <ActivityIndicator size="large" color="#1ae9ef" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <View style={styles.header}>
          {showActivity ? (
            <>
              <TouchableOpacity onPress={() => setShowActivity(false)} style={styles.headerBackBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="arrow-back" size={28} color={TURQUOISE} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Notifications</Text>
              {notifications.length > 0 && (
                <TouchableOpacity
                  onPress={async () => {
                    try {
                      const uid = auth.currentUser?.uid;
                      if (!uid) return;
                      const snap = await getDocs(query(collection(db, 'notifications'), where('userId', '==', uid)));
                      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
                      await Haptics.selectionAsync();
                    } catch (e) {
                      console.warn('clear all notifications failed', e);
                    }
                  }}
                  style={styles.headerRightBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={22} color={TURQUOISE} />
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={styles.headerTitle}>Inbox</Text>
          )}
        </View>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#ccc" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            placeholderTextColor="#bbb"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        {/* Activity notifications entry */}
        <TouchableOpacity
          style={styles.activityCard}
          activeOpacity={0.85}
          onPress={() => setShowActivity(prev => !prev)}
        >
          <View style={styles.activityLeft}>
            <View style={styles.activityIconWrap}>
              <Ionicons name="notifications-outline" size={24} color={TURQUOISE} />
              {notificationCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{notificationCount > 99 ? '99+' : notificationCount}</Text>
                </View>
              )}
            </View>
            <View>
              <Text style={styles.activityTitle}>Notifications</Text>
              {!!latestNotificationText && (
                <Text style={styles.activitySubtitle} numberOfLines={1}>
                  {latestNotificationText}
                </Text>
              )}
            </View>
          </View>
          <Ionicons name={showActivity ? 'chevron-down' : 'chevron-forward'} size={20} color={TURQUOISE} />
        </TouchableOpacity>
        {showActivity ? (
          <Animated.View style={{ flex: 1, opacity: notifFade.current }}>
            {notifications.length === 0 ? (
              <View style={styles.activityEmpty}>
                <Ionicons name="notifications-outline" size={48} color={TURQUOISE} />
                <Text style={styles.activityEmptyTitle}>No notifications yet</Text>
                <Text style={styles.activityEmptyText}>When there’s activity, it’ll show up here.</Text>
              </View>
            ) : (
              <FlatList
                data={notifications}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.chatList}
                renderItem={({ item }) => (
                  <Swipeable
                    overshootLeft={false}
                    overshootRight={false}
                    renderLeftActions={() => (
                      <View style={styles.swipeActionLeft}> 
                        <RectButton
                          onPress={async () => {
                            try {
                              if (item.type === 'friend_request') {
                                await declineFriendRequest(item.id, item.fromUserId);
                              } else {
                                await deleteDoc(doc(db, 'notifications', item.id));
                              }
                              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            } catch (e) {
                              console.warn('delete notification failed', e);
                            }
                          }}
                          style={styles.swipeDeleteBtn}
                        >
                          <Ionicons name="close" size={22} color="#fff" />
                        </RectButton>
                      </View>
                    )}
                    renderRightActions={() => (
                      <View style={styles.swipeActionRight}>
                        <RectButton
                          onPress={async () => {
                            try {
                              if (item.type === 'friend_request') {
                                await declineFriendRequest(item.id, item.fromUserId);
                              } else {
                                await deleteDoc(doc(db, 'notifications', item.id));
                              }
                              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            } catch (e) {
                              console.warn('delete notification failed', e);
                            }
                          }}
                          style={styles.swipeDeleteBtn}
                        >
                          <Ionicons name="close" size={22} color="#fff" />
                        </RectButton>
                      </View>
                    )}
                  >
                    <View style={styles.notificationItem}>
                      <View style={styles.notificationRow}>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                          activeOpacity={0.8}
                          onPress={() => {
                            if (item.fromUserId) {
                              navigation.navigate('UserProfile' as never, { userId: item.fromUserId } as never);
                            }
                          }}
                        >
                          <Image
                            source={{ uri: item.fromPhoto || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.fromUsername || 'User') }}
                            style={styles.notificationAvatar}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.notificationText} numberOfLines={1}>
                              {item.fromUsername || 'User'} {item.text || ''}
                            </Text>
                            <Text style={styles.notificationMeta} numberOfLines={1}>
                              {item.type === 'friend_request'
                                ? 'Friend request'
                                : item.type === 'friend_accept'
                                ? 'You are now connected!'
                                : item.type === 'activity_invite'
                                ? `${item.activityType || 'Activity'} on ${item.activityDate || ''} ${item.activityTime || ''}`
                                : (item.type || 'Activity')}
                            </Text>
                            {!!item.timeAgo && (
                              <Text style={styles.notificationTimeInline} numberOfLines={1}>
                                {item.timeAgo}
                              </Text>
                            )}
                          </View>
                        </TouchableOpacity>
                        {item.type === 'friend_request' ? (
                          <View style={styles.notificationActions}>
                            <TouchableOpacity
                              style={styles.connectBtn}
                              onPress={async () => {
                                try {
                                  await acceptFriendRequest(item.id, item.fromUserId);
                                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                } catch (e) {
                                  console.warn('acceptFriendRequest failed', e);
                                }
                              }}
                            >
                              <Text style={styles.connectBtnText}>Connect</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.deleteBtn}
                              onPress={async () => {
                                try {
                                  await declineFriendRequest(item.id, item.fromUserId);
                                  await Haptics.selectionAsync();
                                } catch (e) {
                                  console.warn('declineFriendRequest failed', e);
                                }
                              }}
                            >
                              <Text style={styles.deleteBtnText}>Delete</Text>
                            </TouchableOpacity>
                          </View>
                        ) : item.type === 'activity_invite' ? (
                          <View style={styles.notificationActions}>
                            <TouchableOpacity
                              style={styles.connectBtn}
                              onPress={async () => {
                                try {
                                  await acceptActivityInvite(item.id, item.activityId);
                                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                } catch (e) {
                                  console.warn('acceptActivityInvite failed', e);
                                }
                              }}
                            >
                              <Text style={styles.connectBtnText}>Join</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.deleteBtn}
                              onPress={async () => {
                                try {
                                  await declineActivityInvite(item.id);
                                  await Haptics.selectionAsync();
                                } catch (e) {
                                  console.warn('declineActivityInvite failed', e);
                                }
                              }}
                            >
                              <Text style={styles.deleteBtnText}>Decline</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (!item.read && <View style={styles.unreadDot} />)}
                      </View>
                    </View>
                  </Swipeable>
                )}
              />
            )}
          </Animated.View>
        ) : filteredChats.length === 0 ? (
          <Text style={{ color: '#bbb', textAlign: 'center', marginTop: 40 }}>No group chats yet.</Text>
        ) : (
          <FlatList
            data={filteredChats}
            keyExtractor={(item) => item.id}
            renderItem={renderChatItem}
            contentContainerStyle={styles.chatList}
            refreshControl={
              <RefreshControl
                refreshing={refreshing || refreshLocked}
                onRefresh={onRefresh}
                colors={["#009fa3"]}
                tintColor="#009fa3"
                progressBackgroundColor="transparent"
              />
            }
          />
        )}
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingHorizontal: 10,
  },
  header: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  headerWithBack: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    color: '#1ae9ef',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  headerBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    position: 'absolute',
    left: 0,
  },
  headerRightBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 6,
  },
  headerRightText: {
    color: TURQUOISE,
    fontSize: 14,
    fontWeight: '600',
  },
  headerBackText: {
    color: TURQUOISE,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 2,
  },
  headerCenterTitle: {
    fontSize: 28,
    color: TURQUOISE,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2b2b2b',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  activityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#202020',
    marginRight: 10,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#e74c3c',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  activityTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  activitySubtitle: {
    color: '#bbb',
    fontSize: 12,
    marginTop: 2,
    maxWidth: 220,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  activityEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginVertical: 5,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  notificationAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: TURQUOISE,
    marginRight: 10,
  },
  notificationIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#202020',
    marginRight: 10,
  },
  notificationText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  notificationMeta: {
    color: '#bbb',
    fontSize: 12,
    marginTop: 2,
  },
  notificationActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
    gap: 6,
  },
  notificationTimeInline: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  connectBtn: {
    backgroundColor: TURQUOISE,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  connectBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 12,
  },
  deleteBtn: {
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: TURQUOISE,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  deleteBtnText: {
    color: TURQUOISE,
    fontWeight: '700',
    fontSize: 12,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TURQUOISE,
    marginLeft: 8,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: '#e74c3c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  unreadBadgeSmall: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: '#e74c3c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Swipe actions background containers
  swipeActionLeft: {
    justifyContent: 'center',
    alignItems: 'flex-start',
    backgroundColor: '#e74c3c',
    borderRadius: 8,
    marginVertical: 5,
  },
  swipeActionRight: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    backgroundColor: '#e74c3c',
    borderRadius: 8,
    marginVertical: 5,
  },
  swipeDeleteBtn: {
    width: 64,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  activityEmptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  activityEmptyText: {
    color: '#bbb',
    fontSize: 14,
    marginTop: 4,
  },
  chatList: {
    paddingBottom: 20,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginVertical: 5,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
  },
  chatInfo: {
    flex: 1,
  },
  chatName: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '500',
  },
  lastMessage: {
    fontSize: 14,
    color: '#ccc',
    fontWeight: '500',
  },
});

export default React.memo(ChatsScreen);