// screens/ChatDetailScreen.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { PanGestureHandler, PanGestureHandlerGestureEvent, State as GHState } from 'react-native-gesture-handler';
import { useAudioRecorder, useAudioPlayer, AudioModule, RecordingPresets } from 'expo-audio';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import { listenToMessages, sendMessage, markChatRead, ensureDmChat, leaveChatWithAutoDelete, addSystemMessage, pingTyping, clearTyping, addReaction, batchFetchProfiles, listenToLatestMessages, fetchLatestMessagesPage, fetchOlderMessagesPage, listenToReactions } from '../utils/firestoreChats';
import { sendActivityInvites } from '../utils/firestoreInvites';
import { useActivityContext } from '../context/ActivityContext';
import { normalizeDateFormat } from '../utils/storage';
import { doc, getDoc, onSnapshot, collection, query, where, getDocs, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { ActivityIcon } from '../components/ActivityIcons';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { uploadChatImage } from '../utils/imageUtils';
import { sendFriendRequest, cancelFriendRequest } from '../utils/firestoreFriends';

// Firestore message type
type Message = {
  id: string;
  senderId: string;
  text: string;
  type: 'text' | 'image' | 'audio' | 'system';
  timestamp?: any;
  replyToId?: string;
};

const ChatDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<any>();
  const { chatId } = route.params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<{ [userId: string]: any }>({});
  const [messageText, setMessageText] = useState('');
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<any>({});
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
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [activityInfo, setActivityInfo] = useState<{ name: string; type: string; date: string; time: string } | null>(null);
  const [dmPeer, setDmPeer] = useState<{ uid: string; username: string; photo?: string } | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [reactionPickerForId, setReactionPickerForId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; senderId: string; text: string; type: string } | null>(null);
  const [myReactions, setMyReactions] = useState<Record<string, string>>({});
  const [reactionsMap, setReactionsMap] = useState<Record<string, Array<{ userId: string; emoji: string }>>>({});
  const reactionUnsubsRef = useRef<Record<string, () => void>>({});
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const oldestSnapRef = useRef<any>(null);
  const noMoreOlderRef = useRef<boolean>(false);
  const unsubLatestRef = useRef<(() => void) | undefined>(undefined);
  const hasSetupMessagesRef = useRef(false);
  const lastLengthRef = useRef(0);
  const latestLimitRef = useRef(20);
  const reactionAnim = useRef(new Animated.Value(0)).current;
  const longPressTriggeredRef = useRef(false);
  const touchStartXRef = useRef<number | null>(null);
  // Per-message swipe state to prevent all rows from sliding
  const swipeXByIdRef = useRef<Record<string, Animated.Value>>({});
  const swipeArmedByIdRef = useRef<Record<string, boolean>>({});
  const { allActivities, joinedActivities } = useActivityContext();
  const myJoinedActivities = (allActivities || []).filter((a: any) => (joinedActivities || []).includes(a.id));
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteSelection, setInviteSelection] = useState<Record<string, boolean>>({});
  const [myFriendIds, setMyFriendIds] = useState<string[]>([]);
  const [myRequestsSent, setMyRequestsSent] = useState<string[]>([]);
  const [chatReads, setChatReads] = useState<Record<string, any>>({});

  // Bottom toast
  const toastAnim = useRef(new Animated.Value(0)).current;
  const [toastMsg, setToastMsg] = useState('');
  const toastTimeoutRef = useRef<any>(null);
  const showToast = (msg: string) => {
    if (!msg) return;
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMsg(msg);
    Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    toastTimeoutRef.current = setTimeout(() => {
      Animated.timing(toastAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      toastTimeoutRef.current = null;
    }, 2000);
  };

  const flatListRef = useRef<FlatList>(null);
  const progressRef = useRef(0);
  const isInitialLoad = useRef(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isMessagesReady, setIsMessagesReady] = useState(false);
  const navigatedAwayRef = useRef(false);
  const leavingRef = useRef(false);
  const shownExitAlertRef = useRef(false);

  const exitToInbox = () => {
    if (navigatedAwayRef.current) return;
    navigatedAwayRef.current = true;
    if (optionsVisible) setOptionsVisible(false);
    if (participantsVisible) setParticipantsVisible(false);
    if (editVisible) setEditVisible(false);
    if (addUsersVisible) setAddUsersVisible(false);
    setTimeout(() => navigation.navigate('MainTabs' as any, { screen: 'Inbox' } as any), 0);
  };

  const safeExitChat = () => {
    if (navigatedAwayRef.current) return;
    navigatedAwayRef.current = true;
    if (optionsVisible) setOptionsVisible(false);
    if (participantsVisible) setParticipantsVisible(false);
    if (editVisible) setEditVisible(false);
    if (addUsersVisible) setAddUsersVisible(false);
    setTimeout(() => {
      const navAny = navigation as any;
      if (navAny?.canGoBack?.()) {
        navigation.goBack();
      } else {
        navigation.navigate('MainTabs' as any, { screen: 'Inbox' } as any);
      }
    }, 0);
  };

  // Fade-in once messages ready
  useEffect(() => {
    if (isMessagesReady) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    }
  }, [isMessagesReady]);

  // Android nav buttons legibility
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setButtonStyleAsync('light');
    }
  }, []);

  // Clear typing indicator on unmount/switch chat
  useEffect(() => {
    return () => {
      clearTyping(chatId);
    };
  }, [chatId]);

  // Scroll to end when keyboard opens
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });
    return () => {
      keyboardDidShowListener.remove();
    };
  }, []);

  // Listen to Firestore messages (access guard + live typing + latest-N window)
  useEffect(() => {
    const ref = doc(db, 'chats', chatId);
    const unsubAccess = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          if (leavingRef.current || navigatedAwayRef.current) {
            exitToInbox();
            return;
          }
          if (!shownExitAlertRef.current) {
            shownExitAlertRef.current = true;
            Alert.alert('Chat not found', 'This chat no longer exists.', [{ text: 'OK', onPress: () => safeExitChat() }]);
          }
          return;
        }
        const data: any = snap.data();
        const uid = auth.currentUser?.uid;
        if (!uid || !Array.isArray(data.participants) || !data.participants.includes(uid)) {
          if (leavingRef.current || navigatedAwayRef.current) {
            exitToInbox();
            return;
          }
          if (!shownExitAlertRef.current) {
            shownExitAlertRef.current = true;
            Alert.alert('Access Denied', 'You are no longer a participant in this group chat.', [{ text: 'OK', onPress: () => safeExitChat() }]);
          }
          return;
        }
        // Live typing indicators (exclude self, only fresh pings)
        try {
          const dataAny: any = data;
          const typing = dataAny?.typing || {};
          const me = auth.currentUser?.uid;
          const fresh: string[] = [];
          const now = Date.now();
          Object.entries(typing).forEach(([uid, ts]: any) => {
            if (uid === me) return;
            const ms = ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : 0;
            if (ms && now - ms < 3500) fresh.push(uid);
          });
          setTypingUsers(fresh);
        } catch {}
        // Live read receipts map (support reads, seen, lastReadBy)
        try {
          const readsMap: Record<string, any> = (data as any)?.reads || (data as any)?.seen || (data as any)?.lastReadBy || {};
          setChatReads(readsMap || {});
        } catch {}
        // Start latest-N messages subscription once on valid access
        const setupMessages = async () => {
          if (hasSetupMessagesRef.current) return;
          hasSetupMessagesRef.current = true;
          try {
            const { messages: initial, lastSnapshot } = await fetchLatestMessagesPage(chatId, latestLimitRef.current);
            oldestSnapRef.current = lastSnapshot;
            lastLengthRef.current = initial.length;
            setMessages(initial as any as Message[]);
            setIsMessagesReady(true);
            isInitialLoad.current = false;
            noMoreOlderRef.current = !lastSnapshot || (initial.length < latestLimitRef.current);
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 0);
          } catch {}
          // live updates on the latest window
          unsubLatestRef.current = listenToLatestMessages(
            chatId,
            latestLimitRef.current,
            (latest) => {
              setMessages(latest as any as Message[]);
              markChatRead(chatId);
              if (latest.length > lastLengthRef.current) {
                setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 60);
              }
              lastLengthRef.current = latest.length;
            },
            () => {
              if (leavingRef.current || navigatedAwayRef.current) {
                exitToInbox();
                return;
              }
              if (!shownExitAlertRef.current) {
                shownExitAlertRef.current = true;
                Alert.alert('Access Denied', 'You are no longer allowed to view this chat.', [
                  { text: 'OK', onPress: () => safeExitChat() },
                ]);
              }
            }
          );
        };
        setupMessages();
      },
      () => {
        if (leavingRef.current || navigatedAwayRef.current) {
          exitToInbox();
          return;
        }
        if (!shownExitAlertRef.current) {
          shownExitAlertRef.current = true;
          Alert.alert('Access Denied', 'You are no longer allowed to view this chat.', [{ text: 'OK', onPress: () => safeExitChat() }]);
        }
      }
    );
    return () => {
      if (unsubLatestRef.current) {
        try { unsubLatestRef.current(); } catch {}
        unsubLatestRef.current = undefined;
      }
      hasSetupMessagesRef.current = false;
      unsubAccess();
    };
  }, [chatId]);

  // Load older messages when scrolled near top
  const onScroll = useCallback(
    async (e: any) => {
      const y = e?.nativeEvent?.contentOffset?.y || 0;
      if (y <= 40 && !isLoadingOlder && oldestSnapRef.current && !noMoreOlderRef.current) {
        setIsLoadingOlder(true);
        try {
          const { messages: older, lastSnapshot } = await fetchOlderMessagesPage(chatId, oldestSnapRef.current, 20);
          if (older.length) {
            oldestSnapRef.current = lastSnapshot || oldestSnapRef.current;
            setMessages((prev) => {
              const map = new Map<string, Message>();
              [...older, ...prev].forEach((m: any) => map.set(m.id, m));
              return Array.from(map.values()) as any as Message[];
            });
          } else {
            // No more older messages
            noMoreOlderRef.current = true;
          }
        } catch {}
        setIsLoadingOlder(false);
      }
    },
    [isLoadingOlder, chatId]
  );

  // Ensure we have profiles for users currently typing (even if they haven't spoken yet)
  useEffect(() => {
    const loadTypingProfiles = async () => {
      const missing = typingUsers.filter((uid) => !profiles[uid]);
      if (!missing.length) return;
      try {
        const fetched = await batchFetchProfiles(missing);
        setProfiles((prev) => ({ ...prev, ...fetched }));
      } catch {}
    };
    if (typingUsers.length) loadTypingProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typingUsers]);

  // Fetch sender profiles (batched + cached)
  useEffect(() => {
    const fetchProfiles = async () => {
      const uniqueSenderIds = Array.from(new Set(messages.map((m) => m.senderId)));
      if (uniqueSenderIds.length === 0) return;
      const batch = await batchFetchProfiles(uniqueSenderIds);
      setProfiles((prev) => ({ ...prev, ...batch }));
    };
    if (messages.length) fetchProfiles();
    // eslint-disable-next-line
  }, [messages]);

  // Listen to reactions for the visible/latest messages (limit to 60)
  useEffect(() => {
    const limit = 60;
    const currentIds = new Set(messages.slice(-limit).map((m) => m.id));
    // Add listeners for new ids
    messages.slice(-limit).forEach((m) => {
      if (!reactionUnsubsRef.current[m.id]) {
        try {
          const unsub = listenToReactions(
            chatId,
            m.id,
            (items: Array<{ userId: string; emoji: string }>) => setReactionsMap((prev) => ({ ...prev, [m.id]: items })),
            () => {}
          );
          reactionUnsubsRef.current[m.id] = unsub;
        } catch {}
      }
    });
    // Cleanup listeners for messages no longer in window
    Object.keys(reactionUnsubsRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        try { reactionUnsubsRef.current[id](); } catch {}
        delete reactionUnsubsRef.current[id];
        setReactionsMap((prev) => {
          const next = { ...prev } as any;
          delete next[id];
          return next;
        });
      }
    });
    return () => {
      // On unmount of screen we keep existing cleanup in the main effect; no-op here
    };
  }, [messages, chatId]);

  // Fetch chat meta: activity or DM or custom group
  useEffect(() => {
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
        setActivityInfo(null);
        setGroupMeta(null);
        setChatActivityId(null);
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
  }, [chatId]);

  // Load participants for modal
  useEffect(() => {
    const load = async () => {
      if (!participantIds.length) {
        setParticipants([]);
        return;
      }
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

  // Live friend state for current user
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
        const data: any = snap.data();
        const friendIds: string[] = Array.isArray(data?.friends) ? data.friends : [];
        const reqs: string[] = Array.isArray(data?.requestsSent) ? data.requestsSent : [];
        setMyFriendIds(friendIds);
        setMyRequestsSent(reqs);
      },
      () => {
        setMyFriendIds([]);
        setMyRequestsSent([]);
      }
    );
    return () => unsub();
  }, []);

  // Load friends for Add Users modal
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const loadFriends = async () => {
      try {
        const meDoc = await getDoc(doc(db, 'profiles', me));
        if (!meDoc.exists()) {
          setFriends([]);
          return;
        }
        const data: any = meDoc.data();
        const friendIds: string[] = Array.isArray(data?.friends) ? data.friends : [];
        if (!friendIds.length) {
          setFriends([]);
          return;
        }
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
      } catch {}
    };
    loadFriends();
  }, []);

  const openInfoMenu = () => setOptionsVisible(true);
  const closeInfoMenu = () => setOptionsVisible(false);

  const handlePickEditPhoto = async () => {
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
  };

  const handleSaveEdit = async () => {
    if (!groupMeta) return; // only for custom groups
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
    // Add selected friends (not already participants)
    const selected = Object.keys(addingUsersMap).filter((k) => addingUsersMap[k]);
    if (!selected.length) {
      setAddUsersVisible(false);
      return;
    }
    setBusy(true);
    try {
      const toAdd = selected.filter((uid) => !participantIds.includes(uid));
      if (toAdd.length) {
        await updateDoc(doc(db, 'chats', chatId), { participants: arrayUnion(...toAdd) } as any);
        setParticipantIds([...participantIds, ...toAdd]);
        // System message: users added
        const me = auth.currentUser?.uid;
        try {
          const addedProfiles = await Promise.all(
            toAdd.map(async (uid) => {
              const p = await getDoc(doc(db, 'profiles', uid));
              return p.exists() ? ((p.data() as any).username || 'User') : 'User';
            })
          );
          const myProfileSnap = me ? await getDoc(doc(db, 'profiles', me)) : null;
          const myName = myProfileSnap && myProfileSnap.exists() ? ((myProfileSnap.data() as any).username || 'Someone') : 'Someone';
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
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
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
        },
      },
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

  const goToUserProfile = (userId: string) => {
    if (participantsVisible) {
      setParticipantsVisible(false);
      setTimeout(() => navigation.navigate('UserProfile', { userId }), 80);
      return;
    }
    if (optionsVisible) setOptionsVisible(false);
    navigation.navigate('UserProfile', { userId });
  };

  // Play an audio message
  const handlePlayPauseAudio = async (uri: string, id: string) => {
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
  };

  const handleSpeedChange = () => {
    let newRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(newRate);
    audioPlayer.playbackRate = newRate;
  };

  // Send a message (text, image, audio)
  const handleSend = async () => {
    if (!auth.currentUser) return;

    // Send images
    for (const uri of selectedImages) {
      try {
        const imageId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const downloadUrl = await uploadChatImage(uri, auth.currentUser.uid, imageId);
        await sendMessage(chatId, auth.currentUser.uid, downloadUrl, 'image');
      } catch (e: any) {
        Alert.alert('Upload failed', e?.message || 'Could not upload image.');
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
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  };

  // Start recording audio
  const startRecording = async () => {
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Denied', 'Please enable audio recording permissions.');
        return;
      }
      await audioRecorder.record();
    } catch (error) {
      Alert.alert('Recording Error', 'Could not start recording. Please try again.');
    }
  };

  // Stop recording and send as audio message
  const stopRecording = async () => {
    if (!audioRecorder.isRecording || !auth.currentUser) return;
    try {
      const uri = await audioRecorder.stop();
      if (uri != null) {
        await sendMessage(chatId, auth.currentUser.uid, uri, 'audio');
      }
    } catch (error) {
      Alert.alert('Recording Error', 'Could not save the recording.');
    }
  };

  const handleCameraPress = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable camera permissions.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setSelectedImages((prev) => {
        const MAX = 3;
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
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setSelectedImages((prev) => {
        const MAX = 3;
        const remaining = MAX - prev.length;
        if (remaining <= 0) {
          Alert.alert('Limit reached', 'You can only send up to 3 images at a time.');
          return prev;
        }
        const picked = result.assets.map((a) => a.uri).slice(0, remaining);
        const next = [...prev, ...picked];
        if (result.assets.length > remaining) {
          Alert.alert('Limit reached', 'Only the first 3 images will be added.');
        }
        return next;
      });
    }
  };

  const handleRemoveImage = (uriToRemove: string) => {
    setSelectedImages((prev) => prev.filter((uri) => uri !== uriToRemove));
  };

  // --- Instagram-like helpers (added; do not change your existing functions) ---
  const getClusterFlags = (msgs: Message[], idx: number) => {
    const cur = msgs[idx];
    const prev = msgs[idx - 1];
    const next = msgs[idx + 1];
    const isFirst = !prev || prev.senderId !== cur.senderId;
    const isLast = !next || next.senderId !== cur.senderId;
    return { isFirst, isLast };
  };

  const bubbleCorners = (isOwn: boolean, isFirst: boolean, isLast: boolean) => {
    if (isOwn) {
      return {
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        borderBottomRightRadius: isLast ? 18 : 6,
        borderBottomLeftRadius: 18,
      };
    }
    return {
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderBottomLeftRadius: isLast ? 18 : 6,
      borderBottomRightRadius: 18,
    };
  };

  const userAvatar = (username?: string, photo?: string) =>
    photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(username || 'User')}`;

  // Grouping logic + IG-like visuals
  const renderItem = useCallback(({ item, index }: { item: Message; index: number }) => {
    const { isFirst, isLast } = getClusterFlags(messages, index);
    const sender = profiles[item.senderId] || {};
    const isOwn = item.senderId === auth.currentUser?.uid;

    // System message
    if (item.type === 'system') {
      return (
        <View style={{ alignItems: 'center', marginVertical: 8 }}>
          <Text style={{ color: '#aaa', fontStyle: 'italic', fontSize: 13, textAlign: 'center', paddingHorizontal: 10 }}>
            {item.text}
          </Text>
          {!!item.timestamp && (
            <Text style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
              {new Date(item.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
      );
    }

    // Find reply target (if any)
    const replied = item.replyToId ? messages.find((m) => m.id === item.replyToId) : undefined;
    const repliedSender = replied ? (profiles[replied.senderId] || {}) : null;

    return (
      <View style={[styles.rowLine, isOwn ? styles.rowRight : styles.rowLeft]}>
        {/* Avatar column for others, only for the LAST bubble in cluster */}
        {!isOwn && (
          <View style={styles.avatarSlot}>
            {isLast ? (
              <TouchableOpacity onPress={() => navigation.navigate('UserProfile', { userId: item.senderId })} activeOpacity={0.7}>
                <Image
                  source={{ uri: userAvatar(sender.username, sender.photo || sender.photoURL) }}
                  style={styles.bubbleAvatar}
                />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 28 }} />
            )}
          </View>
        )}

        {/* Message column */}
        <View style={[styles.bubbleCol, isOwn && { alignItems: 'flex-end' }]}>
          {/* Username above FIRST bubble of cluster for others */}
          {!isOwn && isFirst && (
            <TouchableOpacity onPress={() => navigation.navigate('UserProfile', { userId: item.senderId })} activeOpacity={0.7}>
              <Text style={styles.nameAbove}>{sender.username || 'User'}</Text>
            </TouchableOpacity>
          )}

          {/* Bubble + anchored reaction picker */}
          <View style={{ position: 'relative', alignSelf: isOwn ? 'flex-end' : 'flex-start' }}>
          {/* Per-row swipe-to-reply handler */}
          {(() => {
            // Initialize per-message animated value
            const swipeX = (swipeXByIdRef.current[item.id] = swipeXByIdRef.current[item.id] || new Animated.Value(0));
            const thresholdPx = 72; // ~2cm swipe to arm reply
            return (
          <PanGestureHandler
            onGestureEvent={Animated.event([{ nativeEvent: { translationX: swipeX } }], { useNativeDriver: true })}
            onHandlerStateChange={(e) => {
              const state: any = e.nativeEvent.state;
              if (state === GHState.ACTIVE) {
                swipeArmedByIdRef.current[item.id] = false;
              }
              if (state === GHState.END || state === GHState.CANCELLED || state === GHState.FAILED) {
                // Reset translation
                try { (swipeX as any).stopAnimation?.(); } catch {}
                swipeX.setValue(0);
                Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
                if (swipeArmedByIdRef.current[item.id]) {
                  setReplyTo({ id: item.id, senderId: item.senderId, text: item.text, type: item.type });
                  swipeArmedByIdRef.current[item.id] = false;
                }
              } else {
                const dx = (e.nativeEvent as any).translationX || 0;
                if (dx > thresholdPx && !swipeArmedByIdRef.current[item.id]) {
                  swipeArmedByIdRef.current[item.id] = true;
                  Haptics.selectionAsync().catch(() => {});
                }
              }
            }}
            activeOffsetX={[-5, 5]}
          >
          <Animated.View style={{ transform: [{ translateX: swipeX }] }}>
          <Pressable
            style={[
              styles.messageBubble,
              isOwn ? styles.yourMessage : styles.theirMessage,
              bubbleCorners(isOwn, isFirst, isLast),
              item.type === 'image' && styles.imageBubblePad,
            ]}
            onLongPress={() => {
              longPressTriggeredRef.current = true;
              Haptics.selectionAsync().catch(() => {});
              setReactionPickerForId((prev) => (prev === item.id ? null : item.id));
              reactionAnim.setValue(0);
              Animated.spring(reactionAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 120 }).start();
            }}
            onPressIn={(e) => {
              touchStartXRef.current = e.nativeEvent.pageX;
            }}
            onPressOut={(e) => {
              const start = touchStartXRef.current;
              touchStartXRef.current = null;
              if (longPressTriggeredRef.current) {
                // consume long press
                longPressTriggeredRef.current = false;
                return;
              }
              if (typeof start === 'number') {
                const dx = e.nativeEvent.pageX - start;
                if (dx > 40) {
                  Haptics.selectionAsync().catch(() => {});
                  setReplyTo({ id: item.id, senderId: item.senderId, text: item.text, type: item.type });
                }
              }
            }}
          >
            {/* Reply header */}
            {replied && (
              <View style={[styles.replyHeader, isOwn ? styles.replyHeaderOwn : styles.replyHeaderOther]}>
                <Text style={styles.replyHeaderName} numberOfLines={1}>
                  {repliedSender?.username || 'User'}
                </Text>
                <Text style={styles.replyHeaderSnippet} numberOfLines={1}>
                  {replied.type === 'text' ? replied.text : replied.type === 'image' ? 'Photo' : replied.type === 'audio' ? 'Voice message' : replied.text}
                </Text>
              </View>
            )}
            {item.type === 'text' && (
              <Text style={[styles.messageText, isOwn && styles.userMessageText]}>{item.text}</Text>
            )}

            {item.type === 'audio' && (
              <View style={styles.audioBubbleRow}>
                <TouchableOpacity
                  onPress={() => handlePlayPauseAudio(item.text, item.id)}
                  style={styles.audioPlayButton}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={playingAudioId === item.id && audioPlayer.playing ? 'pause' : 'play-arrow'}
                    size={18}
                    color="#fff"
                  />
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

            {item.type === 'image' && (
              <TouchableOpacity activeOpacity={0.9} onPress={() => item.text && setViewerUri(item.text)}>
                <Image
                  source={{
                    uri: typeof item.text === 'string' && item.text ? item.text : userAvatar(sender.username),
                  }}
                  style={[styles.media, bubbleCorners(isOwn, isFirst, isLast)]}
                />
              </TouchableOpacity>
            )}

            {!!item.timestamp && (
              <Text style={[styles.messageTime, isOwn && styles.userMessageTime]}>
                {new Date(item.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </Pressable>
          </Animated.View>
          </PanGestureHandler>
            );
          })()}
          {/* Reactions aggregate chips at top-right of bubble */}
          {!!reactionsMap[item.id]?.length && (
            <View style={[styles.reactionChipsWrap, { right: 6 }]}>
              {Object.entries(
                reactionsMap[item.id].reduce((acc: Record<string, number>, r) => {
                  acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                  return acc;
                }, {})
              ).map(([emo, count]) => (
                <View key={emo} style={styles.reactionChip}>
                  <Text style={styles.reactionChipText}>{emo}{count > 1 ? ` ${count}` : ''}</Text>
                </View>
              ))}
            </View>
          )}
          {/* Reaction picker (anchored, animated) */}
          {reactionPickerForId === item.id && (
            <Animated.View
              style={[
                styles.reactionPickerRow,
                {
                  position: 'absolute',
                  top: -8,
                  // Place beside the bubble: to right for others, to left for own
                  left: isOwn ? undefined : '100%',
                  right: isOwn ? '100%' : undefined,
                  transform: [{ scale: reactionAnim }],
                  opacity: reactionAnim,
                },
              ]}
            >
              {['❤️','👍','🔥','😂','👏','😮'].map((emo) => (
                <TouchableOpacity
                  key={emo}
                  onPress={async () => {
                    try {
                      await addReaction(chatId, item.id, emo);
                      setMyReactions((prev) => ({ ...prev, [item.id]: emo }));
                      // Optimistic aggregate update so chips show instantly
                      setReactionsMap((prev) => {
                        const arr = prev[item.id] || [];
                        const me = auth.currentUser?.uid || 'me';
                        // replace existing my reaction if present
                        const others = arr.filter((r) => r.userId !== me);
                        return { ...prev, [item.id]: [...others, { userId: me, emoji: emo }] };
                      });
                      setReactionPickerForId(null);
                    } catch {}
                  }}
                  style={styles.reactionBtn}
                >
                  <Text style={styles.reactionEmoji}>{emo}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setReplyTo({ id: item.id, senderId: item.senderId, text: item.text, type: item.type });
                  setReactionPickerForId(null);
                }}
                style={[styles.reactionBtn, { paddingHorizontal: 8 }]}
              >
                <Ionicons name="return-down-back" size={18} color="#fff" />
              </TouchableOpacity>
              {item.type === 'text' && typeof item.text === 'string' && (
                <TouchableOpacity
                  onPress={async () => {
                    try { await Clipboard.setStringAsync(item.text); showToast('Copied'); } catch {}
                    setReactionPickerForId(null);
                  }}
                  style={[styles.reactionBtn, { paddingHorizontal: 8 }]}
                >
                  <Ionicons name="copy-outline" size={18} color="#fff" />
                </TouchableOpacity>
              )}
            </Animated.View>
          )}
          </View>

          {/* Inline reaction counts under bubble (iMessage style) */}
          {!!reactionsMap[item.id]?.length && (
            <View style={[styles.reactionCountsRow, isOwn ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
              <Text style={styles.reactionCountsText}>
                {Object.entries(
                  reactionsMap[item.id].reduce((acc: Record<string, number>, r) => {
                    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                    return acc;
                  }, {})
                )
                  .map(([emo, count]) => `${emo}${count > 1 ? ` x${count}` : ''}`)
                  .join(', ')}
              </Text>
            </View>
          )}

          {/* My reaction display */}
          {myReactions[item.id] && (
            <View style={[styles.myReactionTag, isOwn ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
              <Text style={{ fontSize: 12 }}>{myReactions[item.id]}</Text>
            </View>
          )}

          {/* Read receipts: DM shows 'Read' for peer; Groups show small avatars of readers (excluding me) */}
          {(() => {
            const ts = (t: any) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : typeof t === 'number' ? t : 0);
            const msgMs = ts(item.timestamp);
            // DM read
            if (dmPeer && isOwn && msgMs) {
              const peerTs = ts(chatReads?.[dmPeer.uid]);
              if (peerTs && peerTs >= msgMs) {
                return (
                  <View style={[styles.readAvatarsRow, { alignSelf: 'flex-end' }]}>
                    <Ionicons name="checkmark-done" size={14} color="#9ddfe1" />
                    <Text style={styles.readText}>Read</Text>
                  </View>
                );
              }
              return null;
            }
            // Group/activity read avatars (only on my own messages)
            if (!dmPeer && isOwn && msgMs && participantIds?.length) {
              const readers = participants
                .filter((p) => p.uid !== auth.currentUser?.uid)
                .filter((p) => {
                  const r = chatReads?.[p.uid];
                  const rMs = ts(r);
                  return rMs && rMs >= msgMs;
                });
              if (readers.length) {
                const shown = readers.slice(0, 5);
                const extra = readers.length - shown.length;
                return (
                  <View style={[styles.readAvatarsRow, { alignSelf: 'flex-end' }]}>
                    {shown.map((p) => (
                      <Image key={p.uid} source={{ uri: p.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(p.username) }} style={styles.readAvatar} />
                    ))}
                    {extra > 0 ? <Text style={styles.readText}>+{extra}</Text> : null}
                  </View>
                );
              }
            }
            return null;
          })()}
        </View>
      </View>
    );
  }, [messages, profiles, playingAudioId, audioPlayer.playing, audioPlayer.duration, playbackRate, reactionPickerForId, myReactions]);

  // Render
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#121212' }} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={styles.flexContainer}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={safeExitChat} style={styles.headerBack}>
              <Ionicons name="arrow-back" size={26} color="#1ae9ef" />
            </TouchableOpacity>
            {dmPeer ? (
              (() => {
                const isFriend = dmPeer ? myFriendIds.includes(dmPeer.uid) : false;
                const isRequested = dmPeer ? myRequestsSent.includes(dmPeer.uid) : false;
                return (
                  <>
                    <TouchableOpacity onPress={() => dmPeer?.uid && goToUserProfile(dmPeer.uid)} activeOpacity={0.8}>
                      <Image
                        source={{
                          uri: dmPeer.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(dmPeer.username),
                        }}
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
                                setInviteModalVisible(true);
                              }}
                            >
                              <Ionicons name="add-circle-outline" size={18} color="#000" />
                              <Text style={styles.inviteBtnText}>Invite</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                            <TouchableOpacity
                              style={styles.msgBtn}
                              activeOpacity={0.85}
                              onPress={() => dmPeer && handleAddFriend(dmPeer.uid)}
                            >
                              <Ionicons name="person-add-outline" size={18} color={'#1ae9ef'} style={{ marginRight: 4 }} />
                              <Text style={styles.msgBtnText}>Add Friend</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.inviteBtn, { marginLeft: 6 }]}
                              onPress={() => {
                                setInviteSelection({});
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
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    borderWidth: 1,
                    borderColor: '#1ae9ef',
                    marginLeft: 6,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'transparent',
                  }}
                >
                  {activityInfo?.type ? <ActivityIcon activity={activityInfo.type} size={22} color="#1ae9ef" /> : null}
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: '#1ae9ef', fontWeight: 'bold', fontSize: 17 }}>
                    {activityInfo?.name || 'Group Chat'}
                  </Text>
                  {activityInfo?.date && activityInfo?.time && (
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '500' }}>
                      Scheduled for {normalizeDateFormat(activityInfo.date)} at {activityInfo.time}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={openInfoMenu} style={styles.headerInfo}>
                  <Ionicons name="information-circle-outline" size={26} color="#1ae9ef" />
                </TouchableOpacity>
              </>
            ) : (
              <>
                {groupMeta?.photoUrl ? (
                  <Image source={{ uri: groupMeta.photoUrl }} style={styles.headerImage} />
                ) : (
                  <View
                    style={[
                      styles.headerImage,
                      { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1ae9ef' },
                    ]}
                  >
                    <Ionicons name="people" size={22} color="#1ae9ef" />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.headerTitle}>{groupMeta?.title || 'Group Chat'}</Text>
                </View>
                <TouchableOpacity onPress={openInfoMenu} style={styles.headerInfo}>
                  <Ionicons name="information-circle-outline" size={26} color="#1ae9ef" />
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Invite modal for DM peer */}
          <Modal
            visible={inviteModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setInviteModalVisible(false)}
          >
            <View style={styles.menuOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setInviteModalVisible(false)} />
              <View style={styles.modalPanel} pointerEvents="auto">
                <Text style={styles.modalTitle}>Invite {dmPeer?.username || 'user'}</Text>
                {myJoinedActivities.length === 0 ? (
                  <Text style={styles.placeholderText}>You haven't joined any activities yet.</Text>
                ) : (
                  <FlatList
                    data={myJoinedActivities}
                    keyExtractor={(a: any) => a.id}
                    renderItem={({ item }: any) => {
                      const targetAlreadyJoined = !!(
                        dmPeer &&
                        Array.isArray(item?.joinedUserIds) &&
                        item.joinedUserIds.includes(dmPeer.uid)
                      );
                      return (
                        <Pressable
                          style={[
                            styles.row,
                            { justifyContent: 'space-between' },
                            targetAlreadyJoined && { opacity: 0.45 },
                          ]}
                          onPress={() => {
                            if (targetAlreadyJoined) {
                              showToast(`${dmPeer?.username || 'User'} is already in this activity`);
                              return;
                            }
                            setInviteSelection((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <ActivityIcon activity={item.activity} size={22} color="#1ae9ef" />
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
                              color={inviteSelection[item.id] ? '#1ae9ef' : '#666'}
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
                  <TouchableOpacity
                    onPress={() => setInviteModalVisible(false)}
                    style={[styles.modalButton, { backgroundColor: '#8e2323' }]}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={async () => {
                      if (!dmPeer) return;
                      const selectedIds = Object.keys(inviteSelection).filter((id) => inviteSelection[id]);
                      if (selectedIds.length === 0) {
                        setInviteModalVisible(false);
                        return;
                      }
                      const eligible = selectedIds.filter((id) => {
                        const act = (allActivities || []).find((a: any) => a.id === id);
                        const joinedIds = (act as any)?.joinedUserIds || [];
                        return !(Array.isArray(joinedIds) && dmPeer && joinedIds.includes(dmPeer.uid));
                      });
                      if (eligible.length === 0) {
                        showToast(`${dmPeer.username} is already in those activities`);
                        return;
                      }
                      try {
                        const { sentIds } = await sendActivityInvites(dmPeer.uid, eligible);
                        if (sentIds.length > 0) showToast(sentIds.length === 1 ? 'Invite sent' : `Sent ${sentIds.length} invites`);
                        else showToast('No invites sent');
                      } catch {
                        showToast('Could not send invites');
                      }
                      setInviteModalVisible(false);
                      setInviteSelection({});
                    }}
                    style={[styles.modalButton, { backgroundColor: '#1ae9ef', marginLeft: 8 }]}
                  >
                    <Text style={{ color: '#000', fontWeight: '700' }}>Send</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Group info menu */}
          <Modal visible={optionsVisible} transparent animationType="fade" onRequestClose={closeInfoMenu}>
            <View style={styles.menuOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={closeInfoMenu} />
              <View style={styles.menuPanel} pointerEvents="auto">
                {groupMeta ? (
                  <>
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => {
                        setEditVisible(true);
                        setOptionsVisible(false);
                      }}
                    >
                      <Text style={styles.menuItemText}>Edit group (title & photo)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => {
                        setAddUsersVisible(true);
                        setOptionsVisible(false);
                      }}
                    >
                      <Text style={styles.menuItemText}>Add users</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => {
                        setParticipantsVisible(true);
                        setOptionsVisible(false);
                      }}
                    >
                      <Text style={styles.menuItemText}>View participants</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.menuItemDanger}
                      onPress={() => {
                        setOptionsVisible(false);
                        handleLeaveCustomGroup();
                      }}
                    >
                      <Text style={styles.menuItemDangerText}>Leave group</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => {
                        setParticipantsVisible(true);
                        setOptionsVisible(false);
                      }}
                    >
                      <Text style={styles.menuItemText}>View participants</Text>
                    </TouchableOpacity>
                    {!!chatActivityId && (
                      <TouchableOpacity
                        style={styles.menuItem}
                        onPress={() => {
                          setOptionsVisible(false);
                          navigation.navigate('ActivityDetails' as any, { activityId: chatActivityId });
                        }}
                      >
                        <Text style={styles.menuItemText}>Go to activity details</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
                <TouchableOpacity style={[styles.menuItem, { marginTop: 8 }]} onPress={closeInfoMenu}>
                  <Text style={[styles.menuItemText, { color: '#aaa' }]}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Edit custom group modal */}
          <Modal
            visible={!!(editVisible && groupMeta)}
            transparent
            animationType="fade"
            onRequestClose={() => setEditVisible(false)}
          >
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
                          { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c0c0c', borderWidth: 1, borderColor: '#1ae9ef' },
                        ]}
                      >
                        <Ionicons name="image" size={18} color="#1ae9ef" />
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
                      style={[styles.modalButton, { backgroundColor: '#1ae9ef', marginLeft: 8, opacity: busy ? 0.6 : 1 }]}
                    >
                      <Text style={{ color: '#000', fontWeight: '700' }}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </Modal>

          {/* Add users modal */}
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
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => setAddingUsersMap((prev) => ({ ...prev, [item.uid]: !prev[item.uid] }))}
                    >
                      <Image
                        source={{ uri: item.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username) }}
                        style={styles.rowImage}
                      />
                      <Text style={styles.rowText}>{item.username}</Text>
                      <Ionicons
                        name={addingUsersMap[item.uid] ? 'checkbox' : 'square-outline'}
                        size={22}
                        color="#1ae9ef"
                      />
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={{ color: '#777', textAlign: 'center', marginVertical: 8 }}>No available friends to add</Text>
                  }
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
                    style={[styles.modalButton, { backgroundColor: '#1ae9ef', marginLeft: 8, opacity: busy ? 0.6 : 1 }]}
                  >
                    <Text style={{ color: '#000', fontWeight: '700' }}>Add</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Participants modal */}
          <Modal
            visible={participantsVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setParticipantsVisible(false)}
          >
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
                        <TouchableOpacity
                          onPress={() => goToUserProfile(item.uid)}
                          style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                        >
                          <Image
                            source={{
                              uri: item.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username),
                            }}
                            style={styles.rowImage}
                          />
                          <Text style={[styles.rowText, { flex: 1 }]}>
                            {item.username}
                            {isMe ? ' (You)' : ''}
                          </Text>
                        </TouchableOpacity>
                        {!isMe && groupMeta && (
                          <>
                            <TouchableOpacity onPress={() => handleMessageUser(item.uid)} style={[styles.chip, { backgroundColor: '#1ae9ef' }]}>
                              <Text style={{ color: '#000', fontWeight: '700' }}>Message</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleAddFriend(item.uid)}
                              style={[styles.chip, { marginLeft: 6, borderColor: '#1ae9ef', borderWidth: 1 }]}
                            >
                              <Text style={{ color: '#1ae9ef', fontWeight: '700' }}>Add Friend</Text>
                            </TouchableOpacity>
                          </>
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

          {/* Messages area */}
          {!isMessagesReady ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
              <ActivityIndicator size="large" color="#1ae9ef" />
            </View>
          ) : (
            <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
              {reactionPickerForId && (
                <Pressable onPress={() => setReactionPickerForId(null)} style={StyleSheet.absoluteFill} />
              )}
              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.messageList}
                renderItem={renderItem}
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                keyboardShouldPersistTaps="handled"
                onLayout={() => {
                  if (messages.length > 0) flatListRef.current?.scrollToEnd({ animated: false });
                }}
                onScroll={onScroll}
                scrollEventThrottle={32}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews
                maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
                ListHeaderComponent={isLoadingOlder ? (
                  <View style={{ paddingVertical: 8 }}>
                    <ActivityIndicator size="small" color="#1ae9ef" />
                  </View>
                ) : null}
              />
            </Animated.View>
          )}

          {/* Typing indicator */}
          {typingUsers.length > 0 && (
            <View style={{ paddingHorizontal: 12, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TypingDots />
              <Text style={{ color: '#9ddfe1', fontSize: 12 }}>
                {(() => {
                  // Build names list for group/activity; default to generic for DM
                  const names = typingUsers
                    .map((uid) => profiles[uid]?.username)
                    .filter(Boolean) as string[];
                  if (names.length === 0) return 'Typing…';
                  if (names.length === 1) return `${names[0]} is typing…`;
                  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
                  return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing…`;
                })()}
              </Text>
            </View>
          )}

          {/* Reply bar above input */}
          {replyTo && (
            <View style={[styles.replyBar, { marginHorizontal: 10, marginBottom: 6 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.replyBarLabel}>Replying to</Text>
                <Text style={styles.replyBarText} numberOfLines={1}>
                  {profiles[replyTo.senderId]?.username || 'User'}: {replyTo.type === 'text' ? replyTo.text : replyTo.type === 'image' ? 'Photo' : replyTo.type === 'audio' ? 'Voice message' : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyTo(null)} style={{ padding: 6 }}>
                <Ionicons name="close" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {/* Input area */}
          <View style={[styles.inputContainer, { paddingBottom: insets.bottom }]}>
            <TouchableOpacity style={styles.inputCircleButton} onPress={handleCameraPress}>
              <Ionicons name="camera" size={22} color="#007575" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputCircleButton} onPress={handleGalleryPress}>
              <Ionicons name="image" size={22} color="#007575" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.inputCircleButton}
              onPress={audioRecorder.isRecording ? stopRecording : startRecording}
            >
              <Ionicons name={audioRecorder.isRecording ? 'stop' : 'mic'} size={22} color="#007575" />
            </TouchableOpacity>
            <TextInput
              style={styles.inputText}
              placeholder="Message..."
              placeholderTextColor="#888"
              value={messageText}
              onChangeText={(t) => {
                setMessageText(t);
                pingTyping(chatId);
              }}
              autoCapitalize="sentences"
              autoCorrect={true}
              textContentType="none"
              autoComplete="off"
              keyboardType="default"
              returnKeyType="send"
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
              multiline
              maxLength={2000}
              textAlignVertical="center"
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
              <Ionicons name="send" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Selected images preview */}
          {selectedImages.length > 0 && (
            <View style={{ flexDirection: 'row', margin: 8 }}>
              {selectedImages.map((uri) => (
                <View key={uri} style={{ marginRight: 6 }}>
                  {typeof uri === 'string' && uri ? (
                    <Image source={{ uri }} style={{ width: 60, height: 60, borderRadius: 10 }} />
                  ) : (
                    <Image source={require('../assets/default-group.png')} style={{ width: 60, height: 60, borderRadius: 10 }} />
                  )}
                  <TouchableOpacity
                    onPress={() => handleRemoveImage(uri)}
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: 'red',
                      justifyContent: 'center',
                      alignItems: 'center',
                      borderWidth: 2,
                      borderColor: '#fff',
                      zIndex: 1,
                      elevation: 2,
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18, lineHeight: 20 }}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Full-screen image viewer */}
          {viewerUri && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.95)',
                zIndex: 999,
              }}
            >
              <SafeAreaView style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                  <TouchableOpacity onPress={() => setViewerUri(null)} style={styles.headerBack}>
                    <Ionicons name="arrow-back" size={26} color="#1ae9ef" />
                  </TouchableOpacity>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Image source={{ uri: viewerUri }} style={{ width: '100%', height: '100%', resizeMode: 'contain' }} />
                </View>
              </SafeAreaView>
            </View>
          )}
        </View>

        {/* Bottom toast */}
        <Animated.View
          pointerEvents={toastMsg ? 'auto' : 'none'}
          style={{
            position: 'absolute',
            left: 20,
            right: 20,
            bottom: 24,
            backgroundColor: 'rgba(0,0,0,0.85)',
            borderColor: '#2a2a2a',
            borderWidth: 1,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
            alignItems: 'center',
            transform: [
              { translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
            ],
            opacity: toastAnim,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{toastMsg}</Text>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// Small animated typing dots
const TypingDots = ({ color = '#1ae9ef' }: { color?: string }) => {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    a.setValue(0);
    const loop = Animated.loop(
      Animated.timing(a, { toValue: 1, duration: 900, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  const dot = (i: number) => ({
    opacity: a.interpolate({ inputRange: [0, 0.5, 1], outputRange: i === 0 ? [1, 0.3, 1] : i === 1 ? [0.3, 1, 0.3] : [0.3, 0.3, 1] }),
    transform: [
      { translateY: a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -2, 0] }) },
    ],
  });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Animated.View style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }, dot(0)]} />
      <Animated.View style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }, dot(1)]} />
      <Animated.View style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }, dot(2)]} />
    </View>
  );
};

// Helper to format date as dd-mm-yyyy
function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const [yyyy, mm, dd] = dateStr.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

const styles = StyleSheet.create({
  flexContainer: { flex: 1 },
  container: { flex: 1, backgroundColor: '#121212' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18191a',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerBack: { padding: 4 },
  headerImage: { width: 38, height: 38, borderRadius: 19, marginLeft: 6 },
  headerTitle: { color: '#fff', fontWeight: 'bold', fontSize: 17, letterSpacing: 0.2 },
  headerInfo: { padding: 4, marginLeft: 8 },

  // List
  messageList: { paddingTop: 6, paddingBottom: 8 },

  // IG-like row layout
  rowLine: { flexDirection: 'row', paddingHorizontal: 10, marginBottom: 2, alignItems: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },

  avatarSlot: { width: 36, alignItems: 'center', justifyContent: 'flex-end', marginRight: 6 },
  bubbleAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: '#1ae9ef' },

  bubbleCol: { maxWidth: '78%' },
  nameAbove: { color: '#9ddfe1', fontWeight: '600', fontSize: 12, marginLeft: 6, marginBottom: 2 },

  messageBubble: { paddingVertical: 6, paddingHorizontal: 10, marginVertical: 2 },
  yourMessage: { backgroundColor: '#1ae9ef', alignSelf: 'flex-end' },
  theirMessage: { backgroundColor: '#1f1f1f', alignSelf: 'flex-start' },
  imageBubblePad: { padding: 4 },

  replyHeader: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderLeftWidth: 3,
    borderRadius: 8,
    marginBottom: 6,
  },
  replyHeaderOwn: { backgroundColor: '#c6f8fa', borderLeftColor: '#007575' },
  replyHeaderOther: { backgroundColor: '#2a2a2a', borderLeftColor: '#1ae9ef' },
  replyHeaderName: { color: '#1ae9ef', fontWeight: '700', fontSize: 12 },
  replyHeaderSnippet: { color: '#ccc', fontSize: 12 },

  messageText: { fontSize: 16, color: '#fff' },
  userMessageText: { color: '#000' },
  messageTime: { fontSize: 10, color: '#c9c9c9', alignSelf: 'flex-end', marginTop: 3 },
  userMessageTime: { color: '#075e5e' },

  media: { width: 240, height: undefined, aspectRatio: 4 / 3 },

  // Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#1e1e1e',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18191a',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  inputText: {
    flex: 1,
    backgroundColor: '#232323',
    color: '#fff',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 8 : 6,
    marginHorizontal: 8,
    fontSize: 16,
    minHeight: 36,
    maxHeight: 120,
  },
  sendButton: { backgroundColor: '#1ae9ef', borderRadius: 18, padding: 8, marginLeft: 4 },

  // Audio bubble
  audioBubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1ae9ef',
    borderRadius: 14,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginVertical: 4,
    minWidth: 120,
    height: 36,
  },
  audioPlayButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#007575',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  audioWaveformBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#b2f5f5',
    borderRadius: 2,
    overflow: 'hidden',
    marginRight: 6,
  },
  audioWaveformFill: { height: 4, backgroundColor: '#007575', borderRadius: 2 },
  audioDurationRight: { color: '#007575', fontWeight: 'bold', fontSize: 12, minWidth: 38, textAlign: 'right' },
  audioSpeedButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#007575',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  audioSpeedText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },

  inputCircleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e1e1e',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    borderWidth: 2,
    borderColor: '#007575',
  },

  // Menus / modals
  menuOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 54,
    paddingRight: 8,
    zIndex: 9999,
    elevation: 20,
  },
  menuPanel: {
    width: 260,
    backgroundColor: '#18191a',
    borderRadius: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    zIndex: 10000,
    elevation: 24,
  },
  menuItem: { paddingVertical: 10, paddingHorizontal: 12 },
  menuItemText: { color: '#fff', fontSize: 15 },
  menuItemDanger: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#311', borderTopWidth: 1, borderTopColor: '#3a1f1f' },
  menuItemDangerText: { color: '#ff4d4f', fontSize: 15, fontWeight: '700' },

  modalPanel: {
    width: '92%',
    backgroundColor: '#18191a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignSelf: 'center',
  },
  modalTitle: { color: '#1ae9ef', fontWeight: 'bold', fontSize: 18, marginBottom: 10 },
  photoPickerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  input: { backgroundColor: '#232323', color: '#fff', borderRadius: 8, paddingHorizontal: 12, height: 40 },

  // Added placeholderText style used in the invite modal when no joined activities exist
  placeholderText: { color: '#777', textAlign: 'center', marginVertical: 8 },

  smallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1ae9ef',
  },
  smallActionText: { color: '#000', fontWeight: '700', fontSize: 12, marginLeft: 6 },

  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1ae9ef',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  inviteBtnText: { color: '#000', fontWeight: '700', fontSize: 11, marginLeft: 6 },
  msgBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#1ae9ef', borderRadius: 16, paddingVertical: 5, paddingHorizontal: 8 },
  msgBtnText: { color: '#1ae9ef', fontWeight: '700', fontSize: 11, marginLeft: 6 },
  msgBtnFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1ae9ef',
    borderWidth: 1,
    borderColor: '#1ae9ef',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  msgBtnTextInverted: { color: '#000', fontWeight: '700', fontSize: 11, marginLeft: 6 },

  modalButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6 },
  rowImage: { width: 36, height: 36, borderRadius: 18, marginRight: 10, borderWidth: 1, borderColor: '#1ae9ef' },
  rowText: { color: '#fff', fontSize: 15 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },

  reactionPickerRow: {
    flexDirection: 'row',
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginTop: 4,
  },
  reactionBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  reactionEmoji: { fontSize: 18 },
  reactionChipsWrap: {
    position: 'absolute',
    top: -12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reactionChip: {
    backgroundColor: '#2a2a2a',
    borderColor: '#3a3a3a',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reactionChipText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  reactionCountsRow: { marginTop: 4 },
  reactionCountsText: { color: '#aaa', fontSize: 11 },
  myReactionTag: {
    backgroundColor: '#232323',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
    borderWidth: 1,
    borderColor: '#333',
  },
  readAvatarsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  readAvatar: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: '#1ae9ef' },
  readText: { color: '#9ddfe1', fontSize: 11, marginLeft: 4 },

  replyBar: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  replyBarLabel: { color: '#9ddfe1', fontSize: 11, fontWeight: '700' },
  replyBarText: { color: '#fff', fontSize: 12, marginTop: 2 },
});

export default React.memo(ChatDetailScreen);
