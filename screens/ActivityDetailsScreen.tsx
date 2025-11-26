import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getDisplayCreatorUsername } from '../utils/getDisplayCreatorUsername';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Linking,
  Platform,
  Image,
  RefreshControl,
  Modal,
  Pressable,
  Animated,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Calendar from 'expo-calendar';
import MapView, { Marker, PROVIDER_DEFAULT, Polyline, UrlTile, Callout } from 'react-native-maps';
import { useActivityContext } from '../context/ActivityContext';
import UserAvatar from '../components/UserAvatar';
import { fetchUsersByIds } from '../utils/firestoreActivities';
import { getOrCreateChatForActivity } from '../utils/firestoreChats';
import { auth, db, storage } from '../firebaseConfig';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { doc, getDoc, updateDoc, arrayUnion, onSnapshot } from 'firebase/firestore';
import { normalizeDateFormat } from '../utils/storage';
import { ActivityIcon } from '../components/ActivityIcons';
import { sendActivityInvites } from '../utils/firestoreInvites';
import { useTheme } from '../context/ThemeContext';
import { shareActivity } from '../utils/deepLinking';
import { useFocusEffect } from '@react-navigation/native';

// Slight darken helper for hex colors (fallback to original on parse failure)
function darkenHex(color: string, amount = 0.12): string {
  try {
    if (!color || typeof color !== 'string') return color;
    const hex = color.trim();
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!match) return color;
    let r = 0, g = 0, b = 0;
    if (match[1].length === 3) {
      r = parseInt(match[1][0] + match[1][0], 16);
      g = parseInt(match[1][1] + match[1][1], 16);
      b = parseInt(match[1][2] + match[1][2], 16);
    } else {
      r = parseInt(match[1].slice(0, 2), 16);
      g = parseInt(match[1].slice(2, 4), 16);
      b = parseInt(match[1].slice(4, 6), 16);
    }
    const factor = Math.max(0, Math.min(1, 1 - amount));
    const dr = Math.round(r * factor);
    const dg = Math.round(g * factor);
    const db = Math.round(b * factor);
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(dr)}${toHex(dg)}${toHex(db)}`;
  } catch {
    return color;
  }
}

const ActivityDetailsScreen = ({ route, navigation }: any) => {
  const { activityId } = route.params;
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { allActivities, isActivityJoined, toggleJoinActivity, profile } = useActivityContext();

  // ALL STATE HOOKS MUST BE BEFORE ANY CONDITIONAL RETURNS
  const [creatorUsername, setCreatorUsername] = useState<string>('');
  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const [joinedUsers, setJoinedUsers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const [isAddedToCalendar, setIsAddedToCalendar] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const sparkleAnims = useRef([...Array(6)].map(() => new Animated.Value(0))).current;
  
  // Load calendar status from AsyncStorage on mount and when screen comes into focus
  const loadCalendarStatus = async () => {
    try {
      const stored = await AsyncStorage.getItem('calendarStatus');
      if (stored) {
        const calendarStatus = JSON.parse(stored);
        setIsAddedToCalendar(!!calendarStatus[activityId]);
      } else {
        setIsAddedToCalendar(false);
      }
    } catch (error) {
      console.error('Failed to load calendar status:', error);
    }
  };
  
  useEffect(() => {
    loadCalendarStatus();
  }, [activityId]);
  
  // Reload calendar status when screen comes into focus (syncs with CalendarScreen)
  useFocusEffect(
    React.useCallback(() => {
      loadCalendarStatus();
    }, [activityId])
  );
  
  // GPX viewer modal state
  const [showGpxModal, setShowGpxModal] = useState(false);
  const [gpxLoading, setGpxLoading] = useState(false);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [gpxCoords, setGpxCoords] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [gpxWaypoints, setGpxWaypoints] = useState<Array<{ latitude: number; longitude: number; title?: string }>>([]);
  const gpxMapRef = useRef<MapView | null>(null);

  // Invite friends modal state
  const [inviteFriendsVisible, setInviteFriendsVisible] = useState(false);
  const [friendProfiles, setFriendProfiles] = useState<any[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Record<string, boolean>>({});
  const [noSelectionHintVisible, setNoSelectionHintVisible] = useState(false);
  const noSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Success modal state (for newly created activities)
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [invitedFriendIds, setInvitedFriendIds] = useState<string[]>([]);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const iconScale = useRef(new Animated.Value(0)).current;
  const iconRotate = useRef(new Animated.Value(0)).current;

  // Menu modal state
  const [menuVisible, setMenuVisible] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef<MapView>(null);

  const activity = allActivities.find(a => a.id === activityId);
  const gpxSupported = activity ? ['hiking', 'running', 'cycling'].includes(String((activity as any).activity || '').toLowerCase()) : false;
  
  // Fade in on mount
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, []);

  // Animate progress bar
  useEffect(() => {
    if (!activity) return;
    const progress = joinedUsers.length / activity.maxParticipants;
    const isFull = joinedUsers.length >= activity.maxParticipants;
    
    Animated.spring(progressAnim, {
      toValue: progress,
      tension: 50,
      friction: 7,
      useNativeDriver: false,
    }).start();

    if (isFull) {
      // Pulse animation when full
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Sparkle animations
      sparkleAnims.forEach((anim, i) => {
        Animated.loop(
          Animated.sequence([
            Animated.delay(i * 200),
            Animated.timing(anim, {
              toValue: 1,
              duration: 600,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 600,
              useNativeDriver: true,
            }),
          ])
        ).start();
      });
    } else {
      pulseAnim.setValue(1);
      sparkleAnims.forEach(anim => anim.setValue(0));
    }
  }, [joinedUsers.length, activity]);

  // Location (last known -> current fallback)
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          let location = await Location.getLastKnownPositionAsync({});
          if (!location) location = await Location.getCurrentPositionAsync({});
          if (location) setUserLocation(location.coords);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!activity) return;
    const fetchUsername = async () => {
      const username = await getDisplayCreatorUsername(activity.creatorId, activity.creator);
      setCreatorUsername(username);
    };
    fetchUsername();
  }, [activity]);

  // Helper: fetch latest joined users & added-to-calendar state
  const fetchAndSetJoinedUsers = async () => {
    if (!activity) return;
    try {
      const activityRef = doc(db, 'activities', activity.id);
      const activitySnap = await getDoc(activityRef);

      // If activity was deleted, navigate back
      if (!activitySnap.exists()) {
        console.log('Activity deleted, navigating back');
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('DiscoverGames');
        }
        return;
      }

      const data: any = activitySnap.data();
      const latestJoinedUserIds: string[] = Array.isArray(data.joinedUserIds) ? data.joinedUserIds : [];

      if (latestJoinedUserIds.length) {
        const users = await fetchUsersByIds(latestJoinedUserIds);
        setJoinedUsers(users);
      } else {
        setJoinedUsers([]);
      }
    } catch (error) {
      console.warn('Error fetching joined users:', error);
    }
  };

  // Initial load only - NO real-time updates
  useEffect(() => {
    if (activity) {
      fetchAndSetJoinedUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.id]);

  // Pre-create chat if already joined
  useEffect(() => {
    const setup = async () => {
      if (auth.currentUser && activity && isActivityJoined(activityId)) {
        await getOrCreateChatForActivity(activityId, auth.currentUser.uid);
      }
    };
    setup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, activity]);
  
  // Handle success modal for newly created activities
  useEffect(() => {
    if (route.params?.showSuccessModal) {
      const loadFriends = async () => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        
        const myFriendIds: string[] = Array.isArray(profile?.friends) ? profile.friends : [];
        if (myFriendIds.length) {
          try {
            const users = await fetchUsersByIds(myFriendIds);
            const filteredUsers = users.filter((u: any) => u.uid !== uid);
            setFriendProfiles(filteredUsers);
          } catch {
            setFriendProfiles([]);
          }
        } else {
          setFriendProfiles([]);
        }
      };
      
      loadFriends();
      
      // Show modal with slight delay for smooth entrance
      setTimeout(() => {
        setShowSuccessModal(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }, 400);
    }
  }, [route.params?.showSuccessModal, profile]);
  
  // Success modal animations
  useEffect(() => {
    if (showSuccessModal) {
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      setTimeout(() => {
        Animated.parallel([
          Animated.spring(iconScale, {
            toValue: 1,
            tension: 100,
            friction: 5,
            useNativeDriver: true,
          }),
          Animated.timing(iconRotate, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]).start();
      }, 200);
    } else {
      overlayOpacity.setValue(0);
      scaleAnim.setValue(0.7);
      slideAnim.setValue(50);
      iconScale.setValue(0);
      iconRotate.setValue(0);
    }
  }, [showSuccessModal]);

  // Early return with loading state if activity is null to prevent rendering errors
  if (!activity) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <ActivityIndicator size="large" color={theme.primary} />
      </SafeAreaView>
    );
  }

  if (gpxSupported && (activity as any).gpx) {
    try { console.log('[ActivityDetails] GPX debug for', activity.id, (activity as any).gpx); } catch {}
  }

  // Calculate distance in km
  const getDistance = () => {
    if (!userLocation) return null;
    const toRad = (v: number) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(activity.latitude - userLocation.latitude);
    const dLon = toRad(activity.longitude - userLocation.longitude);
    const lat1 = toRad(userLocation.latitude);
    const lat2 = toRad(activity.latitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return (R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))).toFixed(2);
    };

  const simplifyLocation = (location: string) => {
    const parts = location.split(',').map(p => p.trim());
    if (parts.length >= 2) return `${parts[0]}, ${parts[parts.length - 2] || parts[parts.length - 1]}`;
    return location;
  };

  // Invite Friends helpers
  const joinedUserIds = Array.isArray((activity as any).joinedUserIds)
    ? ((activity as any).joinedUserIds as string[])
    : (joinedUsers?.map((u: any) => u.uid) || []);
  const myFriendIds: string[] = Array.isArray(profile?.friends) ? profile.friends : [];

  useEffect(() => {
    const loadFriends = async () => {
      try {
        if (myFriendIds.length) {
          const users = await fetchUsersByIds(myFriendIds);
          // Filter out current user from friends list
          const currentUserId = auth.currentUser?.uid;
          const filteredUsers = currentUserId ? users.filter((u: any) => u.uid !== currentUserId) : users;
          setFriendProfiles(filteredUsers);
        } else {
          setFriendProfiles([]);
        }
      } catch {
        setFriendProfiles([]);
      }
    };
    loadFriends();
  }, [JSON.stringify(myFriendIds)]);

  const openInviteFriends = () => {
    setSelectedFriendIds({});
    setInviteFriendsVisible(true);
  };

  const toggleSelectFriend = (uid: string, disabled: boolean) => {
    if (disabled) return;
    setSelectedFriendIds(prev => ({ ...prev, [uid]: !prev[uid] }));
  };

  const confirmInviteFriends = async () => {
    const selected = Object.keys(selectedFriendIds).filter(id => selectedFriendIds[id]);
    if (selected.length === 0) {
      setNoSelectionHintVisible(true);
      if (noSelectionTimerRef.current) clearTimeout(noSelectionTimerRef.current);
      noSelectionTimerRef.current = setTimeout(() => setNoSelectionHintVisible(false), 1800);
      return;
    }
    let sent = 0;
    let skipped = 0;
    await Promise.all(
      selected.map(async friendId => {
        try {
          const res = await sendActivityInvites(friendId, [activity.id]);
          if ((res?.sentIds || []).length > 0) sent += 1;
          else skipped += 1;
        } catch {
          skipped += 1;
        }
      })
    );
    setInviteFriendsVisible(false);
    const msg =
      sent > 0
        ? `Sent invites to ${sent} friend${sent === 1 ? '' : 's'}${skipped ? ` (skipped ${skipped} already joined)` : ''}.`
        : `No invites sent. ${skipped} skipped (already joined).`;
    Alert.alert('Invites', msg);
  };

  const getSportEmoji = (sport: string): string => {
    const emojiMap: Record<string, string> = {
      'American Football': '🏈',
      'Badminton': '🏸',
      'Baseball': '⚾',
      'Basketball': '🏀',
      'Boxing': '🥊',
      'Calisthenics': '💪',
      'Cricket': '🏏',
      'Cycling': '🚴',
      'Field Hockey': '🏑',
      'Golf': '⛳',
      'Gym': '🏋️',
      'Hiking': '🥾',
      'Ice Hockey': '🏒',
      'Martial Arts': '🥋',
      'Padel': '🎾',
      'Running': '🏃',
      'Soccer': '⚽',
      'Swimming': '🏊',
      'Table Tennis': '🏓',
      'Tennis': '🎾',
      'Volleyball': '🏐',
      'Yoga': '🧘',
    };
    return emojiMap[sport] || '⚽';
  };

  const handleGetDirections = async () => {
    let currentLocation;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Permission Denied', 'Permission to access location was denied.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      currentLocation = `${loc.coords.latitude},${loc.coords.longitude}`;
    } catch {
      Alert.alert('Error', 'Could not fetch your current location.');
      return;
    }
    const destination = `${activity.latitude},${activity.longitude}`;
    Alert.alert(
      'Choose Map',
      'Select which map app to use for directions.',
      [
        { text: 'Google Maps', onPress: () => Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${currentLocation}&destination=${destination}&travelmode=driving`) },
        { text: 'Apple Maps', onPress: () => Linking.openURL(`http://maps.apple.com/?saddr=${currentLocation}&daddr=${destination}&dirflg=d`) },
        { text: 'Waze', onPress: () => Linking.openURL(`https://waze.com/ul?ll=${destination}&navigate=yes`) },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  const handleJoinLeave = async () => {
    try {
      const currentUserId = auth.currentUser?.uid;
      const wasJoined = isActivityJoined(activity.id);
      
      // Optimistic update: Update joined users list instantly for current user
      if (currentUserId) {
        if (wasJoined) {
          // Remove current user from list instantly
          setJoinedUsers(prev => prev.filter(u => u.uid !== currentUserId));
        } else {
          // Add current user to list instantly (with basic profile info)
          const currentUserProfile = {
            uid: currentUserId,
            username: profile?.username || 'You',
            photo: profile?.photo || profile?.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.username || 'User')}`,
          };
          setJoinedUsers(prev => [...prev, currentUserProfile]);
        }
      }
      
      let didNavigate = false;
      
      // Sync with Firestore with navigation callback for deletion
      await toggleJoinActivity(activity, () => {
        // Navigate back immediately when activity is deleted
        didNavigate = true;
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('DiscoverGames');
        }
      });
      
      // Only refetch if we didn't navigate (activity wasn't deleted)
      if (!didNavigate) {
        await fetchAndSetJoinedUsers();
        
        // If user left the activity, clear calendar status from AsyncStorage
        if (wasJoined) {
          try {
            const stored = await AsyncStorage.getItem('calendarStatus');
            const calendarStatus = stored ? JSON.parse(stored) : {};
            calendarStatus[activity.id] = false;
            await AsyncStorage.setItem('calendarStatus', JSON.stringify(calendarStatus));
            setIsAddedToCalendar(false);
          } catch (error) {
            console.error('Failed to clear calendar status:', error);
          }
        }
      }
    } catch (error) {
      console.warn('Error in handleJoinLeave:', error);
    }
  };

  const waitUntilParticipant = (chatId: string, uid: string, timeoutMs = 2000) =>
    new Promise<void>((resolve) => {
      const ref = doc(db, 'chats', chatId);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          const data: any = snap.data();
          if (snap.exists() && Array.isArray(data?.participants) && data.participants.includes(uid)) {
            try { unsub(); } catch {}
            resolve();
          }
        },
        () => {
          try { unsub(); } catch {}
          resolve();
        }
      );
      setTimeout(() => {
        try { unsub(); } catch {}
        resolve();
      }, timeoutMs);
    });

  const waitUntilJoinedToActivity = (actId: string, uid: string, timeoutMs = 2000) =>
    new Promise<void>((resolve) => {
      const ref = doc(db, 'activities', actId);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) return;
          const data: any = snap.data();
          const joined = Array.isArray(data?.joinedUserIds) ? data.joinedUserIds : [];
          if (joined.includes(uid)) {
            try { unsub(); } catch {}
            resolve();
          }
        },
        () => {
          try { unsub(); } catch {}
          resolve();
        }
      );
      setTimeout(() => {
        try { unsub(); } catch {}
        resolve();
      }, timeoutMs);
    });

  const handleOpenGroupChat = async () => {
    if (!auth.currentUser) {
      Alert.alert('Not Signed In', 'You need to be signed in to access the group chat.', [{ text: 'OK', style: 'destructive' }]);
      return;
    }
    if (!isActivityJoined(activity.id)) {
      Alert.alert(
        'Join to Access Group Chat',
        'You need to join this activity to access the group chat.',
        [{ text: 'Cancel', style: 'destructive' }, { text: 'Join Activity', onPress: joinAndOpenChat }],
        { cancelable: true }
      );
      return;
    }
    const chatId = await getOrCreateChatForActivity(activity.id, auth.currentUser.uid);
    if (!chatId) {
      Alert.alert('Chat unavailable', 'Could not open group chat. Please try again in a moment.');
      return;
    }
    try { await waitUntilParticipant(chatId, auth.currentUser.uid); } catch {}
    navigation.navigate('ChatDetail', { chatId });
  };

  const joinAndOpenChat = async () => {
    try {
      await toggleJoinActivity(activity, () => {
        // Navigate back if deletion happens
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('DiscoverGames');
        }
      });
      if (auth.currentUser) {
        try { await waitUntilJoinedToActivity(activity.id, auth.currentUser.uid); } catch {}
        const chatId = await getOrCreateChatForActivity(activity.id, auth.currentUser.uid);
        if (!chatId) {
          Alert.alert('Chat unavailable', 'Could not open group chat. Please try again in a moment.');
          return;
        }
        try { await waitUntilParticipant(chatId, auth.currentUser.uid); } catch {}
        navigation.navigate('ChatDetail', { chatId });
      }
    } finally {}
  };

  const handleAddToCalendar = async () => {
    if (!isActivityJoined(activity.id)) {
      Alert.alert(
        'Join to Add to Calendar',
        'You need to join this activity before adding it to your calendar.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Join Activity', onPress: async () => { 
              await toggleJoinActivity(activity, () => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.navigate('DiscoverGames');
                }
              }); 
              setTimeout(() => { addToCalendar(); }, 500); 
            } 
          },
        ],
        { cancelable: true }
      );
      return;
    }
    if (isAddedToCalendar) {
      Alert.alert(
        'Already Added',
        'This event is already in your calendar. Want to add it again?',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Add Again', onPress: addToCalendar }],
        { cancelable: true }
      );
      return;
    }
    await addToCalendar();
  };

  const addToCalendar = async () => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Calendar permission is required to add this activity to your calendar.', [{ text: 'OK' }]);
        return;
      }
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const writableCalendars = calendars.filter((cal: any) => cal.allowsModifications);
      if (!writableCalendars.length) {
        Alert.alert('No Calendar Available', 'No writable calendar found on your device.');
        return;
      }
      showCalendarPicker(writableCalendars);
    } catch (error) {
      console.error('Error adding to calendar:', error);
      Alert.alert('Error', 'Failed to add activity to calendar.');
    }
  };

  const showCalendarPicker = (calendars: any[]) => {
    const opts = calendars.map((cal) => {
      let accountType = cal.source.name || cal.source.type || 'Local';
      const l = String(accountType).toLowerCase();
      if (l.includes('icloud') || l.includes('ios')) accountType = 'Apple';
      else if (l.includes('google')) accountType = 'Google';
      else if (l.includes('outlook') || l.includes('microsoft')) accountType = 'Outlook';
      else if (l.includes('samsung')) accountType = 'Samsung';
      return { text: `${accountType} - ${cal.title}`, onPress: () => createCalendarEvent(cal.id) };
    });
    opts.push({ text: 'Cancel', onPress: async () => {} });

    Alert.alert('Choose Calendar', 'Select which calendar account to add this event to:', opts, { cancelable: true });
  };

  const createCalendarEvent = async (calendarId: string) => {
    try {
      const [day, month, year] = normalizeDateFormat(activity.date).split('-').map(Number);
      const [hours, minutes] = activity.time.split(':').map(Number);
      const startDate = new Date(year, month - 1, day, hours, minutes);
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      const sportEmoji = getSportEmoji(activity.activity);
      const eventDetails: any = {
        title: `${sportEmoji} ${activity.activity} Session`,
        startDate,
        endDate,
        location: activity.location,
        notes: `${activity.activity} session organized via SportsPal\n\nLocation: ${activity.location}\nDate: ${activity.date}\nTime: ${activity.time}`,
        alarms: [{ relativeOffset: -360 }, { relativeOffset: -30 }],
        calendarColor: '#1ae9ef',
      };

      await Calendar.createEventAsync(calendarId, eventDetails);

      // Update local state and persist to AsyncStorage
      setIsAddedToCalendar(true);
      try {
        const stored = await AsyncStorage.getItem('calendarStatus');
        const calendarStatus = stored ? JSON.parse(stored) : {};
        calendarStatus[activity.id] = true;
        await AsyncStorage.setItem('calendarStatus', JSON.stringify(calendarStatus));
      } catch (error) {
        console.error('Failed to save calendar status:', error);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Added to Calendar! 📅',
        `${activity.activity} has been added to your calendar with reminders at 6 hours and 30 minutes before the event.`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error creating calendar event:', error);
      Alert.alert('Error', 'Failed to create calendar event.');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await fetchAndSetJoinedUsers();
    setTimeout(() => {
      setRefreshing(false);
      setRefreshLocked(false);
    }, 1500);
  };

  const handleReportActivity = () => {
    setMenuVisible(false);
    Alert.alert(
      'Report Activity',
      'Why are you reporting this activity?',
      [
        { text: 'Inappropriate content', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
        { text: 'Spam or misleading', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
        { text: 'Dangerous location', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleShareActivity = () => {
    shareActivity(activity.id, activity.activity);
  };

  // Determine if activity is in history: now > start + 2h
  const isHistorical = (() => {
    try {
      const [day, month, year] = normalizeDateFormat(activity.date).split('-').map(Number);
      const [hours, minutes] = (activity.time || '00:00').split(':').map((n: string) => parseInt(n, 10));
      const start = new Date(year, month - 1, day, hours || 0, minutes || 0);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      return Date.now() > end.getTime();
    } catch {
      return false;
    }
  })();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* Header */}
        {activity.activity === 'American Football' ? (
          <View style={{ marginTop: 10, marginBottom: 0, alignItems: 'center', width: '100%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', width: '95%' }}>
              <TouchableOpacity
                style={{ padding: 4, marginRight: 2, left: 0, position: 'absolute', zIndex: 10 }}
                onPress={() => navigation.goBack()}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="arrow-back" size={28} color={theme.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={{ padding: 4, right: 0, position: 'absolute', zIndex: 10 }}
                onPress={() => setMenuVisible(true)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="ellipsis-horizontal" size={28} color={theme.primary} />
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 44 }}>
                <ActivityIcon activity={activity.activity} size={28} color={theme.primary} />
                <Text style={{ fontSize: 28, color: theme.primary, fontWeight: 'bold', marginLeft: 0 }}>American Football</Text>
              </View>
            </View>
            <Text style={{ fontSize: 28, color: theme.primary, fontWeight: 'bold', textAlign: 'center', marginTop: 2 }}>Details</Text>
          </View>
        ) : (
          <View style={styles.header}>
            <TouchableOpacity
              style={[styles.backButton, { left: 16, position: 'absolute', zIndex: 10 }]}
              onPress={() => navigation.goBack()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-back" size={28} color={theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.backButton, { right: 16, position: 'absolute', zIndex: 10 }]}
              onPress={() => setMenuVisible(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="ellipsis-horizontal" size={28} color={theme.primary} />
            </TouchableOpacity>
            <View style={styles.headerTitleContainer}>
              <ActivityIcon activity={activity.activity} size={28} color={theme.primary} />
              <Text style={styles.headerTitle}>{activity.activity} Details</Text>
            </View>
          </View>
        )}

        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || refreshLocked}
              onRefresh={onRefresh}
              colors={[theme.primaryStrong]}
              tintColor={theme.primaryStrong}
              progressBackgroundColor="transparent"
            />
          }
        >
          <View style={styles.mapContainer}>
            <MapView
              ref={mapRef}
              style={{ flex: 1, borderRadius: 10 }}
              provider={PROVIDER_DEFAULT}
              initialRegion={{
                latitude: activity.latitude,
                longitude: activity.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
              showsUserLocation={!!userLocation}
              showsMyLocationButton={false}
              userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
            >
              <Marker
                coordinate={{ latitude: activity.latitude, longitude: activity.longitude }}
                title={activity.activity}
                description={activity.location}
              />
            </MapView>
            {userLocation && (
              <>
                <TouchableOpacity
                  style={[styles.myLocationButton, { position: 'absolute', bottom: 16, right: 16 }]}
                  onPress={() => {
                    mapRef.current?.animateToRegion({
                      latitude: userLocation.latitude,
                      longitude: userLocation.longitude,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    });
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="locate" size={28} color={theme.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.activityLocationButton, { position: 'absolute', bottom: 70, right: 16 }]}
                  onPress={() => {
                    mapRef.current?.animateToRegion({
                      latitude: activity.latitude,
                      longitude: activity.longitude,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    });
                  }}
                  activeOpacity={0.7}
                >
                  <ActivityIcon activity={activity.activity} size={28} color={theme.primary} />
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Info */}
          <View style={styles.infoContainer}>
            {userLocation && (
              <View style={styles.infoRow}>
                <Ionicons name="navigate" size={16} color={theme.primary} style={styles.infoIcon} />
                <Text style={styles.infoLabel}>Distance:</Text>
                <Text style={styles.infoValue}>{getDistance()} km away</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Ionicons name="person" size={16} color={theme.primary} style={styles.infoIcon} />
              <Text style={styles.infoLabel}>Host:</Text>
              <Text style={styles.infoValue}>{creatorUsername}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="location" size={16} color={theme.primary} style={styles.infoIcon} />
              <Text style={styles.infoLabel}>Location:</Text>
              <Text style={styles.infoValue}>{simplifyLocation(activity.location)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="calendar" size={16} color={theme.primary} style={styles.infoIcon} />
              <Text style={styles.infoLabel}>Date:</Text>
              <Text style={styles.infoValue}>{normalizeDateFormat(activity.date)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="time" size={16} color={theme.primary} style={styles.infoIcon} />
              <Text style={styles.infoLabel}>Time:</Text>
              <Text style={styles.infoValue}>{activity.time}</Text>
            </View>

            {(activity as any).description && (
              <View style={styles.descriptionSection}>
                <Text style={styles.descriptionTitle}>Activity Description</Text>
                <Text style={styles.description}>{(activity as any).description}</Text>
              </View>
            )}
            {/* GPX / Route statistics (if present) only for Hiking/Running/Cycling */}
            {gpxSupported && ((activity as any).gpx || (activity as any).drawnRoute) && (
              <>
                <View style={{ marginBottom: 8 }}>
                  <TouchableOpacity
                    style={[styles.actionButton, { alignSelf: 'center', justifyContent: 'center' }]}
                    onPress={async () => {
                      // Handle both GPX and drawn routes
                      if ((activity as any).drawnRoute && (activity as any).drawnRoute.length > 0) {
                        // Show drawn route directly
                        setShowGpxModal(true);
                        setGpxError(null);
                        setGpxCoords((activity as any).drawnRoute);
                        setGpxWaypoints([]);
                        setGpxLoading(false);
                        return;
                      }
                      
                      // Original GPX handling code
                      // Diagnostic logs to help identify why "No GPX URL available" appears
                      console.log('Opening GPX viewer for activity id:', activity.id);
                      console.log('activity.gpx payload:', (activity as any).gpx);

                      setShowGpxModal(true);
                      setGpxError(null);
                      setGpxCoords([]);
                      setGpxWaypoints([]);

                      try {
                        setGpxLoading(true);

                        // Prefer an explicit downloadUrl, otherwise try to derive one from storagePath
                        let url: string | null = (activity as any).gpx?.downloadUrl || null;
                        const storagePath: string | null = (activity as any).gpx?.storagePath || null;

                        console.log('Initial GPX url:', url, 'storagePath:', storagePath);

                        try {
                          if (!url && storagePath) {
                            // If storagePath looks like a full url, try to use or resolve it; otherwise resolve via getDownloadURL
                            if (storagePath.startsWith('http') || storagePath.startsWith('gs://')) {
                              console.log('storagePath looks like HTTP/GS URI. Attempting to resolve via Storage.getDownloadURL if necessary.');
                              try {
                                const r = storageRef(storage, storagePath);
                                url = await getDownloadURL(r);
                                console.log('getDownloadURL resolved to:', url);
                              } catch (e) {
                                console.warn('getDownloadURL failed for storagePath:', storagePath, e);
                                // fallback: if it's an http url, use it directly
                                if (storagePath.startsWith('http')) {
                                  url = storagePath;
                                  console.log('Using storagePath directly as URL:', url);
                                } else {
                                  url = null;
                                  console.log('storagePath not usable as direct URL');
                                }
                              }
                            } else {
                              console.log('storagePath looks like a path (not http/gs). Attempting to create ref and getDownloadURL.');
                              const r = storageRef(storage, storagePath);
                              url = await getDownloadURL(r);
                              console.log('getDownloadURL resolved to:', url);
                            }
                          }
                        } catch (e) {
                          console.warn('Could not resolve GPX download URL from storagePath', storagePath, e);
                          url = null;
                        }

                        if (!url) {
                          console.warn('No GPX URL available after resolution attempts. downloadUrl:', (activity as any).gpx?.downloadUrl, 'storagePath:', storagePath);
                          setGpxError('No GPX URL available');
                          setGpxLoading(false);
                          return;
                        }

                        console.log('Fetching GPX from URL:', url);
                        const resp = await fetch(url, {
                          headers: {
                            Accept: 'application/gpx+xml, text/xml, text/plain, */*',
                          },
                        });
                        const ct = resp.headers?.get?.('content-type');
                        console.log('GPX fetch status:', resp.status, resp.statusText, 'content-type:', ct || '(unknown)');

                        // Read as text; if unusable, try a cloned response (or a re-fetch) as arrayBuffer and decode
                        let text: string | null = null;
                        try {
                          text = await resp.text();
                        } catch (e) {
                          console.warn('resp.text() failed (will try binary decode):', e);
                        }
                        if (!text || !/<(trkpt|rtept|wpt)\b/i.test(text)) {
                          try {
                            let ab: ArrayBuffer | null = null;
                            if (typeof (resp as any).clone === 'function') {
                              try {
                                const resp2 = (resp as any).clone();
                                ab = await resp2.arrayBuffer();
                              } catch (e) {
                                console.warn('clone().arrayBuffer() failed, refetching URL', e);
                              }
                            }
                            if (!ab) {
                              const resp3 = await fetch(url);
                              ab = await resp3.arrayBuffer();
                            }
                            // Decode
                            let decoded = '';
                            try {
                              // @ts-ignore
                              decoded = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(ab) : '';
                            } catch {}
                            if (!decoded) {
                              const bytes = new Uint8Array(ab);
                              let s = '';
                              for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
                              decoded = s;
                            }
                            text = decoded;
                          } catch (e) {
                            console.warn('binary decode path failed', e);
                          }
                        }
                        console.log('GPX text length:', typeof text === 'string' ? text.length : '(non-string)');

                        const pts: Array<{ latitude: number; longitude: number }> = [];
                        const wpts: Array<{ latitude: number; longitude: number; title?: string }> = [];
                        const xml = typeof text === 'string' ? text : '';

                        // Extract track/route points only (polylines)
                        const extractPoints = (tag: 'trkpt' | 'rtept') => {
                          const regex = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
                          let count = 0;
                          let m: RegExpExecArray | null;
                          while ((m = regex.exec(xml)) !== null) {
                            count++;
                            const tagStr = m[0];
                            const latMatch = /lat=\"([^\"]+)\"/i.exec(tagStr);
                            const lonMatch = /lon=\"([^\"]+)\"/i.exec(tagStr);
                            if (latMatch && lonMatch) {
                              const lat = parseFloat(latMatch[1].replace(',', '.'));
                              const lon = parseFloat(lonMatch[1].replace(',', '.'));
                              if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
                                pts.push({ latitude: lat, longitude: lon });
                              }
                            }
                          }
                          return count;
                        };

                        // Extract waypoints as separate markers with optional name
                        const extractWpts = () => {
                          const regex = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/gi;
                          let count = 0;
                          let m: RegExpExecArray | null;
                          while ((m = regex.exec(xml)) !== null) {
                            count++;
                            const attrs = m[1] || '';
                            const inner = m[2] || '';
                            const latMatch = /lat=\"([^\"]+)\"/i.exec(attrs);
                            const lonMatch = /lon=\"([^\"]+)\"/i.exec(attrs);
                            if (latMatch && lonMatch) {
                              const lat = parseFloat(latMatch[1].replace(',', '.'));
                              const lon = parseFloat(lonMatch[1].replace(',', '.'));
                              if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
                                let title: string | undefined = undefined;
                                const nameMatch = /<name>([\s\S]*?)<\/name>/i.exec(inner);
                                const descMatch = /<desc>([\s\S]*?)<\/desc>/i.exec(inner) || /<cmt>([\s\S]*?)<\/cmt>/i.exec(inner);
                                if (nameMatch && nameMatch[1]) title = nameMatch[1].trim();
                                else if (descMatch && descMatch[1]) title = descMatch[1].trim();
                                wpts.push({ latitude: lat, longitude: lon, title });
                              }
                            }
                          }
                          return count;
                        };

                        const trkCount = extractPoints('trkpt');
                        const rteCountBefore = pts.length;
                        const rteCount = trkCount === 0 ? extractPoints('rtept') : 0;
                        // Extract waypoints as separate markers
                        const wptCount = extractWpts();

                        console.log('GPX point summary -> trkpt:', trkCount, 'rtept:', rteCount === 0 ? 0 : (pts.length - rteCountBefore), 'wpt:', wptCount);

                        if (pts.length === 0 && wpts.length === 0) {
                          setGpxError('No track/route/waypoint points found in GPX');
                        } else {
                          setGpxCoords(pts);
                          setGpxWaypoints(wpts);
                          const fitPts = pts.length > 0 ? pts : wpts;
                          setTimeout(() => {
                            try {
                              if (gpxMapRef.current && fitPts.length > 0) {
                                gpxMapRef.current.fitToCoordinates(fitPts, { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true });
                              }
                            } catch (e) {
                              console.warn('fitToCoordinates failed', e);
                            }
                          }, 300);
                        }
                      } catch (e: any) {
                        console.warn('Failed to load GPX', e);
                        setGpxError('Failed to load GPX file');
                      } finally {
                        setGpxLoading(false);
                      }
                    }}
                  >
                    <Ionicons name="map" size={18} style={[styles.actionIconBold, { marginRight: 8 }]} />
                    <Text style={styles.actionText}>
                      View {(activity as any).activity} Route {(activity as any).gpx ? '(GPX)' : '(Drawn)'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {(activity as any).gpx && (
                  <View style={{ marginVertical: 10, backgroundColor: theme.card, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                      <Ionicons name="stats-chart" size={20} color={theme.primary} style={{ marginRight: 8 }} />
                      <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 16 }}>Route Statistics</Text>
                    </View>
                    {(() => {
                      const s: any = (activity as any).gpx.stats || {};
                      const iconMap: Record<string, string> = {
                        'Distance': 'trail-sign',
                        'Ascent': 'trending-up',
                        'Descent': 'trending-down',
                        'Max Elevation': 'arrow-up-circle',
                        'Difficulty': 'speedometer',
                        'Route Type': 'git-branch',
                      };
                      const rows = [
                        ['Distance', s.distance || '—'],
                        ['Ascent', s.ascent || '—'],
                        ['Descent', s.descent || '—'],
                        ['Max Elevation', s.maxElevation || '—'],
                        ['Difficulty', s.difficulty || '—'],
                        ['Route Type', s.routeType || '—'],
                      ];
                      return rows.map(([label, val]) => (
                        <View key={label as string} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingVertical: 4 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Ionicons name={iconMap[label as string] as any} size={16} color={theme.primary} />
                            <Text style={{ color: theme.muted, fontWeight: '600' }}>{label}:</Text>
                          </View>
                          <Text style={{ color: theme.text, fontWeight: '500' }}>{val}</Text>
                        </View>
                      ));
                    })()}
                  </View>
                )}
              </>
            )}

            {/* Participants */}
            <View style={{ marginVertical: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Ionicons name="people" size={20} color={theme.primary} style={{ marginRight: 6 }} />
                <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 16 }}>
                  Participants:
                </Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {joinedUsers.map(user => (
                  <TouchableOpacity
                    key={user.uid}
                    style={{ alignItems: 'center', marginRight: 16 }}
                    onPress={() => {
                      if (user.uid === auth.currentUser?.uid) navigation.navigate('MainTabs', { screen: 'Profile' });
                      else navigation.navigate('UserProfile', { userId: user.uid });
                    }}
                  >
                    <UserAvatar
                      photoUrl={user.photo || user.photoURL}
                      username={user.username}
                      size={54}
                      borderColor={theme.primary}
                      borderWidth={2}
                    />
                    <Text style={{ color: theme.text, marginTop: 6, fontWeight: 'bold' }}>{user.username}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Animated Progress Bar */}
            <Animated.View style={[styles.joinContainer, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.progressHeader}>
                <View style={styles.progressTextRow}>
                  <Text style={styles.joinText}>
                    {joinedUsers.length}/{activity.maxParticipants} joined
                  </Text>
                </View>
                {joinedUsers.length >= activity.maxParticipants && (
                  <View style={styles.fullBadge}>
                    <Ionicons name="checkmark-circle" size={16} color="#fff" />
                    <Text style={styles.fullBadgeText}>FULL</Text>
                  </View>
                )}
              </View>
              
              <View style={styles.progressBarContainer}>
                <View style={styles.progressBarBackground}>
                  <Animated.View
                    style={[
                      styles.progressBarFill,
                      {
                        width: progressAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0%', '100%'],
                        }),
                        backgroundColor: joinedUsers.length >= activity.maxParticipants ? '#10b981' : theme.primary,
                      },
                    ]}
                  >
                    {joinedUsers.length >= activity.maxParticipants && (
                      <View style={styles.sparkleContainer}>
                        {sparkleAnims.map((anim, i) => (
                          <Animated.View
                            key={i}
                            style={[
                              styles.sparkle,
                              {
                                left: `${(i + 1) * 15}%`,
                                opacity: anim,
                                transform: [
                                  {
                                    translateY: anim.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [0, -8],
                                    }),
                                  },
                                  {
                                    scale: anim.interpolate({
                                      inputRange: [0, 0.5, 1],
                                      outputRange: [0, 1.2, 0],
                                    }),
                                  },
                                ],
                              },
                            ]}
                          >
                            <Text style={styles.sparkleText}>✨</Text>
                          </Animated.View>
                        ))}
                      </View>
                    )}
                  </Animated.View>
                </View>
                
                {/* Progress percentage text */}
                <Text style={styles.progressPercentage}>
                  {Math.round((joinedUsers.length / activity.maxParticipants) * 100)}%
                </Text>
              </View>
              
              {joinedUsers.length >= activity.maxParticipants && (
                <Text style={styles.fullMessage}>🎉 This activity is full!</Text>
              )}
            </Animated.View>

            {/* Actions */}
            <View style={styles.actionsContainer}>
              {!isHistorical && (
                <>
                  <TouchableOpacity
                    style={[
                      styles.actionButton,
                      isActivityJoined(activity.id) && styles.actionButtonJoined,
                    ]}
                    onPress={handleJoinLeave}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={isActivityJoined(activity.id) ? 'log-out-outline' : 'checkmark-circle'}
                      size={20}
                      style={styles.actionIconBold}
                    />
                    <Text style={[styles.actionText]}>
                      {isActivityJoined(activity.id) ? 'Leave Activity' : 'Join Activity'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.actionButton} onPress={openInviteFriends}>
                    <Ionicons name="person-add" size={20} style={styles.actionIconBold} />
                    <Text style={styles.actionText}>Invite Friends</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.actionButton} onPress={handleOpenGroupChat}>
                    <Ionicons name="chatbubbles" size={20} style={styles.actionIconBold} />
                    <Text style={styles.actionText}>Group Chat</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, isAddedToCalendar && styles.actionButtonAddedToCalendar]}
                    onPress={handleAddToCalendar}
                  >
                    <Ionicons
                      name={isAddedToCalendar ? 'checkmark-circle' : 'calendar-outline'}
                      size={20}
                      style={[styles.actionIconBold, isAddedToCalendar && styles.actionIconAddedToCalendar]}
                    />
                    <Text style={[styles.actionText, isAddedToCalendar && styles.actionTextAddedToCalendar]}>
                      {isAddedToCalendar ? 'Added to Calendar' : 'Add to Calendar'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity style={styles.actionButton} onPress={handleGetDirections}>
                <Ionicons name="navigate" size={24} style={styles.actionIconBold} />
                <Text style={styles.actionText}>Get Directions</Text>
              </TouchableOpacity>
            </View>
          </View>

        </ScrollView>
      </Animated.View>

      {/* GPX Route Modal (shows polyline) */}
      <Modal
        visible={showGpxModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGpxModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowGpxModal(false)}>
          <Pressable style={[styles.modalCard, { width: '95%', maxWidth: 920, padding: 12 }]} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>{(activity as any).activity} Route</Text>
              <TouchableOpacity onPress={() => setShowGpxModal(false)}>
                <Ionicons name="close" size={22} color={theme.muted} />
              </TouchableOpacity>
            </View>
            <View style={{ height: 420, marginTop: 12, borderRadius: 8, overflow: 'hidden' }}>
              {gpxLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator size="large" color={theme.primary} />
                </View>
              ) : gpxError ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 12 }}>
                  <Text style={{ color: theme.text, textAlign: 'center' }}>{gpxError}</Text>
                </View>
              ) : (gpxCoords.length > 0 || gpxWaypoints.length > 0) ? (
                <MapView
                  ref={(r) => { gpxMapRef.current = r; }}
                  style={{ flex: 1 }}
                  provider={PROVIDER_DEFAULT}
                  initialRegion={{
                    latitude: (gpxCoords[0] || gpxWaypoints[0]).latitude,
                    longitude: (gpxCoords[0] || gpxWaypoints[0]).longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                  }}
                  userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
                >
                  {/* OpenStreetMap tiles for the GPX modal only */}
                  <UrlTile
                    urlTemplate="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maximumZ={19}
                    flipY={false}
                  />
                  {/* Render route if available */}
                  {gpxCoords.length > 0 && (
                    <>
                      {/* Outline underlay for better visibility */}
                      <Polyline coordinates={gpxCoords} strokeWidth={8} strokeColor="#0a2a2b" />
                      <Polyline coordinates={gpxCoords} strokeWidth={5} strokeColor={theme.primary} />
                      {/* Start and end markers */}
                      <Marker coordinate={gpxCoords[0]} />
                      <Marker coordinate={gpxCoords[gpxCoords.length - 1]} />
                      
                      {/* Meeting point marker for drawn routes */}
                      {(activity as any).drawnRoute && activity.latitude && activity.longitude && (
                        <Marker
                          coordinate={{ latitude: activity.latitude, longitude: activity.longitude }}
                          title="Meeting Point"
                        >
                          <View style={{ backgroundColor: theme.primary, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' }}>
                            <Ionicons name="location" size={24} color="#fff" />
                          </View>
                        </Marker>
                      )}
                    </>
                  )}
                  {/* If no track/route but waypoints exist, optionally connect with dashed line for context */}
                  {gpxCoords.length === 0 && gpxWaypoints.length > 1 && (
                    <Polyline coordinates={gpxWaypoints} strokeWidth={3} strokeColor={`${theme.primary}99`} lineDashPattern={[6,4]} />
                  )}
                  {/* Waypoint checkpoints */}
                  {gpxWaypoints.map((p, idx) => (
                    <Marker key={`wpt-${idx}`} coordinate={p} pinColor="#f2c200" title={p.title}
                    >
                      {p.title ? (
                        <Callout>
                          <Text style={{ fontWeight: '700' }}>{p.title}</Text>
                        </Callout>
                      ) : null}
                    </Marker>
                  ))}
                </MapView>
              ) : (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#fff' }}>No route data available</Text>
                </View>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Invite Friends Modal */}
      <Modal
        visible={inviteFriendsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteFriendsVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setInviteFriendsVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Friends</Text>
              <TouchableOpacity onPress={() => setInviteFriendsVisible(false)}>
                <Ionicons name="close" size={22} color={theme.muted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Select friends to invite to this activity</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {friendProfiles.length === 0 && (
                <Text style={{ color: theme.muted, textAlign: 'center', marginVertical: 20 }}>No friends yet.</Text>
              )}
              {friendProfiles.map((f) => {
                const alreadyJoined = joinedUserIds.includes(f.uid);
                const selected = !!selectedFriendIds[f.uid];
                return (
                  <TouchableOpacity
                    key={f.uid}
                    style={[styles.friendRow, alreadyJoined && { opacity: 0.45 }]}
                    onPress={() => toggleSelectFriend(f.uid, alreadyJoined)}
                    disabled={alreadyJoined}
                    activeOpacity={0.7}
                  >
                    <View style={styles.friendLeft}>
                      <UserAvatar
                        photoUrl={f.photo || f.photoURL}
                        username={f.username || 'User'}
                        size={44}
                        style={styles.friendAvatar}
                      />
                      <View>
                        <Text style={styles.friendName}>{f.username || 'User'}</Text>
                        {alreadyJoined && <Text style={styles.friendMeta}>Already joined</Text>}
                      </View>
                    </View>
                    {!alreadyJoined && (
                      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                        {selected && <Ionicons name="checkmark" size={16} color={'#fff'} />}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setInviteFriendsVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={confirmInviteFriends}>
                <Ionicons name="send" size={18} color={'#fff'} />
                <Text style={styles.modalConfirmText}>Send Invites</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
          {noSelectionHintVisible && (
            <View style={styles.bottomToast} pointerEvents="none">
              <Text style={styles.bottomToastText}>No friends selected</Text>
            </View>
          )}
        </Pressable>
      </Modal>

      {/* Success Modal (for newly created activities) */}
      <Modal visible={showSuccessModal} transparent animationType="none" onRequestClose={() => setShowSuccessModal(false)}>
        <Animated.View style={[styles.modalOverlay, { opacity: overlayOpacity }]}>
          <Animated.View
            style={[
              styles.modalCard,
              {
                maxWidth: 500,
                padding: 24,
                transform: [
                  { scale: scaleAnim },
                  { translateY: slideAnim },
                ],
              },
            ]}
          >
            {/* Animated Activity Icon */}
            <Animated.View
              style={[
                {
                  width: 90,
                  height: 90,
                  borderRadius: 45,
                  backgroundColor: theme.background,
                  justifyContent: 'center',
                  alignItems: 'center',
                  alignSelf: 'center',
                  marginBottom: 20,
                  borderWidth: 3,
                  borderColor: theme.primary,
                  transform: [
                    { scale: iconScale },
                    { rotate: iconRotate.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }) },
                  ],
                },
              ]}
            >
              <Animated.View
                style={{
                  transform: [
                    { rotate: iconRotate.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '-360deg'],
                    }) },
                  ],
                }}
              >
                <ActivityIcon 
                  activity={route.params?.activitySport || activity.activity} 
                  size={56} 
                  color={theme.primary} 
                />
              </Animated.View>
            </Animated.View>

            {/* Title & Subtitle */}
            <Text style={[styles.modalTitle, { fontSize: 26, textAlign: 'center', marginBottom: 8 }]}>
              🎉 Activity Created!
            </Text>
            <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>
              Your {route.params?.activitySport || activity.activity} activity is live! Friends can now discover and join from their feed.
            </Text>

            {/* Friends List */}
            {friendProfiles.length > 0 ? (
              <>
                <Text style={{ fontSize: 15, fontWeight: '700', color: theme.text, marginBottom: 12, marginTop: 8 }}>
                  Invite friends to join this activity:
                </Text>
                <ScrollView style={{ maxHeight: 260, marginBottom: 16 }} showsVerticalScrollIndicator={false}>
                  {friendProfiles.map((friend: any) => {
                    const isInvited = invitedFriendIds.includes(friend.uid);
                    const isSelected = selectedFriendIds[friend.uid];
                    return (
                      <TouchableOpacity
                        key={friend.uid}
                        style={[
                          {
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingVertical: 12,
                            paddingHorizontal: 8,
                            borderRadius: 12,
                            marginBottom: 8,
                            backgroundColor: theme.background,
                          },
                          isInvited && { opacity: 0.5 },
                        ]}
                        onPress={() => {
                          if (!isInvited) {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setSelectedFriendIds(prev => ({ ...prev, [friend.uid]: !prev[friend.uid] }));
                          }
                        }}
                        disabled={isInvited}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                          <UserAvatar
                            photoUrl={friend.photo}
                            username={friend.username}
                            size={44}
                            borderColor={theme.primary}
                            borderWidth={2}
                            style={{ marginRight: 12 }}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 }}>
                              {friend.username}
                            </Text>
                            {friend.bio && (
                              <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                                {friend.bio}
                              </Text>
                            )}
                          </View>
                        </View>
                        {isInvited ? (
                          <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '600' }}>Invited</Text>
                        ) : (
                          <View
                            style={[
                              {
                                width: 24,
                                height: 24,
                                borderRadius: 8,
                                borderWidth: 2,
                                borderColor: theme.primary,
                                alignItems: 'center',
                                justifyContent: 'center',
                              },
                              isSelected && { backgroundColor: theme.primary },
                            ]}
                          >
                            {isSelected && <Ionicons name="checkmark" size={16} color={'#fff'} />}
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* Invite Button */}
                <TouchableOpacity
                  style={[
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 16,
                      paddingHorizontal: 20,
                      borderRadius: 12,
                      gap: 10,
                      backgroundColor: theme.primary,
                    },
                    !Object.values(selectedFriendIds).some(v => v) && { opacity: 0.45 },
                  ]}
                  onPress={async () => {
                    const selected = Object.keys(selectedFriendIds).filter(id => selectedFriendIds[id] && !invitedFriendIds.includes(id));
                    if (selected.length === 0) {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                      setNoSelectionHintVisible(true);
                      if (noSelectionTimerRef.current) clearTimeout(noSelectionTimerRef.current);
                      noSelectionTimerRef.current = setTimeout(() => setNoSelectionHintVisible(false), 1800);
                      return;
                    }
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    let sent = 0;
                    let skipped = 0;
                    const newlyInvited: string[] = [];
                    for (const friendId of selected) {
                      try {
                        const res = await sendActivityInvites(friendId, [activityId]);
                        if ((res?.sentIds || []).length > 0) {
                          sent += 1;
                          newlyInvited.push(friendId);
                        } else {
                          skipped += 1;
                        }
                      } catch {
                        skipped += 1;
                      }
                    }
                    setInvitedFriendIds(prev => Array.from(new Set([...prev, ...newlyInvited])));
                    setSelectedFriendIds({});
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert('Invites',
                      sent > 0
                        ? `Sent invites to ${sent} friend${sent === 1 ? '' : 's'}${skipped ? ` (skipped ${skipped} already joined)` : ''}.`
                        : `No invites sent. ${skipped} skipped (already joined).`
                    );
                  }}
                  disabled={!Object.values(selectedFriendIds).some(v => v)}
                >
                  <Ionicons name="send" size={20} color="#fff" />
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
                    {Object.values(selectedFriendIds).filter(v => v).length > 0
                      ? `Invite ${Object.values(selectedFriendIds).filter(v => v).length} Friend${Object.values(selectedFriendIds).filter(v => v).length === 1 ? '' : 's'}`
                      : 'Select Friends to Invite'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', marginVertical: 20 }}>
                No friends to invite yet. Add friends to invite them to your activities!
              </Text>
            )}

            {/* Done Button */}
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 16,
                paddingHorizontal: 20,
                borderRadius: 12,
                gap: 10,
                backgroundColor: theme.primary,
                marginTop: 12,
              }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowSuccessModal(false);
                setSelectedFriendIds({});
                setInvitedFriendIds([]);
              }}
            >
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
                Done
              </Text>
            </TouchableOpacity>

            {/* Toast */}
            {noSelectionHintVisible && (
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 20, alignItems: 'center' }} pointerEvents="none">
                <Text style={{ backgroundColor: 'rgba(26, 233, 239, 0.2)', color: theme.text, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, fontWeight: '600', overflow: 'hidden' }}>
                  Please select friends to invite
                </Text>
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* Menu Modal */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMenuVisible(false)}>
          <Pressable style={[styles.modalCard, { maxWidth: 280, padding: 0 }]}>
            <TouchableOpacity onPress={() => setMenuVisible(false)} style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, backgroundColor: theme.background, borderRadius: 15, padding: 2 }}>
              <Ionicons name="close-circle" size={24} color={theme.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleShareActivity}
            >
              <Ionicons name="share-social-outline" size={22} color={theme.primary} />
              <Text style={styles.menuItemText}>Share Activity</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleReportActivity}
            >
              <Ionicons name="flag-outline" size={22} color={theme.danger} />
              <Text style={[styles.menuItemText, { color: theme.danger }]}>Report Activity</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

export default ActivityDetailsScreen;

const createStyles = (t: ReturnType<typeof useTheme>['theme']) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: t.background },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 520, backgroundColor: t.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: t.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { color: t.text, fontSize: 18, fontWeight: 'bold' },
  modalSubtitle: { color: t.muted, marginBottom: 12 },
  friendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  friendLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  friendAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: t.primary },
  friendName: { color: t.text, fontWeight: '600' },
  friendMeta: { color: t.muted, fontSize: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: t.primary, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: t.primary },
  modalActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  modalCancel: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: t.card, borderRadius: 10, borderWidth: 1, borderColor: t.danger },
  modalCancelText: { color: t.danger, fontWeight: '700' },
  modalConfirm: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.primary, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  modalConfirmText: { color: t.isDark ? '#111' : '#fff', fontWeight: '700' },
  bottomToast: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center' },
  bottomToastText: { backgroundColor: 'rgba(26, 233, 239, 0.18)', color: t.text, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, overflow: 'hidden', fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: t.background, position: 'relative', marginTop: 10, marginBottom: 18 },
  backButton: { padding: 4 },
  headerTitleContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  headerTitle: { fontSize: 28, color: t.primary, fontWeight: 'bold', textAlign: 'center' },
  mapContainer: { height: 250, width: '100%', marginVertical: 10, borderRadius: 10, overflow: 'hidden' },
  infoContainer: { paddingHorizontal: 15, paddingVertical: 15 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
  infoIcon: { marginRight: 8 },
  infoLabel: { fontSize: 14, color: t.primary, fontWeight: '600', marginRight: 6 },
  infoValue: { fontSize: 14, color: t.text, fontWeight: '500' },
  joinContainer: { marginVertical: 10, padding: 12, borderRadius: 12, backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
  joinText: { color: t.primary, fontSize: 15, fontWeight: '700' },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  progressTextRow: { flexDirection: 'row', alignItems: 'center' },
  fullBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#10b981', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, gap: 3 },
  fullBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 },
  progressBarContainer: { position: 'relative', marginBottom: 6 },
  progressBarBackground: { height: 8, backgroundColor: t.isDark ? '#1a1a1a' : '#e5e7eb', borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: t.border },
  progressBarFill: { height: '100%', borderRadius: 4, position: 'relative', overflow: 'visible' },
  sparkleContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' },
  sparkle: { position: 'absolute', top: -6 },
  sparkleText: { fontSize: 10 },
  progressPercentage: { position: 'absolute', right: 0, top: -22, color: t.primary, fontSize: 12, fontWeight: '700' },
  fullMessage: { color: '#10b981', fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 2 },
  descriptionSection: { marginTop: 15, marginBottom: 10 },
  descriptionTitle: { color: t.primary, fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  description: { color: t.text, fontSize: 14, lineHeight: 20 },
  actionsContainer: { marginTop: 20, alignItems: 'center' },
  actionButton: { flexDirection: 'row', backgroundColor: t.primary, padding: 15, borderRadius: 8, marginVertical: 5, alignItems: 'center', justifyContent: 'center', width: '90%' },
  actionButtonJoined: { backgroundColor: t.isDark ? '#007E84' : darkenHex(t.primary, 0.12) },
  actionButtonAddedToCalendar: { backgroundColor: t.isDark ? '#007E84' : darkenHex(t.primary, 0.12) },
  actionText: { color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 1.1 },
  actionTextJoined: { color: '#fff' },
  actionTextAddedToCalendar: { color: '#fff' },
  actionIconBold: { color: '#fff', fontWeight: 'bold', marginRight: 6 },
  actionIconAddedToCalendar: { color: '#fff' },
  myLocationButton: { position: 'absolute', bottom: 16, right: 16, backgroundColor: t.card, borderRadius: 24, padding: 8, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2, zIndex: 10 },
  activityLocationButton: { backgroundColor: t.card, borderRadius: 24, padding: 8, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2, marginBottom: 10, zIndex: 10 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  menuItemText: { color: t.text, fontSize: 16, fontWeight: '600' },
  menuDivider: { height: 1, backgroundColor: t.border },
});
