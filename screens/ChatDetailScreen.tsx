// screens/ChatDetailScreen.tsx
// ✅ COMPLETELY REWRITTEN - Instagram-level smoothness
// Key features:
// - Message clustering (like Instagram)
// - Swipe right to reply with haptic feedback
// - Hold to show reaction picker with animations
// - Instant message loading
// - Smooth keyboard handling (iOS/Android)
// - Consistent profile pictures and usernames
// - Typing indicators
// - Read receipts (DM and group)
// - Improved audio message UI
// - Three chat types: DMs, Activity Groups, Custom Groups

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import UserAvatar from '../components/UserAvatar';
import { Image } from 'expo-image';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Keyboard,
  Animated,
  ActivityIndicator,
  Modal,
  Pressable,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PanGestureHandler, State as GestureState } from 'react-native-gesture-handler';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
// Blur removed
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { doc, getDoc, onSnapshot, collection, query, where, getDocs, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { ActivityIcon } from '../components/ActivityIcons';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { uploadChatImage } from '../utils/imageUtils';
import { muteChat, unmuteChat, isChatMuted } from '../utils/firestoreMutes';
import { isBlockedByUser } from '../utils/firestoreBlocks';
import { sendFriendRequest, cancelFriendRequest } from '../utils/firestoreFriends';
import { useTheme } from '../context/ThemeContext';
import { useActivityContext } from '../context/ActivityContext';
import { useInAppNotification } from '../context/InAppNotificationContext';
import { normalizeDateFormat } from '../utils/storage';
import {
  sendMessage,
  markChatRead,
  ensureDmChat,
  leaveChatWithAutoDelete,
  addSystemMessage,
  pingTyping,
  clearTyping,
  addReaction,
  batchFetchProfiles,
  fetchLatestMessagesPage,
  fetchOlderMessagesPage,
  listenToLatestMessages,
  listenToReactions,
  getCachedProfile,
} from '../utils/firestoreChats';
import { sendActivityInvites } from '../utils/firestoreInvites';
import {
  saveMessagesToCache,
  loadMessagesFromCache,
  addMessageToCache,
  clearMessagesCache,
} from '../utils/chatCache';

// ==================== TYPES ====================
type Message = {
  id: string;
  senderId: string;
  text: string;
  type: 'text' | 'image' | 'system';
  timestamp?: any;
  replyToId?: string;
  isPending?: boolean; // For optimistic UI
};

type Profile = {
  uid: string;
  username: string;
  photo?: string;
  photoURL?: string;
};

type ChatMeta = {
  isDm: boolean;
  isActivity: boolean;
  isGroup: boolean;
  dmPeer?: Profile;
  activityId?: string;
  activityInfo?: {
    name: string;
    type: string;
    date: string;
    time: string;
  };
  groupMeta?: {
    title: string;
    photoUrl?: string;
  };
  participants: string[];
};

// ==================== HELPER COMPONENTS ====================

// Typing indicator dots animation
const TypingDots = () => {
  const { theme } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const getDotStyle = (index: number) => ({
    opacity: anim.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: index === 0 ? [1, 0.3, 1] : index === 1 ? [0.3, 1, 0.3] : [0.3, 0.3, 1],
    }),
    transform: [{
      translateY: anim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0, -2, 0],
      }),
    }],
  });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            { width: 4, height: 4, borderRadius: 2, backgroundColor: theme.primary },
            getDotStyle(i),
          ]}
        />
      ))}
    </View>
  );
};

// Toast notification component
const Toast = ({ message, visible }: { message: string; visible: boolean }) => {
  const { theme } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 8,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 20,
        right: 20,
        bottom: 24,
        backgroundColor: 'rgba(0,0,0,0.85)',
        borderColor: theme.border,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center',
        transform: [{
          translateY: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [20, 0],
          }),
        }],
        opacity: anim,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 14, textAlign: 'center' }}>
        {message}
      </Text>
    </Animated.View>
  );
};

// ==================== MESSAGE BUBBLE COMPONENT ====================
const MessageBubble = React.memo<{
  message: Message;
  isOwn: boolean;
  isFirst: boolean;
  isLast: boolean;
  sender: Profile;
  replyToMessage?: Message;
  replySender?: Profile;
  reactions: Array<{ userId: string; emoji: string }>;
  myReaction?: string;
  showReactionPicker: boolean;
  onLongPress: () => void;
  onSwipeReply: () => void;
  onReact: (emoji: string) => void;
  onCopy: () => void;
  onImagePress: () => void;
  onUserPress: (uid: string) => void;
  onClosePicker: () => void;
  onReactionsPress: () => void;
  onBubbleMeasured?: (layout: { x: number; y: number; width: number; height: number }) => void;
  theme: any;
  styles: any;
}>(({
  message,
  isOwn,
  isFirst,
  isLast,
  sender,
  replyToMessage,
  replySender,
  reactions,
  myReaction,
  showReactionPicker,
  onLongPress,
  onSwipeReply,
  onReact,
  onCopy,
  onImagePress,
  onUserPress,
  onClosePicker,
  onReactionsPress,
  onBubbleMeasured,
  theme,
  styles,
}) => {
  const swipeX = useRef(new Animated.Value(0)).current;
  const reactionAnim = useRef(new Animated.Value(0)).current;
  const longPressTriggered = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const rowRef = useRef<View>(null);
  const pickerRef = useRef<View>(null);

  // Animate reaction picker
  useEffect(() => {
    if (showReactionPicker) {
      reactionAnim.setValue(0);
      Animated.spring(reactionAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
        tension: 120,
      }).start();
      // Measure bubble + reaction picker to build union spotlight hole
      setTimeout(() => {
        try {
          rowRef.current?.measureInWindow((bx, by, bW, bH) => {
            if (!pickerRef.current) {
              onBubbleMeasured?.({ x: bx, y: by, width: bW, height: bH });
              return;
            }
            pickerRef.current?.measureInWindow((px, py, pW, pH) => {
              const unionX = Math.min(bx, px);
              const unionY = Math.min(by, py);
              const unionRight = Math.max(bx + bW, px + pW);
              const unionBottom = Math.max(by + bH, py + pH);
              const unionW = unionRight - unionX;
              const unionH = unionBottom - unionY;
              onBubbleMeasured?.({ x: unionX, y: unionY, width: unionW, height: unionH });
            });
          });
        } catch {}
      }, 30); // slight delay ensures picker laid out
    }
  }, [showReactionPicker]);

  // System message rendering
  if (message.type === 'system') {
    return (
      <View style={{ alignItems: 'center', marginVertical: 8 }}>
        <Text style={{ color: '#aaa', fontStyle: 'italic', fontSize: 13, textAlign: 'center', paddingHorizontal: 10 }}>
          {message.text}
        </Text>
        {message.timestamp && (
          <Text style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
            {new Date(message.timestamp.seconds * 1000).toLocaleTimeString([], { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </Text>
        )}
      </View>
    );
  }

  // Bubble corner radii (Instagram-style)
  const cornerRadius = {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: isOwn ? 18 : (isLast ? 18 : 6),
    borderBottomRightRadius: isOwn ? (isLast ? 18 : 6) : 18,
  };

  // Avatar photo (explicit fallback handled by UserAvatar component)
  const avatarPhoto = sender.photo || sender.photoURL || null;

  // Aggregate reactions (filter out empty emojis)
  const reactionCounts = reactions
    .filter(r => r.emoji && r.emoji.trim())
    .reduce((acc, r) => {
      acc[r.emoji] = (acc[r.emoji] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  return (
    <View ref={rowRef} style={[
      styles.messageRow,
      isOwn ? styles.messageRowRight : styles.messageRowLeft,
      showReactionPicker && { zIndex: 100 },
    ]}>
      {/* Avatar column (for others, show on last message) */}
      {!isOwn && (
        <View style={styles.avatarColumn}>
          {isLast ? (
            <TouchableOpacity 
              onPress={() => onUserPress(message.senderId)}
              activeOpacity={0.7}
            >
              <UserAvatar
                photoUrl={avatarPhoto}
                username={sender.username || 'User'}
                size={28}
                style={styles.avatar}
              />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 28 }} />
          )}
        </View>
      )}

      {/* Message column */}
      <View style={[styles.messageColumn, isOwn && { alignItems: 'flex-end' }]}>
        {/* Username (show on first message for others) */}
        {!isOwn && isFirst && (
          <TouchableOpacity 
            onPress={() => onUserPress(message.senderId)}
            activeOpacity={0.7}
          >
            <Text style={styles.username}>
              {sender.username || 'User'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Bubble with swipe gesture */}
        <View style={{ position: 'relative' }}>
          <PanGestureHandler
            onGestureEvent={Animated.event(
              [{ nativeEvent: { translationX: swipeX } }],
              { useNativeDriver: true }
            )}
            onHandlerStateChange={(e) => {
              const state = e.nativeEvent.state;
              const THRESHOLD = 72;

              if (state === GestureState.END || state === GestureState.CANCELLED) {
                const dx = (e.nativeEvent as any).translationX || 0;
                
                // Reset animation
                Animated.spring(swipeX, {
                  toValue: 0,
                  useNativeDriver: true,
                }).start();

                // Trigger reply based on message ownership
                // Own messages: swipe left (negative dx)
                // Other messages: swipe right (positive dx)
                const shouldTrigger = isOwn ? dx < -THRESHOLD : dx > THRESHOLD;
                
                if (shouldTrigger) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  onSwipeReply();
                }
              }
            }}
            activeOffsetX={[-5, 5]}
          >
            <Animated.View style={{ transform: [{ translateX: swipeX }] }}>
              <Pressable
                style={[
                  styles.bubble,
                  isOwn ? styles.bubbleOwn : styles.bubbleOther,
                  cornerRadius,
                  message.type === 'image' && { padding: 4 },
                  showReactionPicker && styles.bubbleHighlight,
                ]}
                onLongPress={() => {
                  longPressTriggered.current = true;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  onLongPress();
                }}
                onPressIn={(e) => {
                  touchStartX.current = e.nativeEvent.pageX;
                }}
                onPressOut={(e) => {
                  const start = touchStartX.current;
                  touchStartX.current = null;

                  if (longPressTriggered.current) {
                    longPressTriggered.current = false;
                    return;
                  }

                  // Quick swipe detection
                  // Own messages: swipe left (negative dx)
                  // Other messages: swipe right (positive dx)
                  if (typeof start === 'number') {
                    const dx = e.nativeEvent.pageX - start;
                    const shouldTrigger = isOwn ? dx < -40 : dx > 40;
                    
                    if (shouldTrigger) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                      onSwipeReply();
                    }
                  }
                }}
              >
                {/* Reply header */}
                {replyToMessage && (
                  <View style={[
                    styles.replyHeader,
                    isOwn ? styles.replyHeaderOwn : styles.replyHeaderOther,
                  ]}>
                    <Text style={styles.replyHeaderName} numberOfLines={1}>
                      {replySender?.username || 'User'}
                    </Text>
                    <Text style={styles.replyHeaderSnippet} numberOfLines={1}>
                      {replyToMessage.type === 'text' 
                        ? replyToMessage.text 
                        : replyToMessage.type === 'image' 
                        ? 'Photo' 
                        : replyToMessage.text}
                    </Text>
                  </View>
                )}

                {/* Text message */}
                {message.type === 'text' && (
                  <Text style={[
                    styles.messageText,
                    isOwn && styles.messageTextOwn,
                  ]}>
                    {message.text}
                  </Text>
                )}

                {/* Image message */}
                {message.type === 'image' && (
                  (() => {
                    const resolvedUri = typeof message.text === 'string' && message.text ? message.text : avatarPhoto;
                    if (!resolvedUri) {
                      return null;
                    }
                    return (
                      <TouchableOpacity 
                        activeOpacity={0.9} 
                        onPress={onImagePress}
                      >
                        <Image
                          source={{ uri: resolvedUri }}
                          style={[styles.messageImage, cornerRadius]}
                        />
                      </TouchableOpacity>
                    );
                  })()
                )}

                {/* Timestamp or loading indicator */}
                {message.timestamp ? (
                  <Text style={[
                    styles.timestamp,
                    isOwn && styles.timestampOwn,
                  ]}>
                    {new Date(message.timestamp.seconds * 1000).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                ) : isOwn && message.isPending ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <ActivityIndicator size="small" color={isOwn ? '#fff' : theme.muted} style={{ marginRight: 4 }} />
                    <Text style={[
                      styles.timestamp,
                      isOwn && styles.timestampOwn,
                      { fontSize: 11 }
                    ]}>
                      Sending...
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </Animated.View>
          </PanGestureHandler>

          {/* Reaction chips */}
          {Object.keys(reactionCounts).length > 0 && (
            <TouchableOpacity 
              style={[
                styles.reactionChips, 
                isOwn ? { left: 6 } : { right: 6 }
              ]}
              onPress={onReactionsPress}
              activeOpacity={0.7}
            >
              {Object.entries(reactionCounts).map(([emoji, count]) => (
                <View key={emoji} style={styles.reactionChip}>
                  <Text style={styles.reactionChipText}>
                    {emoji}{count > 1 ? ` ${count}` : ''}
                  </Text>
                </View>
              ))}
            </TouchableOpacity>
          )}

          {/* Reaction picker */}
          {showReactionPicker && (
            <Animated.View
              ref={pickerRef}
              style={[
                styles.reactionPicker,
                {
                  position: 'absolute',
                  top: -56,
                  left: isOwn ? undefined : 0,
                  right: isOwn ? 0 : undefined,
                  transform: [{ scale: reactionAnim }],
                  opacity: reactionAnim,
                  zIndex: 200,
                },
              ]}
            >
              {['❤️', '👍', '🔥', '😂', '👏', '😮'].map((emoji) => {
                const isSelected = myReaction === emoji;
                return (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => onReact(emoji)}
                    style={[styles.reactionButton, { alignItems: 'center' }]}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                    {isSelected && (
                      <View style={styles.reactionDot} />
                    )}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                onPress={onSwipeReply}
                style={[styles.reactionButton, { paddingHorizontal: 8 }]}
              >
                <Ionicons name="return-down-back" size={18} color={theme.text} />
              </TouchableOpacity>
              {message.type === 'text' && (
                <TouchableOpacity
                  onPress={onCopy}
                  style={[styles.reactionButton, { paddingHorizontal: 8 }]}
                >
                  <Ionicons name="copy-outline" size={18} color={theme.text} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={onClosePicker}
                style={[styles.reactionButton, { paddingHorizontal: 8 }]}
              >
                <Ionicons name="close" size={18} color={theme.muted} />
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  // Important: also re-render when sender or replySender profile info changes
  const prevSenderPhoto = prevProps.sender?.photo || prevProps.sender?.photoURL || '';
  const nextSenderPhoto = nextProps.sender?.photo || nextProps.sender?.photoURL || '';
  const prevReplySenderPhoto = prevProps.replySender?.photo || prevProps.replySender?.photoURL || '';
  const nextReplySenderPhoto = nextProps.replySender?.photo || nextProps.replySender?.photoURL || '';

  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.text === nextProps.message.text &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.showReactionPicker === nextProps.showReactionPicker &&
    prevProps.myReaction === nextProps.myReaction &&
    JSON.stringify(prevProps.reactions) === JSON.stringify(nextProps.reactions) &&
    // Re-render when sender profile changes (username/photo)
    prevProps.sender?.uid === nextProps.sender?.uid &&
    prevProps.sender?.username === nextProps.sender?.username &&
    prevSenderPhoto === nextSenderPhoto &&
    // Re-render when reply header identity or profile changes
    (prevProps.replyToMessage?.id || null) === (nextProps.replyToMessage?.id || null) &&
    (prevProps.replySender?.uid || null) === (nextProps.replySender?.uid || null) &&
    (prevProps.replySender?.username || null) === (nextProps.replySender?.username || null) &&
    prevReplySenderPhoto === nextReplySenderPhoto
  );
});

// ==================== MAIN COMPONENT ====================
const ChatDetailScreen = () => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<any>();
  const { chatId } = route.params;
  const { allActivities, joinedActivities, blockedUsers, isUserBlockedById } = useActivityContext();
  const { setCurrentChatId } = useInAppNotification();

  // Track when user is viewing this chat (suppress notifications)
  useEffect(() => {
    setCurrentChatId(chatId);
    return () => setCurrentChatId(null);
  }, [chatId, setCurrentChatId]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
    scrollOffsetRef.current = 0;
    contentHeightRef.current = 0;
    // Reset restoration helpers when switching chats
    pendingAddedRestoreRef.current = null;
    messageHeightsRef.current = {};
    setAnchored(false);
  }, [chatId]);

  // ========== STATE ==========
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [chatMeta, setChatMeta] = useState<ChatMeta>({
    isDm: false,
    isActivity: false,
    isGroup: false,
    participants: [],
  });
  const [messageText, setMessageText] = useState('');
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  // Removed spotlight layout state
  const [myReactions, setMyReactions] = useState<Record<string, string>>({});
  const [reactionsMap, setReactionsMap] = useState<Record<string, Array<{ userId: string; emoji: string }>>>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [chatReads, setChatReads] = useState<Record<string, any>>({});
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [anchored, setAnchored] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [participantsVisible, setParticipantsVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isBlockedByPeer, setIsBlockedByPeer] = useState(false); // They blocked us
  const [reactionsModalVisible, setReactionsModalVisible] = useState(false);
  const [selectedMessageReactions, setSelectedMessageReactions] = useState<Array<{ userId: string; emoji: string }>>([]);

  // Refs
  const flatListRef = useRef<FlatList>(null);
  // Prefer native anchor maintenance for prepend (RN/FlatList)
  const USE_NATIVE_MAINTAIN = true;
  const oldestSnapRef = useRef<any>(null);
  const noMoreOlderRef = useRef(false);
  const unsubLatestRef = useRef<(() => void) | undefined>(undefined);
  const hasSetupRef = useRef(false);
  const lastLengthRef = useRef(0);
  const navigatedAwayRef = useRef(false);
  const reactionUnsubsRef = useRef<Record<string, () => void>>({});
  const toastTimeoutRef = useRef<any>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollButtonAnim = useRef(new Animated.Value(0)).current;
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const layoutHeightRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);
  const isLoadingOlderRef = useRef(false);
  // Track measured heights for each message id
  const messageHeightsRef = useRef<Record<string, number>>({});
  // Pending precise restoration after adding older messages
  const pendingAddedRestoreRef = useRef<{
    prevHeight: number;
  } | null>(null);

  // ========== CHECK IF OTHER USER IS BLOCKED (DM only) - bidirectional ==========
  const isOtherUserBlocked = useMemo(() => {
    if (!chatMeta.isDm || blockedUsers.length === 0) return false;
    const me = auth.currentUser?.uid;
    const otherUser = chatMeta.participants?.find(uid => uid !== me);
    return otherUser ? blockedUsers.includes(otherUser) : false;
  }, [chatMeta.isDm, chatMeta.participants, blockedUsers]);
  
  // Combined: DM is blocked if we blocked them OR they blocked us
  const isDmBlocked = isOtherUserBlocked || isBlockedByPeer;

  // ========== TOAST ==========
  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    setToastVisible(true);
    toastTimeoutRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimeoutRef.current = null;
    }, 2000);
  }, []);

  // ========== CHECK IF CHAT IS MUTED ==========
  useEffect(() => {
    const checkMuted = async () => {
      const muted = await isChatMuted(chatId);
      setIsMuted(muted);
    };
    checkMuted();
  }, [chatId]);

  // ========== CHECK IF DM PEER HAS BLOCKED US (bidirectional) ==========
  useEffect(() => {
    const checkBlockedByPeer = async () => {
      if (chatMeta.isDm && chatMeta.dmPeer?.uid) {
        try {
          const blocked = await isBlockedByUser(chatMeta.dmPeer.uid);
          setIsBlockedByPeer(blocked);
        } catch (e) {
          console.log('Could not check if blocked by peer:', e);
        }
      }
    };
    checkBlockedByPeer();
  }, [chatMeta.isDm, chatMeta.dmPeer?.uid]);

  // ========== RELOAD MUTE STATE WHEN SCREEN IS FOCUSED ==========
  useFocusEffect(
    React.useCallback(() => {
      const checkMuted = async () => {
        try {
          const muted = await isChatMuted(chatId);
          setIsMuted(muted);
        } catch (error) {
          console.error('Error checking mute state:', error);
        }
      };
      checkMuted();
    }, [chatId])
  );

  // ========== SCROLL TO BOTTOM ==========
  const scrollToBottom = useCallback((animated: boolean = true) => {
    // Compute exact bottom offset using tracked sizes
    const contentH = contentHeightRef.current || 0;
    const layoutH = layoutHeightRef.current || 0;
    const target = Math.max(contentH - layoutH, 0);

    if (Number.isFinite(target)) {
      flatListRef.current?.scrollToOffset({ offset: target, animated });
      // Re-affirm bottom on next frame in case of async size changes
      requestAnimationFrame(() => {
        const contentH2 = contentHeightRef.current || 0;
        const layoutH2 = layoutHeightRef.current || 0;
        const target2 = Math.max(contentH2 - layoutH2, 0);
        flatListRef.current?.scrollToOffset({ offset: target2, animated: false });
      });
    } else {
      // Fallback
      flatListRef.current?.scrollToEnd({ animated });
    }
    isAtBottomRef.current = true;
    setShowScrollButton(false);
  }, []);

  // ========== SCROLL BUTTON ANIMATION ==========
  useEffect(() => {
    if (showScrollButton) {
      Animated.spring(scrollButtonAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 8,
        tension: 120,
      }).start();
    } else {
      Animated.timing(scrollButtonAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [showScrollButton]);

  // ========== NAVIGATION ==========
  const exitChat = useCallback(() => {
    if (navigatedAwayRef.current) return;
    navigatedAwayRef.current = true;
    
    setTimeout(() => {
      const navAny = navigation as any;
      if (navAny?.canGoBack?.()) {
        navigation.goBack();
      } else {
        navigation.navigate('MainTabs' as any, { screen: 'Inbox' } as any);
      }
    }, 0);
  }, [navigation]);

  // ========== FADE IN ANIMATION (after initial anchor) ==========
  useEffect(() => {
    if (anchored) {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    }
  }, [anchored]);

  // ========== ANDROID NAV BUTTONS ==========
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setButtonStyleAsync('light');
    }
  }, []);

  // ========== CLEAR TYPING ON UNMOUNT ==========
  useEffect(() => {
    return () => {
      clearTyping(chatId);
    };
  }, [chatId]);

  // ========== KEYBOARD HANDLING ==========
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const changeEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : null;

    const onShow = () => {
      if (!isAtBottomRef.current) return;
      // Let layout/avoiding settle, then snap precisely to bottom
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToBottom(false));
      });
    };

    const subShow = Keyboard.addListener(showEvt as any, onShow);
    const subChange = changeEvt ? Keyboard.addListener(changeEvt as any, onShow) : { remove: () => {} } as any;

    return () => {
      try { subShow.remove(); } catch {}
      try { subChange.remove(); } catch {}
    };
  }, [scrollToBottom]);

  // ========== FETCH CHAT META ==========
  useEffect(() => {
    const fetchMeta = async () => {
      try {
        const chatDoc = await getDoc(doc(db, 'chats', chatId));
        if (!chatDoc.exists()) return;

        const data = chatDoc.data();
        const participants = Array.isArray(data?.participants) ? data.participants : [];
        const isDm = data?.type === 'dm' || chatId.startsWith('dm_');

        if (isDm) {
          // DM chat
          const myId = auth.currentUser?.uid;
          const peerId = participants.find((p: string) => p !== myId);
          
          if (peerId) {
            const peerDoc = await getDoc(doc(db, 'profiles', peerId));
            if (peerDoc.exists()) {
              const peerData = peerDoc.data();
              const peerProfile: Profile = {
                uid: peerId,
                username: peerData.username || 'User',
                photo: peerData.photo || peerData.photoURL,
                photoURL: peerData.photoURL || peerData.photo,
              };
              
              // Cache the peer profile immediately
              setProfiles((prev) => ({ ...prev, [peerId]: peerProfile }));
              
              setChatMeta({
                isDm: true,
                isActivity: false,
                isGroup: false,
                participants,
                dmPeer: peerProfile,
              });
            } else {
              setChatMeta({
                isDm: true,
                isActivity: false,
                isGroup: false,
                participants,
              });
            }
          } else {
            setChatMeta({
              isDm: true,
              isActivity: false,
              isGroup: false,
              participants,
            });
          }
        } else if (data?.activityId) {
          // Activity group chat
          const activityDoc = await getDoc(doc(db, 'activities', data.activityId));
          if (activityDoc.exists()) {
            const actData = activityDoc.data();
            setChatMeta({
              isDm: false,
              isActivity: true,
              isGroup: false,
              participants,
              activityId: data.activityId,
              activityInfo: {
                name: actData.activity || actData.name || 'Activity',
                type: actData.activity || '',
                date: actData.date || '',
                time: actData.time || '',
              },
            });
          }
        } else {
          // Custom group chat
          setChatMeta({
            isDm: false,
            isActivity: false,
            isGroup: true,
            participants,
            groupMeta: {
              title: data?.title || 'Group Chat',
              photoUrl: data?.photoUrl,
            },
          });
        }
      } catch (error) {
        console.error('Error fetching chat meta:', error);
      }
    };

    fetchMeta();
  }, [chatId]);

  // ========== LISTEN TO CHAT ==========
  useEffect(() => {
    const chatRef = doc(db, 'chats', chatId);
    
    const unsubAccess = onSnapshot(
      chatRef,
      (snap) => {
        if (!snap.exists()) {
          Alert.alert('Chat not found', 'This chat no longer exists.', [
            { text: 'OK', onPress: exitChat },
          ]);
          return;
        }

        const data = snap.data();
        const uid = auth.currentUser?.uid;

        if (!uid || !Array.isArray(data.participants) || !data.participants.includes(uid)) {
          Alert.alert('Access Denied', 'You are no longer a participant.', [
            { text: 'OK', onPress: exitChat },
          ]);
          return;
        }

        // Update typing users
        try {
          const typing = data?.typing || {};
          const now = Date.now();
          const fresh: string[] = [];

          Object.entries(typing).forEach(([userId, ts]: any) => {
            if (userId === uid) return;
            const ms = ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : 0;
            if (ms && now - ms < 3500) {
              fresh.push(userId);
            }
          });

          setTypingUsers(fresh);
        } catch {}

        // Update read receipts
        try {
          const reads = data?.reads || data?.seen || data?.lastReadBy || {};
          setChatReads(reads);
        } catch {}

        // Setup messages listener
        const setupMessages = async () => {
          if (hasSetupRef.current) return;
          hasSetupRef.current = true;

          // ========== LOAD FROM CACHE FIRST (instant UI) ==========
          const cachedMessages = await loadMessagesFromCache(chatId);
          if (cachedMessages && cachedMessages.length > 0) {
            console.log('📦 Loaded messages from cache (instant UI)');
            setMessages(cachedMessages as any);
            setIsReady(true);
            
            // ========== FETCH PROFILES FOR CACHED MESSAGES ==========
            const senderIds = Array.from(new Set(cachedMessages.map((m: any) => m.senderId)));
            const missing = senderIds.filter((id) => !profiles[id]);
            if (missing.length > 0) {
              try {
                const batch = await batchFetchProfiles(missing);
                const validatedBatch: Record<string, Profile> = {};
                Object.entries(batch).forEach(([uid, data]: [string, any]) => {
                  validatedBatch[uid] = {
                    uid,
                    username: data?.username || 'User',
                    photo: data?.photo || data?.photoURL || undefined,
                    photoURL: data?.photoURL || data?.photo || undefined,
                  };
                });
                setProfiles((prev) => ({ ...prev, ...validatedBatch }));
              } catch (err) {
                console.error('Error fetching profiles for cached messages:', err);
              }
            }
            
            // Instantly appear at bottom without any scroll animation
            requestAnimationFrame(() => {
              if (flatListRef.current && cachedMessages.length > 0) {
                flatListRef.current.scrollToEnd({ animated: false });
              }
              isAtBottomRef.current = true;
            });
          }

          try {
            const { messages: initial, lastSnapshot } = await fetchLatestMessagesPage(chatId, 20);
            oldestSnapRef.current = lastSnapshot;
            lastLengthRef.current = initial.length;
            setMessages(initial as any);
            setIsReady(true);
            noMoreOlderRef.current = !lastSnapshot || initial.length < 20;

            // ========== SAVE TO CACHE ==========
            await saveMessagesToCache(chatId, initial as any);

            // ========== FETCH PROFILES FOR INITIAL MESSAGES ==========
            const senderIds = Array.from(new Set(initial.map((m: any) => m.senderId)));
            const missing = senderIds.filter((id) => !profiles[id]);
            if (missing.length > 0) {
              try {
                const batch = await batchFetchProfiles(missing);
                const validatedBatch: Record<string, Profile> = {};
                Object.entries(batch).forEach(([uid, data]: [string, any]) => {
                  validatedBatch[uid] = {
                    uid,
                    username: data?.username || 'User',
                    photo: data?.photo || data?.photoURL || undefined,
                    photoURL: data?.photoURL || data?.photo || undefined,
                  };
                });
                setProfiles((prev) => ({ ...prev, ...validatedBatch }));
              } catch (err) {
                console.error('Error fetching profiles for initial messages:', err);
              }
            }

            // Instantly appear at bottom without any scroll animation
            requestAnimationFrame(() => {
              if (flatListRef.current && initial.length > 0) {
                flatListRef.current.scrollToEnd({ animated: false });
              }
              isAtBottomRef.current = true;
            });
          } catch {}

          // Listen to latest messages
          unsubLatestRef.current = listenToLatestMessages(
            chatId,
            20,
            async (latest) => {
              // Remove any pending messages when real messages arrive
              setMessages((prev) => {
                const nonPending = prev.filter((m) => !m.isPending);
                return latest as any;
              });
              markChatRead(chatId);

              // ========== UPDATE CACHE WITH NEW MESSAGES ==========
              saveMessagesToCache(chatId, latest as any);

              // ========== FETCH PROFILES IMMEDIATELY ==========
              const senderIds = Array.from(new Set(latest.map((m: any) => m.senderId)));
              const missing = senderIds.filter((id) => !profiles[id]);
              if (missing.length > 0) {
                try {
                  const batch = await batchFetchProfiles(missing);
                  const validatedBatch: Record<string, Profile> = {};
                  Object.entries(batch).forEach(([uid, data]: [string, any]) => {
                    validatedBatch[uid] = {
                      uid,
                      username: data?.username || 'User',
                      photo: data?.photo || data?.photoURL || undefined,
                      photoURL: data?.photoURL || data?.photo || undefined,
                    };
                  });
                  setProfiles((prev) => ({ ...prev, ...validatedBatch }));
                } catch (err) {
                  console.error('Error fetching profiles in listener:', err);
                }
              }

              if (latest.length > lastLengthRef.current) {
                // Only auto-scroll if user is at bottom
                if (isAtBottomRef.current) {
                  setTimeout(() => {
                    if (flatListRef.current && latest.length > 0) {
                      flatListRef.current.scrollToEnd({ animated: true });
                    }
                  }, 60);
                }
              }

              lastLengthRef.current = latest.length;
            },
            () => {
              Alert.alert('Access Denied', 'You can no longer view this chat.', [
                { text: 'OK', onPress: exitChat },
              ]);
            }
          );
        };

        setupMessages();
      },
      () => {
        Alert.alert('Error', 'Unable to access chat.', [
          { text: 'OK', onPress: exitChat },
        ]);
      }
    );

    return () => {
      if (unsubLatestRef.current) {
        unsubLatestRef.current();
        unsubLatestRef.current = undefined;
      }
      hasSetupRef.current = false;
      unsubAccess();
    };
  }, [chatId, exitChat]);

  // ========== LOAD OLDER MESSAGES ==========
  const loadOlderMessages = useCallback(async () => {
    if (isLoadingOlder || noMoreOlderRef.current || !oldestSnapRef.current) return;

    setIsLoadingOlder(true);
    isLoadingOlderRef.current = true;
    
    // Mark that we're not at bottom to prevent auto-scroll during prepend
    isAtBottomRef.current = false;

    // Capture current scroll metrics BEFORE data changes (fallback anchor)
    const prevHeight = contentHeightRef.current;
    
    try {
      const { messages: older, lastSnapshot } = await fetchOlderMessagesPage(
        chatId,
        oldestSnapRef.current,
        20
      );

      if (older.length) {
        oldestSnapRef.current = lastSnapshot || oldestSnapRef.current;
        
        setMessages((prev) => {
          const map = new Map<string, Message>();
          [...older, ...prev].forEach((m: any) => map.set(m.id, m));
          return Array.from(map.values()) as any;
        });

        // If native maintain isn't used, remember prev height to restore manually
        if (!USE_NATIVE_MAINTAIN) {
          pendingAddedRestoreRef.current = {
            prevHeight,
          };
        }
      } else {
        noMoreOlderRef.current = true;
      }
    } catch {}
    
    // Small delay to ensure smooth rendering before resetting flag
    setTimeout(() => {
      setIsLoadingOlder(false);
      isLoadingOlderRef.current = false;
    }, 150);
  }, [isLoadingOlder, chatId]);

  const handleScroll = useCallback(
    (e: any) => {
      const y = e?.nativeEvent?.contentOffset?.y || 0;
      const layoutHeight = e?.nativeEvent?.layoutMeasurement?.height || 0;
      const contentHeight = e?.nativeEvent?.contentSize?.height || 0;
      
      // Store current scroll position and sizes
      scrollOffsetRef.current = y;
      contentHeightRef.current = contentHeight;
      layoutHeightRef.current = layoutHeight;
      
      // Load older messages when scrolling near top (increased threshold for smoother trigger)
      if (y <= 100 && !isLoadingOlder) {
        loadOlderMessages();
      }

      // Calculate distance from bottom
      const distanceFromBottom = contentHeight - layoutHeight - y;
      
      // Show scroll button if scrolled up more than 5 messages worth (~400px)
      const shouldShow = distanceFromBottom > 400;
      if (shouldShow !== showScrollButton) {
        setShowScrollButton(shouldShow);
      }

      // Track if user is at bottom (within 50px)
      isAtBottomRef.current = distanceFromBottom < 50;
    },
    [loadOlderMessages, showScrollButton, isLoadingOlder]
  );

  const handleContentSizeChange = useCallback(
    (_: number, height: number) => {
      const previousHeight = contentHeightRef.current;
      contentHeightRef.current = height;

      // Initial scroll to bottom when chat first loads; fade in only after anchored
      if (!initialScrollDoneRef.current && isReady && height > 0) {
        initialScrollDoneRef.current = true;
        requestAnimationFrame(() => {
          scrollToBottom(false);
          requestAnimationFrame(() => setAnchored(true));
        });
        return;
      }

      // If native maintain is disabled and we have a pending restore, adjust offset once
      if (!USE_NATIVE_MAINTAIN) {
        const restore = pendingAddedRestoreRef.current;
        if (restore) {
          const delta = Math.max(height - (restore.prevHeight || 0), 0);
          pendingAddedRestoreRef.current = null;

          if (delta > 0.5) {
            const currentOffset = scrollOffsetRef.current || 0;
            const targetOffset = Math.max(currentOffset + delta, 0);
            scrollOffsetRef.current = targetOffset;
            requestAnimationFrame(() => {
              flatListRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
            });
            return;
          }
        }
      }

      // Auto-scroll to bottom when new messages arrive (and user is near bottom)
      // BUT NOT when we're loading older messages
      if (isAtBottomRef.current && height > previousHeight && !isLoadingOlderRef.current) {
        requestAnimationFrame(() => scrollToBottom(true));
      }
    },
    [isReady, scrollToBottom]
  );

  // ========== FETCH PROFILES ==========
  useEffect(() => {
    const fetchProfiles = async () => {
      const uniqueIds = Array.from(new Set([
        ...messages.map((m) => m.senderId),
        ...typingUsers,
        ...chatMeta.participants,
      ]));

      if (!uniqueIds.length) return;

      const missing = uniqueIds.filter((id) => !profiles[id]);
      if (!missing.length) return;

      const batch = await batchFetchProfiles(missing);
      
      // Ensure all profiles have required fields
      const validatedBatch: Record<string, Profile> = {};
      Object.entries(batch).forEach(([uid, data]: [string, any]) => {
        validatedBatch[uid] = {
          uid,
          username: data?.username || 'User',
          photo: data?.photo || data?.photoURL || undefined,
          photoURL: data?.photoURL || data?.photo || undefined,
        };
      });
      
      setProfiles((prev) => ({ ...prev, ...validatedBatch }));
    };

    fetchProfiles();
  }, [messages, typingUsers, chatMeta.participants]);

  // Retry fetch for profiles missing a photo (handles race where initial profile exists but photo added shortly after)
  useEffect(() => {
    const missingPhotoIds = Object.entries(profiles)
      .filter(([_, p]) => !p.photo && !p.photoURL && p.uid !== 'system')
      .map(([uid]) => uid);
    if (!missingPhotoIds.length) return;
    let cancelled = false;
    (async () => {
      for (const uid of missingPhotoIds) {
        try {
          const fresh = await getCachedProfile(uid);
          if (!cancelled && fresh && (fresh.photo || fresh.photoURL)) {
            setProfiles(prev => ({
              ...prev,
              [uid]: {
                uid,
                username: fresh.username || prev[uid]?.username || 'User',
                photo: fresh.photo || fresh.photoURL,
                photoURL: fresh.photoURL || fresh.photo,
              }
            }));
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [profiles]);

  // Ensure auto-scroll for new messages even if user is near (but not exactly at) bottom (< 120px)
  useEffect(() => {
    if (!messages.length) return;
  // Removed direct contentSize access (not typed) – rely on length diff and bottom proximity flags instead
    // Fallback: if lastLengthRef smaller than current, treat as new messages
    const added = messages.length - lastLengthRef.current;
    if (added > 0) {
      // Avoid any programmatic scroll while we're loading/prepending older messages
      if (isLoadingOlderRef.current || pendingAddedRestoreRef.current) {
        lastLengthRef.current = messages.length;
        return;
      }
      // If user near bottom OR the new messages are mine, scroll
      const lastMsg = messages[messages.length - 1];
      const isMine = lastMsg.senderId === auth.currentUser?.uid;
      if (isAtBottomRef.current || isMine) {
        requestAnimationFrame(() => scrollToBottom(true));
      }
      lastLengthRef.current = messages.length;
    }
  }, [messages, scrollToBottom]);

  // ========== LISTEN TO REACTIONS ==========
  useEffect(() => {
    const limit = 60;
    const currentIds = new Set(messages.slice(-limit).map((m) => m.id));
    const myUid = auth.currentUser?.uid;

    // Add listeners for new messages
    messages.slice(-limit).forEach((m) => {
      if (!reactionUnsubsRef.current[m.id]) {
        const unsub = listenToReactions(
          chatId,
          m.id,
          (items) => {
            setReactionsMap((prev) => ({ ...prev, [m.id]: items }));
            
            // Update myReactions based on the reactions
            if (myUid) {
              const myReaction = items.find((r) => r.userId === myUid);
              setMyReactions((prev) => {
                if (myReaction?.emoji) {
                  return { ...prev, [m.id]: myReaction.emoji };
                } else {
                  const next = { ...prev };
                  delete next[m.id];
                  return next;
                }
              });
            }
          },
          () => {}
        );
        reactionUnsubsRef.current[m.id] = unsub;
      }
    });

    // Cleanup old listeners
    Object.keys(reactionUnsubsRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        reactionUnsubsRef.current[id]();
        delete reactionUnsubsRef.current[id];
        setReactionsMap((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    });
  }, [messages, chatId]);

  // ========== MESSAGE HELPERS ==========
  const getMessageClusterFlags = (index: number) => {
    const current = messages[index];
    const prev = messages[index - 1];
    const next = messages[index + 1];

    const isFirst = !prev || prev.senderId !== current.senderId;
    const isLast = !next || next.senderId !== current.senderId;

    return { isFirst, isLast };
  };

  // ========== SEND MESSAGE ==========
  const handleSend = useCallback(async () => {
    if (!auth.currentUser) return;

    // Send images with optimistic UI
    for (const uri of selectedImages) {
      // Create optimistic pending message
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const pendingMessage: Message = {
        id: tempId,
        senderId: auth.currentUser.uid,
        text: uri,
        type: 'image',
        isPending: true,
      };
      
      // Add to messages immediately
      setMessages((prev) => [...prev, pendingMessage]);
      setTimeout(() => scrollToBottom(true), 50);
      
      try {
        const imageId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const downloadUrl = await uploadChatImage(uri, auth.currentUser.uid, imageId);
        await sendMessage(chatId, auth.currentUser.uid, downloadUrl, 'image');
        
        // Remove pending message (real one will come from listener)
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      } catch (error: any) {
        // Remove pending message on error
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        Alert.alert('Upload failed', error?.message || 'Could not upload image.');
      }
    }
    setSelectedImages([]);

    // Send text with optimistic UI
    if (messageText.trim()) {
      const textToSend = messageText.trim();
      const extra: any = {};
      if (replyTo?.id) extra.replyToId = replyTo.id;
      
      // Create optimistic pending message
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const pendingMessage: Message = {
        id: tempId,
        senderId: auth.currentUser.uid,
        text: textToSend,
        type: 'text',
        isPending: true,
        replyToId: extra.replyToId,
      };
      
      // Add to messages immediately and clear input
      setMessages((prev) => [...prev, pendingMessage]);
      setReplyTo(null);
      setMessageText('');
      setTimeout(() => scrollToBottom(true), 50);

      try {
        await sendMessage(chatId, auth.currentUser.uid, textToSend, 'text', extra);
        
        // Remove pending message (real one will come from listener)
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      } catch (error) {
        // Remove pending message on error
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        console.error('Failed to send message:', error);
      }
    }
  }, [chatId, messageText, selectedImages, replyTo, scrollToBottom]);

  // ========== IMAGES ==========
  const handleCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable camera permissions.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length) {
      setSelectedImages((prev) => {
        const MAX = 3;
        if (prev.length >= MAX) {
          Alert.alert('Limit reached', 'You can only send up to 3 images.');
          return prev;
        }
        return [...prev, result.assets[0].uri].slice(0, MAX);
      });
    }
  }, []);

  const handleGallery = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable gallery permissions.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length) {
      setSelectedImages((prev) => {
        const MAX = 3;
        const remaining = MAX - prev.length;
        if (remaining <= 0) {
          Alert.alert('Limit reached', 'You can only send up to 3 images.');
          return prev;
        }
        const picked = result.assets.map((a) => a.uri).slice(0, remaining);
        return [...prev, ...picked];
      });
    }
  }, []);

  // ========== REACTIONS ==========
  const handleReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      const currentReaction = myReactions[messageId];
      
      // If clicking the same emoji, remove the reaction
      if (currentReaction === emoji) {
        await addReaction(chatId, messageId, ''); // Empty string removes reaction
        setMyReactions((prev) => {
          const next = { ...prev };
          delete next[messageId];
          return next;
        });
        setReactionsMap((prev) => {
          const arr = prev[messageId] || [];
          const me = auth.currentUser?.uid || '';
          const others = arr.filter((r) => r.userId !== me);
          return { ...prev, [messageId]: others };
        });
      } else {
        // Otherwise, add or change the reaction
        await addReaction(chatId, messageId, emoji);
        setMyReactions((prev) => ({ ...prev, [messageId]: emoji }));
        setReactionsMap((prev) => {
          const arr = prev[messageId] || [];
          const me = auth.currentUser?.uid || '';
          const others = arr.filter((r) => r.userId !== me);
          return { ...prev, [messageId]: [...others, { userId: me, emoji }] };
        });
      }
      setReactionPickerId(null);
    } catch {}
  }, [chatId, myReactions]);

  // ========== ADDITIONAL STATE FOR MODALS ==========
  const [friends, setFriends] = useState<Profile[]>([]);
  const [participants, setParticipants] = useState<Profile[]>([]);
  const [myFriendIds, setMyFriendIds] = useState<string[]>([]);
  const [myRequestsSent, setMyRequestsSent] = useState<string[]>([]);
  const [editVisible, setEditVisible] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editPhotoUri, setEditPhotoUri] = useState<string | null>(null);
  const [addUsersVisible, setAddUsersVisible] = useState(false);
  const [addingUsersMap, setAddingUsersMap] = useState<Record<string, boolean>>({});
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteSelection, setInviteSelection] = useState<Record<string, boolean>>({});
  const [selectedInvitee, setSelectedInvitee] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [dmOptionsModalVisible, setDmOptionsModalVisible] = useState(false);

  // ========== LOAD PARTICIPANTS ==========
  useEffect(() => {
    const loadParticipants = async () => {
      if (!chatMeta.participants.length) {
        setParticipants([]);
        return;
      }

      const rows: Profile[] = [];
      for (let i = 0; i < chatMeta.participants.length; i += 10) {
        const ids = chatMeta.participants.slice(i, i + 10);
        const q = query(collection(db, 'profiles'), where('__name__', 'in', ids));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const data = d.data();
          rows.push({
            uid: d.id,
            username: data.username || 'User',
            photo: data.photo || data.photoURL,
          });
        });
      }
      rows.sort((a, b) => a.username.localeCompare(b.username));
      setParticipants(rows);
    };

    loadParticipants();
  }, [chatMeta.participants]);

  // ========== LOAD FRIENDS ==========
  useEffect(() => {
    const loadFriends = async () => {
      const me = auth.currentUser?.uid;
      if (!me) return;

      const meDoc = await getDoc(doc(db, 'profiles', me));
      if (!meDoc.exists()) {
        setFriends([]);
        return;
      }

      const data = meDoc.data();
      const friendIds: string[] = Array.isArray(data?.friends) ? data.friends : [];

      if (!friendIds.length) {
        setFriends([]);
        return;
      }

      const rows: Profile[] = [];
      for (let i = 0; i < friendIds.length; i += 10) {
        const ids = friendIds.slice(i, i + 10);
        const q = query(collection(db, 'profiles'), where('__name__', 'in', ids));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const data = d.data();
          rows.push({
            uid: d.id,
            username: data.username || 'User',
            photo: data.photo || data.photoURL,
          });
        });
      }
      rows.sort((a, b) => a.username.localeCompare(b.username));
      setFriends(rows);
    };

    loadFriends();
  }, []);

  // ========== LIVE FRIEND STATE ==========
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;

    const unsub = onSnapshot(
      doc(db, 'profiles', me),
      (snap) => {
        if (!snap.exists()) {
          setMyFriendIds([]);
          setMyRequestsSent([]);
          return;
        }

        const data = snap.data();
        setMyFriendIds(Array.isArray(data?.friends) ? data.friends : []);
        setMyRequestsSent(Array.isArray(data?.requestsSent) ? data.requestsSent : []);
      },
      () => {
        setMyFriendIds([]);
        setMyRequestsSent([]);
      }
    );

    return () => unsub();
  }, []);

  // ========== FRIEND ACTIONS ==========
  const handleAddFriend = useCallback(async (uid: string) => {
    try {
      setMyRequestsSent((prev) => [...prev, uid]);
      await sendFriendRequest(uid);
      showToast('Friend request sent');
    } catch (error: any) {
      setMyRequestsSent((prev) => prev.filter((id) => id !== uid));
      Alert.alert('Failed', error?.message || 'Could not send request.');
    }
  }, [showToast]);

  const handleCancelRequest = useCallback(async (uid: string) => {
    try {
      setMyRequestsSent((prev) => prev.filter((id) => id !== uid));
      await cancelFriendRequest(uid);
      showToast('Request canceled');
    } catch (error: any) {
      Alert.alert('Failed', error?.message || 'Could not cancel request.');
    }
  }, [showToast]);

  // ========== MESSAGE USER ==========
  const handleMessageUser = useCallback(async (uid: string) => {
    const me = auth.currentUser?.uid;
    if (!me || uid === me) return;

    try {
      const dmId = await ensureDmChat(uid);
      setTimeout(() => {
        navigation.navigate('ChatDetail', { chatId: dmId });
      }, 60);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not open chat.');
    }
  }, [navigation]);

  // ========== GROUP ACTIONS ==========
  const handleEditGroup = useCallback(async () => {
    if (!chatMeta.groupMeta) return;
    
    setBusy(true);
    try {
      const updates: any = {};
      const newTitle = editTitle.trim().slice(0, 25);
      
      if (newTitle && newTitle !== chatMeta.groupMeta.title) {
        updates.title = newTitle;
      }

      if (editPhotoUri) {
        const uploaded = await uploadChatImage(
          editPhotoUri,
          auth.currentUser?.uid || 'unknown',
          `group_${chatId}`
        );
        updates.photoUrl = uploaded;
      }

      if (Object.keys(updates).length) {
        await updateDoc(doc(db, 'chats', chatId), updates);
        setChatMeta((prev) => ({
          ...prev,
          groupMeta: {
            title: updates.title || prev.groupMeta?.title || 'Group Chat',
            photoUrl: updates.photoUrl || prev.groupMeta?.photoUrl,
          },
        }));
      }

      setEditVisible(false);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not update group.');
    } finally {
      setBusy(false);
    }
  }, [chatMeta, editTitle, editPhotoUri, chatId]);

  const handleAddUsers = useCallback(async () => {
    const selected = Object.keys(addingUsersMap).filter((k) => addingUsersMap[k]);
    if (!selected.length) {
      setAddUsersVisible(false);
      return;
    }

    setBusy(true);
    try {
      const toAdd = selected.filter((uid) => !chatMeta.participants.includes(uid));
      
      if (toAdd.length) {
        await updateDoc(doc(db, 'chats', chatId), {
          participants: arrayUnion(...toAdd),
        });

        // System message
        const me = auth.currentUser?.uid;
        if (me && toAdd.length > 0) {
          const myProfile = await getDoc(doc(db, 'profiles', me));
          const myName = myProfile.exists() 
            ? myProfile.data().username || 'Someone' 
            : 'Someone';

          const addedNames = await Promise.all(
            toAdd.map(async (uid) => {
              const p = await getDoc(doc(db, 'profiles', uid));
              return p.exists() ? p.data().username || 'User' : 'User';
            })
          );

          await addSystemMessage(chatId, `${myName} added ${addedNames.join(', ')}`);
        }

        setChatMeta((prev) => ({
          ...prev,
          participants: [...prev.participants, ...toAdd],
        }));
      }

      setAddUsersVisible(false);
      setAddingUsersMap({});
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not add users.');
    } finally {
      setBusy(false);
    }
  }, [addingUsersMap, chatMeta, chatId]);

  const handleLeaveGroup = useCallback(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;

    Alert.alert(
      'Leave group',
      'Are you sure you want to leave this group?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              const myProfile = await getDoc(doc(db, 'profiles', me));
              const myName = myProfile.exists()
                ? myProfile.data().username || 'Someone'
                : 'Someone';

              await addSystemMessage(chatId, `${myName} left this group chat`);
              await leaveChatWithAutoDelete(chatId, me);
              exitChat();
            } catch {}
          },
        },
      ]
    );
  }, [chatId]);

  const handleMuteToggle = useCallback(async () => {
    setOptionsVisible(false);
    try {
      if (isMuted) {
        await unmuteChat(chatId);
        setIsMuted(false);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('Chat unmuted');
      } else {
        await muteChat(chatId);
        setIsMuted(true);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('Chat muted');
      }
    } catch (error) {
      console.error('Error toggling mute:', error);
      Alert.alert('Error', 'Failed to update mute settings');
    }
  }, [chatId, isMuted, showToast]);

  // ========== INVITE TO ACTIVITIES ==========
  const handleSendInvites = useCallback(async () => {
    const targetUser = selectedInvitee || chatMeta.dmPeer;
    if (!targetUser) return;

    const selectedIds = Object.keys(inviteSelection).filter((id) => inviteSelection[id]);
    if (!selectedIds.length) {
      setInviteModalVisible(false);
      setSelectedInvitee(null);
      return;
    }

    // Filter out activities user already joined
    const eligible = selectedIds.filter((id) => {
      const act = allActivities?.find((a: any) => a.id === id);
      const joinedIds = act?.joinedUserIds || [];
      return !joinedIds.includes(targetUser.uid);
    });

    if (!eligible.length) {
      showToast(`${targetUser.username} is already in those activities`);
      return;
    }

    try {
      const { sentIds } = await sendActivityInvites(targetUser.uid, eligible);
      showToast(sentIds.length === 1 ? 'Invite sent' : `Sent ${sentIds.length} invites`);
    } catch {
      showToast('Could not send invites');
    }

    setInviteModalVisible(false);
    setSelectedInvitee(null);
    setInviteSelection({});
  }, [selectedInvitee, chatMeta, inviteSelection, allActivities, showToast]);

  // Upcoming activities
  const myJoinedActivities = useMemo(() => {
    return (allActivities || []).filter((a: any) => 
      (joinedActivities || []).includes(a.id)
    );
  }, [allActivities, joinedActivities]);

  const isActivityUpcoming = useCallback((a: any) => {
    try {
      const [dd, mm, yyyy] = (a?.date || '').split('-');
      const [hh, min] = (a?.time || '00:00').split(':');
      const start = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      return end.getTime() > Date.now();
    } catch {
      return true;
    }
  }, []);

  const myJoinedActivitiesUpcoming = useMemo(() => {
    return myJoinedActivities.filter(isActivityUpcoming);
  }, [myJoinedActivities, isActivityUpcoming]);

  // ========== PICK EDIT PHOTO ==========
  const handlePickEditPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length) {
      setEditPhotoUri(result.assets[0].uri);
    }
  }, []);

  // ========== READ RECEIPTS HELPER ==========
  const getReadReceipts = useCallback((message: Message, isOwn: boolean, messageIndex: number) => {
    if (!message.timestamp) return null;

    const msgMs = message.timestamp.toMillis 
      ? message.timestamp.toMillis() 
      : message.timestamp.seconds * 1000;

    // DM: Show "Read" if peer has read this message (only show on my messages)
    if (chatMeta.isDm && chatMeta.dmPeer) {
      if (!isOwn) return null; // Only show on my messages
      
      const peerRead = chatReads[chatMeta.dmPeer.uid];
      const peerMs = peerRead?.toMillis 
        ? peerRead.toMillis() 
        : peerRead?.seconds ? peerRead.seconds * 1000 : 0;

      if (peerMs >= msgMs) {
        return (
          <View style={styles.readReceipts}>
            <Ionicons name="checkmark-done" size={14} color={theme.primary} />
            <Text style={styles.readText}>Read</Text>
          </View>
        );
      }
      return null;
    }

    // Group: Show avatars of readers whose last read message is THIS message
    if (!chatMeta.isDm) {
      const readersAtThisMessage = participants.filter((p) => {
        if (p.uid === auth.currentUser?.uid) return false;
        
        const read = chatReads[p.uid];
        const readMs = read?.toMillis ? read.toMillis() : read?.seconds ? read.seconds * 1000 : 0;
        
        if (readMs < msgMs) return false; // Haven't read this message yet
        
        // Check if this is the last message they've read
        // (i.e., they haven't read the next message)
        const nextMessage = messages[messageIndex + 1];
        if (!nextMessage) {
          // This is the last message overall
          return readMs >= msgMs;
        }
        
        const nextMs = nextMessage.timestamp?.toMillis 
          ? nextMessage.timestamp.toMillis() 
          : nextMessage.timestamp?.seconds ? nextMessage.timestamp.seconds * 1000 : 0;
        
        // They've read this message but not the next one
        return readMs >= msgMs && readMs < nextMs;
      });

      if (readersAtThisMessage.length) {
        const shown = readersAtThisMessage.slice(0, 5);
        const extra = readersAtThisMessage.length - shown.length;

        return (
          <View style={styles.readReceipts}>
            {shown.map((p) => (
              <UserAvatar
                key={p.uid}
                photoUrl={p.photo || p.photoURL}
                username={p.username || 'User'}
                style={styles.readAvatar}
              />
            ))}
            {extra > 0 && <Text style={styles.readText}>+{extra}</Text>}
          </View>
        );
      }
    }

    return null;
  }, [chatMeta, chatReads, participants, theme, messages]);

  // ========== RENDER MESSAGE ==========
  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const { isFirst, isLast } = getMessageClusterFlags(index);
    const isOwn = item.senderId === auth.currentUser?.uid;
    
    // Check if sender is blocked
    const isSenderBlocked = isUserBlockedById(item.senderId);
    
    // Ensure sender has all required fields with fallbacks
    const senderProfile = profiles[item.senderId];
    const sender: Profile = {
      uid: item.senderId,
      // Show "Blocked User" for blocked users (but not for own messages)
      username: isSenderBlocked && !isOwn ? 'Blocked User' : (senderProfile?.username || 'User'),
      // Hide photo for blocked users
      photo: isSenderBlocked && !isOwn ? undefined : (senderProfile?.photo || senderProfile?.photoURL),
      photoURL: isSenderBlocked && !isOwn ? undefined : (senderProfile?.photoURL || senderProfile?.photo),
    };
    
    const replyToMessage = item.replyToId 
      ? messages.find((m) => m.id === item.replyToId) 
      : undefined;
    const replySender = replyToMessage 
      ? profiles[replyToMessage.senderId] 
      : undefined;
    
    // Check if reply sender is blocked
    const isReplySenderBlocked = replyToMessage ? isUserBlockedById(replyToMessage.senderId) : false;
    const maskedReplySender = replySender && isReplySenderBlocked 
      ? { ...replySender, username: 'Blocked User', photo: undefined, photoURL: undefined }
      : replySender;

    const readReceipts = getReadReceipts(item, isOwn, index);

    // Determine if we should show read receipts
    const isLastMessageOverall = index === messages.length - 1;
    let shouldShowReadReceipts = false;

    if (chatMeta.isDm) {
      // DM: Show only on the last message sent by me
      if (isOwn) {
        // Find if this is the last message from me
        const myMessages = messages.filter(m => m.senderId === auth.currentUser?.uid);
        const lastMyMessage = myMessages[myMessages.length - 1];
        shouldShowReadReceipts = lastMyMessage?.id === item.id;
      }
    } else {
      // Group/Activity: Show on each message where users have read up to
      // We need to check if any user's last read message is this one
      shouldShowReadReceipts = readReceipts !== null;
    }

    return (
      <View>
        <MessageBubble
          message={item}
          isOwn={isOwn}
          isFirst={isFirst}
          isLast={isLast}
          sender={sender}
          replyToMessage={replyToMessage}
          replySender={maskedReplySender}
          reactions={reactionsMap[item.id] || []}
          myReaction={myReactions[item.id]}
          showReactionPicker={reactionPickerId === item.id}
          onLongPress={async () => {
            // Refresh profile if missing photo or has generic username (skip for blocked users)
            if (item.senderId && !isSenderBlocked && (!sender.photo || sender.username === 'User')) {
              try {
                const fresh = await getCachedProfile(item.senderId);
                if (fresh && (fresh.photo || fresh.photoURL)) {
                  setProfiles(prev => ({
                    ...prev,
                    [item.senderId]: {
                      uid: item.senderId,
                      username: fresh.username || sender.username,
                      photo: fresh.photo || fresh.photoURL,
                      photoURL: fresh.photoURL || fresh.photo,
                    }
                  }));
                }
              } catch {}
            }
            setReactionPickerId((prev) => (prev === item.id ? null : item.id));
            // Reset spotlight layout when opening picker
            // Spotlight layout removed
          }}
          onSwipeReply={() => {
            setReplyTo(item);
            setReactionPickerId(null);
            // Spotlight layout removed
          }}
          onReact={(emoji) => handleReaction(item.id, emoji)}
          onCopy={async () => {
            try {
              await Clipboard.setStringAsync(item.text);
              showToast('Copied');
            } catch {}
            setReactionPickerId(null);
            // Spotlight layout removed
          }}
          onImagePress={() => setViewerUri(item.text)}
          onUserPress={(uid) => {
            // Don't navigate to blocked user's profile
            if (isUserBlockedById(uid)) return;
            navigation.navigate('UserProfile', { userId: uid });
          }}
          onClosePicker={() => setReactionPickerId(null)}
          onReactionsPress={() => {
            setSelectedMessageReactions(reactionsMap[item.id] || []);
            setReactionsModalVisible(true);
          }}
          // onBubbleMeasured removed (no spotlight)
          theme={theme}
          styles={styles}
        />
        {readReceipts && shouldShowReadReceipts && (
          <View style={[
            styles.readReceiptsContainer,
            { 
              alignSelf: isOwn ? 'flex-end' : 'flex-start',
              paddingHorizontal: 10, 
              marginTop: 4,
              marginRight: isOwn ? 10 : 0,
              marginLeft: isOwn ? 0 : 46,
            }
          ]}>
            {readReceipts}
          </View>
        )}
      </View>
    );
  }, [
    messages,
    profiles,
    reactionsMap,
    myReactions,
    reactionPickerId,
    handleReaction,
    showToast,
    theme,
    navigation,
    getReadReceipts,
    chatMeta,
  ]);

  // ========== HEADER ==========
  const renderHeader = () => {
    if (chatMeta.isDm && chatMeta.dmPeer) {
      const isFriend = myFriendIds.includes(chatMeta.dmPeer.uid);
      const isRequested = myRequestsSent.includes(chatMeta.dmPeer.uid);
      const isPeerBlocked = isUserBlockedById(chatMeta.dmPeer.uid);
      // Combined: any block relationship (we blocked them OR they blocked us)
      const hasBlockRelationship = isPeerBlocked || isBlockedByPeer;

      return (
        <>
          <TouchableOpacity 
            onPress={() => navigation.navigate('UserProfile', { userId: chatMeta.dmPeer!.uid })}
            activeOpacity={0.8}
          >
            {hasBlockRelationship ? (
              <View style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: theme.muted,
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <Ionicons name="ban" size={18} color={theme.text} />
              </View>
            ) : (
              <UserAvatar
                photoUrl={chatMeta.dmPeer.photo || chatMeta.dmPeer.photoURL}
                username={chatMeta.dmPeer.username}
                size={38}
                style={styles.headerImage}
              />
            )}
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <TouchableOpacity 
              onPress={() => navigation.navigate('UserProfile', { userId: chatMeta.dmPeer!.uid })}
              activeOpacity={0.7}
            >
              {hasBlockRelationship ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.headerTitle, { color: theme.muted }]} numberOfLines={1}>Blocked User</Text>
                  <View style={{ backgroundColor: `${theme.danger}20`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: theme.danger }}>BLOCKED</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {chatMeta.dmPeer.username}
                </Text>
              )}
            </TouchableOpacity>
          </View>
          {/* Three-dot menu for DM options */}
          <TouchableOpacity
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.card,
              justifyContent: 'center',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: theme.border,
            }}
            onPress={() => setDmOptionsModalVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="ellipsis-vertical" size={18} color={theme.text} />
          </TouchableOpacity>
        </>
      );
    }

    if (chatMeta.isActivity && chatMeta.activityInfo) {
      return (
        <>
          <TouchableOpacity 
            style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
            onPress={() => {
              if (chatMeta.activityId) {
                navigation.navigate('ActivityDetails', { activityId: chatMeta.activityId });
              }
            }}
            activeOpacity={0.7}
          >
            <View style={styles.headerIconCircle}>
              {chatMeta.activityInfo.type && (
                <ActivityIcon activity={chatMeta.activityInfo.type} size={22} color={theme.primary} />
              )}
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.headerTitle}>
                {chatMeta.activityInfo.name}
              </Text>
              {chatMeta.activityInfo.date && chatMeta.activityInfo.time && (
                <Text style={styles.headerSubtitle}>
                  {normalizeDateFormat(chatMeta.activityInfo.date)} at {chatMeta.activityInfo.time}
                </Text>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setOptionsVisible(true)} style={styles.headerButton}>
            <Ionicons name="information-circle-outline" size={26} color={theme.primary} />
          </TouchableOpacity>
        </>
      );
    }

    if (chatMeta.isGroup && chatMeta.groupMeta) {
      return (
        <>
          {chatMeta.groupMeta.photoUrl ? (
            <Image source={{ uri: chatMeta.groupMeta.photoUrl }} style={styles.headerImage} cachePolicy="memory-disk" />
          ) : (
            <View style={[styles.headerImage, styles.headerIconCircle]}>
              <Ionicons name="people" size={22} color={theme.primary} />
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.headerTitle}>{chatMeta.groupMeta.title}</Text>
          </View>
          <TouchableOpacity onPress={() => setOptionsVisible(true)} style={styles.headerButton}>
            <Ionicons name="information-circle-outline" size={26} color={theme.primary} />
          </TouchableOpacity>
        </>
      );
    }

    return null;
  };

  // ========== RENDER ==========
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={exitChat} style={styles.headerButton}>
              <Ionicons name="arrow-back" size={26} color={theme.primary} />
            </TouchableOpacity>
            {renderHeader()}
          </View>


          {/* Messages */}
          {!isReady ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : (
            <Animated.View style={{ flex: 1, opacity: anchored ? fadeAnim : 0 }}>
              {/* Blur spotlight removed */}
              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => item.id}
                renderItem={renderMessage}
                contentContainerStyle={styles.messageList}
                nestedScrollEnabled
                onLayout={(e) => {
                  const h = e?.nativeEvent?.layout?.height || 0;
                  if (h > 0) layoutHeightRef.current = h;
                }}
                onScroll={handleScroll}
                onContentSizeChange={handleContentSizeChange}
                onScrollBeginDrag={() => setReactionPickerId(null)}
                maintainVisibleContentPosition={USE_NATIVE_MAINTAIN ? { minIndexForVisible: 1 } : undefined}
                scrollEventThrottle={32}
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={15}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews={Platform.OS === 'android'}
                ListHeaderComponent={() => (
                  <View style={{ height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    {isLoadingOlder && (
                      <>
                        <ActivityIndicator size="small" color={theme.primary} />
                        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 6 }}>
                          Loading older messages...
                        </Text>
                      </>
                    )}
                  </View>
                )}
                ListEmptyComponent={() => (
                  <View style={{ 
                    flex: 1, 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    paddingHorizontal: 40,
                    paddingVertical: 60,
                  }}>
                    <View style={{ 
                      width: 80, 
                      height: 80, 
                      borderRadius: 40, 
                      backgroundColor: theme.card,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 20,
                      borderWidth: 2,
                      borderColor: theme.primary,
                    }}>
                      {chatMeta.isActivity && chatMeta.activityInfo?.type ? (
                        <ActivityIcon 
                          activity={chatMeta.activityInfo.type} 
                          size={36} 
                          color={theme.primary} 
                        />
                      ) : (
                        <Ionicons 
                          name={chatMeta.isDm ? "chatbubbles" : "people"} 
                          size={36} 
                          color={theme.primary} 
                        />
                      )}
                    </View>
                    <Text style={{ 
                      fontSize: 20, 
                      fontWeight: 'bold', 
                      color: theme.text, 
                      textAlign: 'center',
                      marginBottom: 8,
                    }}>
                      {chatMeta.isDm 
                        ? `Start chatting with ${chatMeta.dmPeer?.username || 'this user'}` 
                        : chatMeta.isActivity 
                        ? 'Welcome to the activity chat!' 
                        : 'Welcome to the group!'}
                    </Text>
                    <Text style={{ 
                      fontSize: 15, 
                      color: theme.muted, 
                      textAlign: 'center',
                      lineHeight: 22,
                    }}>
                      {chatMeta.isDm 
                        ? 'Send a message to start the conversation' 
                        : chatMeta.isActivity 
                        ? `This is the group chat for ${chatMeta.activityInfo?.name || 'this activity'}. Share updates, coordinate plans, or just chat!`
                        : 'This is the beginning of your group chat. Share your thoughts!'}
                    </Text>
                  </View>
                )}
              />
            </Animated.View>
          )}

          {/* Typing indicator */}
          {typingUsers.length > 0 && (
            <View style={styles.typingContainer}>
              <TypingDots />
              <Text style={styles.typingText}>
                {(() => {
                  const names = typingUsers
                    .map((uid) => isUserBlockedById(uid) ? 'Blocked User' : profiles[uid]?.username)
                    .filter(Boolean);
                  if (!names.length) return 'Typing…';
                  if (names.length === 1) return `${names[0]} is typing…`;
                  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
                  return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing…`;
                })()}
              </Text>
            </View>
          )}

          {/* Reply bar */}
          {replyTo && (
            <View style={styles.replyBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.replyBarLabel}>Replying to</Text>
                <Text style={styles.replyBarText} numberOfLines={1}>
                  {isUserBlockedById(replyTo.senderId) ? 'Blocked User' : (profiles[replyTo.senderId]?.username || 'User')}: {
                    replyTo.type === 'text' 
                      ? replyTo.text 
                      : replyTo.type === 'image' 
                      ? 'Photo' 
                      : 'Voice message'
                  }
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyTo(null)} style={{ padding: 6 }}>
                <Ionicons name="close" size={18} color={theme.text} />
              </TouchableOpacity>
            </View>
          )}

          {/* Input - Block DMs with blocked users (both directions), but allow group chat messaging */}
          {isDmBlocked && chatMeta.isDm ? (
            <View style={[styles.inputContainer, { paddingBottom: insets.bottom, justifyContent: 'center' }]}>
              <Text style={{ color: theme.muted, textAlign: 'center', flex: 1 }}>
                {isBlockedByPeer && !isOtherUserBlocked 
                  ? 'This user has blocked you' 
                  : 'You have blocked this user'}
              </Text>
            </View>
          ) : (
          <View style={[styles.inputContainer, { paddingBottom: insets.bottom }]}>
            <TouchableOpacity style={styles.inputButton} onPress={handleCamera}>
              <Ionicons name="camera" size={22} color={theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputButton} onPress={handleGallery}>
              <Ionicons name="image" size={22} color={theme.primary} />
            </TouchableOpacity>
            
            <TextInput
              style={styles.inputText}
              placeholder="Message..."
              placeholderTextColor={theme.muted}
              value={messageText}
              onChangeText={(text) => {
                setMessageText(text);
                pingTyping(chatId);
              }}
              autoCapitalize="sentences"
              autoCorrect
              returnKeyType="send"
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
              <Ionicons name="send" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          )}

          {/* Selected images */}
          {selectedImages.length > 0 && (
            <View style={styles.selectedImagesContainer}>
              {selectedImages.map((uri) => (
                <View key={uri} style={{ marginRight: 6 }}>
                  <Image source={{ uri }} style={styles.selectedImage} cachePolicy="memory-disk" />
                  <TouchableOpacity
                    onPress={() => setSelectedImages((prev) => prev.filter((u) => u !== uri))}
                    style={styles.removeImageButton}
                  >
                    <Text style={styles.removeImageText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Image viewer */}
          {viewerUri && (
            <View style={styles.imageViewer}>
              <SafeAreaView style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                  <TouchableOpacity onPress={() => setViewerUri(null)} style={styles.headerButton}>
                    <Ionicons name="arrow-back" size={26} color={theme.primary} />
                  </TouchableOpacity>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Image 
                    source={{ uri: viewerUri }} 
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="contain"
                  />
                </View>
              </SafeAreaView>
            </View>
          )}

          {/* Options Menu */}
          <Modal visible={optionsVisible} transparent animationType="fade" onRequestClose={() => setOptionsVisible(false)}>
            <View style={styles.modalOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setOptionsVisible(false)} />
              <View style={styles.optionsPanel} pointerEvents="auto">
                <View style={styles.optionsPanelHeader}>
                  <View style={styles.optionsHeaderIconContainer}>
                    <Ionicons
                      name={chatMeta.isGroup ? "people" : chatMeta.isActivity ? "football" : "chatbubbles"}
                      size={24}
                      color={theme.primary}
                    />
                  </View>
                  <View style={styles.optionsHeaderText}>
                    <Text style={styles.optionsHeaderTitle}>
                      {chatMeta.isGroup ? 'Group Chat' : chatMeta.isActivity ? 'Activity Chat' : 'Options'}
                    </Text>
                    <Text style={styles.optionsHeaderSubtitle}>
                      {participants.length} {participants.length === 1 ? 'participant' : 'participants'}
                    </Text>
                  </View>
                </View>

                <View style={styles.optionsList}>
                  {chatMeta.isGroup ? (
                    <>
                      <TouchableOpacity
                        style={styles.optionItem}
                        onPress={() => {
                          setEditTitle(chatMeta.groupMeta?.title || '');
                          setEditPhotoUri(null);
                          setEditVisible(true);
                          setOptionsVisible(false);
                        }}
                      >
                        <View style={styles.optionIconCircle}>
                          <Ionicons name="create-outline" size={20} color={theme.primary} />
                        </View>
                        <Text style={styles.optionItemText}>Edit Group</Text>
                        <Ionicons name="chevron-forward" size={18} color={theme.muted} style={{ marginLeft: 'auto' }} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.optionItem}
                        onPress={() => {
                          setAddUsersVisible(true);
                          setOptionsVisible(false);
                        }}
                      >
                        <View style={styles.optionIconCircle}>
                          <Ionicons name="person-add-outline" size={20} color={theme.primary} />
                        </View>
                        <Text style={styles.optionItemText}>Add Users</Text>
                        <Ionicons name="chevron-forward" size={18} color={theme.muted} style={{ marginLeft: 'auto' }} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.optionItem}
                        onPress={() => {
                          setParticipantsVisible(true);
                          setOptionsVisible(false);
                        }}
                      >
                        <View style={styles.optionIconCircle}>
                          <Ionicons name="people-outline" size={20} color={theme.primary} />
                        </View>
                        <Text style={styles.optionItemText}>View Participants</Text>
                        <Ionicons name="chevron-forward" size={18} color={theme.muted} style={{ marginLeft: 'auto' }} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.optionItem}
                        onPress={handleMuteToggle}
                      >
                        <View style={styles.optionIconCircle}>
                          <Ionicons 
                            name={isMuted ? "notifications" : "notifications-off-outline"} 
                            size={20} 
                            color={theme.primary} 
                          />
                        </View>
                        <Text style={styles.optionItemText}>
                          {isMuted ? 'Unmute' : 'Mute'}
                        </Text>
                        <Ionicons name="chevron-forward" size={18} color={theme.muted} style={{ marginLeft: 'auto' }} />
                      </TouchableOpacity>

                      <View style={styles.optionsDivider} />

                      <TouchableOpacity
                        style={styles.optionItem}
                        onPress={() => {
                          setOptionsVisible(false);
                          Alert.alert(
                            'Report',
                            'Why are you reporting this group chat?',
                            [
                              { text: 'Inappropriate content', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
                              { text: 'Spam or harassment', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
                              { text: 'Suspicious activity', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
                              { text: 'Cancel', style: 'cancel' },
                            ]
                          );
                        }}
                      >
                        <View style={[styles.optionIconCircle, { backgroundColor: '#331111' }]}>
                          <Ionicons name="flag-outline" size={20} color="#ff4d4f" />
                        </View>
                        <Text style={[styles.optionItemText, { color: '#ff4d4f' }]}>Report</Text>
                      </TouchableOpacity>

                      <View style={styles.optionsDivider} />

                      <TouchableOpacity
                        style={styles.optionItemDanger}
                        onPress={() => {
                          setOptionsVisible(false);
                          handleLeaveGroup();
                        }}
                      >
                        <View style={[styles.optionIconCircle, { backgroundColor: '#331111' }]}>
                          <Ionicons name="exit-outline" size={20} color="#ff4d4f" />
                        </View>
                        <Text style={styles.optionItemDangerText}>Leave Group</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.optionItem}
                        onPress={() => {
                          setParticipantsVisible(true);
                          setOptionsVisible(false);
                        }}
                      >
                        <View style={styles.optionIconCircle}>
                          <Ionicons name="people-outline" size={20} color={theme.primary} />
                        </View>
                        <Text style={styles.optionItemText}>View Participants</Text>
                        <Ionicons name="chevron-forward" size={18} color={theme.muted} style={{ marginLeft: 'auto' }} />
                      </TouchableOpacity>

                      {chatMeta.activityId && (
                        <TouchableOpacity
                          style={styles.optionItem}
                          onPress={() => {
                            setOptionsVisible(false);
                            navigation.navigate('ActivityDetails' as any, { activityId: chatMeta.activityId });
                          }}
                        >
                          <View style={styles.optionIconCircle}>
                            <Ionicons name="information-circle-outline" size={20} color={theme.primary} />
                          </View>
                          <Text style={styles.optionItemText}>Activity Details</Text>
                          <Ionicons name="chevron-forward" size={18} color={theme.muted} style={{ marginLeft: 'auto' }} />
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        style={styles.optionItem}
                        onPress={handleMuteToggle}
                      >
                        <View style={styles.optionIconCircle}>
                          <Ionicons 
                            name={isMuted ? "notifications" : "notifications-off-outline"} 
                            size={20} 
                            color={theme.primary} 
                          />
                        </View>
                        <Text style={styles.optionItemText}>
                          {isMuted ? 'Unmute' : 'Mute'}
                        </Text>
                        <Ionicons name="chevron-forward" size={18} color={theme.muted} style={{ marginLeft: 'auto' }} />
                      </TouchableOpacity>

                      <View style={styles.optionsDivider} />

                      <TouchableOpacity
                        style={styles.optionItem}
                        onPress={() => {
                          setOptionsVisible(false);
                          Alert.alert(
                            'Report',
                            'Why are you reporting this chat?',
                            [
                              { text: 'Inappropriate content', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
                              { text: 'Spam or harassment', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
                              { text: 'Suspicious activity', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
                              { text: 'Cancel', style: 'cancel' },
                            ]
                          );
                        }}
                      >
                        <View style={[styles.optionIconCircle, { backgroundColor: '#331111' }]}>
                          <Ionicons name="flag-outline" size={20} color="#ff4d4f" />
                        </View>
                        <Text style={[styles.optionItemText, { color: '#ff4d4f' }]}>Report</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>

                <TouchableOpacity style={styles.optionsCloseButton} onPress={() => setOptionsVisible(false)}>
                  <Text style={styles.optionsCloseText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Participants Modal */}
          <Modal visible={participantsVisible} transparent animationType="fade" onRequestClose={() => setParticipantsVisible(false)}>
            <Pressable style={styles.modalOverlay} onPress={() => setParticipantsVisible(false)}>
              <Pressable style={styles.participantsModal} onPress={() => {}}>
                <View style={styles.participantsHeader}>
                  <Text style={styles.participantsTitle}>Participants ({participants.length})</Text>
                  <TouchableOpacity onPress={() => setParticipantsVisible(false)}>
                    <Ionicons name="close" size={24} color={theme.text} />
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={participants}
                  keyExtractor={(item) => item.uid}
                  style={{ maxHeight: 400 }}
                  renderItem={({ item }) => {
                    const me = auth.currentUser?.uid;
                    const isMe = item.uid === me;
                    const isFriend = myFriendIds.includes(item.uid);
                    const isRequested = myRequestsSent.includes(item.uid);

                    return (
                      <View style={styles.participantRow}>
                        <TouchableOpacity
                          onPress={() => navigation.navigate('UserProfile', { userId: item.uid })}
                          style={styles.participantInfo}
                        >
                          <UserAvatar
                            photoUrl={item.photo || item.photoURL}
                            username={item.username || 'User'}
                            size={44}
                            style={styles.participantAvatar}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.participantName} numberOfLines={1}>
                              {item.username}{isMe ? ' (You)' : ''}
                            </Text>
                            {!isMe && (
                              <Text style={styles.participantStatus}>
                                {isFriend ? 'Connected' : isRequested ? 'Request sent' : 'Not connected'}
                              </Text>
                            )}
                          </View>
                        </TouchableOpacity>
                        {!isMe && (
                          <View style={{ flexDirection: 'row', gap: 12 }}>
                            <TouchableOpacity onPress={() => handleMessageUser(item.uid)} style={{ padding: 8 }}>
                              <Ionicons name="chatbubble" size={20} color={theme.primary} />
                            </TouchableOpacity>
                            {isFriend ? (
                              <View style={{ padding: 8 }}>
                                <Ionicons name="checkmark-done" size={20} color={theme.primary} />
                              </View>
                            ) : isRequested ? (
                              <View style={{ padding: 8 }}>
                                <Ionicons name="person-add" size={20} color={theme.muted} />
                              </View>
                            ) : (
                              <TouchableOpacity onPress={() => handleAddFriend(item.uid)} style={{ padding: 8 }}>
                                <Ionicons name="person-add-outline" size={20} color={theme.primary} />
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              onPress={() => {
                                setParticipantsVisible(false);
                                setSelectedInvitee(item);
                                setInviteModalVisible(true);
                              }}
                              style={{ padding: 8 }}
                            >
                              <Ionicons name="calendar-outline" size={20} color={theme.primary} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  }}
                  ListEmptyComponent={
                    <Text style={{ color: theme.muted, textAlign: 'center', marginVertical: 20 }}>
                      No participants
                    </Text>
                  }
                />
              </Pressable>
            </Pressable>
          </Modal>

          {/* Edit Group Modal */}
          <Modal visible={editVisible && chatMeta.isGroup} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
            <View style={styles.modalOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditVisible(false)} />
              <View style={styles.inviteModalCard} pointerEvents="auto">
                {/* Header */}
                <View style={styles.inviteModalHeader}>
                  <View style={styles.inviteModalHeaderIcon}>
                    <Ionicons name="people" size={24} color={theme.primary} />
                  </View>
                  <View style={styles.inviteModalHeaderText}>
                    <Text style={styles.inviteModalTitle}>Edit Group</Text>
                    <Text style={styles.inviteModalSubtitle}>Update group details</Text>
                  </View>
                </View>
                
                {/* Group Photo */}
                <TouchableOpacity onPress={handlePickEditPhoto} style={styles.editGroupPhotoSection}>
                  {editPhotoUri || chatMeta.groupMeta?.photoUrl ? (
                    <Image
                      source={{ uri: editPhotoUri || chatMeta.groupMeta?.photoUrl }}
                      style={styles.editGroupPhoto}
                    />
                  ) : (
                    <View style={styles.editGroupPhotoPlaceholder}>
                      <Ionicons name="camera" size={28} color={theme.primary} />
                    </View>
                  )}
                  <View style={styles.editGroupPhotoOverlay}>
                    <Ionicons name="pencil" size={14} color="#fff" />
                  </View>
                </TouchableOpacity>
                <Text style={styles.editGroupPhotoHint}>Tap to change photo</Text>

                {/* Group Title */}
                <Text style={styles.inviteModalSectionLabel}>Group Name</Text>
                <TextInput
                  style={styles.editGroupInput}
                  value={editTitle}
                  onChangeText={(t) => setEditTitle(t.slice(0, 25))}
                  placeholder="Enter group name"
                  placeholderTextColor={theme.muted}
                />
                <Text style={styles.editGroupCharCount}>{editTitle.length}/25</Text>

                {/* Footer */}
                <View style={styles.inviteModalFooter}>
                  <TouchableOpacity
                    onPress={() => setEditVisible(false)}
                    style={styles.inviteModalCancelBtn}
                  >
                    <Text style={styles.inviteModalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={busy || !editTitle.trim()}
                    onPress={handleEditGroup}
                    style={[styles.inviteModalSendBtn, (busy || !editTitle.trim()) && { opacity: 0.5 }]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="checkmark" size={18} color="#fff" />
                        <Text style={styles.inviteModalSendText}>Save</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Add Users Modal */}
          <Modal visible={addUsersVisible} transparent animationType="fade" onRequestClose={() => setAddUsersVisible(false)}>
            <View style={styles.modalOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setAddUsersVisible(false)} />
              <View style={styles.inviteModalCard} pointerEvents="auto">
                {/* Header */}
                <View style={styles.inviteModalHeader}>
                  <View style={styles.inviteModalHeaderIcon}>
                    <Ionicons name="person-add" size={24} color={theme.primary} />
                  </View>
                  <View style={styles.inviteModalHeaderText}>
                    <Text style={styles.inviteModalTitle}>Add Members</Text>
                    <Text style={styles.inviteModalSubtitle}>Select from your connections</Text>
                  </View>
                </View>
                
                {friends.filter((f) => !chatMeta.participants.includes(f.uid)).length === 0 ? (
                  <View style={styles.inviteModalEmptyState}>
                    <Ionicons name="people-outline" size={48} color={theme.muted} />
                    <Text style={styles.inviteModalEmptyText}>No connections available to add</Text>
                  </View>
                ) : (
                  <FlatList
                    data={friends.filter((f) => !chatMeta.participants.includes(f.uid))}
                    keyExtractor={(item) => item.uid}
                    style={styles.inviteModalList}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item }) => {
                      const isSelected = addingUsersMap[item.uid];
                      return (
                        <TouchableOpacity
                          style={[styles.inviteFriendRow, isSelected && styles.inviteFriendRowSelected]}
                          onPress={() => setAddingUsersMap((prev) => ({ ...prev, [item.uid]: !prev[item.uid] }))}
                          activeOpacity={0.7}
                        >
                          <UserAvatar
                            photoUrl={item.photo || item.photoURL}
                            username={item.username || 'User'}
                            size={44}
                            style={styles.inviteFriendAvatar}
                          />
                          <View style={styles.inviteFriendInfo}>
                            <Text style={styles.inviteFriendName}>{item.username}</Text>
                          </View>
                          <View style={[styles.inviteCheckbox, isSelected && styles.inviteCheckboxSelected]}>
                            {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
                          </View>
                        </TouchableOpacity>
                      );
                    }}
                    ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                  />
                )}

                {/* Footer */}
                <View style={styles.inviteModalFooter}>
                  <Text style={styles.inviteModalSelectedCount}>
                    {Object.values(addingUsersMap).filter(Boolean).length} selected
                  </Text>
                  <View style={styles.inviteModalButtons}>
                    <TouchableOpacity
                      onPress={() => setAddUsersVisible(false)}
                      style={styles.inviteModalCancelBtn}
                    >
                      <Text style={styles.inviteModalCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={busy || Object.values(addingUsersMap).filter(Boolean).length === 0}
                      onPress={handleAddUsers}
                      style={[styles.inviteModalSendBtn, (busy || Object.values(addingUsersMap).filter(Boolean).length === 0) && { opacity: 0.5 }]}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="person-add" size={18} color="#fff" />
                          <Text style={styles.inviteModalSendText}>Add</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </Modal>

          {/* Invite Modal */}
          <Modal visible={inviteModalVisible} transparent animationType="fade" onRequestClose={() => {
            setInviteModalVisible(false);
            setSelectedInvitee(null);
          }}>
            <View style={styles.modalOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => {
                setInviteModalVisible(false);
                setSelectedInvitee(null);
              }} />
              <View style={styles.inviteModalCard} pointerEvents="auto">
                {/* Header */}
                <View style={styles.inviteModalHeader}>
                  <View style={styles.inviteModalHeaderIcon}>
                    <Ionicons name="paper-plane" size={24} color={theme.primary} />
                  </View>
                  <View style={styles.inviteModalHeaderText}>
                    <Text style={styles.inviteModalTitle}>Invite to Activity</Text>
                    <Text style={styles.inviteModalSubtitle}>
                      Send invite to {(selectedInvitee || chatMeta.dmPeer)?.username || 'user'}
                    </Text>
                  </View>
                </View>
                
                {myJoinedActivitiesUpcoming.length === 0 ? (
                  <View style={styles.inviteModalEmptyState}>
                    <Ionicons name="calendar-outline" size={48} color={theme.muted} />
                    <Text style={styles.inviteModalEmptyText}>You haven't joined any upcoming activities</Text>
                    <Text style={styles.inviteModalEmptyHint}>Join an activity first to invite others</Text>
                  </View>
                ) : (
                  <FlatList
                    data={myJoinedActivitiesUpcoming}
                    keyExtractor={(item: any) => item.id}
                    style={styles.inviteModalList}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item }: any) => {
                      const targetUser = selectedInvitee || chatMeta.dmPeer;
                      const alreadyJoined = targetUser && 
                        Array.isArray(item?.joinedUserIds) && 
                        item.joinedUserIds.includes(targetUser.uid);
                      const isSelected = inviteSelection[item.id];

                      return (
                        <Pressable
                          style={[styles.inviteActivityRow, isSelected && !alreadyJoined && styles.inviteActivityRowSelected]}
                          onPress={() => {
                            if (alreadyJoined) {
                              showToast(`${targetUser?.username} is already in this activity`);
                              return;
                            }
                            setInviteSelection((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
                          }}
                        >
                          <View style={styles.inviteActivityIconCircle}>
                            <ActivityIcon activity={item.activity} size={22} color={theme.primary} />
                          </View>
                          <View style={styles.inviteActivityInfo}>
                            <Text style={styles.inviteActivityName} numberOfLines={1}>
                              {item.activity}
                            </Text>
                            <Text style={styles.inviteActivityMeta}>
                              {item.date} • {item.time}
                            </Text>
                          </View>
                          {alreadyJoined ? (
                            <View style={styles.inviteAlreadyJoinedBadge}>
                              <Ionicons name="checkmark-circle" size={14} color={theme.primary} />
                              <Text style={styles.inviteAlreadyJoinedText}>Joined</Text>
                            </View>
                          ) : (
                            <View style={[styles.inviteCheckbox, isSelected && styles.inviteCheckboxSelected]}>
                              {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
                            </View>
                          )}
                        </Pressable>
                      );
                    }}
                    ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                  />
                )}

                {/* Footer */}
                <View style={styles.inviteModalFooter}>
                  <Text style={styles.inviteModalSelectedCount}>
                    {Object.values(inviteSelection).filter(Boolean).length} selected
                  </Text>
                  <View style={styles.inviteModalButtons}>
                    <TouchableOpacity
                      onPress={() => {
                        setInviteModalVisible(false);
                        setSelectedInvitee(null);
                      }}
                      style={styles.inviteModalCancelBtn}
                    >
                      <Text style={styles.inviteModalCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleSendInvites}
                      disabled={Object.values(inviteSelection).filter(Boolean).length === 0}
                      style={[styles.inviteModalSendBtn, Object.values(inviteSelection).filter(Boolean).length === 0 && { opacity: 0.5 }]}
                    >
                      <Ionicons name="paper-plane" size={18} color="#fff" />
                      <Text style={styles.inviteModalSendText}>Send</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </Modal>

          {/* DM Options Modal */}
          <Modal visible={dmOptionsModalVisible} transparent animationType="fade" onRequestClose={() => setDmOptionsModalVisible(false)}>
            <View style={styles.modalOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setDmOptionsModalVisible(false)} />
              <View style={{ backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border, maxWidth: 300, width: '85%' }} pointerEvents="auto">
                {/* Header with X button */}
                <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border, alignItems: 'center', position: 'relative' }}>
                  {/* Close button */}
                  <TouchableOpacity
                    style={{
                      position: 'absolute',
                      top: 12,
                      right: 12,
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: theme.background,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                    onPress={() => setDmOptionsModalVisible(false)}
                  >
                    <Ionicons name="close" size={18} color={theme.muted} />
                  </TouchableOpacity>
                  
                  {chatMeta.dmPeer && (
                    <>
                      <UserAvatar
                        photoUrl={chatMeta.dmPeer.photo || chatMeta.dmPeer.photoURL}
                        username={chatMeta.dmPeer.username}
                        size={50}
                        style={{ marginBottom: 8 }}
                      />
                      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{chatMeta.dmPeer.username}</Text>
                      <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>Direct Message</Text>
                    </>
                  )}
                </View>

                {/* Connection Status */}
                {chatMeta.dmPeer && (() => {
                  const isFriend = myFriendIds.includes(chatMeta.dmPeer.uid);
                  const isRequested = myRequestsSent.includes(chatMeta.dmPeer.uid);
                  const isPeerBlocked = isUserBlockedById(chatMeta.dmPeer.uid);
                  
                  if (isPeerBlocked || isBlockedByPeer) {
                    return (
                      <View style={{ padding: 12, alignItems: 'center', backgroundColor: theme.background }}>
                        <Ionicons name="ban" size={24} color={theme.muted} />
                        <Text style={{ color: theme.muted, fontSize: 14, marginTop: 4 }}>Blocked User</Text>
                      </View>
                    );
                  }
                  
                  return (
                    <View style={{ paddingVertical: 12, paddingHorizontal: 16, backgroundColor: theme.background }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Ionicons 
                            name={isFriend ? "people" : "person-add-outline"} 
                            size={18} 
                            color={isFriend ? theme.primary : theme.muted} 
                          />
                          <Text style={{ color: theme.text, fontSize: 14 }}>
                            {isFriend ? 'Connected' : isRequested ? 'Request Sent' : 'Not Connected'}
                          </Text>
                        </View>
                        {!isFriend && (
                          isRequested ? (
                            <TouchableOpacity
                              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}
                              onPress={() => {
                                handleCancelRequest(chatMeta.dmPeer!.uid);
                                setDmOptionsModalVisible(false);
                              }}
                            >
                              <Text style={{ color: theme.muted, fontSize: 13, fontWeight: '600' }}>Cancel</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.primary }}
                              onPress={() => {
                                handleAddFriend(chatMeta.dmPeer!.uid);
                                setDmOptionsModalVisible(false);
                              }}
                            >
                              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Connect</Text>
                            </TouchableOpacity>
                          )
                        )}
                      </View>
                    </View>
                  );
                })()}

                <View style={{ height: 1, backgroundColor: theme.border }} />

                {/* View Profile */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}
                  onPress={() => {
                    setDmOptionsModalVisible(false);
                    if (chatMeta.dmPeer) {
                      navigation.navigate('UserProfile', { userId: chatMeta.dmPeer.uid });
                    }
                  }}
                >
                  <Ionicons name="person-outline" size={22} color={theme.primary} />
                  <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>View Profile</Text>
                </TouchableOpacity>

                <View style={{ height: 1, backgroundColor: theme.border }} />

                {/* Mute/Unmute */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}
                  onPress={() => {
                    setDmOptionsModalVisible(false);
                    handleMuteToggle();
                  }}
                >
                  <Ionicons 
                    name={isMuted ? "notifications" : "notifications-off"} 
                    size={22} 
                    color={theme.primary} 
                  />
                  <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
                    {isMuted ? 'Unmute' : 'Mute'}
                  </Text>
                </TouchableOpacity>

                {/* Invite to Activity - only if not blocked */}
                {chatMeta.dmPeer && !isUserBlockedById(chatMeta.dmPeer.uid) && !isBlockedByPeer && (
                  <>
                    <View style={{ height: 1, backgroundColor: theme.border }} />
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}
                      onPress={() => {
                        setDmOptionsModalVisible(false);
                        setInviteSelection({});
                        setInviteModalVisible(true);
                      }}
                    >
                      <Ionicons name="calendar-outline" size={22} color={theme.primary} />
                      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>Invite to Activity</Text>
                    </TouchableOpacity>
                  </>
                )}

                {/* Danger Zone */}
                <View style={{ height: 1, backgroundColor: theme.border, marginTop: 8 }} />
                <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '600', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>DANGER ZONE</Text>

                {/* Block User Info */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}
                  onPress={() => {
                    setDmOptionsModalVisible(false);
                    Alert.alert(
                      'Block User',
                      'To block this user, visit their profile and tap the menu icon (⋮) in the top right corner.',
                      [
                        { text: 'OK', style: 'default' },
                        {
                          text: 'Go to Profile',
                          onPress: () => {
                            if (chatMeta.dmPeer) {
                              navigation.navigate('UserProfile', { userId: chatMeta.dmPeer.uid });
                            }
                          },
                        },
                      ]
                    );
                  }}
                >
                  <Ionicons name="ban" size={22} color={theme.danger} />
                  <Text style={{ color: theme.danger, fontSize: 16, fontWeight: '600' }}>Block User</Text>
                </TouchableOpacity>

                <View style={{ height: 1, backgroundColor: theme.border }} />

                {/* Report User */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}
                  onPress={() => {
                    setDmOptionsModalVisible(false);
                    Alert.alert(
                      'Report User',
                      'Why are you reporting this user?',
                      [
                        { text: 'Harassment or bullying', onPress: () => Alert.alert('Reported', 'Thank you for your report. We will review it and take appropriate action.') },
                        { text: 'Spam or scam', onPress: () => Alert.alert('Reported', 'Thank you for your report. We will review it and take appropriate action.') },
                        { text: 'Inappropriate content', onPress: () => Alert.alert('Reported', 'Thank you for your report. We will review it and take appropriate action.') },
                        { text: 'Cancel', style: 'cancel' },
                      ]
                    );
                  }}
                >
                  <Ionicons name="flag-outline" size={22} color={theme.danger} />
                  <Text style={{ color: theme.danger, fontSize: 16, fontWeight: '600' }}>Report User</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </View>

        {/* Scroll to Bottom Button */}
        {showScrollButton && (
          <Animated.View
            style={{
              position: 'absolute',
              right: 16,
              bottom: 80,
              transform: [{
                scale: scrollButtonAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.3, 1],
                }),
              }, {
                translateY: scrollButtonAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              }],
              opacity: scrollButtonAnim,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.3,
              shadowRadius: 4,
              elevation: 5,
            }}
          >
            <TouchableOpacity
              onPress={() => scrollToBottom(true)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: theme.primary,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 2,
                borderColor: theme.card,
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="chevron-down" size={24} color={theme.isDark ? '#111' : '#fff'} />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Toast */}
        <Toast message={toastMessage} visible={toastVisible} />

        {/* Reactions Modal */}
        <Modal
          visible={reactionsModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setReactionsModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <Pressable 
              style={StyleSheet.absoluteFill} 
              onPress={() => setReactionsModalVisible(false)} 
            />
            <View style={[styles.modalPanel, { maxHeight: '60%' }]} pointerEvents="auto">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={styles.modalTitle}>Reactions</Text>
                <TouchableOpacity onPress={() => setReactionsModalVisible(false)}>
                  <Ionicons name="close" size={24} color={theme.muted} />
                </TouchableOpacity>
              </View>
              
              <FlatList
                data={selectedMessageReactions}
                keyExtractor={(item, index) => `${item.userId}-${index}`}
                renderItem={({ item }) => {
                  const user = profiles[item.userId];
                  const username = user?.username || 'User';
                  const photo = user?.photo || user?.photoURL;
                  
                  return (
                    <TouchableOpacity
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        backgroundColor: theme.background,
                        borderRadius: 10,
                        marginBottom: 6,
                      }}
                      onPress={() => {
                        setReactionsModalVisible(false);
                        navigation.navigate('UserProfile', { userId: item.userId });
                      }}
                      activeOpacity={0.7}
                    >
                      <UserAvatar
                        photoUrl={photo}
                        username={username}
                        size={36}
                        style={styles.avatar}
                      />
                      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500', flex: 1, marginLeft: 10 }}>
                        {username}
                      </Text>
                      <Text style={{ fontSize: 20, marginLeft: 10 }}>
                        {item.emoji}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text style={{ color: theme.muted, textAlign: 'center', paddingVertical: 20 }}>
                    No reactions yet
                  </Text>
                }
              />
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ==================== STYLES ====================
const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerButton: { padding: 4 },
  headerImage: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginLeft: 6,
  },
  headerIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginLeft: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.primary,
    backgroundColor: 'transparent',
  },
  headerTitle: {
    color: theme.text,
    fontWeight: 'bold',
    fontSize: 17,
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '500',
  },

  // Messages
  messageList: {
    flexGrow: 1,
    paddingTop: 6,
    paddingBottom: 8,
  },
  messageRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    marginBottom: 2,
    alignItems: 'flex-end',
  },
  messageRowLeft: {
    justifyContent: 'flex-start',
  },
  messageRowRight: {
    justifyContent: 'flex-end',
  },
  avatarColumn: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginRight: 6,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.primary,
  },
  messageColumn: {
    maxWidth: '78%',
  },
  username: {
    color: theme.primary,
    fontWeight: '600',
    fontSize: 12,
    marginLeft: 6,
    marginBottom: 2,
  },

  // Bubble
  bubble: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginVertical: 2,
  },
  bubbleOwn: {
    backgroundColor: theme.primary,
    alignSelf: 'flex-end',
  },
  bubbleOther: {
    backgroundColor: theme.card,
    alignSelf: 'flex-start',
  },

  // Reply header
  replyHeader: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderLeftWidth: 3,
    borderRadius: 8,
    marginBottom: 6,
  },
  replyHeaderOwn: {
    backgroundColor: 'rgba(198, 248, 250, 0.3)',
    borderLeftColor: theme.primaryStrong,
  },
  replyHeaderOther: {
    backgroundColor: theme.background,
    borderLeftColor: theme.primary,
  },
  replyHeaderName: {
    color: theme.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  replyHeaderSnippet: {
    color: theme.muted,
    fontSize: 12,
  },

  // Text
  messageText: {
    fontSize: 16,
    color: theme.text,
  },
  messageTextOwn: {
    color: '#fff',
  },
  timestamp: {
    fontSize: 10,
    color: theme.muted,
    alignSelf: 'flex-end',
    marginTop: 3,
  },
  timestampOwn: {
    color: 'rgba(255, 255, 255, 0.7)',
  },

  // Image
  messageImage: {
    width: 240,
    height: 180,
  },

  // Reactions
  reactionChips: {
    position: 'absolute',
    top: -12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reactionChip: {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reactionChipText: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '600',
  },
  reactionPicker: {
    flexDirection: 'row',
    backgroundColor: theme.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 6,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  bubbleHighlight: {
    borderWidth: 2,
    borderColor: theme.primary,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 7,
  },
  reactionButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  reactionEmoji: {
    fontSize: 20,
  },
  reactionDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.primary,
    marginTop: 2,
  },
  myReaction: {
    backgroundColor: theme.card,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
    borderWidth: 1,
    borderColor: theme.border,
  },

  // Typing
  typingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  typingText: {
    color: theme.primary,
    fontSize: 12,
  },

  // Reply bar
  replyBar: {
    backgroundColor: theme.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginBottom: 6,
  },
  replyBarLabel: {
    color: theme.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  replyBarText: {
    color: theme.text,
    fontSize: 12,
    marginTop: 2,
  },

  // Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.card,
  },
  inputButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    borderWidth: 2,
    borderColor: theme.primary,
  },
  inputText: {
    flex: 1,
    backgroundColor: theme.background,
    color: theme.text,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 8 : 6,
    marginHorizontal: 8,
    fontSize: 16,
    minHeight: 36,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: theme.primary,
    borderRadius: 18,
    padding: 8,
    marginLeft: 4,
  },

  // Selected images
  selectedImagesContainer: {
    flexDirection: 'row',
    margin: 8,
  },
  selectedImage: {
    width: 60,
    height: 60,
    borderRadius: 10,
  },
  removeImageButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ff4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  removeImageText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 18,
    lineHeight: 20,
  },

  // Image viewer
  imageViewer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.95)',
    zIndex: 999,
  },

  // DM Header Buttons
  dmHeaderConnected: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  dmHeaderRequested: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  dmHeaderAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  dmHeaderInvite: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  dmHeaderText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
    marginLeft: 4,
  },
  dmHeaderRequestedText: {
    color: theme.primary,
    fontWeight: '600',
    fontSize: 12,
    marginLeft: 4,
  },

  // Read Receipts
  readReceipts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  readText: {
    color: theme.primary,
    fontSize: 11,
    marginLeft: 4,
  },
  readAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.primary,
  },
  readReceiptsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Modal Overlay
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Modal Panel
  modalPanel: {
    width: '92%',
    backgroundColor: theme.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  modalTitle: {
    color: theme.primary,
    fontWeight: 'bold',
    fontSize: 18,
    marginBottom: 10,
  },

  // Modal Buttons
  modalButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalButtonCancel: {
    backgroundColor: '#8e2323',
  },
  modalButtonCancelText: {
    color: '#fff',
    fontWeight: '600',
  },
  modalButtonPrimary: {
    backgroundColor: theme.primary,
  },
  modalButtonPrimaryText: {
    color: '#000',
    fontWeight: '700',
  },

  // Options Panel
  optionsPanel: {
    width: 320,
    backgroundColor: theme.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  optionsPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    marginBottom: 12,
  },
  optionsHeaderIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  optionsHeaderText: {
    flex: 1,
  },
  optionsHeaderTitle: {
    color: theme.text,
    fontWeight: 'bold',
    fontSize: 18,
    marginBottom: 2,
  },
  optionsHeaderSubtitle: {
    color: theme.muted,
    fontSize: 13,
  },
  optionsList: {
    marginBottom: 12,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  optionIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  optionItemText: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '500',
  },
  optionsDivider: {
    height: 1,
    backgroundColor: theme.border,
    marginVertical: 8,
  },
  optionItemDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#1a0a0a',
  },
  optionItemDangerText: {
    color: '#ff4d4f',
    fontSize: 15,
    fontWeight: '600',
  },
  optionsCloseButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: theme.background,
    alignItems: 'center',
  },
  optionsCloseText: {
    color: theme.muted,
    fontSize: 15,
    fontWeight: '500',
  },

  // Participants Modal
  participantsModal: {
    width: '88%',
    maxHeight: 500,
    backgroundColor: theme.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  participantsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  participantsTitle: {
    color: theme.primary,
    fontWeight: 'bold',
    fontSize: 18,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  participantInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  participantAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
    borderWidth: 2,
    borderColor: theme.primary,
  },
  participantName: {
    color: theme.text,
    fontWeight: 'bold',
    fontSize: 15,
  },
  participantStatus: {
    color: theme.muted,
    fontSize: 12,
    marginTop: 2,
  },

  // User Row (Add Users)
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  userRowImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    borderWidth: 1,
    borderColor: theme.primary,
  },
  userRowText: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
  },

  // Photo Picker
  photoPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  input: {
    backgroundColor: theme.card,
    color: theme.text,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: theme.border,
  },

  // ========== INVITE MODAL STYLES (Professional Design) ==========
  inviteModalCard: {
    width: '92%',
    maxWidth: 400,
    backgroundColor: theme.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.border,
    maxHeight: '80%',
  },
  inviteModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  inviteModalHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: `${theme.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  inviteModalHeaderText: {
    flex: 1,
  },
  inviteModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.text,
    marginBottom: 2,
  },
  inviteModalSubtitle: {
    fontSize: 14,
    color: theme.muted,
  },
  inviteModalSectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.primary,
    marginBottom: 10,
    marginTop: 8,
  },
  inviteModalList: {
    maxHeight: 280,
  },
  inviteModalEmptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  inviteModalEmptyText: {
    color: theme.muted,
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  inviteModalEmptyHint: {
    color: theme.muted,
    fontSize: 13,
    marginTop: 4,
    opacity: 0.7,
  },
  inviteModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  inviteModalSelectedCount: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: '500',
  },
  inviteModalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  inviteModalCancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.border,
  },
  inviteModalCancelText: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  inviteModalSendBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: theme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inviteModalSendText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },

  // Friend row in invite modal
  inviteFriendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: theme.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  inviteFriendRowSelected: {
    borderColor: theme.primary,
    backgroundColor: `${theme.primary}10`,
  },
  inviteFriendAvatar: {
    borderWidth: 2,
    borderColor: theme.primary,
  },
  inviteFriendInfo: {
    flex: 1,
    marginLeft: 12,
  },
  inviteFriendName: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  inviteCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inviteCheckboxSelected: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },

  // Activity row in invite modal
  inviteActivityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: theme.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  inviteActivityRowSelected: {
    borderColor: theme.primary,
    backgroundColor: `${theme.primary}10`,
  },
  inviteActivityIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: `${theme.primary}15`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  inviteActivityInfo: {
    flex: 1,
  },
  inviteActivityName: {
    color: theme.text,
    fontWeight: '600',
    fontSize: 15,
  },
  inviteActivityMeta: {
    color: theme.muted,
    fontSize: 13,
    marginTop: 2,
  },
  inviteAlreadyJoinedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${theme.primary}15`,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  inviteAlreadyJoinedText: {
    color: theme.primary,
    fontSize: 12,
    fontWeight: '600',
  },

  // Edit Group Modal
  editGroupPhotoSection: {
    alignSelf: 'center',
    marginBottom: 8,
  },
  editGroupPhoto: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: theme.primary,
  },
  editGroupPhotoPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: `${theme.primary}15`,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.border,
    borderStyle: 'dashed',
  },
  editGroupPhotoOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.card,
  },
  editGroupPhotoHint: {
    color: theme.muted,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  editGroupInput: {
    backgroundColor: theme.background,
    color: theme.text,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  editGroupCharCount: {
    color: theme.muted,
    fontSize: 12,
    textAlign: 'right',
    marginTop: 6,
  },

  // Legacy Activity Row (keep for compatibility)
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: theme.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 8,
  },
  activityIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityName: {
    color: theme.text,
    fontWeight: '600',
    fontSize: 15,
  },
  activityMeta: {
    color: theme.muted,
    fontSize: 12,
    marginTop: 2,
  },
});

export default React.memo(ChatDetailScreen);
