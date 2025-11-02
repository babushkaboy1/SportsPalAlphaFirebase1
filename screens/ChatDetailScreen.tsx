// screens/ChatDetailScreen.tsx
// OPTIMIZED VERSION (v2.2) – restores Info/Invite flows, anchors reactions next to bubble,
// speeds up peer delivery, prefetches avatars, and hardens keyboard positioning.
// Requires: @shopify/flash-list, @react-native-async-storage/async-storage, expo-image
// PS> npm i @shopify/flash-list @react-native-async-storage/async-storage expo-image
//
// ANDROID keyboard: in app.json keep
// {
//   "expo": { "android": { "softwareKeyboardLayoutMode": "resize" } }
// }

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList as RNFlatList,
  TouchableOpacity,
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
  KeyboardAvoidingView,
  AppState,
  AppStateStatus,
  GestureResponderEvent,
  Image as RNImage,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
// Fallback to RN FlatList if FlashList hiccups at runtime (defensive)
const ListComponent: any = (FlashList as unknown as any) || RNFlatList;

import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useAudioRecorder, useAudioPlayer, AudioModule, RecordingPresets } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  getDocs, updateDoc, arrayUnion, serverTimestamp, deleteField
} from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';

// ---- ActivityIcon import made resilient to default/named export shape ----
import * as ActivityIconsAll from '../components/ActivityIcons';
const ActivityIconComp: any =
  // if named export exists
  (ActivityIconsAll as any).ActivityIcon ||
  // else if default export exists
  (ActivityIconsAll as any).default ||
  // last resort: render nothing (prevents runtime crash)
  ((_props: any) => null);

import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { uploadChatImage } from '../utils/imageUtils';
import { sendFriendRequest, cancelFriendRequest } from '../utils/firestoreFriends';

type Message = {
  id: string;
  senderId: string;
  text: string;
  type: 'text' | 'image' | 'audio' | 'system';
  timestamp?: any; // Firestore Timestamp | number
  _local?: boolean;
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  readBy?: string[];
};

const PAGE_SIZE = 20;
const CACHE_LIMIT = 80;
const CACHE_KEY = (id: string) => `chat_cache_v2_${id}`;

const TURQUOISE = '#1ae9ef';
const BG = '#121212';
const CARD = '#1e1e1e';
const SURFACE = '#18191a';
const STROKE = '#2a2a2a';
const DANGER = '#e74c3c';
const TYPING_FRESH_MS = 3000;
const SWIPE_THRESHOLD = 60;

const REACTIONS = ['👍', '😂', '❤️', '👎', '😮'] as const;

// ---- Time helpers (millisecond-accurate, fixes mis-ordering) ----
const tsMs = (t: any): number => {
  if (!t) return 0;
  if (typeof t === 'number') {
    return t > 1e12 ? t : t * 1000;
  }
  if (t.seconds != null) {
    const ns = (t.nanoseconds || 0) / 1e6;
    return t.seconds * 1000 + ns;
  }
  return Date.now();
};
const isGapBigMs = (a?: any, b?: any, mins = 6) => {
  if (!a || !b) return false;
  return Math.abs(tsMs(a) - tsMs(b)) > mins * 60 * 1000;
};

// ---- Typing indicator dots ----
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

// ---- Swipe-to-reply ----
const makeSwipeToReply = (onReply: () => void, swipeAnim: Animated.Value) =>
  PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderGrant: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
    onPanResponderMove: (_e, g) => {
      const clampedDx = Math.max(0, Math.min(g.dx, 80));
      swipeAnim.setValue(clampedDx);
      if (g.dx >= SWIPE_THRESHOLD && g.dx < SWIPE_THRESHOLD + 5) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
    },
    onPanResponderRelease: (_e, g) => {
      if (g.dx >= SWIPE_THRESHOLD) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onReply();
      }
      Animated.spring(swipeAnim, { toValue: 0, useNativeDriver: true, friction: 8, tension: 100 }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(swipeAnim, { toValue: 0, useNativeDriver: true, friction: 8, tension: 100 }).start();
    },
  });

// ---- Message Row ----
type MessageItemProps = {
  item: Message;
  prev?: Message;
  next?: Message;
  profile: any;
  isOwn: boolean;
  myId: string | undefined;
  reaction?: string;
  isLastMine: boolean;
  readReceipt?: React.ReactNode | null;
  messageStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  onLongPress: (e: GestureResponderEvent, isOwn: boolean) => void;
  onImagePress: () => void;
  onProfilePress: () => void;
  onReply: () => void;
  handlePlayPauseAudio: (uri: string, id: string) => void;
  playingAudioId: string | null;
  audioPlayer: ReturnType<typeof useAudioPlayer>;
  handleSpeedChange: () => void;
  playbackRate: number;
};

const MessageItem = React.memo((props: MessageItemProps) => {
  const {
    item, prev, next, profile, isOwn, reaction, isLastMine, readReceipt,
    messageStatus, onLongPress, onImagePress, onProfilePress, onReply,
    handlePlayPauseAudio, playingAudioId, audioPlayer, handleSpeedChange, playbackRate
  } = props;

  const swipeAnim = useRef(new Animated.Value(0)).current;
  const isFirstOfGroup = !prev || prev.senderId !== item.senderId;
  const isLastOfGroup = !next || next.senderId !== item.senderId;
  const sender = profile || {};

  const shouldShowTimestamp = () => {
    const gapBefore = isGapBigMs(item.timestamp, prev?.timestamp, 6);
    return isLastOfGroup || gapBefore || item.type === 'image';
  };

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

  const responder = makeSwipeToReply(() => onReply(), swipeAnim);
  const replyIconOpacity = swipeAnim.interpolate({ inputRange: [0, SWIPE_THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' });
  const replyIconScale = swipeAnim.interpolate({ inputRange: [0, SWIPE_THRESHOLD], outputRange: [0.5, 1], extrapolate: 'clamp' });

  const getStatusIcon = () => {
    if (!isOwn || !item.timestamp) return null;
    if (item._local || item.status === 'pending') return <Ionicons name="time-outline" size={12} color={'#006666'} />;
    if (messageStatus === 'read' || (item.readBy && item.readBy.length > 0)) return <Ionicons name="checkmark-done" size={14} color="#8ecfd1" />;
    if (item.status === 'delivered' || messageStatus === 'delivered') return <Ionicons name="checkmark-done" size={14} color={'#006666'} />;
    return <Ionicons name="checkmark" size={12} color={'#006666'} />;
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', position: 'relative' }}>
      {!isOwn && (
        <View style={{ width: 34, alignItems: 'center', marginBottom: isLastOfGroup ? 8 : 2 }}>
          {isLastOfGroup ? (
            <TouchableOpacity onPress={onProfilePress} activeOpacity={0.7}>
              {typeof sender.photo === 'string' && sender.photo ? (
                <ExpoImage
                  source={{ uri: sender.photo }}
                  style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: TURQUOISE, alignSelf: 'flex-end' }}
                  contentFit="cover"
                  cachePolicy="disk"
                />
              ) : (
                <ExpoImage
                  source={require('../assets/default-group.png')}
                  style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: TURQUOISE, alignSelf: 'flex-end' }}
                  contentFit="cover"
                  cachePolicy="disk"
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

        <Animated.View
          style={{
            position: 'absolute',
            right: isOwn ? 'auto' : -40,
            left: isOwn ? -40 : 'auto',
            top: '50%',
            transform: [{ translateY: -12 }, { scale: replyIconScale }],
            opacity: replyIconOpacity,
          }}
          pointerEvents="none"
        >
          <Ionicons name="arrow-undo" size={24} color={TURQUOISE} />
        </Animated.View>

        <Animated.View style={{ transform: [{ translateX: swipeAnim }] }} {...responder.panHandlers}>
          <View style={bubbleStyle}>
            {reaction ? (
              <View style={{ position: 'absolute', right: -8, top: -8, backgroundColor: '#000', borderRadius: 12, paddingHorizontal: 6, paddingVertical: 3, borderWidth: 1, borderColor: '#222' }}>
                <Text style={{ fontSize: 12 }}>{reaction}</Text>
              </View>
            ) : null}

            {item.type === 'text' && (
              <TouchableOpacity activeOpacity={0.85} delayLongPress={220} onLongPress={(e) => onLongPress(e, isOwn)}>
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
              <TouchableOpacity activeOpacity={0.9} onPress={onImagePress} onLongPress={(e) => onLongPress(e, isOwn)}>
                <ExpoImage
                  source={{ uri: item.text }}
                  style={[styles.media, { borderWidth: 1, borderColor: TURQUOISE }]}
                  contentFit="cover"
                  cachePolicy="disk"
                />
              </TouchableOpacity>
            ) : item.type === 'image' && !item.text ? (
              <Text style={styles.placeholderText}>Image not available</Text>
            ) : null}

            {item.type === 'image' ? (
              <View style={[styles.messageTimeContainer, isOwn ? styles.messageTimeRight : styles.messageTimeLeft]}>
                <Text style={[styles.messageTime, isOwn && styles.userMessageTime, styles.imageTime]}>
                  {item.timestamp
                    ? new Date(tsMs(item.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : item._local ? 'Sending…' : ''}
                </Text>
                {isOwn && getStatusIcon()}
              </View>
            ) : shouldShowTimestamp() ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: isOwn ? 'flex-end' : 'flex-start', marginTop: 2 }}>
                <Text style={[styles.messageTime, isOwn && styles.userMessageTime]}>
                  {item.timestamp
                    ? new Date(tsMs(item.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : item._local ? 'Sending…' : ''}
                </Text>
                {isOwn && <View style={{ marginLeft: 4 }}>{getStatusIcon()}</View>}
              </View>
            ) : null}
          </View>
        </Animated.View>

        {isLastMine && readReceipt}
      </View>
    </View>
  );
}, (p, n) => (
  p.item.id === n.item.id &&
  p.item.text === n.item.text &&
  p.item._local === n.item._local &&
  p.item.status === n.item.status &&
  p.isOwn === n.isOwn &&
  p.reaction === n.reaction &&
  p.isLastMine === n.isLastMine &&
  p.messageStatus === n.messageStatus &&
  p.playingAudioId === n.playingAudioId &&
  p.audioPlayer?.playing === n.audioPlayer?.playing &&
  p.audioPlayer?.currentTime === n.audioPlayer?.currentTime &&
  p.profile?.photo === n.profile?.photo &&
  p.profile?.username === n.profile?.username &&
  p.prev?.senderId === n.prev?.senderId &&
  p.next?.senderId === n.next?.senderId
));

// ---- Keyboard wrapper: zero gap (supports exact offset) ----
const KeyboardCompatibleView: React.FC<{
  children: React.ReactNode;
  setKbdVisible: (v: boolean) => void;
  iosOffset: number;
}> = ({ children, setKbdVisible, iosOffset }) => {
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const onShow = () => { setIsKeyboardVisible(true); setKbdVisible(true); };
    const onHide = () => { setIsKeyboardVisible(false); setKbdVisible(false); };
    const sub1 = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', onShow);
    const sub2 = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', onHide);
    return () => { try { sub1.remove(); sub2.remove(); } catch {} };
  }, [setKbdVisible]);

  const keyboardVerticalOffset = Platform.OS === 'ios' ? Math.max(iosOffset, 0) : Math.max(insets.bottom, 0);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardVerticalOffset}
      enabled
    >
      {children}
    </KeyboardAvoidingView>
  );
};

const ChatDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<any>();
  const { chatId } = route.params;
  const preloadedMessages: Message[] | undefined = route.params?.preloadedMessages;
  const initialSnapshotId: string | null = route.params?.initialSnapshotId ?? null;
  const initialHeader: any = route.params?.initialHeader;

  const appState = useRef(AppState.currentState);
  const typingCleanupTimerRef = useRef<any>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appState.current.match(/active/) && nextAppState.match(/inactive|background/)) {
        if (chatId) clearTyping(chatId);
      }
      appState.current = nextAppState;
    });
    return () => {
      subscription.remove();
      if (chatId) clearTyping(chatId);
    };
  }, [chatId]);

  useFocusEffect(
    useCallback(() => {
      if (!chatId) return;
      const markRead = async () => {
        try {
          await markChatRead(chatId);
          setMessages(prev => prev.map(msg => ({
            ...msg,
            status: msg.senderId !== auth.currentUser?.uid ? 'read' : msg.status
          })));
          const me = auth.currentUser?.uid;
          if (me) setReadsMap(r => ({ ...(r || {}), [me]: { seconds: Math.floor(Date.now() / 1000) } }));
        } catch {}
      };
      markRead();
      const interval = setInterval(markRead, 2000);
      return () => { clearInterval(interval); markRead(); };
    }, [chatId])
  );

  const [messages, setMessages] = useState<Message[]>([]);
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
  // ...existing code...
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
  const [reactionAnchor, setReactionAnchor] = useState<{ side: 'left' | 'right'; y: number } | null>(null);
  const reactionAnim = useRef(new Animated.Value(0)).current;

  const toastAnim = useRef(new Animated.Value(0)).current;
  const [toastMsg, setToastMsg] = useState('');
  const toastTimeoutRef = useRef<any>(null);
  // animation for anchored invite panel
  const inviteAnim = useRef(new Animated.Value(0)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const messageDim = useRef(new Animated.Value(1)).current;
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

  useEffect(() => {
    // animate invite panel in/out and backdrop/message dim
    Animated.parallel([
      Animated.timing(inviteAnim, {
        toValue: inviteModalVisible ? 1 : 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: inviteModalVisible ? 1 : 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(messageDim, {
        toValue: inviteModalVisible ? 0.6 : 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [inviteModalVisible, inviteAnim, backdropAnim, messageDim]);

  const [reactions, setReactions] = useState<Record<string, string>>({});

  const listRef = useRef<any>(null);
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
  const scrollFabAnim = useRef(new Animated.Value(0)).current;

  const [creatingInvite, setCreatingInvite] = useState(false);
  const [composerKbdVisible, setComposerKbdVisible] = useState(false);

  const [headerHeight, setHeaderHeight] = useState(54);
  const [headerInfoLayout, setHeaderInfoLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const myId = auth.currentUser?.uid;
  const screenW = Dimensions.get('window').width;
  const screenH = Dimensions.get('window').height;

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
    if (isMessagesReady) Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, [isMessagesReady, fadeAnim]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      // Optionally style navigation bar
      // NavigationBar.setBackgroundColorAsync('#121212').catch(() => {});
    }
  }, []);

  useEffect(() => {
    Animated.spring(scrollFabAnim, { toValue: showScrollFab ? 1 : 0, useNativeDriver: true, friction: 8, tension: 100 }).start();
  }, [showScrollFab, scrollFabAnim]);

  // ---------- Local disk cache (instant paint) ----------
  const saveCacheThrottler = useRef<NodeJS.Timeout | null>(null);
  const saveCache = useCallback((rows: Message[]) => {
    if (!chatId) return;
    if (saveCacheThrottler.current) clearTimeout(saveCacheThrottler.current);
    const toSave = rows
      .filter(m => !m._local)
      .slice(-CACHE_LIMIT);
    saveCacheThrottler.current = setTimeout(async () => {
      try { await AsyncStorage.setItem(CACHE_KEY(chatId), JSON.stringify(toSave)); } catch {}
    }, 350);
  }, [chatId]);

  const loadCache = useCallback(async () => {
    if (!chatId) return;
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY(chatId));
      if (raw) {
        const cached: Message[] = JSON.parse(raw);
        if (Array.isArray(cached) && cached.length) {
          setMessages(cached);
          setIsMessagesReady(true);
          isInitialLoad.current = false;
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd({ animated: false });
            userAtBottomRef.current = true;
          });
        }
      }
    } catch {}
  }, [chatId]);

  // ---------- Keyboard auto scroll ----------
  useEffect(() => {
    const onShow = () => {
      if (userAtBottomRef.current) {
        requestAnimationFrame(() => {
          setTimeout(() => { listRef.current?.scrollToEnd({ animated: true }); }, Platform.OS === 'ios' ? 50 : 150);
        });
      }
    };
    const subWillShow = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', onShow);
    return () => { try { subWillShow.remove(); } catch {} };
  }, []);

  // ---------- Access + initial load ----------
  useEffect(() => {
    let unsubscribeMessages: undefined | (() => void);
    const ref = doc(db, 'chats', chatId);

    if (!preloadedMessages?.length) loadCache();

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
              if (preloadedMessages?.length) {
                setMessages(preloadedMessages as any);
                setIsMessagesReady(true);
                isInitialLoad.current = false;
                setTimeout(() => { listRef.current?.scrollToEnd({ animated: false }); userAtBottomRef.current = true; }, 0);
              }

              if (initialSnapshotId) {
                try {
                  const docRef = doc(db, 'chats', chatId, 'messages', initialSnapshotId);
                  const snap = await getDoc(docRef);
                  if (snap.exists()) latestDescSnapshotRef.current = snap;
                } catch {}
              }

              if (!preloadedMessages || preloadedMessages.length === 0) {
                const page = await fetchLatestMessagesPage(chatId, PAGE_SIZE);
                latestDescSnapshotRef.current = page.lastSnapshot || latestDescSnapshotRef.current;
                const sorted = (page.messages || []).slice().sort((a: any, b: any) => tsMs(a.timestamp) - tsMs(b.timestamp));
                setMessages(sorted as any);
                saveCache(sorted as any);
                setIsMessagesReady(true);
                isInitialLoad.current = false;
                setTimeout(() => { listRef.current?.scrollToEnd({ animated: false }); userAtBottomRef.current = true; }, 0);
              }
            } catch {}
          })();

          unsubscribeMessages = listenToLatestMessages(
            chatId,
            50,
            (msgs: any[]) => {
              setMessages((prev) => {
                const ids = new Map(prev.map((m) => [m.id, m]));
                for (const m of msgs) ids.set(m.id, m);
                const deduped = Array.from(ids.values()).sort((a: any, b: any) => tsMs(a.timestamp) - tsMs(b.timestamp));
                const uid = auth.currentUser?.uid;
                const marked = deduped.map(msg => ({
                  ...msg,
                  status: msg.senderId !== uid ? 'delivered' : msg.status
                }));
                saveCache(marked);
                return marked;
              });

              markChatRead(chatId);

              if (!isInitialLoad.current && userAtBottomRef.current) {
                setTimeout(() => { listRef.current?.scrollToEnd({ animated: true }); userAtBottomRef.current = true; }, 60);
              }

              if (isInitialLoad.current) {
                isInitialLoad.current = false;
                setIsMessagesReady(true);
                setTimeout(() => { listRef.current?.scrollToEnd({ animated: false }); userAtBottomRef.current = true; }, 0);
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

    return () => { if (unsubscribeMessages) unsubscribeMessages(); unsubAccess(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // ---------- Batch profile fetching with disk cache ----------
  useEffect(() => {
    const fetchProfiles = async () => {
      const ids = new Set(messages.map((m) => m.senderId));
      participantIds.forEach(id => ids.add(id));
      const newProfiles: { [userId: string]: any } = { ...profiles };
      const toFetch = Array.from(ids).filter(id => !newProfiles[id]);

      if (!toFetch.length) return;

      for (let i = 0; i < toFetch.length; i += 10) {
        const batch = toFetch.slice(i, i + 10);
        const qy = query(collection(db, 'profiles'), where('__name__', 'in', batch));
        try {
          const snap = await getDocs(qy);
          snap.forEach((d) => { newProfiles[d.id] = d.data(); });
        } catch {}
      }
      setProfiles(newProfiles);
    };
    fetchProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, participantIds.join(',')]);

  // Prefetch avatars for instant paint
  useEffect(() => {
    const uris = new Set<string>();
    participantIds.forEach(uid => { const p = profiles[uid]; if (p?.photo) uris.add(p.photo); });
    messages.forEach(m => { const p = profiles[m.senderId]; if (p?.photo) uris.add(p.photo); });
    uris.forEach(u => { if (u) RNImage.prefetch(u).catch(() => {}); });
  }, [participantIds, profiles, messages.length]);

  // ---------- Header meta ----------
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
        const me = auth.currentUser?.uid;
        const peerId = participants.find((p: string) => p !== me);
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
            name: (data as any).activity || (data as any).name || 'Activity',
            type: (data as any).activity || '',
            date: (data as any).date || '',
            time: (data as any).time || '',
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

  // Participants
  useEffect(() => {
    const load = async () => {
      if (!participantIds.length) { setParticipants([]); return; }
      const rows: Array<{ uid: string; username: string; photo?: string }> = [];
      for (let i = 0; i < participantIds.length; i += 10) {
        const ids = participantIds.slice(i, i + 10);
        const qy = query(collection(db, 'profiles'), where('__name__', 'in', ids));
        const snap = await getDocs(qy);
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

  // Live friend state + friend profiles
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const unsub = onSnapshot(
      doc(db, 'profiles', me),
      async (snap) => {
        if (!snap.exists()) { setMyFriendIds([]); setMyRequestsSent([]); setFriends([]); return; }
        const data: any = snap.data();
        const fIds = Array.isArray(data?.friends) ? data.friends : [];
        const req = Array.isArray(data?.requestsSent) ? data.requestsSent : [];
        setMyFriendIds(fIds);
        setMyRequestsSent(req);

        // fetch friend profiles used by Add Users modal
        if (fIds.length) {
          const out: Array<{ uid: string; username: string; photo?: string }> = [];
          for (let i = 0; i < fIds.length; i += 10) {
            const batch = fIds.slice(i, i + 10);
            try {
              const qy = query(collection(db, 'profiles'), where('__name__', 'in', batch));
              const rs = await getDocs(qy);
              rs.forEach(d => {
                const p: any = d.data();
                out.push({ uid: d.id, username: p.username || 'User', photo: p.photo || p.photoURL });
              });
            } catch {}
          }
          out.sort((a, b) => a.username.localeCompare(b.username));
          setFriends(out);
        } else {
          setFriends([]);
        }
      },
      () => { setMyFriendIds([]); setMyRequestsSent([]); setFriends([]); }
    );
    return () => unsub();
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
          const addedProfiles = await Promise.all(toAdd.map(async (uid) => {
            const p = await getDoc(doc(db, 'profiles', uid));
            return p.exists() ? ((p.data() as any).username || 'User') : 'User';
          }));
          const myProfileSnap = me ? await getDoc(doc(db, 'profiles', me)) : null;
          const myName = (myProfileSnap && myProfileSnap.exists()) ? ((myProfileSnap.data() as any).username || 'Someone') : 'Someone';
          const names = addedProfiles.join(', ');
          await addSystemMessage(chatId, `${myName} added ${names}`);
        } catch {}
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
            } catch {}
            await leaveChatWithAutoDelete(chatId, me);
          } catch {}
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

  // Audio
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
    (audioPlayer as any).playbackRate = next;
  }, [playbackRate, audioPlayer]);

  // lastMessage touch (boost peer update speed)
  const touchLastMessage = useCallback(async (type: 'text'|'image'|'audio', text: string, uid: string) => {
    try {
      await updateDoc(doc(db, 'chats', chatId), {
        lastMessageText: type === 'text' ? text : type === 'image' ? 'Sent a photo' : 'Voice message',
        lastMessageType: type,
        lastMessageSenderId: uid,
        lastMessageTimestamp: serverTimestamp(),
      } as any);
    } catch {}
  }, [chatId]);

  // Optimistic send
  const doOptimisticImages = async (uris: string[]) => {
    const uid = auth.currentUser!.uid;
    const locals: Message[] = uris.map((uri) => ({
      id: `local-img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      senderId: uid,
      text: uri,
      type: 'image',
      timestamp: { seconds: Math.floor(Date.now() / 1000) },
      _local: true,
      status: 'pending',
    }));
    setPending((p) => [...p, ...locals]);
    setSelectedImages([]);

    requestAnimationFrame(() => { listRef.current?.scrollToEnd({ animated: true }); userAtBottomRef.current = true; });

    await touchLastMessage('image', 'Sent a photo', uid);

    for (const preview of locals) {
      try {
        const imageId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const downloadUrl = await uploadChatImage(preview.text, uid, imageId);
        await sendMessage(chatId, uid, downloadUrl, 'image');
        setPending((p) => p.filter((x) => x.id !== preview.id).map(msg => msg.id === preview.id ? { ...msg, status: 'sent' } : msg));
      } catch (e: any) {
        Alert.alert('Upload failed', e?.message || 'Could not upload image.');
        setPending((p) => p.filter((x) => x.id !== preview.id));
      }
    }
  };

  const handleSend = useCallback(async () => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;

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
        status: 'pending',
      };

      setPending((p) => [...p, local]);
      setMessageText('');
      setReplyTo(null);

      requestAnimationFrame(() => { listRef.current?.scrollToEnd({ animated: true }); userAtBottomRef.current = true; });

      // touch last message immediately for fast peer inbox updates
      touchLastMessage('text', text, uid);

      sendMessage(chatId, uid, text, 'text')
        .then(() => { setPending((p) => p.filter((m) => m.id !== localId)); })
        .catch(() => { setPending((p) => p.map(m => m.id === localId ? { ...m, status: 'failed' } : m)); });
    }
  }, [messageText, selectedImages, chatId, touchLastMessage]);

  // Recording
  const startRecording = async () => {
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) { Alert.alert('Permission Denied', 'Please enable audio recording permissions.'); return; }
      try { if (audioPlayer.playing) audioPlayer.pause(); } catch {}
      try {
        await (AudioModule as any).setAudioModeAsync?.({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          interruptionModeAndroid: 1,
          playThroughEarpieceAndroid: false,
        } as any);
      } catch {}
      await (audioRecorder as any).prepareToRecordAsync?.(RecordingPresets.HIGH_QUALITY);
      await audioRecorder.record();
    } catch {
      Alert.alert('Recording Error', 'Could not start recording. Please try again.');
    }
  };
  const stopRecording = async () => {
    if (!audioRecorder.isRecording || !auth.currentUser) return;
    try {
      const uid = auth.currentUser.uid;
      const uri = await audioRecorder.stop();
      if (uri != null) {
        await sendMessage(chatId, uid, uri, 'audio');
        await touchLastMessage('audio', 'Voice message', uid);
      }
    } catch {
      Alert.alert('Recording Error', 'Could not save the recording.');
    }
  };

  // Typing ping + cleanup
  const pingTyping = useCallback(async () => {
    const now = Date.now();
    if (now - lastTypingPingRef.current < 2500) return;
    lastTypingPingRef.current = now;
    try {
      const me = auth.currentUser?.uid;
      if (!me) return;
      await updateDoc(doc(db, 'chats', chatId), { [`typing.${me}`]: serverTimestamp() } as any);
      if (typingCleanupTimerRef.current) clearTimeout(typingCleanupTimerRef.current);
      typingCleanupTimerRef.current = setTimeout(async () => {
        try { await updateDoc(doc(db, 'chats', chatId), { [`typing.${me}`]: deleteField() } as any); } catch {}
      }, TYPING_FRESH_MS);
    } catch { }
  }, [chatId]);

  // Camera / gallery
  const handleCameraPress = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission Denied', 'Please enable camera permissions.'); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.8 });
    if (!result.canceled && result.assets?.length) {
      const MAX = 3;
      setSelectedImages((prev) => {
        if (prev.length >= MAX) { Alert.alert('Limit reached', 'You can only send up to 3 images at a time.'); return prev; }
        return [...prev, result.assets[0].uri].slice(0, MAX);
      });
    }
  };
  const handleGalleryPress = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission Denied', 'Please enable gallery permissions.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, allowsEditing: false, quality: 0.8 });
    if (!result.canceled && result.assets?.length) {
      setSelectedImages((prev) => {
        const MAX = 3;
        const remaining = MAX - prev.length;
        if (remaining <= 0) { Alert.alert('Limit reached', 'You can only send up to 3 images at a time.'); return prev; }
        const picked = result.assets.map((a) => a.uri).slice(0, remaining);
        const next = [...prev, ...picked];
        if (result.assets.length > remaining) Alert.alert('Limit reached', 'Only the first 3 images will be added.');
        return next;
      });
    }
  };
  const handleRemoveImage = useCallback((uriToRemove: string) => setSelectedImages((prev) => prev.filter((uri) => uri !== uriToRemove)), []);

  // Merge server + optimistic and sort by ms
  const renderMessages: Message[] = useMemo(() => {
    if (!pending.length) return messages.slice().sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp));
    const byId = new Map<string, Message>();
    for (const m of messages) byId.set(m.id, m);
    for (const p of pending) {
      const near = messages.find((m) => m.senderId === p.senderId && m.type === p.type && (p.type === 'text' ? m.text === p.text : Math.abs(tsMs(m.timestamp) - tsMs(p.timestamp)) < 15000));
      if (!near) byId.set(p.id, p);
    }
    return Array.from(byId.values()).sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp));
  }, [messages, pending]);

  const imageMessages = useMemo(() => renderMessages.filter((m) => m.type === 'image' && m.text), [renderMessages]);

  const lastMineIndex = useMemo(() => {
    let idx = -1;
    renderMessages.forEach((m, i) => { if (m.senderId === myId) idx = i; });
    return idx;
  }, [renderMessages, myId]);

  const readersForMyLast = useMemo(() => {
    const last = lastMineIndex >= 0 ? renderMessages[lastMineIndex] : null;
    if (!last) return [];
    const lastMs = tsMs(last.timestamp);
    return participantIds.filter((uid) => {
      if (uid === myId) return false;
      const r = (readsMap as any)?.[uid];
      return tsMs(r) >= lastMs;
    });
  }, [readsMap, renderMessages, lastMineIndex, participantIds, myId]);

  const typingUsers = useMemo(() => {
    const now = Date.now();
    return Object.entries(typingMap || {})
      .filter(([uid, timestamp]: any) => uid !== myId && (now - tsMs(timestamp)) < TYPING_FRESH_MS)
      .map(([uid]) => uid);
  }, [typingMap, myId]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || noMoreOlderRef.current || !chatId) return;
    setLoadingOlder(true);
    try {
      const oldestSnapshot = latestDescSnapshotRef.current;
      const res = await fetchOlderMessagesPage(chatId, oldestSnapshot, PAGE_SIZE);
      const older = res.messages || [];
      if (!older.length) {
        noMoreOlderRef.current = true;
      } else {
        const currentOffset = scrollOffsetRef.current || 0;
        const currentHeight = contentHeightRef.current || 0;
        savedScrollOffsetBeforePrependRef.current = currentOffset;
        prevContentHeightRef.current = currentHeight;
        adjustingScrollRef.current = true;

        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const toAdd = older.filter((m: any) => !ids.has(m.id));
          const merged = [...toAdd, ...prev].sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp));
          saveCache(merged);
          return merged;
        });
        latestDescSnapshotRef.current = res.lastSnapshot || latestDescSnapshotRef.current;
      }
    } catch {
      // ignore
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, loadingOlder, saveCache]);

  // ---- Reactions (anchored beside bubble) ----
  const openReactions = useCallback((msg: Message, e?: GestureResponderEvent, isOwn?: boolean) => {
    setReactionTarget(msg);
    const y = e?.nativeEvent?.pageY ?? screenH / 2;
    setReactionAnchor({ side: isOwn ? 'right' : 'left', y: Math.max(80, y - 70) });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    reactionAnim.setValue(0);
    Animated.spring(reactionAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 120 }).start();
  }, [reactionAnim, screenH]);

  const closeReactions = useCallback(() => {
    Animated.timing(reactionAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setReactionTarget(null);
      setReactionAnchor(null);
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

      const getMessageStatus = (): 'pending' | 'sent' | 'delivered' | 'read' | 'failed' => {
        if (item._local || item.status === 'pending') return 'pending';
        if (item.status === 'failed') return 'failed';
        if (isOwn) {
          const msgMs = tsMs(item.timestamp);
          const anyoneRead = participantIds.some((uid) => {
            if (uid === myId) return false;
            return tsMs((readsMap as any)?.[uid]) >= msgMs;
          });
          return anyoneRead ? 'read' : 'delivered';
        }
        return item.status || 'delivered';
      };

      const readReceipt = isOwn && isLastMine ? (
        dmPeer ? (
          readersForMyLast.includes(dmPeer.uid) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 4 }}>
              <Text style={{ color: '#8ecfd1', fontSize: 11, marginRight: 4 }}>Read</Text>
              <Ionicons name="checkmark-done" size={14} color="#8ecfd1" />
            </View>
          ) : <View />
        ) : readersForMyLast.length ? (
          <View style={{ flexDirection: 'row-reverse', alignSelf: 'flex-end', marginTop: 4 }}>
            {readersForMyLast.slice(0, 8).map((uid) => {
              const p = profiles[uid] || {};
              return (
                <ExpoImage
                  key={uid}
                  source={{ uri: p.photo || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(p.username || 'U')) }}
                  style={{ width: 18, height: 18, borderRadius: 9, marginLeft: 4, borderWidth: 1, borderColor: TURQUOISE }}
                  contentFit="cover"
                  cachePolicy="disk"
                />
              );
            })}
          </View>
        ) : <View />
      ) : null;

      const onItemLongPress = (e: GestureResponderEvent, own: boolean) => openReactions(item, e, own);

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
          messageStatus={getMessageStatus()}
          onLongPress={onItemLongPress}
          onImagePress={() => {
            const idx = imageMessages.findIndex((m) => m.id === item.id);
            if (idx >= 0) { setViewerIndex(idx); setViewerOpen(true); }
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
      renderMessages, profiles, myId, lastMineIndex, reactions, dmPeer,
      readersForMyLast, participantIds, readsMap, imageMessages, navigation,
      handlePlayPauseAudio, playingAudioId, audioPlayer, handleSpeedChange, playbackRate, openReactions
    ]
  );

  const typingLabel = useMemo(() => {
    const nowTyping = typingUsers;
    if (!nowTyping.length) return '';
    if (dmPeer && nowTyping.includes(dmPeer.uid)) return 'typing…';
    const names = nowTyping.slice(0, 3).map((uid) => profiles[uid]?.username || 'Someone').filter(Boolean);
    if (names.length === 0) return '';
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names.join(' and ')} are typing…`;
    const others = nowTyping.length - 2;
    return `${names.slice(0, 2).join(', ')} and ${others} ${others === 1 ? 'other' : 'others'} are typing…`;
  }, [typingUsers, profiles, dmPeer]);

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    const newH = h || 0;
    const oldH = contentHeightRef.current || 0;
    contentHeightRef.current = newH;

    if (adjustingScrollRef.current) {
      const delta = newH - (prevContentHeightRef.current || oldH);
      const baseOffset = savedScrollOffsetBeforePrependRef.current ?? (scrollOffsetRef.current || 0);
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: Math.max(0, (baseOffset || 0) + (delta || 0)), animated: false });
      });
      adjustingScrollRef.current = false;
      prevContentHeightRef.current = newH;
      savedScrollOffsetBeforePrependRef.current = null;
    } else if (userAtBottomRef.current && newH > oldH) {
      requestAnimationFrame(() => { listRef.current?.scrollToEnd({ animated: false }); });
    }
  }, []);

  const onScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    scrollOffsetRef.current = contentOffset.y || 0;
    contentHeightRef.current = contentSize?.height || contentHeightRef.current;

    const maxScroll = contentSize.height - layoutMeasurement.height;
    const isAtBottom = maxScroll <= 0 || contentOffset.y >= maxScroll - 50;
    userAtBottomRef.current = isAtBottom;

    setShowScrollFab(!isAtBottom && contentOffset.y > 100);

    if (contentOffset.y <= 100 && !loadingOlder) loadOlderMessages().catch(() => {});
  }, [loadOlderMessages, loadingOlder]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['top']}>
      {/* Header */}
      <View style={styles.header} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
        <TouchableOpacity onPress={safeExitChat} style={styles.headerBack} accessible accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={26} color={TURQUOISE} />
        </TouchableOpacity>

        {dmPeer ? (
          (() => {
            const isFriend = myFriendIds.includes(dmPeer.uid);
            const isRequested = myRequestsSent.includes(dmPeer.uid);
            return (
              <>
                <TouchableOpacity onPress={() => dmPeer?.uid && goToUserProfile(dmPeer.uid)} activeOpacity={0.8}>
                  <ExpoImage
                    source={{ uri: dmPeer.photo || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(dmPeer.username)) }}
                    style={styles.headerImage}
                    contentFit="cover"
                    cachePolicy="disk"
                  />
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => dmPeer?.uid && goToUserProfile(dmPeer.uid)} activeOpacity={0.7}>
                      <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">{dmPeer.username}</Text>
                    </TouchableOpacity>
                    {isFriend ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                        <View style={styles.msgBtnFilled}>
                          <Ionicons name={'checkmark-done-outline'} size={18} color={'#000'} style={{ marginRight: 4 }} />
                          <Text style={styles.msgBtnTextInverted}>Connected</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.inviteBtn, { marginLeft: 6 }]}
                          onPress={() => { setInviteSelection({}); setInviteTargetUid(dmPeer?.uid || null); setInviteTargetName(dmPeer?.username || null); setInviteModalVisible(true); }}
                        >
                          <Ionicons name="add-circle-outline" size={18} color="#000" />
                          <Text style={styles.inviteBtnText}>Invite</Text>
                        </TouchableOpacity>
                      </View>
                    ) : isRequested ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                        <TouchableOpacity style={styles.msgBtnFilled} activeOpacity={0.85} onPress={() => handleCancelFriendRequest(dmPeer.uid)}>
                          <Ionicons name={'person-add-outline'} size={18} color={'#000'} style={{ marginRight: 4 }} />
                          <Text style={styles.msgBtnTextInverted}>Request Sent</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.inviteBtn, { marginLeft: 6 }]}
                          onPress={() => { setInviteSelection({}); setInviteTargetUid(dmPeer?.uid || null); setInviteTargetName(dmPeer?.username || null); setInviteModalVisible(true); }}
                        >
                          <Ionicons name="add-circle-outline" size={18} color="#000" />
                          <Text style={styles.inviteBtnText}>Invite</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                        <TouchableOpacity style={styles.msgBtn} activeOpacity={0.85} onPress={() => handleAddFriend(dmPeer.uid)}>
                          <Ionicons name="person-add-outline" size={18} color={TURQUOISE} style={{ marginRight: 4 }} />
                          <Text style={styles.msgBtnText}>Add Friend</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.inviteBtn, { marginLeft: 6 }]}
                          onPress={() => { setInviteSelection({}); setInviteTargetUid(dmPeer?.uid || null); setInviteTargetName(dmPeer?.username || null); setInviteModalVisible(true); }}
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
              <View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: TURQUOISE, marginLeft: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' }}>
                {/* Safe ActivityIcon usage */}
                {activityInfo?.type ? <ActivityIconComp activity={activityInfo.type} size={22} color={TURQUOISE} /> : null}
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
            <TouchableOpacity onPress={openInfoMenu} style={styles.headerInfo} onLayout={(e) => setHeaderInfoLayout(e.nativeEvent.layout)}>
              <Ionicons name="information-circle-outline" size={26} color={TURQUOISE} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            {groupMeta?.photoUrl ? (
              <ExpoImage source={{ uri: groupMeta.photoUrl }} style={styles.headerImage} contentFit="cover" cachePolicy="disk" />
            ) : (
              <View style={[styles.headerImage, { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: TURQUOISE }]}>
                <Ionicons name="people" size={22} color={TURQUOISE} />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.headerTitle}>{groupMeta?.title || 'Group Chat'}</Text>
            </View>
            <TouchableOpacity onPress={openInfoMenu} style={styles.headerInfo} onLayout={(e) => setHeaderInfoLayout(e.nativeEvent.layout)}>
              <Ionicons name="information-circle-outline" size={26} color={TURQUOISE} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* BODY */}
      <KeyboardCompatibleView setKbdVisible={setComposerKbdVisible} iosOffset={headerHeight}>
        {/* INFO / ACTION MENUS & MODALS */}
        {/* Top-right Info (i) overlay */}
        <Modal visible={optionsVisible} transparent animationType="fade" onRequestClose={closeInfoMenu}>
          <Pressable style={styles.menuOverlay} onPress={closeInfoMenu} />
          <View style={[styles.menuPanel, headerInfoLayout ? { position: 'absolute', top: headerHeight, right: Math.max(8, (screenW - (headerInfoLayout.x + headerInfoLayout.width))) } : {}]}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setParticipantsVisible(true); closeInfoMenu(); }}>
              <Text style={styles.menuItemText}>View Participants</Text>
            </TouchableOpacity>

            {!dmPeer && (
              <>
                {!activityInfo && (
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setAddUsersVisible(true); closeInfoMenu(); }}>
                    <Text style={styles.menuItemText}>Add People</Text>
                  </TouchableOpacity>
                )}

                {!activityInfo && (
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setEditVisible(true); closeInfoMenu(); }}>
                    <Text style={styles.menuItemText}>Edit Group</Text>
                  </TouchableOpacity>
                )}

                {activityInfo && chatActivityId && (
                  <TouchableOpacity style={styles.menuItem} onPress={() => { closeInfoMenu(); navigation.navigate('ActivityDetails' as any, { activityId: chatActivityId }); }}>
                    <Text style={styles.menuItemText}>Activity Details</Text>
                  </TouchableOpacity>
                )}

                <View style={{ height: 1, backgroundColor: '#2a2a2a', marginVertical: 4 }} />

                <TouchableOpacity style={styles.menuItemDanger} onPress={handleLeaveCustomGroup}>
                  <Text style={styles.menuItemDangerText}>Leave Chat</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Modal>

        {/* Participants list (anchored under header) */}
        {participantsVisible && (
          <Animated.View style={[styles.modalPanel, { position: 'absolute', top: headerHeight, width: '92%', maxHeight: '75%', alignSelf: 'center', zIndex: 15000 }]}> 
            <Text style={styles.modalTitle}>Participants</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {participants.map((p) => {
                const isFriend = myFriendIds.includes(p.uid);
                const isRequested = myRequestsSent.includes(p.uid);
                const isMe = p.uid === myId;
                return (
                  <View key={p.uid} style={styles.row}>
                    <TouchableOpacity onPress={() => goToUserProfile(p.uid)} activeOpacity={0.8}>
                      <ExpoImage source={{ uri: p.photo || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(p.username || 'U')) }} style={styles.rowImage} contentFit="cover" cachePolicy="disk" />
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowText}>{p.username}{isMe ? ' (You)' : ''}</Text>
                    </View>
                    {!isMe && (
                      <>
                        <TouchableOpacity style={[styles.msgBtn, { marginRight: 6 }]} onPress={() => handleMessageUser(p.uid)}>
                          <Ionicons name="chatbubble-ellipses-outline" size={16} color={TURQUOISE} style={{ marginRight: 4 }} />
                          <Text style={styles.msgBtnText}>Message</Text>
                        </TouchableOpacity>
                        {isFriend ? (
                          <View style={styles.msgBtnFilled}>
                            <Ionicons name="checkmark-done-outline" size={16} color={'#000'} style={{ marginRight: 4 }} />
                            <Text style={styles.msgBtnTextInverted}>Friends</Text>
                          </View>
                        ) : isRequested ? (
                          <TouchableOpacity style={styles.msgBtnFilled} onPress={() => handleCancelFriendRequest(p.uid)}>
                            <Ionicons name="person-add-outline" size={16} color={'#000'} style={{ marginRight: 4 }} />
                            <Text style={styles.msgBtnTextInverted}>Cancel</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity style={styles.msgBtn} onPress={() => handleAddFriend(p.uid)}>
                            <Ionicons name="person-add-outline" size={16} color={TURQUOISE} style={{ marginRight: 4 }} />
                            <Text style={styles.msgBtnText}>Add</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
              <TouchableOpacity style={[styles.modalButton, { backgroundColor: TURQUOISE }]} onPress={() => setParticipantsVisible(false)}>
                <Text style={{ color: '#000', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Add users (anchored under header) */}
        {addUsersVisible && (
          <Animated.View style={[styles.modalPanel, { position: 'absolute', top: headerHeight, width: '92%', maxHeight: '75%', alignSelf: 'center', zIndex: 15000 }]}> 
            <Text style={styles.modalTitle}>Add people</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {friends
                .filter(f => !participantIds.includes(f.uid))
                .map((f) => {
                  const chosen = !!addingUsersMap[f.uid];
                  return (
                    <TouchableOpacity key={f.uid} style={[styles.row, { justifyContent: 'space-between' }]} onPress={() => setAddingUsersMap(m => ({ ...m, [f.uid]: !m[f.uid] }))} activeOpacity={0.8}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <ExpoImage source={{ uri: f.photo || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(f.username || 'U')) }} style={styles.rowImage} contentFit="cover" cachePolicy="disk" />
                        <Text style={styles.rowText}>{f.username}</Text>
                      </View>
                      <View style={[styles.chip, { backgroundColor: chosen ? TURQUOISE : '#2a2a2a' }]}>
                        <Text style={{ color: chosen ? '#000' : '#ddd', fontWeight: '700' }}>{chosen ? 'Selected' : 'Select'}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              {friends.filter(f => !participantIds.includes(f.uid)).length === 0 && (
                <Text style={{ color: '#aaa', textAlign: 'center', paddingVertical: 16 }}>No friends available to add.</Text>
              )}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
              <TouchableOpacity style={[styles.modalButton, { marginRight: 8, backgroundColor: '#2a2a2a' }]} onPress={() => setAddUsersVisible(false)}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={busy} style={[styles.modalButton, { backgroundColor: TURQUOISE, opacity: busy ? 0.6 : 1 }]} onPress={handleAddUsers}>
                <Text style={{ color: '#000', fontWeight: '700' }}>{busy ? 'Adding…' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Edit group (anchored under header) */}
        {editVisible && (
          <Animated.View style={[styles.modalPanel, { position: 'absolute', top: headerHeight, width: '92%', alignSelf: 'center', zIndex: 15000 }]}> 
            <Text style={styles.modalTitle}>Edit group</Text>
            <View style={styles.photoPickerRow}>
              {groupMeta?.photoUrl || editPhotoUri ? (
                <ExpoImage source={{ uri: (editPhotoUri || groupMeta?.photoUrl)! }} style={{ width: 48, height: 48, borderRadius: 24, marginRight: 10, borderWidth: 1, borderColor: TURQUOISE }} contentFit="cover" />
              ) : (
                <View style={{ width: 48, height: 48, borderRadius: 24, marginRight: 10, borderWidth: 1, borderColor: TURQUOISE, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="people" size={22} color={TURQUOISE} />
                </View>
              )}
              <TouchableOpacity onPress={handlePickEditPhoto} style={[styles.modalButton, { backgroundColor: '#2a2a2a' }]}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Change Photo</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              placeholder="Group title"
              placeholderTextColor="#999"
              value={editTitle}
              onChangeText={setEditTitle}
              maxLength={25}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
              <TouchableOpacity style={[styles.modalButton, { marginRight: 8, backgroundColor: '#2a2a2a' }]} onPress={() => setEditVisible(false)}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={busy} style={[styles.modalButton, { backgroundColor: TURQUOISE, opacity: busy ? 0.6 : 1 }]} onPress={handleSaveEdit}>
                <Text style={{ color: '#000', fontWeight: '700' }}>{busy ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Invite panel anchored under header (bottom-right of header) */}
        {inviteModalVisible && (
          <>
            {/* backdrop: covers chat area; tapping closes invite */}
            <Pressable style={{ position: 'absolute', left: 0, right: 0, top: headerHeight, bottom: 0 }} onPress={() => { setInviteModalVisible(false); setInviteSelection({}); }}>
              <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', opacity: backdropAnim }} />
            </Pressable>

            <Animated.View
              pointerEvents="box-none"
              style={[
                styles.invitePanel,
                {
                  top: headerHeight, // align directly to bottom of header
                  opacity: inviteAnim,
                  transform: [{ scale: inviteAnim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }],
                },
              ]}
            >
              <View style={[styles.modalPanel, { maxHeight: 320, width: 320 }]}> 
              <Text style={styles.modalTitle}>Invite {inviteTargetName ? inviteTargetName : 'user'}</Text>
              {myJoinedActivities.length === 0 ? (
                <Text style={{ color: '#aaa', marginBottom: 6 }}>You haven't joined any activities yet.</Text>
              ) : null}
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 220 }}>
                {myJoinedActivities.map((a: any) => {
                  const chosen = !!inviteSelection[a.id];
                  const alreadyJoined = Array.isArray(a.joinedUserIds) && !!inviteTargetUid && a.joinedUserIds.includes(inviteTargetUid);
                  return (
                    <TouchableOpacity
                      key={a.id}
                      style={[styles.row, { justifyContent: 'space-between', opacity: alreadyJoined ? 0.5 : 1 }]}
                      onPress={alreadyJoined ? undefined : () => setInviteSelection(s => ({ ...s, [a.id]: !s[a.id] }))}
                      activeOpacity={alreadyJoined ? 1 : 0.8}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: TURQUOISE, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                          {a.activity ? <ActivityIconComp activity={a.activity} size={18} color={TURQUOISE} /> : <Ionicons name="medal-outline" size={18} color={TURQUOISE} />}
                        </View>
                        <View>
                          <Text style={styles.rowText}>{a.name || a.activity || 'Activity'}</Text>
                          {a.date && a.time ? <Text style={{ color: '#aaa', fontSize: 12 }}>{normalizeDateFormat(a.date)} • {a.time}</Text> : null}
                        </View>
                      </View>
                      {/* right side: Joined label or checkbox */}
                      {alreadyJoined ? (
                        <View style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
                          <Text style={{ color: '#9a9a9a', fontWeight: '700', fontSize: 12 }}>Joined</Text>
                        </View>
                      ) : (
                        <Pressable onPress={() => setInviteSelection(s => ({ ...s, [a.id]: !s[a.id] }))} style={{ padding: 6 }}>
                          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: chosen ? TURQUOISE : '#666', backgroundColor: chosen ? TURQUOISE : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                            {chosen ? <Ionicons name="checkmark" size={14} color={chosen ? '#000' : '#fff'} /> : null}
                          </View>
                        </Pressable>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
                <TouchableOpacity style={[styles.modalButton, { marginRight: 8, backgroundColor: '#2a2a2a' }]} onPress={() => setInviteModalVisible(false)}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={creatingInvite || !inviteTargetUid}
                  style={[styles.modalButton, { backgroundColor: TURQUOISE, opacity: creatingInvite ? 0.6 : 1 }]}
                  onPress={async () => {
                    try {
                      setCreatingInvite(true);
                      const selectedIds = Object.keys(inviteSelection).filter(id => inviteSelection[id]);
                      if (!selectedIds.length || !inviteTargetUid) { setCreatingInvite(false); return; }
                      await sendActivityInvites(inviteTargetUid, selectedIds);
                      setInviteModalVisible(false);
                      setInviteSelection({});
                      showToast('Invited!');
                    } catch (e: any) {
                      Alert.alert('Invite failed', e?.message || 'Please try again.');
                    } finally {
                      setCreatingInvite(false);
                    }
                  }}
                >
                  <Text style={{ color: '#000', fontWeight: '700' }}>{creatingInvite ? 'Sending…' : 'Send Invites'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
          </>
        )}

        {/* Messages list */}
        {!isMessagesReady ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG }}>
            <ActivityIndicator size="large" color={TURQUOISE} />
          </View>
        ) : (
          <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
            <ListComponent
              ref={listRef as any}
              data={renderMessages}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              estimatedItemSize={84}
              onScroll={onScroll}
              scrollEventThrottle={16}
              contentContainerStyle={styles.messageList}
              ListHeaderComponent={loadingOlder ? (
                <View style={{ paddingVertical: 8, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={TURQUOISE} />
                </View>
              ) : <View style={{ height: 6 }} />}
              ListFooterComponent={typingLabel ? (
                <View style={styles.typingIndicatorContainer}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TypingDots />
                    <Text style={{ color: '#9adfe2', marginLeft: 8, fontSize: 13 }}>{typingLabel}</Text>
                  </View>
                </View>
              ) : <View style={{ height: 4 }} />}
              onContentSizeChange={onContentSizeChange}
              maintainVisibleContentPosition={{ autoscrollToTopThreshold: 10, animateAutoScrollToBottom: true }}
              drawDistance={screenH * 2}
              removeClippedSubviews={Platform.OS === 'android'}
              onLayout={() => {
                if (isInitialLoad.current) {
                  requestAnimationFrame(() => { listRef.current?.scrollToEnd({ animated: false }); userAtBottomRef.current = true; });
                }
              }}
            />
          </Animated.View>
        )}

        {/* Composer */}
        <View
          style={[
            styles.inputContainer,
            { paddingBottom: composerKbdVisible ? 8 : Math.max(insets.bottom, 8), backgroundColor: BG }
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
                    <ExpoImage source={{ uri }} style={styles.previewThumb} contentFit="cover" cachePolicy="disk" />
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
              onChangeText={(t) => { setMessageText(t); if (t.trim().length) pingTyping(); }}
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
        </View>

        {/* Scroll-to-bottom FAB */}
        <Animated.View
          style={[
            styles.scrollFab,
            {
              opacity: scrollFabAnim,
              transform: [
                { scale: scrollFabAnim },
                { translateY: scrollFabAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
              ],
            },
          ]}
          pointerEvents={showScrollFab ? 'auto' : 'none'}
        >
          <TouchableOpacity
            onPress={() => { listRef.current?.scrollToEnd({ animated: true }); userAtBottomRef.current = true; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }}
            activeOpacity={0.85}
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="chevron-down" size={22} color="#000" />
          </TouchableOpacity>
        </Animated.View>

        {/* Reaction picker (anchored beside bubble) */}
        <Modal visible={!!reactionTarget} transparent animationType="none" onRequestClose={closeReactions}>
          <Pressable style={styles.overlayTapClose} onPress={closeReactions} />
          <Animated.View
            style={[
              styles.reactionBar,
              {
                transform: [{ scale: reactionAnim }],
                opacity: reactionAnim,
                top: reactionAnchor?.y ?? 140,
                left: reactionAnchor?.side === 'left' ? 12 : undefined,
                right: reactionAnchor?.side === 'right' ? 12 : undefined,
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
                onPress={() => { if (reactionTarget) setReplyTo(reactionTarget); closeReactions(); }}
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
            <RNFlatList
              horizontal
              pagingEnabled
              data={imageMessages}
              keyExtractor={(m) => m.id}
              initialScrollIndex={viewerIndex}
              getItemLayout={(_d, i) => ({ length: Dimensions.get('window').width, offset: Dimensions.get('window').width * i, index: i })}
              renderItem={({ item }) => (
                <View style={{ width: Dimensions.get('window').width, justifyContent: 'center', alignItems: 'center' }}>
                  <ExpoImage source={{ uri: item.text }} style={{ width: '100%', height: '100%' }} contentFit="contain" cachePolicy="disk" />
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
      </KeyboardCompatibleView>
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

  messageList: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },

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
  messageTime: { fontSize: 11, color: '#cfcfcf' },
  userMessageTime: { color: '#004a4a' },

  messageTimeContainer: {
    position: 'absolute',
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  messageTimeRight: { right: 4 },
  messageTimeLeft: { left: 4 },
  imageTime: { fontSize: 11, color: '#fff', marginRight: 2 },

  media: { width: 220, height: 160, borderRadius: 12, marginVertical: 2, backgroundColor: '#000' },
  placeholderText: { color: '#888', fontSize: 14 },

  typingIndicatorContainer: { paddingHorizontal: 14, paddingVertical: 8 },

  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: '#1ae9ef22',
    backgroundColor: SURFACE,
    paddingHorizontal: 10,
    paddingTop: 8,
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

  inputRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6 },
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
    minHeight: 38,
    maxHeight: 100,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
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
    right: 16,
    bottom: 90,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: TURQUOISE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },

  // reaction picker
  overlayTapClose: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  reactionBar: {
    position: 'absolute',
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
  invitePanel: {
    position: 'absolute',
    right: 10,
    width: 320,
    maxWidth: 420,
    zIndex: 20000,
    elevation: 24,
    // small shadow for iOS
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
});

export default React.memo(ChatDetailScreen);
