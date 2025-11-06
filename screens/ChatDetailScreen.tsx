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
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Keyboard,
  Animated,
  ActivityIndicator,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { PanGestureHandler, State as GestureState } from 'react-native-gesture-handler';
import { useAudioRecorder, useAudioPlayer, AudioModule, RecordingPresets } from 'expo-audio';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import { useNavigation, useRoute } from '@react-navigation/native';
import { doc, getDoc, onSnapshot, collection, query, where, getDocs, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { ActivityIcon } from '../components/ActivityIcons';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { uploadChatImage, uploadAudioMessage } from '../utils/imageUtils';
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
  type: 'text' | 'image' | 'audio' | 'system';
  timestamp?: any;
  replyToId?: string;
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
  isPlaying: boolean;
  audioProgress: number;
  audioDuration: number;
  playbackRate: number;
  onLongPress: () => void;
  onSwipeReply: () => void;
  onReact: (emoji: string) => void;
  onCopy: () => void;
  onPlayAudio: () => void;
  onSpeedChange: () => void;
  onImagePress: () => void;
  onUserPress: (uid: string) => void;
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
  isPlaying,
  audioProgress,
  audioDuration,
  playbackRate,
  onLongPress,
  onSwipeReply,
  onReact,
  onCopy,
  onPlayAudio,
  onSpeedChange,
  onImagePress,
  onUserPress,
  theme,
  styles,
}) => {
  const swipeX = useRef(new Animated.Value(0)).current;
  const reactionAnim = useRef(new Animated.Value(0)).current;
  const longPressTriggered = useRef(false);
  const touchStartX = useRef<number | null>(null);

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

  // Avatar URL
  const avatarUrl = sender.photo || sender.photoURL || 
    `https://ui-avatars.com/api/?name=${encodeURIComponent(sender.username || 'User')}`;

  // Aggregate reactions
  const reactionCounts = reactions.reduce((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <View style={[
      styles.messageRow,
      isOwn ? styles.messageRowRight : styles.messageRowLeft,
    ]}>
      {/* Avatar column (for others, show on last message) */}
      {!isOwn && (
        <View style={styles.avatarColumn}>
          {isLast ? (
            <TouchableOpacity 
              onPress={() => onUserPress(message.senderId)}
              activeOpacity={0.7}
            >
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
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

                // Trigger reply if swiped past threshold
                if (dx > THRESHOLD) {
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
                  if (typeof start === 'number') {
                    const dx = e.nativeEvent.pageX - start;
                    if (dx > 40) {
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
                        : replyToMessage.type === 'audio'
                        ? 'Voice message'
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

                {/* Audio message */}
                {message.type === 'audio' && (
                  <View style={styles.audioContainer}>
                    <TouchableOpacity
                      onPress={onPlayAudio}
                      style={styles.audioPlayButton}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={isPlaying ? 'pause' : 'play-arrow'}
                        size={20}
                        color="#fff"
                      />
                    </TouchableOpacity>
                    
                    <View style={styles.audioWaveform}>
                      <View style={[
                        styles.audioWaveformFill,
                        { 
                          width: audioDuration > 0 
                            ? `${(audioProgress / audioDuration) * 100}%` 
                            : '0%' 
                        },
                      ]} />
                    </View>

                    <Text style={styles.audioDuration}>
                      {audioDuration > 0 ? audioDuration.toFixed(1) : '0.0'}s
                    </Text>

                    <TouchableOpacity
                      onPress={onSpeedChange}
                      style={styles.audioSpeedButton}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.audioSpeedText}>
                        {playbackRate}x
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Image message */}
                {message.type === 'image' && (
                  <TouchableOpacity 
                    activeOpacity={0.9} 
                    onPress={onImagePress}
                  >
                    <Image
                      source={{ uri: message.text || avatarUrl }}
                      style={[styles.messageImage, cornerRadius]}
                    />
                  </TouchableOpacity>
                )}

                {/* Timestamp */}
                {message.timestamp && (
                  <Text style={[
                    styles.timestamp,
                    isOwn && styles.timestampOwn,
                  ]}>
                    {new Date(message.timestamp.seconds * 1000).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                )}
              </Pressable>
            </Animated.View>
          </PanGestureHandler>

          {/* Reaction chips */}
          {Object.keys(reactionCounts).length > 0 && (
            <View style={[styles.reactionChips, { right: 6 }]}>
              {Object.entries(reactionCounts).map(([emoji, count]) => (
                <View key={emoji} style={styles.reactionChip}>
                  <Text style={styles.reactionChipText}>
                    {emoji}{count > 1 ? ` ${count}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Reaction picker */}
          {showReactionPicker && (
            <Animated.View
              style={[
                styles.reactionPicker,
                {
                  position: 'absolute',
                  top: -8,
                  left: isOwn ? undefined : '100%',
                  right: isOwn ? '100%' : undefined,
                  transform: [{ scale: reactionAnim }],
                  opacity: reactionAnim,
                },
              ]}
            >
              {['❤️', '👍', '🔥', '😂', '👏', '😮'].map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => onReact(emoji)}
                  style={styles.reactionButton}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
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
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.text === nextProps.message.text &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.showReactionPicker === nextProps.showReactionPicker &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.myReaction === nextProps.myReaction &&
    JSON.stringify(prevProps.reactions) === JSON.stringify(nextProps.reactions)
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
  const { allActivities, joinedActivities } = useActivityContext();
  const { setCurrentChatId } = useInAppNotification();

  // Track when user is viewing this chat (suppress notifications)
  useEffect(() => {
    setCurrentChatId(chatId);
    return () => setCurrentChatId(null);
  }, [chatId, setCurrentChatId]);

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
  const [myReactions, setMyReactions] = useState<Record<string, string>>({});
  const [reactionsMap, setReactionsMap] = useState<Record<string, Array<{ userId: string; emoji: string }>>>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [chatReads, setChatReads] = useState<Record<string, any>>({});
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [participantsVisible, setParticipantsVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Audio
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayer = useAudioPlayer();
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<any>(null);
  const recordingAnimRef = useRef(new Animated.Value(0)).current;

  // Refs
  const flatListRef = useRef<FlatList>(null);
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
  const isAtBottomRef = useRef(true);

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

  // ========== SCROLL TO BOTTOM ==========
  const scrollToBottom = useCallback((animated: boolean = true) => {
    // Scroll to the actual bottom of the list
    flatListRef.current?.scrollToEnd({ animated });
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

  // ========== FADE IN ANIMATION ==========
  useEffect(() => {
    if (isReady) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }
  }, [isReady]);

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
      
      // Clean up recording timer if still active
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [chatId]);

  // ========== KEYBOARD HANDLING ==========
  useEffect(() => {
    const showListener = Keyboard.addListener('keyboardDidShow', () => {
      if (isAtBottomRef.current) {
        setTimeout(() => {
          scrollToBottom(true);
        }, 100);
      }
    });

    return () => {
      showListener.remove();
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
            (latest) => {
              setMessages(latest as any);
              markChatRead(chatId);

              // ========== UPDATE CACHE WITH NEW MESSAGES ==========
              saveMessagesToCache(chatId, latest as any);

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
      } else {
        noMoreOlderRef.current = true;
      }
    } catch {}
    setIsLoadingOlder(false);
  }, [isLoadingOlder, chatId]);

  const handleScroll = useCallback(
    (e: any) => {
      const y = e?.nativeEvent?.contentOffset?.y || 0;
      const layoutHeight = e?.nativeEvent?.layoutMeasurement?.height || 0;
      const contentHeight = e?.nativeEvent?.contentSize?.height || 0;
      
      // Load older messages when scrolling near top
      if (y <= 40) {
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
    [loadOlderMessages, showScrollButton]
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

  // ========== LISTEN TO REACTIONS ==========
  useEffect(() => {
    const limit = 60;
    const currentIds = new Set(messages.slice(-limit).map((m) => m.id));

    // Add listeners for new messages
    messages.slice(-limit).forEach((m) => {
      if (!reactionUnsubsRef.current[m.id]) {
        const unsub = listenToReactions(
          chatId,
          m.id,
          (items) => setReactionsMap((prev) => ({ ...prev, [m.id]: items })),
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

    // Send images
    for (const uri of selectedImages) {
      try {
        const imageId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const downloadUrl = await uploadChatImage(uri, auth.currentUser.uid, imageId);
        await sendMessage(chatId, auth.currentUser.uid, downloadUrl, 'image');
      } catch (error: any) {
        Alert.alert('Upload failed', error?.message || 'Could not upload image.');
      }
    }
    setSelectedImages([]);

    // Send text
    if (messageText.trim()) {
      const extra: any = {};
      if (replyTo?.id) extra.replyToId = replyTo.id;

      await sendMessage(chatId, auth.currentUser.uid, messageText.trim(), 'text', extra);
      setReplyTo(null);
      setMessageText('');

      setTimeout(() => {
        scrollToBottom(true);
      }, 50);
    }
  }, [chatId, messageText, selectedImages, replyTo, scrollToBottom]);

  // ========== AUDIO ==========
  const startRecording = useCallback(async () => {
    if (isRecording) return; // Prevent double-start
    
    try {
      console.log('🎤 Starting recording...');
      
      // Request permission
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Denied', 'Please enable microphone access in your device settings to record voice messages.');
        return;
      }

      // Set audio mode for recording
      await AudioModule.setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      // Start recording
      await audioRecorder.record();
      console.log('🎤 Recording started successfully');
      
      setIsRecording(true);
      setRecordingDuration(0);
      
      // Start animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(recordingAnimRef, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(recordingAnimRef, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Start duration counter - update every second
      const startTime = Date.now();
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setRecordingDuration(elapsed);
      }, 100); // Check every 100ms for smoother updates

    } catch (error) {
      console.error('❌ Recording error:', error);
      setIsRecording(false);
      Alert.alert('Recording Error', 'Could not start recording. Please try again.');
    }
  }, [audioRecorder, recordingAnimRef, isRecording]);

  const stopRecording = useCallback(async () => {
    if (!isRecording || !auth.currentUser) return;

    let base64Audio: string | null = null;

    try {
      console.log('🎤 Stopping recording...');
      
      // Get the URI BEFORE stopping
      const originalUri = audioRecorder.uri;
      console.log('🎤 Got URI before stop:', originalUri);
      
      if (!originalUri || originalUri.trim() === '') {
        console.error('❌ No URI from recording');
        Alert.alert('Recording Error', 'No audio was recorded.');
        
        // Still need to clean up
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        recordingAnimRef.stopAnimation();
        recordingAnimRef.setValue(0);
        setIsRecording(false);
        await audioRecorder.stop();
        await AudioModule.setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
        return;
      }

      // Check minimum duration (at least 1 second)
      if (recordingDuration < 1) {
        console.log('⚠️ Recording too short');
        Alert.alert('Too Short', 'Voice message must be at least 1 second long.');
        
        // Clean up
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        recordingAnimRef.stopAnimation();
        recordingAnimRef.setValue(0);
        setIsRecording(false);
        await audioRecorder.stop();
        await AudioModule.setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
        return;
      }

      // Pause first to keep file, then read, then stop
      console.log('Pausing recorder...');
      await audioRecorder.pause();
      
      console.log('Reading audio file...');
      base64Audio = await FileSystem.readAsStringAsync(originalUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log('Audio file read successfully');
      
      // Now stop to clean up
      await audioRecorder.stop();

      // Clean up UI state
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      recordingAnimRef.stopAnimation();
      recordingAnimRef.setValue(0);
      setIsRecording(false);

      // Generate unique ID for this audio message
      const audioId = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create a temporary file from base64
      const tempUri = `${FileSystem.cacheDirectory}${audioId}.m4a`;
      console.log('💾 Writing to temporary file:', tempUri);
      await FileSystem.writeAsStringAsync(tempUri, base64Audio, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      console.log('☁️ Uploading audio to Firebase Storage...');
      console.log('📁 Audio ID:', audioId);
      
      // Upload to Firebase Storage
      const downloadUrl = await uploadAudioMessage(tempUri, auth.currentUser.uid, audioId);
      console.log('✅ Audio uploaded:', downloadUrl);

      // Clean up the temporary file
      try {
        await FileSystem.deleteAsync(tempUri, { idempotent: true });
        console.log('🗑️ Temporary file deleted');
      } catch (deleteError) {
        console.warn('⚠️ Could not delete temp file:', deleteError);
      }

      // Send message with the download URL
      await sendMessage(chatId, auth.currentUser.uid, downloadUrl, 'audio');
      console.log('✅ Audio message sent');

      // Reset audio mode
      await AudioModule.setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      
      setRecordingDuration(0);
    } catch (error) {
      console.error('❌ Stop recording error:', error);
      setIsRecording(false);
      setRecordingDuration(0);
      
      // Try to clean up recording
      try {
        await audioRecorder.stop();
      } catch (e) {
        console.error('Error stopping recorder:', e);
      }
      
      Alert.alert('Recording Error', 'Could not save recording. Please try again.');
      
      // Try to reset audio mode
      try {
        await AudioModule.setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
      } catch (e) {
        console.error('Error resetting audio mode:', e);
      }
    }
  }, [audioRecorder, chatId, recordingDuration, recordingAnimRef, isRecording]);

  const cancelRecording = useCallback(async () => {
    if (!isRecording) return;

    try {
      console.log('🎤 Cancelling recording...');
      
      // Clear timer and animation
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      recordingAnimRef.stopAnimation();
      recordingAnimRef.setValue(0);
      setIsRecording(false);
      setRecordingDuration(0);

      // Stop and discard recording
      await audioRecorder.stop();

      // Reset audio mode
      await AudioModule.setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      console.log('✅ Recording cancelled');
    } catch (error) {
      console.error('❌ Cancel recording error:', error);
      setIsRecording(false);
      setRecordingDuration(0);
    }
  }, [audioRecorder, recordingAnimRef, isRecording]);

  const handlePlayAudio = useCallback((uri: string, id: string) => {
    if (playingAudioId === id) {
      if (audioPlayer.playing) {
        audioPlayer.pause();
      } else {
        audioPlayer.play();
      }
      return;
    }

    setPlayingAudioId(id);
    audioPlayer.replace(uri);
    audioPlayer.play();
  }, [playingAudioId, audioPlayer]);

  const handleSpeedChange = useCallback(() => {
    const newRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(newRate);
    audioPlayer.playbackRate = newRate;
  }, [playbackRate, audioPlayer]);

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
      await addReaction(chatId, messageId, emoji);
      setMyReactions((prev) => ({ ...prev, [messageId]: emoji }));
      setReactionsMap((prev) => {
        const arr = prev[messageId] || [];
        const me = auth.currentUser?.uid || '';
        const others = arr.filter((r) => r.userId !== me);
        return { ...prev, [messageId]: [...others, { userId: me, emoji }] };
      });
      setReactionPickerId(null);
    } catch {}
  }, [chatId]);

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
        if (me) {
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

              await addSystemMessage(chatId, `${myName} left the group`);
              await leaveChatWithAutoDelete(chatId, me);
              exitChat();
            } catch {}
          },
        },
      ]
    );
  }, [chatId, exitChat]);

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
              <Image
                key={p.uid}
                source={{
                  uri: p.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.username)}`,
                }}
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
    
    // Ensure sender has all required fields with fallbacks
    const senderProfile = profiles[item.senderId];
    const sender: Profile = {
      uid: item.senderId,
      username: senderProfile?.username || 'User',
      photo: senderProfile?.photo || senderProfile?.photoURL,
      photoURL: senderProfile?.photoURL || senderProfile?.photo,
    };
    
    const replyToMessage = item.replyToId 
      ? messages.find((m) => m.id === item.replyToId) 
      : undefined;
    const replySender = replyToMessage 
      ? profiles[replyToMessage.senderId] 
      : undefined;

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
          replySender={replySender}
          reactions={reactionsMap[item.id] || []}
          myReaction={myReactions[item.id]}
          showReactionPicker={reactionPickerId === item.id}
          isPlaying={playingAudioId === item.id && audioPlayer.playing}
          audioProgress={playingAudioId === item.id ? audioPlayer.currentTime : 0}
          audioDuration={playingAudioId === item.id ? audioPlayer.duration : 0}
          playbackRate={playbackRate}
          onLongPress={() => {
            setReactionPickerId((prev) => (prev === item.id ? null : item.id));
          }}
          onSwipeReply={() => {
            setReplyTo(item);
            setReactionPickerId(null);
          }}
          onReact={(emoji) => handleReaction(item.id, emoji)}
          onCopy={async () => {
            try {
              await Clipboard.setStringAsync(item.text);
              showToast('Copied');
            } catch {}
            setReactionPickerId(null);
          }}
          onPlayAudio={() => handlePlayAudio(item.text, item.id)}
          onSpeedChange={handleSpeedChange}
          onImagePress={() => setViewerUri(item.text)}
          onUserPress={(uid) => navigation.navigate('UserProfile', { userId: uid })}
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
    playingAudioId,
    audioPlayer.playing,
    audioPlayer.currentTime,
    audioPlayer.duration,
    playbackRate,
    handleReaction,
    handlePlayAudio,
    handleSpeedChange,
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

      return (
        <>
          <TouchableOpacity 
            onPress={() => navigation.navigate('UserProfile', { userId: chatMeta.dmPeer!.uid })}
            activeOpacity={0.8}
          >
            <Image
              source={{
                uri: chatMeta.dmPeer.photo || 
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(chatMeta.dmPeer.username)}`,
              }}
              style={styles.headerImage}
            />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <TouchableOpacity 
              onPress={() => navigation.navigate('UserProfile', { userId: chatMeta.dmPeer!.uid })}
              activeOpacity={0.7}
            >
              <Text style={styles.headerTitle} numberOfLines={1}>
                {chatMeta.dmPeer.username}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {isFriend ? (
              <View style={styles.dmHeaderConnected}>
                <Ionicons name="checkmark-done" size={16} color="#fff" />
                <Text style={styles.dmHeaderText}>Connected</Text>
              </View>
            ) : isRequested ? (
              <TouchableOpacity
                style={styles.dmHeaderRequested}
                onPress={() => handleCancelRequest(chatMeta.dmPeer!.uid)}
              >
                <Ionicons name="person-add" size={16} color={theme.primary} />
                <Text style={styles.dmHeaderRequestedText}>Sent</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.dmHeaderAdd}
                onPress={() => handleAddFriend(chatMeta.dmPeer!.uid)}
              >
                <Ionicons name="person-add-outline" size={16} color={theme.primary} />
                <Text style={styles.dmHeaderRequestedText}>Add</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.dmHeaderInvite}
              onPress={() => {
                setInviteSelection({});
                setInviteModalVisible(true);
              }}
            >
              <Ionicons name="calendar-outline" size={16} color="#fff" />
              <Text style={styles.dmHeaderText}>Invite</Text>
            </TouchableOpacity>
          </View>
        </>
      );
    }

    if (chatMeta.isActivity && chatMeta.activityInfo) {
      return (
        <>
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
            <Image source={{ uri: chatMeta.groupMeta.photoUrl }} style={styles.headerImage} />
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
            <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
              {reactionPickerId && (
                <Pressable 
                  onPress={() => setReactionPickerId(null)} 
                  style={StyleSheet.absoluteFill} 
                />
              )}
              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => item.id}
                renderItem={renderMessage}
                contentContainerStyle={styles.messageList}
                onScroll={handleScroll}
                scrollEventThrottle={32}
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={15}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews
                maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
                ListHeaderComponent={
                  isLoadingOlder ? (
                    <View style={{ paddingVertical: 8 }}>
                      <ActivityIndicator size="small" color={theme.primary} />
                    </View>
                  ) : null
                }
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
                    .map((uid) => profiles[uid]?.username)
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
                  {profiles[replyTo.senderId]?.username || 'User'}: {
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

          {/* Input */}
          <View style={[styles.inputContainer, { paddingBottom: insets.bottom }]}>
            {/* Recording Overlay */}
            {isRecording && (
              <View style={styles.recordingOverlay}>
                <Animated.View 
                  style={[
                    styles.recordingIndicator,
                    {
                      opacity: recordingAnimRef.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 1],
                      }),
                    },
                  ]}
                >
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingText}>
                    {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
                  </Text>
                </Animated.View>
                <View style={styles.recordingActions}>
                  <TouchableOpacity onPress={cancelRecording} style={styles.cancelButton}>
                    <Ionicons name="trash-outline" size={20} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={stopRecording} style={styles.sendVoiceButton}>
                    <Ionicons name="send" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {!isRecording && (
              <>
                <TouchableOpacity style={styles.inputButton} onPress={handleCamera}>
                  <Ionicons name="camera" size={22} color={theme.primary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.inputButton} onPress={handleGallery}>
                  <Ionicons name="image" size={22} color={theme.primary} />
                </TouchableOpacity>
              </>
            )}
            
            <TouchableOpacity
              style={[styles.inputButton, isRecording && styles.recordingButton]}
              onPress={isRecording ? stopRecording : startRecording}
            >
              <Ionicons 
                name={isRecording ? 'stop' : 'mic'} 
                size={22} 
                color={isRecording ? '#fff' : theme.primary} 
              />
            </TouchableOpacity>
            
            {!isRecording && (
              <>
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
              </>
            )}
          </View>

          {/* Selected images */}
          {selectedImages.length > 0 && (
            <View style={styles.selectedImagesContainer}>
              {selectedImages.map((uri) => (
                <View key={uri} style={{ marginRight: 6 }}>
                  <Image source={{ uri }} style={styles.selectedImage} />
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
                          <Image
                            source={{
                              uri: item.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.username)}`,
                            }}
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
              <View style={styles.modalPanel} pointerEvents="auto">
                <Text style={styles.modalTitle}>Edit Group</Text>
                
                <TouchableOpacity onPress={handlePickEditPhoto} style={styles.photoPickerRow}>
                  {editPhotoUri || chatMeta.groupMeta?.photoUrl ? (
                    <Image
                      source={{ uri: editPhotoUri || chatMeta.groupMeta?.photoUrl }}
                      style={styles.headerImage}
                    />
                  ) : (
                    <View style={[styles.headerImage, styles.headerIconCircle, { backgroundColor: theme.card }]}>
                      <Ionicons name="image" size={18} color={theme.primary} />
                    </View>
                  )}
                  <Text style={{ color: theme.text, marginLeft: 10 }}>Change photo</Text>
                </TouchableOpacity>

                <TextInput
                  style={styles.input}
                  value={editTitle}
                  onChangeText={(t) => setEditTitle(t.slice(0, 25))}
                  placeholder="Group title"
                  placeholderTextColor={theme.muted}
                />

                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => setEditVisible(false)}
                    style={[styles.modalButton, styles.modalButtonCancel]}
                  >
                    <Text style={styles.modalButtonCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={busy}
                    onPress={handleEditGroup}
                    style={[styles.modalButton, styles.modalButtonPrimary, busy && { opacity: 0.6 }]}
                  >
                    <Text style={styles.modalButtonPrimaryText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Add Users Modal */}
          <Modal visible={addUsersVisible} transparent animationType="fade" onRequestClose={() => setAddUsersVisible(false)}>
            <View style={styles.modalOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setAddUsersVisible(false)} />
              <View style={styles.modalPanel} pointerEvents="auto">
                <Text style={styles.modalTitle}>Add Users</Text>
                <Text style={{ color: theme.muted, marginBottom: 8 }}>Select from your connections</Text>
                
                <FlatList
                  data={friends.filter((f) => !chatMeta.participants.includes(f.uid))}
                  keyExtractor={(item) => item.uid}
                  style={{ maxHeight: 260 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.userRow}
                      onPress={() => setAddingUsersMap((prev) => ({ ...prev, [item.uid]: !prev[item.uid] }))}
                    >
                      <Image
                        source={{
                          uri: item.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.username)}`,
                        }}
                        style={styles.userRowImage}
                      />
                      <Text style={styles.userRowText}>{item.username}</Text>
                      <Ionicons
                        name={addingUsersMap[item.uid] ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={theme.primary}
                      />
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={{ color: theme.muted, textAlign: 'center', marginVertical: 8 }}>
                      No available friends
                    </Text>
                  }
                />

                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      setAddUsersVisible(false);
                      setAddingUsersMap({});
                    }}
                    style={[styles.modalButton, styles.modalButtonCancel]}
                  >
                    <Text style={styles.modalButtonCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={busy}
                    onPress={handleAddUsers}
                    style={[styles.modalButton, styles.modalButtonPrimary, busy && { opacity: 0.6 }]}
                  >
                    <Text style={styles.modalButtonPrimaryText}>Add</Text>
                  </TouchableOpacity>
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
              <View style={styles.modalPanel} pointerEvents="auto">
                <Text style={styles.modalTitle}>
                  Invite {(selectedInvitee || chatMeta.dmPeer)?.username || 'user'}
                </Text>
                
                {myJoinedActivitiesUpcoming.length === 0 ? (
                  <Text style={{ color: theme.muted, textAlign: 'center', marginVertical: 8 }}>
                    You haven't joined any upcoming activities
                  </Text>
                ) : (
                  <FlatList
                    data={myJoinedActivitiesUpcoming}
                    keyExtractor={(item: any) => item.id}
                    style={{ maxHeight: 320, marginVertical: 8 }}
                    renderItem={({ item }: any) => {
                      const targetUser = selectedInvitee || chatMeta.dmPeer;
                      const alreadyJoined = targetUser && 
                        Array.isArray(item?.joinedUserIds) && 
                        item.joinedUserIds.includes(targetUser.uid);

                      return (
                        <Pressable
                          style={[styles.activityRow, alreadyJoined && { opacity: 0.45 }]}
                          onPress={() => {
                            if (alreadyJoined) {
                              showToast(`${targetUser?.username} is already in this activity`);
                              return;
                            }
                            setInviteSelection((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                            <View style={styles.activityIconCircle}>
                              <ActivityIcon activity={item.activity} size={20} color={theme.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.activityName} numberOfLines={1}>
                                {item.activity}
                              </Text>
                              <Text style={styles.activityMeta}>
                                {item.date} • {item.time}
                              </Text>
                            </View>
                          </View>
                          {alreadyJoined ? (
                            <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '600' }}>
                              Joined
                            </Text>
                          ) : (
                            <Ionicons
                              name={inviteSelection[item.id] ? 'checkbox' : 'square-outline'}
                              size={22}
                              color={inviteSelection[item.id] ? theme.primary : theme.muted}
                            />
                          )}
                        </Pressable>
                      );
                    }}
                  />
                )}

                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      setInviteModalVisible(false);
                      setSelectedInvitee(null);
                    }}
                    style={[styles.modalButton, styles.modalButtonCancel]}
                  >
                    <Text style={styles.modalButtonCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSendInvites}
                    style={[styles.modalButton, styles.modalButtonPrimary]}
                  >
                    <Text style={styles.modalButtonPrimaryText}>Send</Text>
                  </TouchableOpacity>
                </View>
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

  // Audio
  audioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
    minWidth: 180,
  },
  audioPlayButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.primaryStrong,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  audioWaveform: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
    overflow: 'hidden',
    marginRight: 8,
  },
  audioWaveformFill: {
    height: 4,
    backgroundColor: theme.primaryStrong,
    borderRadius: 2,
  },
  audioDuration: {
    color: theme.primaryStrong,
    fontWeight: '600',
    fontSize: 11,
    minWidth: 30,
  },
  audioSpeedButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.primaryStrong,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  audioSpeedText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11,
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
  reactionButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  reactionEmoji: {
    fontSize: 20,
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

  // Recording UI
  recordingOverlay: {
    position: 'absolute',
    top: -60,
    left: 10,
    right: 10,
    backgroundColor: theme.card,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: '#ff4444',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 999,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ff4444',
  },
  recordingText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
  },
  recordingActions: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ff4444',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  sendVoiceButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  cancelRecordingButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: theme.background,
  },
  cancelRecordingText: {
    color: '#ff4444',
    fontSize: 14,
    fontWeight: '600',
  },
  recordingButton: {
    backgroundColor: '#ff4444',
    borderColor: '#ff4444',
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

  // Activity Row (Invite)
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
