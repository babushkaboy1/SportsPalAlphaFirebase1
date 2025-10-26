// screens/ChatDetailScreen.tsx
// OPTIMIZED VERSION - Instagram-like performance
// NOTE for Android header visibility with keyboard:
// In Expo app.json, ensure:
// {
//   "expo": {
//     "android": {
//       "softwareKeyboardLayoutMode": "resize"
//     }
//   }
// }

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  Platform,
  Alert,
  Keyboard,
  Animated,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Easing,
  PanResponder,
  Dimensions,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useAudioRecorder, useAudioPlayer, AudioModule, RecordingPresets } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import {
  listenToLatestMessages,
  sendMessage,
  markChatRead,
  clearTyping,
  ensureDmChat,
  leaveChatWithAutoDelete,
  addSystemMessage,
  fetchLatestMessagesPage,
  fetchOlderMessagesPage,
} from '../utils/firestoreChats';
import { sendActivityInvites } from '../utils/firestoreInvites';
import { useActivityContext } from '../context/ActivityContext';
import { normalizeDateFormat } from '../utils/storage';
import {
  doc, getDoc, onSnapshot, collection, query, where,
  getDocs, updateDoc, arrayUnion, serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { ActivityIcon } from '../components/ActivityIcons';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { uploadChatImage } from '../utils/imageUtils';
import { sendFriendRequest, cancelFriendRequest } from '../utils/firestoreFriends';

type Message = {
  id: string;
  senderId: string;
  text: string;
  type: 'text' | 'image' | 'audio' | 'system';
  timestamp?: any;
  _local?: boolean;
};

const PAGE_SIZE = 20;
const TURQUOISE = '#1ae9ef';
const BG = '#121212';
const CARD = '#1e1e1e';
const SURFACE = '#18191a';
const STROKE = '#2a2a2a';
const DANGER = '#e74c3c';
const TYPING_FRESH_MS = 3000; // 3 seconds instead of 5

const REACTIONS = ['👍', '😂', '❤️', '👎', '😮'] as const;

const tsSec = (t: any) =>
  typeof t === 'number' ? t : t?.seconds ? t.seconds : Math.floor(Date.now() / 1000);

const isGapBig = (a?: any, b?: any, mins = 6) => {
  if (!a || !b) return false;
  const da = tsSec(a);
  const db = tsSec(b);
  return Math.abs(da - db) > mins * 60;
};

// Typing indicator component
const TypingDots = React.memo(({ color = TURQUOISE }: { color?: string }) => {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  const dot = (i: number) => ({
    opacity: a.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: i === 0 ? [1, 0.3, 1] : i === 1 ? [0.3, 1, 0.3] : [0.3, 0.3, 1],
    }),
    transform: [{ translateY: a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -2, 0] }) }],
  });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            { width: 5, height: 5, borderRadius: 3, marginHorizontal: 2, backgroundColor: color },
            dot(i),
          ]}
        />
      ))}
    </View>
  );
});

const oneLine = (s: string, n = 60) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

const makeSwipeToReply = (onReply: () => void) =>
  PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 18 && Math.abs(g.dy) < 14,
    onPanResponderRelease: (_e, g) => {
      if (g.dx > 26 && Math.abs(g.dy) < 20) {
        Haptics.selectionAsync().catch(() => {});
        onReply();
      }
    },
  });

// Memoized Message Item Component for better performance
const MessageItem = React.memo(({
  item,
  prev,
  next,
  profile,
  isOwn,
  myId,
  reaction,
  isLastMine,
  readReceipt,
  onLongPress,
  onImagePress,
  onProfilePress,
  onReply,
  handlePlayPauseAudio,
  playingAudioId,
  audioPlayer,
  handleSpeedChange,
  playbackRate,
}: any) => {
  const isFirstOfGroup = !prev || prev.senderId !== item.senderId;
  const isLastOfGroup = !next || next.senderId !== item.senderId;
  const sender = profile || {};

  const shouldShowTimestamp = () => {
    const isLastOfGroup = !next || next.senderId !== item.senderId;
    const gapBefore = isGapBig(item.timestamp, prev?.timestamp, 6);
    return isLastOfGroup || gapBefore || item.type === 'image';
  };

  if (item.type === 'system') {
    return (
      <View style={{ flex: 1, alignItems: 'center', marginVertical: 8 }}>
        <Text style={{ color: '#aaa', fontStyle: 'italic', fontSize: 13, textAlign: 'center', paddingHorizontal: 10 }}>
          {item.text}
        </Text>
        <Text style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
          {item.timestamp ? new Date(tsSec(item.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </Text>
      </View>
    );
  }

  const bubbleStyle: StyleProp<ViewStyle> = [
    styles.messageBubble,
    item.type === 'image'
      ? { paddingHorizontal: 0, paddingVertical: 0, backgroundColor: 'transparent', borderRadius: 10, maxWidth: '90%', alignSelf: isOwn ? ('flex-end' as const) : ('flex-start' as const), position: 'relative' }
      : (isOwn ? styles.yourMessage : styles.theirMessage),
    {
      marginTop: isFirstOfGroup ? 10 : 2,
      marginBottom: isLastOfGroup ? 8 : 2,
      borderBottomRightRadius: item.type === 'image' ? 10 : (isOwn ? 6 : 16),
      borderBottomLeftRadius: item.type === 'image' ? 10 : (isOwn ? 16 : 6),
    },
  ];

  const responder = makeSwipeToReply(onReply);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      {!isOwn && (
        <View style={{ width: 34, alignItems: 'center', marginBottom: isLastOfGroup ? 8 : 2 }}>
          {isLastOfGroup ? (
            <TouchableOpacity onPress={onProfilePress} activeOpacity={0.7}>
              {typeof sender.photo === 'string' && sender.photo ? (
                <Image
                  source={{ uri: sender.photo }}
                  style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: TURQUOISE, alignSelf: 'flex-end' }}
                />
              ) : (
                <Image
                  source={require('../assets/default-group.png')}
                  style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: TURQUOISE, alignSelf: 'flex-end' }}
                />
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      <View style={{ flex: 1 }}>
        {isFirstOfGroup && !isOwn && (
          <Text style={{ color: TURQUOISE, fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>
            {sender.username || 'User'}
          </Text>
        )}

        <View style={bubbleStyle} {...responder.panHandlers}>
          {reaction ? (
            <View
              style={{
                position: 'absolute',
                right: -8,
                top: -8,
                backgroundColor: '#000',
                borderRadius: 12,
                paddingHorizontal: 6,
                paddingVertical: 3,
                borderWidth: 1,
                borderColor: '#222',
              }}
            >
              <Text style={{ fontSize: 12 }}>{reaction}</Text>
            </View>
          ) : null}

          {item.type === 'text' && (
            <TouchableOpacity
              activeOpacity={0.85}
              delayLongPress={250}
              onLongPress={onLongPress}
            >
              <Text style={[styles.messageText, isOwn && styles.userMessageText]}>{item.text}</Text>
            </TouchableOpacity>
          )}

          {item.type === 'audio' && (
            <View style={styles.audioBubbleRow}>
              <TouchableOpacity onPress={() => handlePlayPauseAudio(item.text, item.id)} style={styles.audioPlayButton} activeOpacity={0.7}>
                <MaterialIcons name={playingAudioId === item.id && audioPlayer.playing ? 'pause' : 'play-arrow'} size={18} color="#fff" />
              </TouchableOpacity>
              <View style={styles.audioWaveformBar}>
                <View
                  style={[
                    styles.audioWaveformFill,
                    {
                      width:
                        playingAudioId === item.id && audioPlayer.duration > 0
                          ? `${(audioPlayer.currentTime / audioPlayer.duration) * 100}%`
                          : '0%',
                    },
                  ]}
                />
              </View>
              <Text style={styles.audioDurationRight}>
                {playingAudioId === item.id && audioPlayer.duration > 0 ? `${audioPlayer.duration.toFixed(2)}` : '0.00'}
              </Text>
              <TouchableOpacity onPress={handleSpeedChange} style={styles.audioSpeedButton} activeOpacity={0.7}>
                <Text style={styles.audioSpeedText}>{playbackRate}x</Text>
              </TouchableOpacity>
            </View>
          )}

          {item.type === 'image' && item.text ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={onImagePress}
              onLongPress={onLongPress}
            >
              <Image source={{ uri: item.text }} style={[styles.media, { borderWidth: 1, borderColor: TURQUOISE }]} />
            </TouchableOpacity>
          ) : item.type === 'image' && !item.text ? (
            <Text style={styles.placeholderText}>Image not available</Text>
          ) : null}

          {item.type === 'image' ? (
            <Text style={[styles.messageTime, isOwn && styles.userMessageTime, styles.imageTime, isOwn ? styles.imageTimeRight : styles.imageTimeLeft]}>
              {item.timestamp
                ? new Date(tsSec(item.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : item._local
                  ? 'Sending…'
                  : ''}
            </Text>
          ) : shouldShowTimestamp() ? (
            <Text style={[styles.messageTime, isOwn && styles.userMessageTime]}>
              {item.timestamp
                ? new Date(tsSec(item.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : item._local
                  ? 'Sending…'
                  : ''}
            </Text>
          ) : null}
        </View>

        {isLastMine && readReceipt}
      </View>
    </View>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for better performance
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.text === nextProps.item.text &&
    prevProps.item._local === nextProps.item._local &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.reaction === nextProps.reaction &&
    prevProps.isLastMine === nextProps.isLastMine &&
    prevProps.playingAudioId === nextProps.playingAudioId &&
    prevProps.audioPlayer?.playing === nextProps.audioPlayer?.playing &&
    prevProps.audioPlayer?.currentTime === nextProps.audioPlayer?.currentTime &&
    prevProps.profile?.photo === nextProps.profile?.photo &&
    prevProps.profile?.username === nextProps.profile?.username &&
    prevProps.prev?.senderId === nextProps.prev?.senderId &&
    prevProps.next?.senderId === nextProps.next?.senderId
  );
});

const ChatDetailScreen = () => {
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<any>();
  const { chatId } = route.params;
  const preloadedMessages: Message[] | undefined = route.params?.preloadedMessages;
  const initialSnapshotId: string | null = route.params?.initialSnapshotId ?? null;
  const initialHeader: any = route.params?.initialHeader;

  // Cleanup typing on unmount
  useEffect(() => {
    return () => {
      if (chatId) {
        try { clearTyping(chatId); } catch {};
      }
    };
  }, [chatId]);

  // Read receipts: mark read immediately on focus and keep marking every 2s while focused
  useFocusEffect(
    useCallback(() => {
      if (!chatId) return;

      markChatRead(chatId);

      const interval = setInterval(() => {
        markChatRead(chatId);
      }, 2000);

      return () => clearInterval(interval);
    }, [chatId])
  );

  

  const [messages, setMessages] = useState<Message[]>([]);
  // Mark read when new messages arrive (if user is at the bottom)
  useEffect(() => {
    if (messages.length > 0 && userAtBottomRef.current && chatId) {
      markChatRead(chatId);
    }
  }, [messages.length, chatId]);
  const [profiles, setProfiles] = useState<{ [userId: string]: any }>({});
  const [messageText, setMessageText] = useState('');
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioPlayer = useAudioPlayer();
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [groupMeta, setGroupMeta] = useState<{ title?: string; photoUrl?: string } | null>(null);
  const [chatActivityId, setChatActivityId] = useState<string | null>(null);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [participants, setParticipants] = useState<Array<{ uid: string; username: string; photo?: string }>>([]);
  const [friends, setFriends] = useState<Array<{ uid: string; username: string; photo?: string }>>([]);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [addUsersVisible, setAddUsersVisible] = useState(false);
  const [participantsVisible, setParticipantsVisible] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editPhotoUri, setEditPhotoUri] = useState<string | null>(null);
  const [addingUsersMap, setAddingUsersMap] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const [activityInfo, setActivityInfo] = useState<{ name: string, type: string, date: string, time: string } | null>(null);
  const [dmPeer, setDmPeer] = useState<{ uid: string; username: string; photo?: string } | null>(null);
  const { allActivities, joinedActivities } = useActivityContext();
  const myJoinedActivities = useMemo(() => 
    (allActivities || []).filter((a: any) => (joinedActivities || []).includes(a.id)),
    [allActivities, joinedActivities]
  );
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteSelection, setInviteSelection] = useState<Record<string, boolean>>({});
  const [inviteTargetUid, setInviteTargetUid] = useState<string | null>(null);
  const [inviteTargetName, setInviteTargetName] = useState<string | null>(null);
  const [myFriendIds, setMyFriendIds] = useState<string[]>([]);
  const [myRequestsSent, setMyRequestsSent] = useState<string[]>([]);
  const [initialHasJoinedActivities, setInitialHasJoinedActivities] = useState<boolean>(false);

  const [readsMap, setReadsMap] = useState<Record<string, number | { seconds: number }>>({});
  const [typingMap, setTypingMap] = useState<Record<string, any>>({});
  const lastTypingPingRef = useRef(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const noMoreOlderRef = useRef(false);
  const latestDescSnapshotRef = useRef<any | null>(null);

  const [pending, setPending] = useState<Message[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  const [reactionTarget, setReactionTarget] = useState<Message | null>(null);
  const reactionAnim = useRef(new Animated.Value(0)).current;

  const toastAnim = useRef(new Animated.Value(0)).current;
  const [toastMsg, setToastMsg] = useState('');
  const toastTimeoutRef = useRef<any>(null);
  const showToast = useCallback((msg: string) => {
    if (!msg) return;
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMsg(msg);
    Animated.timing(toastAnim, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    toastTimeoutRef.current = setTimeout(() => {
      Animated.timing(toastAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start();
      toastTimeoutRef.current = null;
    }, 1600);
  }, [toastAnim]);

  const [reactions, setReactions] = useState<Record<string, string>>({});

  const flatListRef = useRef<FlatList>(null);
  const isInitialLoad = useRef(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isMessagesReady, setIsMessagesReady] = useState(false);
  const navigatedAwayRef = useRef(false);
  const leavingRef = useRef(false);
  const shownExitAlertRef = useRef(false);

  const contentHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const prevContentHeightRef = useRef(0);
  const adjustingScrollRef = useRef(false);
  const userAtBottomRef = useRef(true);
  const savedScrollOffsetBeforePrependRef = useRef<number | null>(null);

  const [showScrollFab, setShowScrollFab] = useState(false);

  const [readReceiptH, setReadReceiptH] = useState(0);
  const [kbHeightNum, setKbHeightNum] = useState(0);
  const kbHeight = useRef(new Animated.Value(0)).current;

  const [creatingInvite, setCreatingInvite] = useState(false);

  const myId = auth.currentUser?.uid;

  const exitToInbox = useCallback(() => {
    if (navigatedAwayRef.current) return;
    navigatedAwayRef.current = true;
    setOptionsVisible(false);
    setParticipantsVisible(false);
    setEditVisible(false);
    setAddUsersVisible(false);
    setTimeout(() => navigation.navigate('MainTabs' as any, { screen: 'Inbox' } as any), 0);
  }, [navigation]);

  const safeExitChat = useCallback(() => {
    if (navigatedAwayRef.current) return;
    navigatedAwayRef.current = true;
    setOptionsVisible(false);
    setParticipantsVisible(false);
    setEditVisible(false);
    setAddUsersVisible(false);
    setTimeout(() => {
      const navAny = navigation as any;
      if (navAny?.canGoBack?.()) navigation.goBack();
      else navigation.navigate('MainTabs' as any, { screen: 'Inbox' } as any);
    }, 0);
  }, [navigation]);

  useEffect(() => {
    if (isMessagesReady) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    }
  }, [isMessagesReady, fadeAnim]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setButtonStyleAsync('light').catch(() => {});
      NavigationBar.setBackgroundColorAsync('#121212').catch(() => {});
    }
  }, []);

  // Smooth keyboard show: listen for keyboard willShow/didShow and animate scroll to end
  useEffect(() => {
    const onShow = (e: any) => {
      const height = e?.endCoordinates?.height || 0;
      setKbHeightNum(height);
      if (height > 0 && userAtBottomRef.current) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        });
      }
    };

    const onHide = () => {
      setKbHeightNum(0);
    };

    const subWillShow = Keyboard.addListener('keyboardWillShow', onShow);
    const subDidShow = Keyboard.addListener('keyboardDidShow', onShow);
    const subWillHide = Keyboard.addListener('keyboardWillHide', onHide);
    const subDidHide = Keyboard.addListener('keyboardDidHide', onHide);

    return () => {
      try { subWillShow.remove(); } catch {};
      try { subDidShow.remove(); } catch {};
      try { subWillHide.remove(); } catch {};
      try { subDidHide.remove(); } catch {};
    };
  }, []);

  // Access guard + message loading
  useEffect(() => {
    let unsubscribeMessages: undefined | (() => void);
    const ref = doc(db, 'chats', chatId);
    const unsubAccess = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          if (leavingRef.current || navigatedAwayRef.current) { exitToInbox(); return; }
          if (!shownExitAlertRef.current) {
            shownExitAlertRef.current = true;
            Alert.alert('Chat not found', 'This chat no longer exists.', [{ text: 'OK', onPress: () => safeExitChat() }]);
          }
          return;
        }
        const data: any = snap.data();
        const uid = auth.currentUser?.uid;
        if (!uid || !Array.isArray(data.participants) || !data.participants.includes(uid)) {
          if (leavingRef.current || navigatedAwayRef.current) { exitToInbox(); return; }
          if (!shownExitAlertRef.current) {
            shownExitAlertRef.current = true;
            Alert.alert('Access Denied', 'You are no longer a participant in this group chat.', [{ text: 'OK', onPress: () => safeExitChat() }]);
          }
          return;
        }

        setReadsMap(data?.reads || data?.seen || data?.lastReads || data?.lastReadBy || {});
        setTypingMap(data?.typing || {});

        if (!unsubscribeMessages) {
          (async () => {
            try {
              // Instant load from preloaded data
              if (preloadedMessages && Array.isArray(preloadedMessages) && preloadedMessages.length) {
                setMessages(preloadedMessages as any);
                setIsMessagesReady(true);
                isInitialLoad.current = false;
                setTimeout(() => { 
                  flatListRef.current?.scrollToEnd({ animated: false }); 
                  userAtBottomRef.current = true; 
                }, 0);
              }

              if (initialSnapshotId) {
                try {
                  const docRef = doc(db, 'chats', chatId, 'messages', initialSnapshotId);
                  const snap = await getDoc(docRef);
                  if (snap.exists()) latestDescSnapshotRef.current = snap;
                } catch {}
              }

              // Fetch latest if no preload
              if (!preloadedMessages || preloadedMessages.length === 0) {
                const page = await fetchLatestMessagesPage(chatId, PAGE_SIZE);
                latestDescSnapshotRef.current = page.lastSnapshot || latestDescSnapshotRef.current;
                setMessages((page.messages || []) as any);
                setIsMessagesReady(true);
                isInitialLoad.current = false;
                setTimeout(() => { 
                  flatListRef.current?.scrollToEnd({ animated: false }); 
                  userAtBottomRef.current = true; 
                }, 0);
              }
            } catch {}
          })();

          // Real-time listener for new messages
          unsubscribeMessages = listenToLatestMessages(
            chatId,
            50,
            (msgs: any[]) => {
              setMessages((prev) => {
                const ids = new Set(prev.map((m) => m.id));
                const newMsgs = msgs.filter((m) => !ids.has(m.id));
                if (newMsgs.length === 0) return prev;
                
                const merged = [...prev, ...newMsgs];
                const deduped = Array.from(new Map(merged.map((m: any) => [m.id, m])).values());
                deduped.sort((a: any, b: any) => tsSec(a.timestamp) - tsSec(b.timestamp));
                return deduped;
              });
              
              markChatRead(chatId);
              
              if (!isInitialLoad.current && userAtBottomRef.current) {
                setTimeout(() => { 
                  flatListRef.current?.scrollToEnd({ animated: true }); 
                  userAtBottomRef.current = true; 
                }, 60);
              }
              
              if (isInitialLoad.current) {
                isInitialLoad.current = false;
                setIsMessagesReady(true);
                setTimeout(() => { 
                  flatListRef.current?.scrollToEnd({ animated: false }); 
                  userAtBottomRef.current = true; 
                }, 0);
              }
            },
            () => {
              if (leavingRef.current || navigatedAwayRef.current) { exitToInbox(); return; }
              if (!shownExitAlertRef.current) {
                shownExitAlertRef.current = true;
                Alert.alert('Access Denied', 'You are no longer allowed to view this chat.', [{ text: 'OK', onPress: () => safeExitChat() }]);
              }
            }
          );
        }
      },
      () => {
        if (leavingRef.current || navigatedAwayRef.current) { exitToInbox(); return; }
        if (!shownExitAlertRef.current) {
          shownExitAlertRef.current = true;
          Alert.alert('Access Denied', 'You are no longer allowed to view this chat.', [{ text: 'OK', onPress: () => safeExitChat() }]);
        }
      }
    );
    return () => {
      if (unsubscribeMessages) unsubscribeMessages();
      unsubAccess();
    };
  }, [chatId, preloadedMessages, initialSnapshotId, exitToInbox, safeExitChat]);

  // Batch profile fetching
  useEffect(() => {
    const fetchProfiles = async () => {
      const ids = new Set(messages.map((m) => m.senderId));
      const newProfiles: { [userId: string]: any } = { ...profiles };
      const toFetch = Array.from(ids).filter(id => !newProfiles[id]);
      
      if (toFetch.length === 0) return;

      // Batch fetch in groups of 10
      for (let i = 0; i < toFetch.length; i += 10) {
        const batch = toFetch.slice(i, i + 10);
        const q = query(collection(db, 'profiles'), where('__name__', 'in', batch));
        try {
          const snap = await getDocs(q);
          snap.forEach((d) => {
            newProfiles[d.id] = d.data();
          });
        } catch {}
      }
      
      setProfiles(newProfiles);
    };
    if (messages.length) fetchProfiles();
  }, [messages.length]);

  // Header meta
  useEffect(() => {
    if (initialHeader) {
      try {
        const ih = initialHeader || {};
        if (Array.isArray(ih.myFriendIds)) setMyFriendIds(ih.myFriendIds);
        if (Array.isArray(ih.myRequestsSent)) setMyRequestsSent(ih.myRequestsSent);
        if (Array.isArray(ih.myJoinedActivitiesIds) && ih.myJoinedActivitiesIds.length > 0) setInitialHasJoinedActivities(true);
        if (ih.type === 'dm') {
          setDmPeer({ uid: ih.peerId || '', username: ih.name || 'User', photo: ih.image || ih.photo || '' });
          setActivityInfo(null); setGroupMeta(null); setChatActivityId(null);
        } else if (ih.activityType) {
          setActivityInfo({ name: ih.name || 'Activity', type: ih.activityType || '', date: ih.date || '', time: ih.time || '' });
          setGroupMeta(null); setChatActivityId(ih.activityId || null);
        } else {
          setActivityInfo(null);
          setGroupMeta({ title: ih.name || 'Group Chat', photoUrl: ih.image || ih.photo || '' });
          setChatActivityId(null);
          setEditTitle((ih.name || 'Group Chat') as string);
        }
      } catch {}
    }

    const fetchActivity = async () => {
      const chatDoc = await getDoc(doc(db, 'chats', chatId));
      const chatData = chatDoc.data();
      const participants = Array.isArray(chatData?.participants) ? chatData?.participants : [];
      const isDm = chatData?.type === 'dm' || String(chatId || '').startsWith('dm_');
      setParticipantIds(participants);

      if (isDm) {
        const myId = auth.currentUser?.uid;
        const peerId = participants.find((p: string) => p !== myId);
        if (peerId) {
          const peerDoc = await getDoc(doc(db, 'profiles', peerId));
          if (peerDoc.exists()) {
            const p: any = peerDoc.data();
            setDmPeer({ uid: peerId, username: p.username || 'User', photo: p.photo || p.photoURL });
          }
        }
        setActivityInfo(null); setGroupMeta(null); setChatActivityId(null);
      } else if (chatData?.activityId) {
        const activityDoc = await getDoc(doc(db, 'activities', chatData.activityId));
        if (activityDoc.exists()) {
          const data = activityDoc.data();
          setActivityInfo({
            name: data.activity || data.name || 'Activity',
            type: data.activity || '',
            date: data.date || '',
            time: data.time || '',
          });
        }
        setGroupMeta(null);
        setChatActivityId(chatData.activityId);
      } else {
        setActivityInfo(null);
        setGroupMeta({ title: (chatData as any)?.title || 'Group Chat', photoUrl: (chatData as any)?.photoUrl });
        setChatActivityId(null);
        setEditTitle(((chatData as any)?.title || 'Group Chat') as string);
      }
    };
    fetchActivity();
  }, [chatId, initialHeader]);

  // Participants list
  useEffect(() => {
    const load = async () => {
      if (!participantIds.length) { setParticipants([]); return; }
      const rows: Array<{ uid: string; username: string; photo?: string }> = [];
      for (let i = 0; i < participantIds.length; i += 10) {
        const ids = participantIds.slice(i, i + 10);
        const q = query(collection(db, 'profiles'), where('__name__', 'in', ids));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const p: any = d.data();
          rows.push({ uid: d.id, username: p.username || p.username_lower || 'User', photo: p.photo || p.photoURL });
        });
      }
      rows.sort((a, b) => a.username.localeCompare(b.username));
      setParticipants(rows);
    };
    load();
  }, [participantIds]);

  // Live friend state
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const unsub = onSnapshot(
      doc(db, 'profiles', me),
      (snap) => {
        if (!snap.exists()) { setMyFriendIds([]); setMyRequestsSent([]); return; }
        const data: any = snap.data();
        setMyFriendIds(Array.isArray(data?.friends) ? data.friends : []);
        setMyRequestsSent(Array.isArray(data?.requestsSent) ? data.requestsSent : []);
      },
      () => { setMyFriendIds([]); setMyRequestsSent([]); }
    );
    return () => unsub();
  }, []);

  // Friends for add-users modal
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const loadFriends = async () => {
      try {
        const meDoc = await getDoc(doc(db, 'profiles', me));
        if (!meDoc.exists()) { setFriends([]); return; }
        const data: any = meDoc.data();
        const friendIds: string[] = Array.isArray(data?.friends) ? data.friends : [];
        if (!friendIds.length) { setFriends([]); return; }
        const rows: Array<{ uid: string; username: string; photo?: string }> = [];
        for (let i = 0; i < friendIds.length; i += 10) {
          const ids = friendIds.slice(i, i + 10);
          const q2 = query(collection(db, 'profiles'), where('__name__', 'in', ids));
          const snap2 = await getDocs(q2);
          snap2.forEach((d) => {
            const p: any = d.data();
            rows.push({ uid: d.id, username: p.username || p.username_lower || 'User', photo: p.photo || p.photoURL });
          });
        }
        rows.sort((a, b) => a.username.localeCompare(b.username));
        setFriends(rows);
      } catch { }
    };
    loadFriends();
  }, []);

  const openInfoMenu = useCallback(() => setOptionsVisible(true), []);
  const closeInfoMenu = useCallback(() => setOptionsVisible(false), []);

  const handlePickEditPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!result.canceled && result.assets?.length) setEditPhotoUri(result.assets[0].uri);
  };

  const handleSaveEdit = async () => {
    if (!groupMeta) return;
    setBusy(true);
    try {
      const updates: any = {};
      const newTitle = (editTitle || '').trim().slice(0, 25);
      if (newTitle && newTitle !== groupMeta.title) updates.title = newTitle;
      if (editPhotoUri) {
        const uploaded = await uploadChatImage(editPhotoUri, auth.currentUser?.uid || 'unknown', `group_${chatId}`);
        updates.photoUrl = uploaded;
      }
      if (Object.keys(updates).length) {
        await updateDoc(doc(db, 'chats', chatId), updates);
        setGroupMeta({ title: updates.title || groupMeta.title, photoUrl: updates.photoUrl || groupMeta.photoUrl });
      }
      setEditVisible(false);
    } catch (e: any) {
      Alert.alert('Update failed', e?.message || 'Could not update group.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddUsers = async () => {
    const selected = Object.keys(addingUsersMap).filter((k) => addingUsersMap[k]);
    if (!selected.length) { setAddUsersVisible(false); return; }
    setBusy(true);
    try {
      const toAdd = selected.filter((uid) => !participantIds.includes(uid));
      if (toAdd.length) {
        await updateDoc(doc(db, 'chats', chatId), { participants: arrayUnion(...toAdd) } as any);
        setParticipantIds([...participantIds, ...toAdd]);
        const me = auth.currentUser?.uid;
        try {
          const addedProfiles = await Promise.all(
            toAdd.map(async (uid) => {
              const p = await getDoc(doc(db, 'profiles', uid));
              return p.exists() ? ((p.data() as any).username || 'User') : 'User';
            })
          );
          const myProfileSnap = me ? await getDoc(doc(db, 'profiles', me)) : null;
          const myName = (myProfileSnap && myProfileSnap.exists()) ? ((myProfileSnap.data() as any).username || 'Someone') : 'Someone';
          const names = addedProfiles.join(', ');
          await addSystemMessage(chatId, `${myName} added ${names}`);
        } catch { }
      }
      setAddUsersVisible(false);
      setAddingUsersMap({});
    } catch (e: any) {
      Alert.alert('Add users failed', e?.message || 'Could not add users.');
    } finally {
      setBusy(false);
    }
  };

  const handleLeaveCustomGroup = async () => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    Alert.alert('Leave group', 'Are you sure you want to leave this group?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          try {
            leavingRef.current = true;
            try {
              const mySnap = await getDoc(doc(db, 'profiles', me));
              const myName = mySnap.exists() ? ((mySnap.data() as any).username || 'Someone') : 'Someone';
              await addSystemMessage(chatId, `${myName} left the group`);
            } catch { }
            await leaveChatWithAutoDelete(chatId, me);
          } catch { }
          exitToInbox();
        }
      }
    ]);
  };

  const handleMessageUser = async (uid: string) => {
    const me = auth.currentUser?.uid;
    if (!me || uid === me) return;
    try {
      if (participantsVisible) setParticipantsVisible(false);
      if (optionsVisible) setOptionsVisible(false);
      const dmId = await ensureDmChat(uid);
      setTimeout(() => navigation.navigate('ChatDetail', { chatId: dmId }), 60);
    } catch (e: any) {
      Alert.alert('Could not open chat', e?.message || 'Please try again.');
    }
  };

  const handleAddFriend = async (uid: string) => {
    try {
      setMyRequestsSent((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
      await sendFriendRequest(uid);
      showToast('Friend request sent');
    } catch (e: any) {
      setMyRequestsSent((prev) => prev.filter((id) => id !== uid));
      Alert.alert('Failed', e?.message || 'Could not send request.');
    }
  };

  const handleCancelFriendRequest = async (uid: string) => {
    try {
      setMyRequestsSent((prev) => prev.filter((id) => id !== uid));
      await cancelFriendRequest(uid);
      showToast('Canceled request');
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not cancel request.');
    }
  };

  const goToUserProfile = useCallback((userId: string) => {
    if (participantsVisible) {
      setParticipantsVisible(false);
      setTimeout(() => navigation.navigate('UserProfile', { userId }), 80);
      return;
    }
    if (optionsVisible) setOptionsVisible(false);
    navigation.navigate('UserProfile', { userId });
  }, [participantsVisible, optionsVisible, navigation]);

  // Audio handlers
  const handlePlayPauseAudio = useCallback(async (uri: string, id: string) => {
    if (playingAudioId === id) {
      if (audioPlayer.playing) audioPlayer.pause();
      else audioPlayer.play();
      return;
    }
    setPlayingAudioId(id);
    audioPlayer.replace(uri);
    audioPlayer.play();
  }, [playingAudioId, audioPlayer]);

  const handleSpeedChange = useCallback(() => {
    const next = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(next);
    audioPlayer.playbackRate = next;
  }, [playbackRate, audioPlayer]);

  // OPTIMISTIC SEND
  const doOptimisticImages = async (uris: string[]) => {
    const uid = auth.currentUser!.uid;
    const locals: Message[] = uris.map((uri) => ({
      id: `local-img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      senderId: uid,
      text: uri,
      type: 'image',
      timestamp: { seconds: Math.floor(Date.now() / 1000) },
      _local: true,
    }));
    setPending((p) => [...p, ...locals]);
    setSelectedImages([]);
    try {
      const channelRef = doc(db, 'chats', chatId);
      await updateDoc(channelRef, {
        lastMessageText: 'Sent a photo',
        lastMessageType: 'image',
        lastMessageSenderId: uid,
        lastMessageTimestamp: serverTimestamp(),
      } as any);
    } catch {}
    for (const preview of locals) {
      try {
        const imageId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const downloadUrl = await uploadChatImage(preview.text, uid, imageId);
        await sendMessage(chatId, uid, downloadUrl, 'image');
      } catch (e: any) {
        Alert.alert('Upload failed', e?.message || 'Could not upload image.');
        setPending((p) => p.filter((x) => x.id !== preview.id));
      }
    }
  };

  const handleSend = useCallback(async () => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;

    // Clear typing immediately
    clearTyping(chatId);

    if (selectedImages.length) await doOptimisticImages(selectedImages);

    if (messageText.trim()) {
      const text = messageText.trim();
      const localId = `local-${Date.now()}-${Math.random()}`;
      
      const local: Message = {
        id: localId,
        senderId: uid,
        text,
        type: 'text',
        timestamp: { seconds: Math.floor(Date.now() / 1000) },
        _local: true,
      };
      
      // INSTANT: Add to pending, clear input
      setPending((p) => [...p, local]);
      setMessageText('');
      setReplyTo(null);
      
      // INSTANT: Scroll immediately
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
        userAtBottomRef.current = true;
      });
      
      // Send in background (do not await — UI is already updated)
      sendMessage(chatId, uid, text, 'text')
        .then(() => {
          setPending((p) => p.filter((m) => m.id !== localId));
        })
        .catch((e) => {
          console.error('Send failed:', e);
        });
    }
  }, [messageText, selectedImages, chatId]);

  // Recording
  const startRecording = async () => {
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Denied', 'Please enable audio recording permissions.');
        return;
      }
      try { if (audioPlayer.playing) audioPlayer.pause(); } catch {}
      try {
        await AudioModule.setAudioModeAsync?.({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          interruptionModeAndroid: 1,
          playThroughEarpieceAndroid: false,
        } as any);
      } catch {}
      await audioRecorder.prepareToRecordAsync?.(RecordingPresets.HIGH_QUALITY);
      await audioRecorder.record();
    } catch {
      Alert.alert('Recording Error', 'Could not start recording. Please try again.');
    }
  };
  
  const stopRecording = async () => {
    if (!audioRecorder.isRecording || !auth.currentUser) return;
    try {
      const uri = await audioRecorder.stop();
      if (uri != null) await sendMessage(chatId, auth.currentUser.uid, uri, 'audio');
    } catch {
      Alert.alert('Recording Error', 'Could not save the recording.');
    }
  };

  // Typing pings
  const pingTyping = useCallback(async () => {
    const now = Date.now();
    if (now - lastTypingPingRef.current < 2500) return;
    lastTypingPingRef.current = now;
    try {
      const me = auth.currentUser?.uid;
      if (!me) return;
      await updateDoc(doc(db, 'chats', chatId), { [`typing.${me}`]: serverTimestamp() } as any);
    } catch { }
  }, [chatId]);

  // Camera / gallery
  const handleCameraPress = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable camera permissions.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.8 });
    if (!result.canceled && result.assets?.length) {
      const MAX = 3;
      setSelectedImages((prev) => {
        if (prev.length >= MAX) {
          Alert.alert('Limit reached', 'You can only send up to 3 images at a time.');
          return prev;
        }
        return [...prev, result.assets[0].uri].slice(0, MAX);
      });
    }
  };

  const handleGalleryPress = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable gallery permissions.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, allowsEditing: false, quality: 0.8 });
    if (!result.canceled && result.assets?.length) {
      setSelectedImages((prev) => {
        const MAX = 3;
        const remaining = MAX - prev.length;
        if (remaining <= 0) {
          Alert.alert('Limit reached', 'You can only send up to 3 images at a time.');
          return prev;
        }
        const picked = result.assets.map((a) => a.uri).slice(0, remaining);
        const next = [...prev, ...picked];
        if (result.assets.length > remaining) Alert.alert('Limit reached', 'Only the first 3 images will be added.');
        return next;
      });
    }
  };

  const handleRemoveImage = useCallback((uriToRemove: string) => 
    setSelectedImages((prev) => prev.filter((uri) => uri !== uriToRemove)), 
  []);

  // Merge server + optimistic
  const renderMessages: Message[] = useMemo(() => {
    if (!pending.length) return messages;
    const serverMine = messages.filter((m) => m.senderId === myId);
    const cleaned = pending.filter((p) => {
      const near = serverMine.find((m) => {
        if (m.type !== p.type) return false;
        if (p.type === 'text' && m.text === p.text) return true;
        const dt = Math.abs(tsSec(m.timestamp) - tsSec(p.timestamp));
        return dt < 15;
      });
      return !near;
    });
    return [...messages, ...cleaned].sort((a, b) => tsSec(a.timestamp) - tsSec(b.timestamp));
  }, [messages, pending, myId]);

  const imageMessages = useMemo(
    () => renderMessages.filter((m) => m.type === 'image' && m.text),
    [renderMessages]
  );

  const lastMineIndex = useMemo(() => {
    let idx = -1;
    renderMessages.forEach((m, i) => { if (m.senderId === myId) idx = i; });
    return idx;
  }, [renderMessages, myId]);

  const readersForMyLast = useMemo(() => {
    const last = lastMineIndex >= 0 ? renderMessages[lastMineIndex] : null;
    if (!last) return [];
    const lastTs = tsSec(last.timestamp);
    return participantIds.filter((uid) => {
      if (uid === myId) return false;
      const r = (readsMap as any)?.[uid];
      const rs = tsSec(r);
      return rs >= lastTs;
    });
  }, [readsMap, renderMessages, lastMineIndex, participantIds, myId]);

  const typingUsers = useMemo(() => {
    const now = Date.now();
    const ids = Object.entries(typingMap || {})
      .filter(([uid, t]: any) => uid !== myId && now - tsSec(t) * 1000 < TYPING_FRESH_MS)
      .map(([uid]) => uid);
    return ids;
  }, [typingMap, myId]);

  const bottomSpacer = useMemo(() => {
    return kbHeightNum + readReceiptH + 12;
  }, [kbHeightNum, readReceiptH]);

  

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder) return;
    if (noMoreOlderRef.current) return;
    if (!chatId) return;
    setLoadingOlder(true);
    try {
      const oldestSnapshot = latestDescSnapshotRef.current;
      const res = await fetchOlderMessagesPage(chatId, oldestSnapshot, PAGE_SIZE);
      const older = res.messages || [];
      if (!older || older.length === 0) {
        noMoreOlderRef.current = true;
      } else {
        // Capture current scroll position & height BEFORE prepending older messages
        const currentOffset = scrollOffsetRef.current || 0;
        const currentHeight = contentHeightRef.current || 0;
        savedScrollOffsetBeforePrependRef.current = currentOffset;
        prevContentHeightRef.current = currentHeight;
        adjustingScrollRef.current = true;

        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const toAdd = older.filter((m: any) => !ids.has(m.id));
          return [...toAdd, ...prev];
        });
        latestDescSnapshotRef.current = res.lastSnapshot || latestDescSnapshotRef.current;
      }
    } catch (e) {
      // noop
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, loadingOlder]);

  const openReactions = useCallback((msg: Message) => {
    setReactionTarget(msg);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    reactionAnim.setValue(0);
    Animated.spring(reactionAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 120 }).start();
  }, [reactionAnim]);

  const closeReactions = useCallback(() => {
    Animated.timing(reactionAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setReactionTarget(null);
    });
  }, [reactionAnim]);

  const pickReaction = useCallback((emoji: string) => {
    if (!reactionTarget) return;
    Haptics.selectionAsync().catch(() => {});
    setReactions((r) => ({ ...r, [reactionTarget.id]: emoji }));
    setTimeout(() => {
      setReactions((r) => {
        const { [reactionTarget.id]: _drop, ...rest } = r;
        return rest;
      });
    }, 3000);
    closeReactions();
  }, [reactionTarget, closeReactions]);

  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const prev = renderMessages[index - 1];
      const next = renderMessages[index + 1];
      const profile = profiles[item.senderId];
      const isOwn = item.senderId === myId;
      const isLastMine = index === lastMineIndex;

      const readReceipt = isOwn && isLastMine ? (
        dmPeer ? (
          readersForMyLast.includes(dmPeer.uid) ? (
            <Text
              onLayout={(e) => setReadReceiptH(e.nativeEvent.layout.height)}
              style={{ color: '#8ecfd1', fontSize: 11, marginTop: 4, alignSelf: 'flex-end' }}
            >
              Read
            </Text>
          ) : (
            <View onLayout={() => setReadReceiptH(0)} />
          )
        ) : readersForMyLast.length ? (
          <View
            onLayout={(e) => setReadReceiptH(e.nativeEvent.layout.height)}
            style={{ flexDirection: 'row-reverse', alignSelf: 'flex-end', marginTop: 4 }}
          >
            {readersForMyLast.slice(0, 8).map((uid) => {
              const p = profiles[uid] || {};
              return (
                <Image
                  key={uid}
                  source={{ uri: p.photo || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(p.username || 'U')) }}
                  style={{ width: 18, height: 18, borderRadius: 9, marginLeft: 4, borderWidth: 1, borderColor: TURQUOISE }}
                />
              );
            })}
          </View>
        ) : (
          <View onLayout={() => setReadReceiptH(0)} />
        )
      ) : null;

      return (
        <MessageItem
          item={item}
          prev={prev}
          next={next}
          profile={profile}
          isOwn={isOwn}
          myId={myId}
          reaction={reactions[item.id]}
          isLastMine={isLastMine}
          readReceipt={readReceipt}
          onLongPress={() => openReactions(item)}
          onImagePress={() => {
            const idx = imageMessages.findIndex((m) => m.id === item.id);
            if (idx >= 0) {
              setViewerIndex(idx);
              setViewerOpen(true);
            }
          }}
          onProfilePress={() => navigation.navigate('UserProfile', { userId: item.senderId })}
          onReply={() => setReplyTo(item)}
          handlePlayPauseAudio={handlePlayPauseAudio}
          playingAudioId={playingAudioId}
          audioPlayer={audioPlayer}
          handleSpeedChange={handleSpeedChange}
          playbackRate={playbackRate}
        />
      );
    },
    [
      renderMessages,
      profiles,
      myId,
      lastMineIndex,
      reactions,
      dmPeer,
      readersForMyLast,
      openReactions,
      imageMessages,
      navigation,
      handlePlayPauseAudio,
      playingAudioId,
      audioPlayer,
      handleSpeedChange,
      playbackRate,
    ]
  );

  const typingLabel = useMemo(() => {
    if (!typingUsers.length) return '';
    if (dmPeer && typingUsers.includes(dmPeer.uid)) return 'typing…';
    const names = typingUsers
      .map((uid) => profiles[uid]?.username)
      .filter(Boolean)
      .slice(0, 2)
      .join(' & ');
    return names ? `${names} ${typingUsers.length > 1 ? 'are' : 'is'} typing…` : 'Someone is typing…';
  }, [typingUsers, profiles, dmPeer]);

  const screenW = Dimensions.get('window').width;

  const keyExtractor = useCallback((item: Message) => item.id.toString(), []);
  const getItemLayout = useCallback(
    (_data: any, index: number) => ({
      length: 100,
      offset: 100 * index,
      index,
    }),
    []
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['top']}>
      {/* Header (always visible) */}
      <View style={styles.header}>
        <TouchableOpacity onPress={safeExitChat} style={styles.headerBack} accessible accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={26} color={TURQUOISE} />
        </TouchableOpacity>

        {dmPeer ? (
          (() => {
            const isFriend = dmPeer ? myFriendIds.includes(dmPeer.uid) : false;
            const isRequested = dmPeer ? myRequestsSent.includes(dmPeer.uid) : false;
            return (
              <>
                <TouchableOpacity onPress={() => dmPeer?.uid && goToUserProfile(dmPeer.uid)} activeOpacity={0.8}>
                  <Image
                    source={{ uri: dmPeer.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(dmPeer.username) }}
                    style={styles.headerImage}
                  />
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => dmPeer?.uid && goToUserProfile(dmPeer.uid)} activeOpacity={0.7}>
                      <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
                        {dmPeer.username}
                      </Text>
                    </TouchableOpacity>
                    {isFriend ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                        <View style={styles.msgBtnFilled}>
                          <Ionicons name={'checkmark-done-outline'} size={18} color={'#000'} style={{ marginRight: 4 }} />
                          <Text style={styles.msgBtnTextInverted}>Connected</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.inviteBtn, { marginLeft: 6 }]}
                          onPress={() => {
                            setInviteSelection({});
                            setInviteTargetUid(dmPeer?.uid || null);
                            setInviteTargetName(dmPeer?.username || null);
                            setInviteModalVisible(true);
                          }}
                        >
                          <Ionicons name="add-circle-outline" size={18} color="#000" />
                          <Text style={styles.inviteBtnText}>Invite</Text>
                        </TouchableOpacity>
                      </View>
                    ) : isRequested ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                        <TouchableOpacity
                          style={styles.msgBtnFilled}
                          activeOpacity={0.85}
                          onPress={() => dmPeer && handleCancelFriendRequest(dmPeer.uid)}
                        >
                          <Ionicons name={'person-add-outline'} size={18} color={'#000'} style={{ marginRight: 4 }} />
                          <Text style={styles.msgBtnTextInverted}>Request Sent</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.inviteBtn, { marginLeft: 6 }]}
                          onPress={() => {
                            setInviteSelection({});
                            setInviteTargetUid(dmPeer?.uid || null);
                            setInviteTargetName(dmPeer?.username || null);
                            setInviteModalVisible(true);
                          }}
                        >
                          <Ionicons name="add-circle-outline" size={18} color="#000" />
                          <Text style={styles.inviteBtnText}>Invite</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                        <TouchableOpacity style={styles.msgBtn} activeOpacity={0.85} onPress={() => dmPeer && handleAddFriend(dmPeer.uid)}>
                          <Ionicons name="person-add-outline" size={18} color={TURQUOISE} style={{ marginRight: 4 }} />
                          <Text style={styles.msgBtnText}>Add Friend</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.inviteBtn, { marginLeft: 6 }]}
                          onPress={() => {
                            setInviteSelection({});
                            setInviteTargetUid(dmPeer?.uid || null);
                            setInviteTargetName(dmPeer?.username || null);
                            setInviteModalVisible(true);
                          }}
                        >
                          <Ionicons name="add-circle-outline" size={18} color="#000" />
                          <Text style={styles.inviteBtnText}>Invite</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              </>
            );
          })()
        ) : activityInfo ? (
          <>
            <TouchableOpacity onPress={() => { if (chatActivityId) navigation.navigate('ActivityDetails' as any, { activityId: chatActivityId }); }} activeOpacity={0.8}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  borderWidth: 1,
                  borderColor: TURQUOISE,
                  marginLeft: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'transparent',
                }}
              >
                {activityInfo?.type ? <ActivityIcon activity={activityInfo.type} size={22} color={TURQUOISE} /> : null}
              </View>
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <TouchableOpacity onPress={() => { if (chatActivityId) navigation.navigate('ActivityDetails' as any, { activityId: chatActivityId }); }} activeOpacity={0.8}>
                <Text style={{ color: TURQUOISE, fontWeight: 'bold', fontSize: 17 }}>{activityInfo?.name || 'Group Chat'}</Text>
              </TouchableOpacity>
              {activityInfo?.date && activityInfo?.time && (
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '500' }}>
                  Scheduled for {normalizeDateFormat(activityInfo.date)} at {activityInfo.time}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={openInfoMenu} style={styles.headerInfo}>
              <Ionicons name="information-circle-outline" size={26} color={TURQUOISE} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            {groupMeta?.photoUrl ? (
              <Image source={{ uri: groupMeta.photoUrl }} style={styles.headerImage} />
            ) : (
              <View style={[styles.headerImage, { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: TURQUOISE }]}>
                <Ionicons name="people" size={22} color={TURQUOISE} />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.headerTitle}>{groupMeta?.title || 'Group Chat'}</Text>
            </View>
            <TouchableOpacity onPress={openInfoMenu} style={styles.headerInfo}>
              <Ionicons name="information-circle-outline" size={26} color={TURQUOISE} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* BODY */}
      <View style={{ flex: 1 }}>
        {/* Modals */}
        <Modal visible={inviteModalVisible} transparent animationType="fade" onRequestClose={() => { setInviteModalVisible(false); setInviteTargetUid(null); setInviteTargetName(null); }}>
          <View style={styles.menuOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => { setInviteModalVisible(false); setInviteTargetUid(null); setInviteTargetName(null); }} />
            <View style={styles.modalPanel} pointerEvents="auto">
              <Text style={styles.modalTitle}>Invite {inviteTargetName || dmPeer?.username || 'user'}</Text>
              {((myJoinedActivities.length === 0) && !initialHasJoinedActivities) ? (
                <Text style={styles.placeholderText}>You haven't joined any activities yet.</Text>
              ) : (
                <FlatList
                  data={myJoinedActivities}
                  keyExtractor={(a: any) => a.id}
                  renderItem={({ item }: any) => {
                    const targetUid = inviteTargetUid || dmPeer?.uid;
                    const targetAlreadyJoined = !!(targetUid && Array.isArray(item?.joinedUserIds) && item.joinedUserIds.includes(targetUid));
                    return (
                      <Pressable
                        style={[styles.row, { justifyContent: 'space-between' }, targetAlreadyJoined && { opacity: 0.45 }]}
                        onPress={() => {
                          if (targetAlreadyJoined) {
                            showToast(`${inviteTargetName || dmPeer?.username || 'User'} is already in this activity`);
                            return;
                          }
                          setInviteSelection((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <ActivityIcon activity={item.activity} size={22} color={TURQUOISE} />
                          <View style={{ marginLeft: 8 }}>
                            <Text style={{ color: '#fff', fontWeight: '600' }} numberOfLines={1}>
                              {item.activity}
                            </Text>
                            <Text style={{ color: '#bbb', fontSize: 12 }}>
                              {item.date} • {item.time}
                            </Text>
                          </View>
                        </View>
                        {targetAlreadyJoined ? (
                          <Text style={{ color: '#bbb', fontSize: 12, fontWeight: '600' }}>Joined</Text>
                        ) : (
                          <Ionicons
                            name={inviteSelection[item.id] ? 'checkbox' : 'square-outline'}
                            size={22}
                            color={inviteSelection[item.id] ? TURQUOISE : '#666'}
                          />
                        )}
                      </Pressable>
                    );
                  }}
                  ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                  style={{ maxHeight: 320, marginVertical: 8 }}
                />
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                <TouchableOpacity onPress={() => { setInviteModalVisible(false); setInviteTargetUid(null); setInviteTargetName(null); }} style={[styles.modalButton, { backgroundColor: '#8e2323' }]}>
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    const targetUid = inviteTargetUid || dmPeer?.uid;
                    if (!targetUid) return;
                    const selectedIds = Object.keys(inviteSelection).filter((id) => inviteSelection[id]);
                    if (selectedIds.length === 0) {
                      setInviteModalVisible(false);
                      setInviteTargetUid(null);
                      setInviteTargetName(null);
                      return;
                    }
                    const eligible = selectedIds.filter((id) => {
                      const act = (allActivities || []).find((a: any) => a.id === id);
                      const joinedIds = (act as any)?.joinedUserIds || [];
                      return !(Array.isArray(joinedIds) && joinedIds.includes(targetUid));
                    });
                    if (eligible.length === 0) {
                      showToast(`${inviteTargetName || dmPeer?.username || 'User'} is already in those activities`);
                      return;
                    }
                    try {
                      setCreatingInvite(true);
                      const { sentIds } = await sendActivityInvites(targetUid, eligible);
                      if (sentIds.length > 0) showToast(sentIds.length === 1 ? 'Invite sent' : `Sent ${sentIds.length} invites`);
                      else showToast('No invites sent');
                    } catch {
                      showToast('Could not send invites');
                    }
                    setCreatingInvite(false);
                    setInviteModalVisible(false);
                    setInviteSelection({});
                    setInviteTargetUid(null);
                    setInviteTargetName(null);
                  }}
                  style={[styles.modalButton, { backgroundColor: TURQUOISE, marginLeft: 8, opacity: creatingInvite ? 0.6 : 1 }]}
                >
                  <Text style={{ color: '#000', fontWeight: '700' }}>{creatingInvite ? 'Sending…' : 'Send'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={optionsVisible} transparent animationType="fade" onRequestClose={closeInfoMenu}>
          <View style={styles.menuOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeInfoMenu} />
            <View style={styles.menuPanel} pointerEvents="auto">
              {groupMeta ? (
                <>
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setEditVisible(true); setOptionsVisible(false); }}>
                    <Text style={styles.menuItemText}>Edit group (title & photo)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setAddUsersVisible(true); setOptionsVisible(false); }}>
                    <Text style={styles.menuItemText}>Add users</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setParticipantsVisible(true); setOptionsVisible(false); }}>
                    <Text style={styles.menuItemText}>View participants</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItemDanger} onPress={() => { setOptionsVisible(false); handleLeaveCustomGroup(); }}>
                    <Text style={styles.menuItemDangerText}>Leave group</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setParticipantsVisible(true); setOptionsVisible(false); }}>
                    <Text style={styles.menuItemText}>View participants</Text>
                  </TouchableOpacity>
                  {!!chatActivityId && (
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => { setOptionsVisible(false); navigation.navigate('ActivityDetails' as any, { activityId: chatActivityId }); }}
                    >
                      <Text style={styles.menuItemText}>Go to activity details</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
              {chatActivityId ? (
                <TouchableOpacity style={styles.menuItemDanger} onPress={closeInfoMenu}>
                  <Text style={styles.menuItemDangerText}>Close</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.menuItem, { marginTop: 8 }]} onPress={closeInfoMenu}>
                  <Text style={[styles.menuItemText, { color: '#aaa' }]}>Close</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>

        <Modal visible={!!(editVisible && groupMeta)} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
          <View style={styles.menuOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditVisible(false)} />
            {groupMeta && (
              <View style={styles.modalPanel} pointerEvents="auto">
                <Text style={styles.modalTitle}>Edit group</Text>
                <TouchableOpacity onPress={handlePickEditPhoto} style={styles.photoPickerRow}>
                  {editPhotoUri || groupMeta.photoUrl ? (
                    <Image source={{ uri: editPhotoUri || groupMeta.photoUrl }} style={styles.headerImage} />
                  ) : (
                    <View
                      style={[
                        styles.headerImage,
                        { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c0c0c', borderWidth: 1, borderColor: TURQUOISE },
                      ]}
                    >
                      <Ionicons name="image" size={18} color={TURQUOISE} />
                    </View>
                  )}
                  <Text style={{ color: '#fff', marginLeft: 10 }}>Change group photo</Text>
                </TouchableOpacity>
                <TextInput
                  style={styles.input}
                  value={editTitle}
                  onChangeText={(t) => setEditTitle(t.slice(0, 25))}
                  placeholder="Group title"
                  placeholderTextColor="#888"
                />
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                  <TouchableOpacity onPress={() => setEditVisible(false)} style={[styles.modalButton, { backgroundColor: '#8e2323' }]}>
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={busy}
                    onPress={handleSaveEdit}
                    style={[styles.modalButton, { backgroundColor: TURQUOISE, marginLeft: 8, opacity: busy ? 0.6 : 1 }]}
                  >
                    <Text style={{ color: '#000', fontWeight: '700' }}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </Modal>

        <Modal visible={addUsersVisible} transparent animationType="fade" onRequestClose={() => setAddUsersVisible(false)}>
          <View style={styles.menuOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setAddUsersVisible(false)} />
            <View style={styles.modalPanel} pointerEvents="auto">
              <Text style={styles.modalTitle}>Add users</Text>
              <Text style={{ color: '#aaa', marginBottom: 8 }}>Select from your connections</Text>
              <FlatList
                data={friends.filter((f) => !participantIds.includes(f.uid))}
                keyExtractor={(i) => i.uid}
                style={{ maxHeight: 260 }}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.row} onPress={() => setAddingUsersMap((prev) => ({ ...prev, [item.uid]: !prev[item.uid] }))}>
                    <Image
                      source={{ uri: item.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username) }}
                      style={styles.rowImage}
                    />
                    <Text style={styles.rowText}>{item.username}</Text>
                    <Ionicons name={addingUsersMap[item.uid] ? 'checkbox' : 'square-outline'} size={22} color={TURQUOISE} />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={{ color: '#777', textAlign: 'center', marginVertical: 8 }}>No available friends to add</Text>}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                <TouchableOpacity
                  onPress={() => {
                    setAddUsersVisible(false);
                    setAddingUsersMap({});
                  }}
                  style={[styles.modalButton, { backgroundColor: '#8e2323' }]}
                >
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={busy}
                  onPress={handleAddUsers}
                  style={[styles.modalButton, { backgroundColor: TURQUOISE, marginLeft: 8, opacity: busy ? 0.6 : 1 }]}
                >
                  <Text style={{ color: '#000', fontWeight: '700' }}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={participantsVisible} transparent animationType="fade" onRequestClose={() => setParticipantsVisible(false)}>
          <View style={styles.menuOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setParticipantsVisible(false)} />
            <View style={styles.modalPanel} pointerEvents="auto">
              <Text style={styles.modalTitle}>Participants</Text>
              <FlatList
                data={participants}
                keyExtractor={(i) => i.uid}
                style={{ maxHeight: 300 }}
                renderItem={({ item }) => {
                  const me = auth.currentUser?.uid;
                  const isMe = item.uid === me;
                  return (
                    <View style={[styles.row, { alignItems: 'center' }]}>
                      <TouchableOpacity onPress={() => goToUserProfile(item.uid)} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <Image
                          source={{ uri: item.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username) }}
                          style={styles.rowImage}
                        />
                        <Text style={[styles.rowText, { flex: 1 }]}>
                          {item.username}
                          {isMe ? ' (You)' : ''}
                        </Text>
                      </TouchableOpacity>
                      {!isMe && (
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {myFriendIds.includes(item.uid) ? (
                            <View style={styles.msgBtnFilled}>
                              <Ionicons name={'checkmark-done-outline'} size={18} color={'#000'} style={{ marginRight: 6 }} />
                              <Text style={styles.msgBtnTextInverted}>Connected</Text>
                            </View>
                          ) : myRequestsSent.includes(item.uid) ? (
                            <TouchableOpacity
                              style={styles.msgBtnFilled}
                              activeOpacity={0.85}
                              onPress={() => handleCancelFriendRequest(item.uid)}
                            >
                              <Ionicons name={'person-add-outline'} size={18} color={'#000'} style={{ marginRight: 6 }} />
                              <Text style={styles.msgBtnTextInverted}>Request Sent</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity style={styles.msgBtn} activeOpacity={0.85} onPress={() => handleAddFriend(item.uid)}>
                              <Ionicons name="person-add-outline" size={18} color={TURQUOISE} style={{ marginRight: 6 }} />
                              <Text style={styles.msgBtnText}>Add Friend</Text>
                            </TouchableOpacity>
                          )}

                          <TouchableOpacity
                            style={[styles.inviteBtn, { marginLeft: 6 }]}
                            onPress={() => {
                              setInviteSelection({});
                              setInviteTargetUid(item.uid);
                              setInviteTargetName(item.username);
                              setInviteModalVisible(true);
                            }}
                          >
                            <Ionicons name="add-circle-outline" size={18} color="#000" />
                            <Text style={styles.inviteBtnText}>Invite</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                }}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                <TouchableOpacity
                  onPress={() => setParticipantsVisible(false)}
                  style={[styles.modalButton, { backgroundColor: '#1e1e1e', borderColor: '#444', borderWidth: 1 }]}
                >
                  <Text style={{ color: '#ccc', fontWeight: '600' }}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Messages list */}
        {!isMessagesReady ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG }}>
            <ActivityIndicator size="large" color={TURQUOISE} />
          </View>
        ) : (
          <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
            <FlatList
              ref={flatListRef}
              data={renderMessages}
              keyExtractor={keyExtractor}
              contentContainerStyle={[styles.messageList, { paddingBottom: bottomSpacer }]}
              renderItem={renderItem}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              removeClippedSubviews={Platform.OS === 'android'}
              initialNumToRender={PAGE_SIZE}
              maxToRenderPerBatch={15}
              windowSize={11}
              updateCellsBatchingPeriod={50}
              maintainVisibleContentPosition={{
                minIndexForVisible: 0,
                autoscrollToTopThreshold: 10,
              }}
              onContentSizeChange={(_w, h) => {
                const newH = h || 0;
                const oldH = contentHeightRef.current || 0;
                contentHeightRef.current = newH;

                if (adjustingScrollRef.current) {
                  // Use the previously-captured height (prevContentHeightRef) and the saved offset
                  const delta = newH - (prevContentHeightRef.current || oldH);
                  const baseOffset = savedScrollOffsetBeforePrependRef.current ?? (scrollOffsetRef.current || 0);

                  requestAnimationFrame(() => {
                    flatListRef.current?.scrollToOffset({
                      offset: (baseOffset || 0) + (delta || 0),
                      animated: false,
                    });
                  });

                  adjustingScrollRef.current = false;
                  prevContentHeightRef.current = newH;
                  savedScrollOffsetBeforePrependRef.current = null;
                } else if (userAtBottomRef.current && newH > oldH) {
                  requestAnimationFrame(() => {
                    flatListRef.current?.scrollToEnd({ animated: false });
                  });
                }
              }}
              onScroll={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                scrollOffsetRef.current = contentOffset.y || 0;
                contentHeightRef.current = contentSize?.height || contentHeightRef.current;
                
                // Better bottom detection
                const maxScroll = contentSize.height - layoutMeasurement.height;
                const isAtBottom = maxScroll <= 0 || contentOffset.y >= maxScroll - 20;
                
                userAtBottomRef.current = isAtBottom;
                setShowScrollFab(!isAtBottom);
                
                if (contentOffset.y <= 100 && !loadingOlder) {
                  loadOlderMessages().catch(() => {});
                }
              }}
              scrollEventThrottle={16}
              onLayout={() => {
                if (isInitialLoad.current) {
                  requestAnimationFrame(() => {
                    flatListRef.current?.scrollToEnd({ animated: false });
                    userAtBottomRef.current = true;
                  });
                }
              }}
              ListHeaderComponent={
                loadingOlder ? (
                  <View style={{ paddingVertical: 8, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={TURQUOISE} />
                  </View>
                ) : (
                  <View style={{ height: 6 }} />
                )
              }
              ListFooterComponent={
                typingLabel ? (
                  <View style={{ paddingHorizontal: 14, paddingVertical: 6, alignItems: 'flex-start' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TypingDots />
                      <Text style={{ color: '#9adfe2', marginLeft: 8, fontSize: 12 }}>{typingLabel}</Text>
                    </View>
                  </View>
                ) : <View style={{ height: 6 }} />
              }
            />
          </Animated.View>
        )}

        {/* Composer */}
        <Animated.View
          style={[
            styles.inputContainer,
            {
              paddingBottom: Animated.add(kbHeight, Math.max(insets.bottom, 8)),
            },
          ]}
        >
          {replyTo && (
            <View style={styles.replyHeader}>
              <Ionicons name="return-down-back" size={16} color={TURQUOISE} style={{ marginRight: 6 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#9adfe2', fontSize: 12, marginBottom: 2 }}>
                  Replying to {replyTo.senderId === myId ? 'yourself' : (profiles[replyTo.senderId]?.username || 'user')}
                </Text>
                <Text style={{ color: '#ddd', fontSize: 12 }} numberOfLines={1}>
                  {replyTo.type === 'text' ? oneLine(replyTo.text) : replyTo.type === 'image' ? 'Image' : replyTo.type === 'audio' ? 'Voice message' : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyTo(null)} style={{ padding: 4 }}>
                <Ionicons name="close" size={16} color="#aaa" />
              </TouchableOpacity>
            </View>
          )}

          {selectedImages.length > 0 && (
            <View style={styles.previewBar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {selectedImages.map((uri) => (
                  <View key={uri} style={styles.previewThumbWrap}>
                    <Image source={{ uri }} style={styles.previewThumb} />
                    <TouchableOpacity onPress={() => handleRemoveImage(uri)} style={styles.previewRemoveBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Ionicons name="close" size={14} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={styles.inputRow}>
            <TouchableOpacity style={styles.inputCircleButton} onPress={handleCameraPress}>
              <Ionicons name="camera" size={20} color={TURQUOISE} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputCircleButton} onPress={handleGalleryPress}>
              <Ionicons name="image" size={20} color={TURQUOISE} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputCircleButton} onPress={audioRecorder.isRecording ? stopRecording : startRecording}>
              <Ionicons name={audioRecorder.isRecording ? 'stop' : 'mic'} size={20} color={TURQUOISE} />
            </TouchableOpacity>

            <TextInput
              style={styles.inputText}
              placeholder="Message..."
              placeholderTextColor="#888"
              value={messageText}
              onChangeText={(t) => {
                setMessageText(t);
                if (t.trim().length) pingTyping();
              }}
              autoCapitalize="sentences"
              autoCorrect
              textContentType="none"
              autoComplete="off"
              keyboardType="default"
              returnKeyType="send"
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />

            <TouchableOpacity
              style={[styles.sendButton, (!messageText.trim() && selectedImages.length === 0) && { opacity: 0.5 }]}
              onPress={handleSend}
              activeOpacity={0.85}
            >
              <Ionicons name="send" size={20} color="#000" />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {showScrollFab && (
          <TouchableOpacity
            onPress={() => { flatListRef.current?.scrollToEnd({ animated: true }); userAtBottomRef.current = true; }}
            style={styles.scrollFab}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-down" size={20} color="#000" />
          </TouchableOpacity>
        )}

        {/* Reaction picker */}
        <Modal visible={!!reactionTarget} transparent animationType="none" onRequestClose={closeReactions}>
          <Pressable style={styles.overlayTapClose} onPress={closeReactions} />
          <Animated.View
            style={[
              styles.reactionBar,
              {
                transform: [
                  { translateY: -20 },
                  { scale: reactionAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                ],
                opacity: reactionAnim,
                left: screenW * 0.5 - 130,
              },
            ]}
          >
            <View style={styles.reactionRow}>
              {REACTIONS.map((e) => (
                <TouchableOpacity key={e} onPress={() => pickReaction(e)} style={styles.reactionItem} activeOpacity={0.8}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.reactionDivider} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-evenly' }}>
              <TouchableOpacity
                onPress={() => {
                  if (reactionTarget?.type === 'text') Clipboard.setStringAsync(reactionTarget.text || '');
                  showToast('Copied');
                  closeReactions();
                }}
                style={styles.reactionAction}
              >
                <Ionicons name="copy-outline" size={16} color="#ddd" />
                <Text style={styles.reactionActionText}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (reactionTarget) setReplyTo(reactionTarget);
                  closeReactions();
                }}
                style={styles.reactionAction}
              >
                <Ionicons name="return-down-back-outline" size={16} color="#ddd" />
                <Text style={styles.reactionActionText}>Reply</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Modal>

        {/* Image Gallery */}
        <Modal visible={viewerOpen} transparent onRequestClose={() => setViewerOpen(false)}>
          <View style={styles.viewerOverlay}>
            <TouchableOpacity onPress={() => setViewerOpen(false)} style={styles.viewerCloseBtn}>
              <Ionicons name="close" size={24} color="#000" />
            </TouchableOpacity>
            <FlatList
              horizontal
              pagingEnabled
              data={imageMessages}
              keyExtractor={(m) => m.id}
              initialScrollIndex={viewerIndex}
              getItemLayout={(_d, i) => ({ length: Dimensions.get('window').width, offset: Dimensions.get('window').width * i, index: i })}
              renderItem={({ item }) => (
                <View style={{ width: Dimensions.get('window').width, justifyContent: 'center', alignItems: 'center' }}>
                  <Image source={{ uri: item.text }} style={{ width: '100%', height: '100%', resizeMode: 'contain' }} />
                </View>
              )}
            />
          </View>
        </Modal>

        {/* Toast */}
        <Animated.View
          pointerEvents={toastMsg ? 'auto' : 'none'}
          style={{
            position: 'absolute',
            left: 20,
            right: 20,
            bottom: 24,
            backgroundColor: 'rgba(0,0,0,0.88)',
            borderColor: '#2a2a2a',
            borderWidth: 1,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
            alignItems: 'center',
            transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
            opacity: toastAnim,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{toastMsg}</Text>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flexContainer: { flex: 1 },
  container: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SURFACE,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1ae9ef22',
    zIndex: 5,
  },
  headerBack: { padding: 4 },
  headerImage: { width: 38, height: 38, borderRadius: 19, marginLeft: 6 },
  headerTitle: { color: '#fff', fontWeight: 'bold', fontSize: 17, letterSpacing: 0.2 },
  headerInfo: { padding: 4, marginLeft: 8 },

  messageList: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 0,
  },

  messageBubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    maxWidth: '82%',
  },
  yourMessage: { backgroundColor: TURQUOISE, alignSelf: 'flex-end' },
  theirMessage: { backgroundColor: CARD, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#222' },

  messageText: { fontSize: 16, color: '#fff' },
  userMessageText: { color: '#000' },
  messageTime: { fontSize: 11, color: '#cfcfcf', alignSelf: 'flex-end', marginTop: 4 },
  userMessageTime: { color: '#004a4a' },

  imageTime: { position: 'absolute', bottom: 4, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, fontSize: 11, color: '#fff' },
  imageTimeRight: { right: 4 },
  imageTimeLeft: { left: 4 },

  media: { width: 220, height: 160, borderRadius: 12, marginVertical: 2, backgroundColor: '#000' },
  placeholderText: { color: '#888', fontSize: 14 },

  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: '#1ae9ef22',
    backgroundColor: SURFACE,
    paddingHorizontal: 10,
  },

  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderColor: '#2a2a2a',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
    marginBottom: 6,
  },

  previewBar: { paddingVertical: 6 },
  previewThumbWrap: {
    width: 58,
    height: 58,
    marginRight: 8,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  previewThumb: { width: '100%', height: '100%' },
  previewRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#000000aa',
    alignItems: 'center',
    justifyContent: 'center',
  },

  inputRow: { flexDirection: 'row', alignItems: 'center' },
  inputCircleButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: CARD,
    justifyContent: 'center', alignItems: 'center',
    marginHorizontal: 2, borderWidth: 2, borderColor: TURQUOISE,
  },
  inputText: {
    flex: 1,
    backgroundColor: '#232323',
    color: '#fff',
    borderRadius: 18,
    paddingHorizontal: 14,
    marginHorizontal: 8,
    fontSize: 16,
    height: 38,
  },
  sendButton: {
    backgroundColor: TURQUOISE,
    borderRadius: 18,
    paddingHorizontal: 12,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Audio
  audioBubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TURQUOISE,
    borderRadius: 14,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginVertical: 4,
    minWidth: 120,
    height: 36,
  },
  audioPlayButton: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#007575', justifyContent: 'center', alignItems: 'center', marginRight: 6,
  },
  audioWaveformBar: { flex: 1, height: 4, backgroundColor: '#b2f5f5', borderRadius: 2, overflow: 'hidden', marginRight: 6 },
  audioWaveformFill: { height: 4, backgroundColor: '#007575', borderRadius: 2 },
  audioDurationRight: { color: '#007575', fontWeight: 'bold', fontSize: 12, minWidth: 38, textAlign: 'right' },
  audioSpeedButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#007575', justifyContent: 'center', alignItems: 'center', marginLeft: 6 },
  audioSpeedText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },

  // Menus / modals
  menuOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end',
    paddingTop: 54, paddingRight: 8, zIndex: 9999, elevation: 20,
  },
  menuPanel: {
    width: 260, backgroundColor: SURFACE, borderRadius: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: STROKE, zIndex: 10000, elevation: 24,
  },
  menuItem: { paddingVertical: 10, paddingHorizontal: 12 },
  menuItemText: { color: '#fff', fontSize: 15 },
  menuItemDanger: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#311', borderTopWidth: 1, borderTopColor: '#3a1f1f' },
  menuItemDangerText: { color: '#ff4d4f', fontSize: 15, fontWeight: '700' },

  modalPanel: {
    width: '92%', backgroundColor: SURFACE, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: STROKE, alignSelf: 'center',
  },
  modalTitle: { color: TURQUOISE, fontWeight: 'bold', fontSize: 18, marginBottom: 10 },
  photoPickerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  input: { backgroundColor: '#232323', color: '#fff', borderRadius: 8, paddingHorizontal: 12, height: 40 },
  modalButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6 },
  rowImage: { width: 36, height: 36, borderRadius: 18, marginRight: 10, borderWidth: 1, borderColor: TURQUOISE },
  rowText: { color: '#fff', fontSize: 15 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },

  // DM header action buttons
  inviteBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: TURQUOISE, borderRadius: 16, paddingVertical: 5, paddingHorizontal: 8 },
  inviteBtnText: { color: '#000', fontWeight: '700', fontSize: 11, marginLeft: 6 },
  msgBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: TURQUOISE, borderRadius: 16, paddingVertical: 5, paddingHorizontal: 8 },
  msgBtnText: { color: TURQUOISE, fontWeight: '700', fontSize: 11, marginLeft: 6 },
  msgBtnFilled: { flexDirection: 'row', alignItems: 'center', backgroundColor: TURQUOISE, borderWidth: 1, borderColor: TURQUOISE, borderRadius: 16, paddingVertical: 5, paddingHorizontal: 8 },
  msgBtnTextInverted: { color: '#000', fontWeight: '700', fontSize: 11, marginLeft: 6 },

  // viewer
  viewerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 999 },
  viewerCloseBtn: { position: 'absolute', top: 10, right: 10, zIndex: 1000, width: 36, height: 36, borderRadius: 18, backgroundColor: TURQUOISE, alignItems: 'center', justifyContent: 'center' },

  // Scroll to bottom FAB
  scrollFab: {
    position: 'absolute',
    right: 14,
    bottom: 96,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: TURQUOISE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#000',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },

  // reaction picker
  overlayTapClose: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  reactionBar: {
    position: 'absolute',
    bottom: 140,
    width: 260,
    alignSelf: 'center',
    backgroundColor: '#101010',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  reactionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, marginBottom: 6 },
  reactionItem: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#161616' },
  reactionDivider: { height: 1, backgroundColor: '#2a2a2a', marginVertical: 6 },
  reactionAction: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  reactionActionText: { color: '#ddd', marginLeft: 6, fontSize: 13 },
});

export default React.memo(ChatDetailScreen);