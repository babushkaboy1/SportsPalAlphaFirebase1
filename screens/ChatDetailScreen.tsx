// screens/ChatDetailScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
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
import { useAudioRecorder, useAudioPlayer, AudioModule, RecordingPresets } from 'expo-audio';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { listenToMessages, sendMessage, markChatRead, ensureDmChat, leaveChatWithAutoDelete, addSystemMessage } from '../utils/firestoreChats';
import { sendActivityInvites } from '../utils/firestoreInvites';
import { useActivityContext } from '../context/ActivityContext';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { ActivityIcon } from '../components/ActivityIcons'; // Make sure this is imported
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { uploadChatImage } from '../utils/imageUtils';
import { sendFriendRequest, cancelFriendRequest } from '../utils/firestoreFriends';
import { collection, query, where, getDocs, updateDoc, arrayUnion, arrayRemove, deleteDoc } from 'firebase/firestore';

// Firestore message type
type Message = {
  id: string;
  senderId: string;
  text: string;
  type: 'text' | 'image' | 'audio' | 'system';
  timestamp?: any;
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
  const [activityInfo, setActivityInfo] = useState<{ name: string, type: string, date: string, time: string } | null>(null);
  const [dmPeer, setDmPeer] = useState<{ uid: string; username: string; photo?: string } | null>(null);
  const { allActivities, joinedActivities } = useActivityContext();
  const myJoinedActivities = (allActivities || []).filter((a: any) => (joinedActivities || []).includes(a.id));
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteSelection, setInviteSelection] = useState<Record<string, boolean>>({});
  const [myFriendIds, setMyFriendIds] = useState<string[]>([]);
  const [myRequestsSent, setMyRequestsSent] = useState<string[]>([]);

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
    // Close any overlays
    if (optionsVisible) setOptionsVisible(false);
    if (participantsVisible) setParticipantsVisible(false);
    if (editVisible) setEditVisible(false);
    if (addUsersVisible) setAddUsersVisible(false);
    // Prefer natural back transition when possible; fallback to Inbox if no back stack
    setTimeout(() => {
      const navAny = navigation as any;
      if (navAny?.canGoBack?.()) {
        navigation.goBack();
      } else {
        navigation.navigate('MainTabs' as any, { screen: 'Inbox' } as any);
      }
    }, 0);
  };

  // Set Android navigation bar to dark on mount (only on Android)
  useEffect(() => {
    if (isMessagesReady) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }
  }, [isMessagesReady]);
  useEffect(() => {
    if (Platform.OS === 'android') {
      // NavigationBar.setBackgroundColorAsync is not supported with edge-to-edge enabled
      NavigationBar.setButtonStyleAsync('light');
    }
  }, []);

  // Use native back behavior (hardware/gesture) for proper animations; header back uses safeExitChat.

  // Keyboard listeners - scroll to bottom when keyboard opens
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

  // Listen to Firestore messages only after confirming access to the chat
  useEffect(() => {
    let unsubscribeMessages: undefined | (() => void);
    const ref = doc(db, 'chats', chatId);
    const unsubAccess = onSnapshot(ref, (snap) => {
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
      // Start messages subscription if not already
      if (!unsubscribeMessages) {
        unsubscribeMessages = listenToMessages(
          chatId,
          (msgs: any[]) => {
            const sorted = msgs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
            const prevLength = messages.length;
            setMessages(sorted);
            // Mark read on view
            markChatRead(chatId);
            if (!isInitialLoad.current && sorted.length > prevLength) {
              setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
              }, 100);
            }
            if (isInitialLoad.current) {
              isInitialLoad.current = false;
              setIsMessagesReady(true);
            }
          },
          (error) => {
            // Permission denied or other errors: exit chat
            if (leavingRef.current || navigatedAwayRef.current) { exitToInbox(); return; }
            if (!shownExitAlertRef.current) {
              shownExitAlertRef.current = true;
              Alert.alert('Access Denied', 'You are no longer allowed to view this chat.', [{ text: 'OK', onPress: () => safeExitChat() }]);
            }
          }
        );
      }
    }, (error) => {
      if (leavingRef.current || navigatedAwayRef.current) { exitToInbox(); return; }
      if (!shownExitAlertRef.current) {
        shownExitAlertRef.current = true;
        Alert.alert('Access Denied', 'You are no longer allowed to view this chat.', [{ text: 'OK', onPress: () => safeExitChat() }]);
      }
    });
    return () => {
      if (unsubscribeMessages) unsubscribeMessages();
      unsubAccess();
    };
  }, [chatId, messages.length]);

  // Fetch sender profiles
  useEffect(() => {
    const fetchProfiles = async () => {
      const uniqueSenderIds = Array.from(new Set(messages.map(m => m.senderId)));
      const newProfiles: { [userId: string]: any } = { ...profiles };
      for (const userId of uniqueSenderIds) {
        if (!newProfiles[userId]) {
          const docSnap = await getDoc(doc(db, 'profiles', userId));
          if (docSnap.exists()) {
            newProfiles[userId] = docSnap.data();
          }
        }
      }
      setProfiles(newProfiles);
    };
    if (messages.length) fetchProfiles();
    // eslint-disable-next-line
  }, [messages]);

  // Fetch chat meta: activity info for group, or peer info for DM, or custom group title/photo
  useEffect(() => {
    const fetchActivity = async () => {
      const chatDoc = await getDoc(doc(db, 'chats', chatId));
      const chatData = chatDoc.data();
  // Treat as DM only if type is 'dm' or the chat id follows the DM convention
  const participants = Array.isArray(chatData?.participants) ? chatData?.participants : [];
  const isDm = (chatData?.type === 'dm') || String(chatId || '').startsWith('dm_');
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
            name: data.activity || data.name || 'Activity',
            type: data.activity || '',
            date: data.date || '',
            time: data.time || '',
          });
        }
        setGroupMeta(null);
        setChatActivityId(chatData.activityId);
      } else {
        // Custom non-activity group
        setActivityInfo(null);
        setGroupMeta({ title: (chatData as any)?.title || 'Group Chat', photoUrl: (chatData as any)?.photoUrl });
        setChatActivityId(null);
        setEditTitle(((chatData as any)?.title || 'Group Chat') as string);
      }
    };
    fetchActivity();
  }, [chatId]);

  // Load participants profiles when participantIds change and modal may be opened
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

  // Live friend state for current user (friends and requestsSent) to sync header buttons in realtime
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const unsub = onSnapshot(doc(db, 'profiles', me), (snap) => {
      if (!snap.exists()) { setMyFriendIds([]); setMyRequestsSent([]); return; }
      const data: any = snap.data();
      const friendIds: string[] = Array.isArray(data?.friends) ? data.friends : [];
      const reqs: string[] = Array.isArray(data?.requestsSent) ? data.requestsSent : [];
      setMyFriendIds(friendIds);
      setMyRequestsSent(reqs);
    }, () => {
      setMyFriendIds([]);
      setMyRequestsSent([]);
    });
    return () => unsub();
  }, []);

  // Load friends for Add Users modal
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
      } catch {}
    };
    loadFriends();
  }, []);

  const openInfoMenu = () => setOptionsVisible(true);
  const closeInfoMenu = () => setOptionsVisible(false);

  const handlePickEditPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission required', 'Please allow photo library access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
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
    if (!selected.length) { setAddUsersVisible(false); return; }
    setBusy(true);
    try {
      // Filter out users already in participants
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
              return p.exists() ? (p.data() as any).username || 'User' : 'User';
            })
          );
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
            // Leave the chat; it will only be deleted when the last participant leaves
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
      // Optimistic update
      setMyRequestsSent((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
      await sendFriendRequest(uid);
      showToast('Friend request sent');
    } catch (e: any) {
      // Rollback
      setMyRequestsSent((prev) => prev.filter((id) => id !== uid));
      Alert.alert('Failed', e?.message || 'Could not send request.');
    }
  };

  const handleCancelFriendRequest = async (uid: string) => {
    try {
      // Optimistic update
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
      await sendMessage(chatId, auth.currentUser.uid, messageText.trim(), 'text');
      setMessageText('');
      
      // Scroll to bottom immediately after sending
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
    let result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setSelectedImages(prev => {
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
    let result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setSelectedImages(prev => {
        const MAX = 3;
        const remaining = MAX - prev.length;
        if (remaining <= 0) {
          Alert.alert('Limit reached', 'You can only send up to 3 images at a time.');
          return prev;
        }
        const picked = result.assets.map(a => a.uri).slice(0, remaining);
        const next = [...prev, ...picked];
        if (result.assets.length > remaining) {
          Alert.alert('Limit reached', 'Only the first 3 images will be added.');
        }
        return next;
      });
    }
  };

  const handleRemoveImage = (uriToRemove: string) => {
    setSelectedImages(prev => prev.filter(uri => uri !== uriToRemove));
  };

  // Grouping logic: show avatar/username only at the start of a group
  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const prev = messages[index - 1];
    const next = messages[index + 1];
    const isFirstOfGroup = !prev || prev.senderId !== item.senderId;
    const isLastOfGroup = !next || next.senderId !== item.senderId;
    const sender = profiles[item.senderId] || {};
    const isOwn = item.senderId === auth.currentUser?.uid;

    // System message rendering
    if (item.type === 'system') {
      return (
        <View style={{ flex: 1, alignItems: 'center', marginVertical: 8 }}>
          <Text style={{ color: '#aaa', fontStyle: 'italic', fontSize: 13, textAlign: 'center', paddingHorizontal: 10 }}>
            {item.text}
          </Text>
          <Text style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
            {item.timestamp
              ? new Date(item.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : ''}
          </Text>
        </View>
      );
    }

    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        {/* Avatar column for others, only on last message of group */}
        {!isOwn && (
          <View style={{
            width: 36,
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}>
            {isLastOfGroup ? (
              <TouchableOpacity
                onPress={() => navigation.navigate('UserProfile', { userId: item.senderId })}
                activeOpacity={0.7}
              >
                {typeof sender.photo === 'string' && sender.photo ? (
                  <Image
                    source={{ uri: sender.photo }}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: '#1ae9ef',
                      marginBottom: 2,
                      marginTop: -14,
                    }}
                  />
                ) : (
                  <Image
                    source={require('../assets/default-group.png')}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: '#1ae9ef',
                      marginBottom: 2,
                      marginTop: -14,
                    }}
                  />
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        {/* Message column */}
        <View style={{ flex: 1 }}>
          {isFirstOfGroup && !isOwn && (
            <Text style={{ color: '#1ae9ef', fontWeight: 'bold', fontSize: 14, marginBottom: 2 }}>
              {sender.username || 'User'}
            </Text>
          )}
          <View style={[
            styles.messageBubble,
            isOwn ? styles.yourMessage : styles.theirMessage,
          ]}>
            {item.type === 'text' && (
              <Text style={[
                styles.messageText,
                isOwn && styles.userMessageText,
              ]}>
                {item.text}
              </Text>
            )}
            {item.type === 'audio' && (
              <View style={styles.audioBubbleRow}>
                <TouchableOpacity
                  onPress={() => handlePlayPauseAudio(item.text, item.id)}
                  style={styles.audioPlayButton}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name={playingAudioId === item.id && audioPlayer.playing ? "pause" : "play-arrow"} size={18} color="#fff" />
                </TouchableOpacity>
                <View style={styles.audioWaveformBar}>
                  <View style={[styles.audioWaveformFill, {
                    width: (playingAudioId === item.id && audioPlayer.duration > 0)
                      ? `${(audioPlayer.currentTime / audioPlayer.duration) * 100}%`
                      : '0%',
                  }]} />
                </View>
                <Text style={styles.audioDurationRight}>
                  {playingAudioId === item.id && audioPlayer.duration > 0
                    ? `${audioPlayer.duration.toFixed(2)}`
                    : '0.00'}
                </Text>
                <TouchableOpacity
                  onPress={handleSpeedChange}
                  style={styles.audioSpeedButton}
                  activeOpacity={0.7}
                >
                  <Text style={styles.audioSpeedText}>{playbackRate}x</Text>
                </TouchableOpacity>
              </View>
            )}
            {item.type === 'image' && item.text ? (
              (() => {
                if (typeof item.text === 'string' && item.text) {
                  return (
                    <TouchableOpacity activeOpacity={0.85} onPress={() => setViewerUri(item.text)}>
                      <Image source={{ uri: item.text }} style={styles.media} />
                    </TouchableOpacity>
                  );
                } else {
                  return <Image source={require('../assets/default-group.png')} style={styles.media} />;
                }
              })()
            ) : item.type === 'image' && !item.text ? (
              <Text style={styles.placeholderText}>Image not available</Text>
            ) : null}
            <Text style={[
              styles.messageTime,
              isOwn && styles.userMessageTime,
            ]}>
              {item.timestamp
                ? new Date(item.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''}
            </Text>
          </View>
        </View>
        {/* No spacer for own messages */}
      </View>
    );
  };

  // Removed duplicate access guard (handled above) to avoid multiple alerts

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#121212' }} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.flexContainer}>
          {/* Header with group name and navigation buttons */}
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
                    {/* DM: tapping avatar or name opens their profile */}
                    <TouchableOpacity onPress={() => dmPeer?.uid && goToUserProfile(dmPeer.uid)} activeOpacity={0.8}>
                      <Image source={{ uri: dmPeer.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(dmPeer.username) }} style={styles.headerImage} />
                    </TouchableOpacity>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => dmPeer?.uid && goToUserProfile(dmPeer.uid)} activeOpacity={0.7}>
                          <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">{dmPeer.username}</Text>
                        </TouchableOpacity>
                        {/* Inline friend state + invite, styled like ProfileScreen */}
                        {isFriend ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                            <View style={styles.msgBtnFilled}>
                              <Ionicons name={'checkmark-done-outline'} size={18} color={'#000'} style={{ marginRight: 4 }} />
                              <Text style={styles.msgBtnTextInverted}>Connected</Text>
                            </View>
                            <TouchableOpacity style={[styles.inviteBtn, { marginLeft: 6 }]} onPress={() => { setInviteSelection({}); setInviteModalVisible(true); }}>
                              <Ionicons name="add-circle-outline" size={18} color="#000" />
                              <Text style={styles.inviteBtnText}>Invite</Text>
                            </TouchableOpacity>
                          </View>
                        ) : isRequested ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                            <TouchableOpacity style={styles.msgBtnFilled} activeOpacity={0.85} onPress={() => dmPeer && handleCancelFriendRequest(dmPeer.uid)}>
                              <Ionicons name={'person-add-outline'} size={18} color={'#000'} style={{ marginRight: 4 }} />
                              <Text style={styles.msgBtnTextInverted}>Request Sent</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.inviteBtn, { marginLeft: 6 }]} onPress={() => { setInviteSelection({}); setInviteModalVisible(true); }}>
                              <Ionicons name="add-circle-outline" size={18} color="#000" />
                              <Text style={styles.inviteBtnText}>Invite</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                            <TouchableOpacity style={styles.msgBtn} activeOpacity={0.85} onPress={() => dmPeer && handleAddFriend(dmPeer.uid)}>
                              <Ionicons name="person-add-outline" size={18} color={'#1ae9ef'} style={{ marginRight: 4 }} />
                              <Text style={styles.msgBtnText}>Add Friend</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.inviteBtn, { marginLeft: 6 }]} onPress={() => { setInviteSelection({}); setInviteModalVisible(true); }}>
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
                {/* Activity group: circular avatar with ActivityIcon */}
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
                  {activityInfo?.type ? (
                    <ActivityIcon activity={activityInfo.type} size={22} color="#1ae9ef" />
                  ) : null}
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: '#1ae9ef', fontWeight: 'bold', fontSize: 17 }}>{activityInfo?.name || 'Group Chat'}</Text>
                  {activityInfo?.date && activityInfo?.time && (
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '500' }}>
                      Scheduled for {formatDate(activityInfo.date)} at {activityInfo.time}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={openInfoMenu} style={styles.headerInfo}>
                  <Ionicons name="information-circle-outline" size={26} color="#1ae9ef" />
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Custom group: show group photo and title like DM */}
                {groupMeta?.photoUrl ? (
                  <Image source={{ uri: groupMeta.photoUrl }} style={styles.headerImage} />
                ) : (
                  <View style={[styles.headerImage, { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1ae9ef' }]}> 
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
                      const targetAlreadyJoined = !!(dmPeer && Array.isArray(item?.joinedUserIds) && item.joinedUserIds.includes(dmPeer.uid));
                      return (
                        <Pressable
                          style={[styles.row, { justifyContent: 'space-between' }, targetAlreadyJoined && { opacity: 0.45 }]}
                          onPress={() => {
                            if (targetAlreadyJoined) {
                              showToast(`${dmPeer?.username || 'User'} is already in this activity`);
                              return;
                            }
                            setInviteSelection(prev => ({ ...prev, [item.id]: !prev[item.id] }));
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <ActivityIcon activity={item.activity} size={22} color="#1ae9ef" />
                            <View style={{ marginLeft: 8 }}>
                              <Text style={{ color: '#fff', fontWeight: '600' }} numberOfLines={1}>{item.activity}</Text>
                              <Text style={{ color: '#bbb', fontSize: 12 }}>{item.date} • {item.time}</Text>
                            </View>
                          </View>
                          {targetAlreadyJoined ? (
                            <Text style={{ color: '#bbb', fontSize: 12, fontWeight: '600' }}>Joined</Text>
                          ) : (
                            <Ionicons name={inviteSelection[item.id] ? 'checkbox' : 'square-outline'} size={22} color={inviteSelection[item.id] ? '#1ae9ef' : '#666'} />
                          )}
                        </Pressable>
                      );
                    }}
                    ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                    style={{ maxHeight: 320, marginVertical: 8 }}
                  />
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                  <TouchableOpacity onPress={() => setInviteModalVisible(false)} style={[styles.modalButton, { backgroundColor: '#8e2323' }]}> 
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={async () => {
                      if (!dmPeer) return;
                      const selectedIds = Object.keys(inviteSelection).filter(id => inviteSelection[id]);
                      if (selectedIds.length === 0) { setInviteModalVisible(false); return; }
                      const eligible = selectedIds.filter((id) => {
                        const act = (allActivities || []).find((a: any) => a.id === id);
                        const joinedIds = (act as any)?.joinedUserIds || [];
                        return !(Array.isArray(joinedIds) && dmPeer && joinedIds.includes(dmPeer.uid));
                      });
                      if (eligible.length === 0) { showToast(`${dmPeer.username} is already in those activities`); return; }
                      try {
                        const { sentIds } = await sendActivityInvites(dmPeer.uid, eligible);
                        if (sentIds.length > 0) showToast(sentIds.length === 1 ? 'Invite sent' : `Sent ${sentIds.length} invites`);
                        else showToast('No invites sent');
                      } catch { showToast('Could not send invites'); }
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

          {/* Group info menu (only for group chats) */}
          <Modal
            visible={optionsVisible}
            transparent
            animationType="fade"
            onRequestClose={closeInfoMenu}
          >
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
                      <TouchableOpacity style={styles.menuItem} onPress={() => { setOptionsVisible(false); navigation.navigate('ActivityDetails' as any, { activityId: chatActivityId }); }}>
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
                      <View style={[styles.headerImage, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c0c0c', borderWidth: 1, borderColor: '#1ae9ef' }]}>
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
                    <TouchableOpacity disabled={busy} onPress={handleSaveEdit} style={[styles.modalButton, { backgroundColor: '#1ae9ef', marginLeft: 8, opacity: busy ? 0.6 : 1 }]}> 
                      <Text style={{ color: '#000', fontWeight: '700' }}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </Modal>

          {/* Add users modal */}
          <Modal
            visible={addUsersVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setAddUsersVisible(false)}
          >
            <View style={styles.menuOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setAddUsersVisible(false)} />
              <View style={styles.modalPanel} pointerEvents="auto">
                <Text style={styles.modalTitle}>Add users</Text>
                <Text style={{ color: '#aaa', marginBottom: 8 }}>Select from your connections</Text>
                <FlatList
                  data={friends.filter(f => !participantIds.includes(f.uid))}
                  keyExtractor={(i) => i.uid}
                  style={{ maxHeight: 260 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => setAddingUsersMap(prev => ({ ...prev, [item.uid]: !prev[item.uid] }))}
                    >
                      <Image source={{ uri: item.photo || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username)) }} style={styles.rowImage} />
                      <Text style={styles.rowText}>{item.username}</Text>
                      <Ionicons name={addingUsersMap[item.uid] ? 'checkbox' : 'square-outline'} size={22} color="#1ae9ef" />
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={<Text style={{ color: '#777', textAlign: 'center', marginVertical: 8 }}>No available friends to add</Text>}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                  <TouchableOpacity onPress={() => { setAddUsersVisible(false); setAddingUsersMap({}); }} style={[styles.modalButton, { backgroundColor: '#8e2323' }]}>
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={busy} onPress={handleAddUsers} style={[styles.modalButton, { backgroundColor: '#1ae9ef', marginLeft: 8, opacity: busy ? 0.6 : 1 }]}>
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
                        <TouchableOpacity onPress={() => goToUserProfile(item.uid)} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                          <Image source={{ uri: item.photo || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username)) }} style={styles.rowImage} />
                          <Text style={[styles.rowText, { flex: 1 }]}>{item.username}{isMe ? ' (You)' : ''}</Text>
                        </TouchableOpacity>
                        {!isMe && groupMeta && (
                          <>
                            <TouchableOpacity onPress={() => handleMessageUser(item.uid)} style={[styles.chip, { backgroundColor: '#1ae9ef' }]}>
                              <Text style={{ color: '#000', fontWeight: '700' }}>Message</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleAddFriend(item.uid)} style={[styles.chip, { marginLeft: 6, borderColor: '#1ae9ef', borderWidth: 1 }]}>
                              <Text style={{ color: '#1ae9ef', fontWeight: '700' }}>Add Friend</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    );
                  }}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                  <TouchableOpacity onPress={() => setParticipantsVisible(false)} style={[styles.modalButton, { backgroundColor: '#1e1e1e', borderColor: '#444', borderWidth: 1 }]}>
                    <Text style={{ color: '#ccc', fontWeight: '600' }}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
          
          {/* Messages area with loading state */}
          {!isMessagesReady ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
              <ActivityIndicator size="large" color="#1ae9ef" />
            </View>
          ) : (
            <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.messageList}
                renderItem={renderItem}
                onLayout={() => {
                  // Instantly scroll to bottom on initial layout (no animation)
                  if (messages.length > 0) {
                    flatListRef.current?.scrollToEnd({ animated: false });
                  }
                }}
                initialNumToRender={20}
              />
            </Animated.View>
          )}
          {/* Input area wrapped in KeyboardAvoidingView */}
          <View
            style={[
              styles.inputContainer,
              { paddingBottom: insets.bottom }
            ]}
          >
            <TouchableOpacity style={styles.inputCircleButton} onPress={handleCameraPress}>
              <Ionicons name="camera" size={22} color="#007575" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputCircleButton} onPress={handleGalleryPress}>
              <Ionicons name="image" size={22} color="#007575" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputCircleButton} onPress={audioRecorder.isRecording ? stopRecording : startRecording}>
              <Ionicons name={audioRecorder.isRecording ? "stop" : "mic"} size={22} color="#007575" />
            </TouchableOpacity>
            <TextInput
              style={styles.inputText}
              placeholder="Message..."
              placeholderTextColor="#888"
              value={messageText}
              onChangeText={setMessageText}
              autoCapitalize="sentences"
              autoCorrect={true}
              textContentType="none"
              autoComplete="off"
              keyboardType="default"
              returnKeyType="send"
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
              <Ionicons name="send" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          {selectedImages.length > 0 && (
            <View style={{ flexDirection: 'row', margin: 8 }}>
              {selectedImages.map((uri, idx) => (
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
                  <Image
                    source={{ uri: viewerUri }}
                    style={{ width: '100%', height: '100%', resizeMode: 'contain' }}
                  />
                </View>
              </SafeAreaView>
            </View>
          )}
        </View>
        {/* Bottom toast */}
        <Animated.View
          pointerEvents={toastMsg ? 'auto' : 'none'}
          style={{
            position: 'absolute', left: 20, right: 20, bottom: 24,
            backgroundColor: 'rgba(0,0,0,0.85)', borderColor: '#2a2a2a', borderWidth: 1,
            paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
            transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
            opacity: toastAnim,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{toastMsg}</Text>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// Helper to format date as dd-mm-yyyy
function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const [yyyy, mm, dd] = dateStr.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

const styles = StyleSheet.create({
  flexContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
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
  headerTitle: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 17,
    letterSpacing: 0.2,
  },
  headerInfo: { padding: 4, marginLeft: 8 },
  messageList: {
    padding: 10,
    paddingBottom: 0, // was 80, set to 0
  },
  messageBubble: {
    marginVertical: 8,
    marginHorizontal: 10,
    padding: 4,
    borderRadius: 15,
    maxWidth: '75%',
    backgroundColor: 'transparent', // No background for images
  },
  yourMessage: {
    backgroundColor: '#1ae9ef',
    alignSelf: 'flex-end',
  },
  theirMessage: {
    backgroundColor: '#1e1e1e',
    alignSelf: 'flex-start',
  },
  messageText: {
    fontSize: 16,
    color: '#fff',
  },
  userMessageText: {
    color: '#000',
  },
  messageTime: {
    fontSize: 12,
    color: '#ccc',
    alignSelf: 'flex-end',
    marginTop: 5,
  },
  userMessageTime: {
    color: '#007575',
  },
  media: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginVertical: 2,
  },
  placeholderText: {
    color: '#888',
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingHorizontal: 10,
    paddingVertical: 5,
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
    marginHorizontal: 8,
    fontSize: 16,
    height: 36,
  },
  sendButton: {
    backgroundColor: '#1ae9ef',
    borderRadius: 18,
    padding: 8,
    marginLeft: 4,
  },
  audioContainer: {
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#1e1e1e',
  },
  audioButton: {
    backgroundColor: '#1ae9ef',
    padding: 10,
    borderRadius: 30,
  },
  audioMessageButton: {
    width: 60,
    height: 60,
    backgroundColor: '#1ae9ef',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 0,
    marginVertical: 5,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingVertical: 2,
    paddingHorizontal: 2,
    width: 180,
    gap: 6,
  },
  audioCircleButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e0f7fa',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    borderWidth: 2,
    borderColor: '#007575',
  },
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
  audioWaveformFill: {
    height: 4,
    backgroundColor: '#007575',
    borderRadius: 2,
  },
  audioDuration: {
    color: '#fff',
    fontSize: 10,
    marginTop: 1,
    alignSelf: 'flex-end',
  },
  audioDurationRight: {
    color: '#007575',
    fontWeight: 'bold',
    fontSize: 12,
    minWidth: 38,
    textAlign: 'right',
  },
  audioSpeedButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#007575',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  audioSpeedText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  inputCircleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e1e1e', // or '#1ae9ef' for theme
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    borderWidth: 2,
    borderColor: '#007575',
  },
  // New styles for group info menus/modals
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
    // Ensure overlay sits above all content and captures touches
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
  menuItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  menuItemText: {
    color: '#fff',
    fontSize: 15,
  },
  menuItemDanger: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#311',
    borderTopWidth: 1,
    borderTopColor: '#3a1f1f',
  },
  menuItemDangerText: {
    color: '#ff4d4f',
    fontSize: 15,
    fontWeight: '700',
  },
  modalPanel: {
    width: '92%',
    backgroundColor: '#18191a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignSelf: 'center',
  },
  modalTitle: {
    color: '#1ae9ef',
    fontWeight: 'bold',
    fontSize: 18,
    marginBottom: 10,
  },
  photoPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#232323',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
  },
  smallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1ae9ef',
  },
  smallActionText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 6,
  },
  // Button styles matching ProfileScreen for consistency
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1ae9ef',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  inviteBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 11,
    marginLeft: 6,
  },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1ae9ef',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  msgBtnText: {
    color: '#1ae9ef',
    fontWeight: '700',
    fontSize: 11,
    marginLeft: 6,
  },
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
  msgBtnTextInverted: {
    color: '#000',
    fontWeight: '700',
    fontSize: 11,
    marginLeft: 6,
  },
  modalButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  rowImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#1ae9ef',
  },
  rowText: {
    color: '#fff',
    fontSize: 15,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
});

export default React.memo(ChatDetailScreen);