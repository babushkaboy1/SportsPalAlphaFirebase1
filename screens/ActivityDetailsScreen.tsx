import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getDisplayCreatorUsername } from '../utils/getDisplayCreatorUsername';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
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
import { ScrollView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Calendar from 'expo-calendar';
import MapView, { Marker, PROVIDER_DEFAULT, Polyline, UrlTile, Callout } from 'react-native-maps';
import { useActivityContext } from '../context/ActivityContext';
import UserAvatar from '../components/UserAvatar';
import { ActivitySuccessModal } from '../components/ActivitySuccessModal';
import { ActivityRatingModal } from '../components/ActivityRatingModal';
import { fetchUsersByIds } from '../utils/firestoreActivities';
import { getOrCreateChatForActivity } from '../utils/firestoreChats';
import { auth, db, storage } from '../firebaseConfig';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { doc, getDoc, updateDoc, arrayUnion, onSnapshot } from 'firebase/firestore';
import { normalizeDateFormat } from '../utils/storage';
import { ActivityIcon } from '../components/ActivityIcons';
import { sendActivityInvites } from '../utils/firestoreInvites';
import { useTheme } from '../context/ThemeContext';
import { shareActivity, generateActivityLink, copyLinkToClipboard } from '../utils/deepLinking';
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
  const { activityId, fromProfile } = route.params;
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const scrollContentStyle = useMemo(
    () => ({ flexGrow: 1, paddingBottom: Math.max(insets.bottom, 24) }),
    [insets.bottom]
  );
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
  
  // Rating modal state (for past activities from profile)
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [hasUserRated, setHasUserRated] = useState(false);
  const [userExistingRating, setUserExistingRating] = useState<number | null>(null);
  const ratingCardAnim = useRef(new Animated.Value(0)).current;
  
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
  const [gpxStats, setGpxStats] = useState<{
    distance?: string;
    ascent?: string;
    descent?: string;
    maxElevation?: string;
  }>({});
  
  // Main map route display state (auto-loaded for hiking/running/cycling)
  const [mainMapRouteCoords, setMainMapRouteCoords] = useState<Array<{ latitude: number; longitude: number }>>([]);
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
  
  // Direct fetch fallback for newly created activities not yet in context
  const [directFetchedActivity, setDirectFetchedActivity] = useState<any>(null);

  // Menu modal state
  const [menuVisible, setMenuVisible] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef<MapView>(null);

  // First try to find in context, then use direct fetch fallback
  const activityFromContext = allActivities.find(a => a.id === activityId);
  const activity = activityFromContext || directFetchedActivity;
  const gpxSupported = activity ? ['hiking', 'running', 'cycling'].includes(String((activity as any).activity || '').toLowerCase()) : false;
  
  // Auto-load route data for hiking/running/cycling activities to show on main map
  useEffect(() => {
    // Early exit - no activity or not a supported type
    if (!activity || !gpxSupported) return;
    
    // Check if there's actually any route data to load
    const hasDrawnRoute = (activity as any).drawnRoute && (activity as any).drawnRoute.length > 0;
    const hasGpx = !!(activity as any).gpx;
    
    // No route data at all - exit
    if (!hasDrawnRoute && !hasGpx) return;
    
    const loadRouteForMainMap = async () => {
      // Handle drawn routes first (instant)
      if (hasDrawnRoute) {
        setMainMapRouteCoords((activity as any).drawnRoute);
        return;
      }
      
      // Handle GPX files
      if (!hasGpx) return;
      
      try {
        // Prefer an explicit downloadUrl, otherwise try to derive one from storagePath
        let url: string | null = (activity as any).gpx?.downloadUrl || null;
        const storagePath: string | null = (activity as any).gpx?.storagePath || null;
        
        try {
          if (!url && storagePath) {
            if (storagePath.startsWith('http') || storagePath.startsWith('gs://')) {
              try {
                const r = storageRef(storage, storagePath);
                url = await getDownloadURL(r);
              } catch (e) {
                if (storagePath.startsWith('http')) {
                  url = storagePath;
                } else {
                  url = null;
                }
              }
            } else {
              const r = storageRef(storage, storagePath);
              url = await getDownloadURL(r);
            }
          }
        } catch (e) {
          console.warn('Could not resolve GPX download URL for main map', e);
          url = null;
        }
        
        if (!url) {
          return;
        }
        
        const resp = await fetch(url, {
          headers: { Accept: 'application/gpx+xml, text/xml, text/plain, */*' },
        });
        
        let text: string | null = null;
        try {
          text = await resp.text();
        } catch (e) {
          console.warn('resp.text() failed for main map GPX:', e);
        }
        
        if (!text || !/<(trkpt|rtept|wpt)\b/i.test(text)) {
          try {
            let ab: ArrayBuffer | null = null;
            if (typeof (resp as any).clone === 'function') {
              try {
                const resp2 = (resp as any).clone();
                ab = await resp2.arrayBuffer();
              } catch (e) {
                // Refetch if clone fails
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
            console.warn('binary decode path failed for main map GPX', e);
          }
        }
        
        const pts: Array<{ latitude: number; longitude: number }> = [];
        const xml = typeof text === 'string' ? text : '';
        
        // Extract track/route points
        const extractPoints = (tag: 'trkpt' | 'rtept') => {
          const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
          let m: RegExpExecArray | null;
          while ((m = regex.exec(xml)) !== null) {
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
        };
        
        extractPoints('trkpt');
        if (pts.length === 0) extractPoints('rtept');
        
        if (pts.length > 0) {
          setMainMapRouteCoords(pts);
        }
      } catch (e) {
        console.warn('Error loading route for main map:', e);
      }
    };
    
    loadRouteForMainMap();
  }, [activity?.id, gpxSupported]);
  
  // Direct fetch activity if not found in context (race condition fix for newly created activities)
  // This MUST be before any conditional returns to maintain hook order
  useEffect(() => {
    if (!activityFromContext && activityId) {
      const fetchActivity = async () => {
        try {
          const activityRef = doc(db, 'activities', activityId);
          const activitySnap = await getDoc(activityRef);
          if (activitySnap.exists()) {
            setDirectFetchedActivity({ id: activitySnap.id, ...activitySnap.data() });
          }
        } catch (error) {
          console.warn('Error direct-fetching activity:', error);
        }
      };
      fetchActivity();
    }
  }, [activityFromContext, activityId]);

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
      }, 400);
    }
  }, [route.params?.showSuccessModal, profile]);

  // Load friends for invite modal (MUST be before early return)
  const myFriendIdsForEffect: string[] = Array.isArray(profile?.friends) ? profile.friends : [];
  useEffect(() => {
    const loadFriends = async () => {
      try {
        if (myFriendIdsForEffect.length) {
          const users = await fetchUsersByIds(myFriendIdsForEffect);
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
  }, [JSON.stringify(myFriendIdsForEffect)]);

  // Check if user has already rated this activity (for past activities from profile)
  useEffect(() => {
    const checkRatingStatus = async () => {
      if (!activityId || !fromProfile) return;
      
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      
      try {
        const activityRef = doc(db, 'activities', activityId);
        const activitySnap = await getDoc(activityRef);
        
        if (activitySnap.exists()) {
          const data = activitySnap.data();
          const ratings = data.ratings || [];
          const userRating = ratings.find((r: any) => r.raterId === uid);
          
          if (userRating) {
            setHasUserRated(true);
            setUserExistingRating(userRating.overall || null);
          } else {
            setHasUserRated(false);
            setUserExistingRating(null);
          }
        }
      } catch (error) {
        console.warn('Error checking rating status:', error);
      }
    };
    
    checkRatingStatus();
  }, [activityId, fromProfile]);

  // Animate rating card appearance for past activities from profile
  useEffect(() => {
    if (fromProfile && activity) {
      // Delay animation for smooth entrance
      setTimeout(() => {
        Animated.spring(ratingCardAnim, {
          toValue: 1,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }).start();
      }, 500);
    }
  }, [fromProfile, activity]);

  // Early return with loading state if activity is null to prevent rendering errors
  if (!activity) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: insets.top,
        }}
      >
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
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
            photo: profile?.photo || profile?.photoURL || null,
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
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: theme.background }}>
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
                <Ionicons name="ellipsis-vertical" size={24} color={theme.primary} />
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
              <Ionicons name="ellipsis-vertical" size={24} color={theme.primary} />
            </TouchableOpacity>
            <View style={styles.headerTitleContainer}>
              <ActivityIcon activity={activity.activity} size={28} color={theme.primary} />
              <Text style={styles.headerTitle}>{activity.activity} Details</Text>
            </View>
          </View>
        )}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={scrollContentStyle}
          nestedScrollEnabled
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
                latitudeDelta: mainMapRouteCoords.length > 0 ? 0.05 : 0.01,
                longitudeDelta: mainMapRouteCoords.length > 0 ? 0.05 : 0.01,
              }}
              onMapReady={() => {
                // Fit map to show entire route when route data is available
                if (mainMapRouteCoords.length > 1 && mapRef.current) {
                  const allCoords = [
                    ...mainMapRouteCoords,
                    { latitude: activity.latitude, longitude: activity.longitude }
                  ];
                  mapRef.current.fitToCoordinates(allCoords, {
                    edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
                    animated: false,
                  });
                }
              }}
              showsUserLocation={!!userLocation}
              showsMyLocationButton={false}
              toolbarEnabled={false}
              userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
            >
              {/* Show route polyline when available */}
              {mainMapRouteCoords.length > 0 && (
                <>
                  {/* Triple-layer polyline for better visibility when lines overlap */}
                  {/* Outer shadow/border - makes crossings visible */}
                  <Polyline 
                    coordinates={mainMapRouteCoords} 
                    strokeWidth={10} 
                    strokeColor="rgba(0,0,0,0.2)" 
                  />
                  {/* White border layer - creates contrast at crossings */}
                  <Polyline 
                    coordinates={mainMapRouteCoords} 
                    strokeWidth={6} 
                    strokeColor={theme.isDark ? '#333' : '#fff'} 
                  />
                  {/* Main route color */}
                  <Polyline 
                    coordinates={mainMapRouteCoords} 
                    strokeWidth={4} 
                    strokeColor={theme.primary}
                  />
                  
                  {/* Route start marker - green circle with play icon */}
                  <Marker 
                    coordinate={mainMapRouteCoords[0]} 
                    anchor={{ x: 0.5, y: 0.5 }}
                    title="Start"
                  >
                    <View style={{ 
                      width: 28, 
                      height: 28, 
                      borderRadius: 14, 
                      backgroundColor: '#22c55e', 
                      borderWidth: 3, 
                      borderColor: '#fff',
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.3,
                      shadowRadius: 3,
                      elevation: 4,
                    }}>
                      <Ionicons name="play" size={14} color="#fff" style={{ marginLeft: 2 }} />
                    </View>
                  </Marker>
                  
                  {/* Only show finish marker if NOT a loop (start and end are far apart) */}
                  {(() => {
                    const start = mainMapRouteCoords[0];
                    const end = mainMapRouteCoords[mainMapRouteCoords.length - 1];
                    const dist = Math.sqrt(
                      Math.pow(end.latitude - start.latitude, 2) + 
                      Math.pow(end.longitude - start.longitude, 2)
                    );
                    // If distance > ~50m (rough estimate in degrees), show end marker
                    if (dist > 0.0005) {
                      return (
                        <Marker 
                          coordinate={end} 
                          anchor={{ x: 0.5, y: 0.5 }}
                          title="Finish"
                        >
                          <View style={{ 
                            width: 28, 
                            height: 28, 
                            borderRadius: 14, 
                            backgroundColor: '#ef4444', 
                            borderWidth: 3, 
                            borderColor: '#fff',
                            alignItems: 'center',
                            justifyContent: 'center',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.3,
                            shadowRadius: 3,
                            elevation: 4,
                          }}>
                            <Ionicons name="flag" size={14} color="#fff" />
                          </View>
                        </Marker>
                      );
                    }
                    return null;
                  })()}
                </>
              )}
              
              {/* Meeting point marker - custom circle for route activities, default pin for others */}
              {['Hiking', 'Running', 'Cycling'].includes(activity.activity) ? (
                <Marker
                  coordinate={{ latitude: activity.latitude, longitude: activity.longitude }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  title="Meet Here"
                  description={activity.location}
                  zIndex={999}
                >
                  <View style={{ 
                    width: 32, 
                    height: 32, 
                    borderRadius: 16, 
                    backgroundColor: '#f59e0b', 
                    borderWidth: 3, 
                    borderColor: '#fff',
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.3,
                    shadowRadius: 3,
                    elevation: 4,
                  }}>
                    <Ionicons name="people" size={16} color="#fff" />
                  </View>
                </Marker>
              ) : (
                <Marker
                  coordinate={{ latitude: activity.latitude, longitude: activity.longitude }}
                  title="Meet Here"
                  description={activity.location}
                  zIndex={999}
                />
              )}
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
                    // If route exists, fit to route bounds; otherwise just show activity location
                    if (mainMapRouteCoords.length > 1) {
                      const allCoords = [
                        ...mainMapRouteCoords,
                        { latitude: activity.latitude, longitude: activity.longitude }
                      ];
                      mapRef.current?.fitToCoordinates(allCoords, {
                        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
                        animated: true,
                      });
                    } else {
                      mapRef.current?.animateToRegion({
                        latitude: activity.latitude,
                        longitude: activity.longitude,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                      });
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <ActivityIcon activity={activity.activity} size={28} color={theme.primary} />
                </TouchableOpacity>
              </>
            )}
          </View>
          
          {/* Compact route stats below map - for GPX routes with stats OR drawn routes */}
          {mainMapRouteCoords.length > 0 && ((activity as any).gpx?.stats || (activity as any).drawnRoute) && (
            <View style={{ backgroundColor: theme.card, marginHorizontal: 16, marginTop: 8, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.border }}>
              {(() => {
                const s: any = (activity as any).gpx?.stats || {};
                
                // For drawn routes, calculate distance from mainMapRouteCoords
                let calculatedDistance = s.distance || '';
                if (!calculatedDistance && mainMapRouteCoords.length > 1) {
                  let totalDist = 0;
                  for (let i = 1; i < mainMapRouteCoords.length; i++) {
                    const p1 = mainMapRouteCoords[i - 1];
                    const p2 = mainMapRouteCoords[i];
                    const R = 6371; // Earth's radius in km
                    const dLat = (p2.latitude - p1.latitude) * Math.PI / 180;
                    const dLon = (p2.longitude - p1.longitude) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                             Math.cos(p1.latitude * Math.PI / 180) * Math.cos(p2.latitude * Math.PI / 180) *
                             Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    totalDist += R * c;
                  }
                  calculatedDistance = totalDist >= 1 
                    ? `${totalDist.toFixed(2)} km` 
                    : `${(totalDist * 1000).toFixed(0)} m`;
                }
                
                const row1 = [
                  { icon: 'trail-sign', label: 'Dist', value: calculatedDistance || '—' },
                  { icon: 'trending-up', label: 'Up', value: s.ascent || '—' },
                  { icon: 'trending-down', label: 'Down', value: s.descent || '—' },
                ];
                const row2 = [
                  { icon: 'arrow-up-circle', label: 'Max', value: s.maxElevation || '—' },
                  { icon: 'speedometer', label: 'Diff', value: s.difficulty || '—' },
                  { icon: 'git-branch', label: 'Type', value: s.routeType || '—' },
                ];
                return (
                  <>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 6 }}>
                      {row1.map((item) => (
                        <View key={item.label} style={{ alignItems: 'center', flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                            <Ionicons name={item.icon as any} size={11} color={theme.primary} style={{ marginRight: 3 }} />
                            <Text style={{ fontSize: 10, color: theme.muted, fontWeight: '600' }}>{item.label}</Text>
                          </View>
                          <Text style={{ fontSize: 11, color: theme.text, fontWeight: '700' }} numberOfLines={1}>{item.value}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                      {row2.map((item) => (
                        <View key={item.label} style={{ alignItems: 'center', flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                            <Ionicons name={item.icon as any} size={11} color={theme.primary} style={{ marginRight: 3 }} />
                            <Text style={{ fontSize: 10, color: theme.muted, fontWeight: '600' }}>{item.label}</Text>
                          </View>
                          <Text style={{ fontSize: 11, color: theme.text, fontWeight: '700' }} numberOfLines={1}>{item.value}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                );
              })()}
            </View>
          )}

          {/* Rating Card for Past Activities (placed under map) */}
          {isHistorical && fromProfile && (
            <Animated.View
              style={[
                styles.ratingCard,
                {
                  opacity: ratingCardAnim,
                  transform: [
                    {
                      translateY: ratingCardAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [20, 0],
                      }),
                    },
                    {
                      scale: ratingCardAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.95, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.ratingCardHeader}>
                <View style={styles.ratingCardIconContainer}>
                  {hasUserRated ? (
                    <Ionicons name="star" size={28} color="#FFD700" />
                  ) : (
                    <Ionicons name="star-outline" size={28} color={theme.primary} />
                  )}
                </View>
                <View style={styles.ratingCardTextContainer}>
                  <Text style={styles.ratingCardTitle}>
                    {hasUserRated ? 'You rated this activity' : 'How was this activity?'}
                  </Text>
                  <Text style={styles.ratingCardSubtitle}>
                    {hasUserRated 
                      ? `You gave it ${userExistingRating} star${userExistingRating !== 1 ? 's' : ''}`
                      : 'Your feedback helps the community'}
                  </Text>
                </View>
              </View>
              
              {!hasUserRated && (
                <View style={styles.ratingPreviewStars}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <TouchableOpacity
                      key={star}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setShowRatingModal(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="star-outline" size={32} color={theme.border} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              
              <TouchableOpacity
                style={[
                  styles.ratingCardButton,
                  hasUserRated && styles.ratingCardButtonSecondary,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowRatingModal(true);
                }}
                activeOpacity={0.8}
              >
                <Ionicons 
                  name={hasUserRated ? 'eye-outline' : 'star'} 
                  size={18} 
                  color={hasUserRated ? theme.primary : '#fff'} 
                />
                <Text style={[
                  styles.ratingCardButtonText,
                  hasUserRated && styles.ratingCardButtonTextSecondary,
                ]}>
                  {hasUserRated ? 'View Rating' : 'Rate Now'}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}

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
                {joinedUsers.length < activity.maxParticipants && (
                  <Text style={styles.progressPercentage}>
                    {Math.round((joinedUsers.length / activity.maxParticipants) * 100)}%
                  </Text>
                )}
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
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowGpxModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ width: '95%', maxWidth: 600, maxHeight: '90%', backgroundColor: theme.card, borderRadius: 24, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 20 }}>
            <View style={styles.routeModalHeader}>
              <TouchableOpacity 
                onPress={() => setShowGpxModal(false)}
                style={styles.routeModalCloseButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-circle" size={32} color={theme.primary} />
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={styles.routeModalTitle}>{(activity as any).activity} Route</Text>
                <Text style={styles.routeModalSubtitle}>{simplifyLocation(activity.location)}</Text>
              </View>
              <View style={{ width: 40 }} />
            </View>
            <View style={{ height: 550 }}>
            {gpxLoading ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background }}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={{ color: theme.muted, marginTop: 16, fontSize: 15 }}>Loading route...</Text>
              </View>
            ) : gpxError ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background, paddingHorizontal: 24 }}>
                <Ionicons name="alert-circle-outline" size={64} color={theme.muted} style={{ marginBottom: 16 }} />
                <Text style={{ color: theme.text, textAlign: 'center', fontSize: 16, fontWeight: '600', marginBottom: 8 }}>{gpxError}</Text>
                <Text style={{ color: theme.muted, textAlign: 'center', fontSize: 14 }}>Unable to load route data</Text>
              </View>
            ) : (gpxCoords.length > 0 || gpxWaypoints.length > 0) ? (
              <View style={{ flex: 1, position: 'relative' }}>
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
                  toolbarEnabled={false}
                  showsCompass={true}
                  showsScale={true}
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
                      <Polyline coordinates={gpxCoords} strokeWidth={8} strokeColor="rgba(0,0,0,0.3)" />
                      <Polyline coordinates={gpxCoords} strokeWidth={5} strokeColor={theme.primary} />
                      {/* Start marker with custom styling */}
                      <Marker coordinate={gpxCoords[0]} title="Start">
                        <View style={{ backgroundColor: '#10b981', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 }}>
                          <Ionicons name="play" size={18} color="#fff" />
                        </View>
                      </Marker>
                      {/* End marker with custom styling */}
                      <Marker coordinate={gpxCoords[gpxCoords.length - 1]} title="Finish">
                        <View style={{ backgroundColor: '#ef4444', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 }}>
                          <Ionicons name="flag" size={18} color="#fff" />
                        </View>
                      </Marker>
                      
                      {/* Meeting point marker for drawn routes */}
                      {(activity as any).drawnRoute && activity.latitude && activity.longitude && (
                        <Marker
                          coordinate={{ latitude: activity.latitude, longitude: activity.longitude }}
                          title="Meeting Point"
                        >
                          <View style={{ backgroundColor: '#f59e0b', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 }}>
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
                
                {/* Route stats overlay */}
                {gpxStats && (gpxStats.distance || gpxStats.ascent || gpxStats.descent || gpxStats.maxElevation) && (
                  <View style={styles.routeStatsOverlay}>
                    {gpxStats.distance && (
                      <View style={styles.routeStatItem}>
                        <Ionicons name="speedometer-outline" size={20} color={theme.primary} />
                        <Text style={styles.routeStatValue}>{gpxStats.distance}</Text>
                        <Text style={styles.routeStatLabel}>Distance</Text>
                      </View>
                    )}
                    {gpxStats.ascent && (
                      <View style={styles.routeStatItem}>
                        <Ionicons name="trending-up" size={20} color="#10b981" />
                        <Text style={styles.routeStatValue}>{gpxStats.ascent}</Text>
                        <Text style={styles.routeStatLabel}>Ascent</Text>
                      </View>
                    )}
                    {gpxStats.descent && (
                      <View style={styles.routeStatItem}>
                        <Ionicons name="trending-down" size={20} color="#ef4444" />
                        <Text style={styles.routeStatValue}>{gpxStats.descent}</Text>
                        <Text style={styles.routeStatLabel}>Descent</Text>
                      </View>
                    )}
                    {gpxStats.maxElevation && (
                      <View style={styles.routeStatItem}>
                        <Ionicons name="triangle-outline" size={20} color="#8b5cf6" />
                        <Text style={styles.routeStatValue}>{gpxStats.maxElevation}</Text>
                        <Text style={styles.routeStatLabel}>Max Elevation</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background }}>
                <Ionicons name="map-outline" size={64} color={theme.muted} style={{ marginBottom: 16 }} />
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>No route data available</Text>
              </View>
            )}
          </View>
          </View>
        </View>
      </Modal>

      {/* Invite Friends Modal */}
      <Modal
        visible={inviteFriendsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteFriendsVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setInviteFriendsVisible(false)}>
          <Pressable style={styles.inviteModalCard} onPress={() => {}}>
            {/* Header with icon */}
            <View style={styles.inviteModalHeader}>
              <View style={styles.inviteModalIconWrap}>
                <Ionicons name="people" size={28} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inviteModalTitle}>Invite Connections</Text>
                <Text style={styles.inviteModalSubtitle}>
                  {friendProfiles.length === 0 
                    ? 'Add connections to invite them'
                    : `Select who to invite to this ${activity?.activity || 'activity'}`}
                </Text>
              </View>
              <TouchableOpacity 
                style={styles.inviteModalCloseBtn} 
                onPress={() => setInviteFriendsVisible(false)}
              >
                <Ionicons name="close" size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>

            {/* Connection list */}
            <ScrollView 
              style={styles.inviteModalList} 
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              {friendProfiles.length === 0 ? (
                <View style={styles.inviteEmptyState}>
                  <Ionicons name="person-add-outline" size={48} color={theme.muted} style={{ marginBottom: 12 }} />
                  <Text style={styles.inviteEmptyTitle}>No connections yet</Text>
                  <Text style={styles.inviteEmptyText}>
                    Connect with other users from the Connections tab to invite them to activities.
                  </Text>
                </View>
              ) : (
                <>
                  {/* Show invitable friends first */}
                  {friendProfiles.filter(f => !joinedUserIds.includes(f.uid)).map((f) => {
                    const selected = !!selectedFriendIds[f.uid];
                    return (
                      <TouchableOpacity
                        key={f.uid}
                        style={[styles.inviteFriendRow, selected && styles.inviteFriendRowSelected]}
                        onPress={() => toggleSelectFriend(f.uid, false)}
                        activeOpacity={0.7}
                      >
                        <UserAvatar
                          photoUrl={f.photo || f.photoURL}
                          username={f.username || 'User'}
                          size={46}
                          style={styles.inviteFriendAvatar}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.inviteFriendName}>{f.username || 'User'}</Text>
                          <Text style={styles.inviteFriendHint}>Tap to {selected ? 'deselect' : 'select'}</Text>
                        </View>
                        <View style={[styles.inviteCheckbox, selected && styles.inviteCheckboxSelected]}>
                          {selected && <Ionicons name="checkmark" size={16} color={'#fff'} />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  
                  {/* Show already joined friends at the end */}
                  {friendProfiles.filter(f => joinedUserIds.includes(f.uid)).length > 0 && (
                    <View style={styles.inviteJoinedSection}>
                      <Text style={styles.inviteJoinedLabel}>Already in this activity</Text>
                      {friendProfiles.filter(f => joinedUserIds.includes(f.uid)).map((f) => (
                        <View key={f.uid} style={styles.inviteFriendRowJoined}>
                          <UserAvatar
                            photoUrl={f.photo || f.photoURL}
                            username={f.username || 'User'}
                            size={40}
                            style={[styles.inviteFriendAvatar, { opacity: 0.7 }]}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.inviteFriendName, { opacity: 0.7 }]}>{f.username || 'User'}</Text>
                          </View>
                          <View style={styles.inviteJoinedBadge}>
                            <Ionicons name="checkmark-circle" size={14} color={'#10b981'} />
                            <Text style={styles.inviteJoinedBadgeText}>Joined</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                  
                  {/* All friends already joined message */}
                  {friendProfiles.length > 0 && friendProfiles.every(f => joinedUserIds.includes(f.uid)) && (
                    <View style={styles.inviteAllJoinedMsg}>
                      <Ionicons name="checkmark-done-circle" size={24} color={'#10b981'} />
                      <Text style={styles.inviteAllJoinedText}>
                        All your connections have already joined this activity!
                      </Text>
                    </View>
                  )}
                </>
              )}
            </ScrollView>

            {/* Footer actions */}
            <View style={styles.inviteModalFooter}>
              <TouchableOpacity 
                style={styles.inviteModalCancelBtn} 
                onPress={() => setInviteFriendsVisible(false)}
              >
                <Text style={styles.inviteModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[
                  styles.inviteModalSendBtn,
                  Object.values(selectedFriendIds).filter(Boolean).length === 0 && styles.inviteModalSendBtnDisabled
                ]} 
                onPress={confirmInviteFriends}
                disabled={friendProfiles.length === 0}
              >
                <Ionicons name="paper-plane" size={18} color={'#fff'} />
                <Text style={styles.inviteModalSendText}>
                  {Object.values(selectedFriendIds).filter(Boolean).length > 0
                    ? `Send (${Object.values(selectedFriendIds).filter(Boolean).length})`
                    : 'Send Invites'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
          {noSelectionHintVisible && (
            <View style={styles.bottomToast} pointerEvents="none">
              <Text style={styles.bottomToastText}>Select at least one connection</Text>
            </View>
          )}
        </Pressable>
      </Modal>

      {/* Success Modal (for newly created activities) */}
      <ActivitySuccessModal
        visible={showSuccessModal}
        sport={route.params?.activitySport || activity.activity}
        friendProfiles={friendProfiles}
        selectedFriendIds={selectedFriendIds}
        invitedFriendIds={invitedFriendIds}
        onSelectFriend={(friendId: string) => {
          if (!invitedFriendIds.includes(friendId)) {
            setSelectedFriendIds(prev => ({ ...prev, [friendId]: !prev[friendId] }));
          }
        }}
        onInviteFriends={async () => {
          const selected = Object.keys(selectedFriendIds).filter(id => selectedFriendIds[id] && !invitedFriendIds.includes(id));
          if (selected.length === 0) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return;
          }
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
          Alert.alert('Invites Sent! 🎉',
            sent > 0
              ? `Sent invites to ${sent} friend${sent === 1 ? '' : 's'}${skipped ? ` (skipped ${skipped} already joined)` : ''}.`
              : `No invites sent. ${skipped} skipped (already joined).`
          );
        }}
        onClose={() => {
          setShowSuccessModal(false);
          setSelectedFriendIds({});
          setInvitedFriendIds([]);
        }}
      />

      {/* Menu Modal */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMenuVisible(false)}>
          <Pressable style={styles.menuModalCard}>
            {/* Header */}
            <View style={styles.menuModalHeader}>
              <View style={styles.menuModalIconWrap}>
                <ActivityIcon activity={activity.activity} size={24} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuModalTitle} numberOfLines={1}>{activity.activity}</Text>
                <Text style={styles.menuModalSubtitle}>Activity Options</Text>
              </View>
              <TouchableOpacity 
                onPress={() => setMenuVisible(false)} 
                style={styles.menuModalCloseBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>

            {/* Actions */}
            <View style={styles.menuModalActions}>
              {/* Share */}
              <TouchableOpacity
                style={styles.menuModalItem}
                onPress={() => {
                  setMenuVisible(false);
                  handleShareActivity();
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.menuModalItemIcon, { backgroundColor: `${theme.primary}15` }]}>
                  <Ionicons name="share-social-outline" size={20} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuModalItemText}>Share Activity</Text>
                  <Text style={styles.menuModalItemHint}>Send to friends or social media</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.muted} />
              </TouchableOpacity>

              {/* Copy Link */}
              <TouchableOpacity
                style={styles.menuModalItem}
                onPress={async () => {
                  setMenuVisible(false);
                  const link = generateActivityLink(activity.id);
                  await copyLinkToClipboard(link);
                  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert('Link Copied!', 'Activity link copied to clipboard');
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.menuModalItemIcon, { backgroundColor: `${theme.primary}15` }]}>
                  <Ionicons name="link-outline" size={20} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuModalItemText}>Copy Link</Text>
                  <Text style={styles.menuModalItemHint}>Copy activity link to clipboard</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.muted} />
              </TouchableOpacity>

              {/* View Host Profile */}
              {activity.creatorId && activity.creatorId !== auth.currentUser?.uid && (
                <TouchableOpacity
                  style={styles.menuModalItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('UserProfile', { userId: activity.creatorId });
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.menuModalItemIcon, { backgroundColor: `${theme.primary}15` }]}>
                    <Ionicons name="person-outline" size={20} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.menuModalItemText}>View Host Profile</Text>
                    <Text style={styles.menuModalItemHint}>{creatorUsername || 'Activity creator'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.muted} />
                </TouchableOpacity>
              )}

              {/* Invite Friends */}
              {!isHistorical && (
                <TouchableOpacity
                  style={styles.menuModalItem}
                  onPress={() => {
                    setMenuVisible(false);
                    openInviteFriends();
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.menuModalItemIcon, { backgroundColor: `${theme.primary}15` }]}>
                    <Ionicons name="people-outline" size={20} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.menuModalItemText}>Invite Friends</Text>
                    <Text style={styles.menuModalItemHint}>Send invites to your connections</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.muted} />
                </TouchableOpacity>
              )}

              {/* Get Directions */}
              <TouchableOpacity
                style={styles.menuModalItem}
                onPress={() => {
                  setMenuVisible(false);
                  handleGetDirections();
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.menuModalItemIcon, { backgroundColor: `${theme.primary}15` }]}>
                  <Ionicons name="navigate-outline" size={20} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuModalItemText}>Get Directions</Text>
                  <Text style={styles.menuModalItemHint}>Open in maps app</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.muted} />
              </TouchableOpacity>
            </View>

            {/* Danger Zone */}
            <View style={styles.menuModalDangerSection}>
              <TouchableOpacity
                style={styles.menuModalDangerItem}
                onPress={handleReportActivity}
                activeOpacity={0.7}
              >
                <View style={[styles.menuModalItemIcon, { backgroundColor: `${theme.danger}15` }]}>
                  <Ionicons name="flag-outline" size={20} color={theme.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.menuModalItemText, { color: theme.danger }]}>Report Activity</Text>
                  <Text style={styles.menuModalItemHint}>Flag inappropriate content</Text>
                </View>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Rating Modal (for past activities from profile) */}
      <ActivityRatingModal
        visible={showRatingModal}
        activity={activity ? {
          id: activityId,
          activity: activity.activity,
          hasRoute: !!(activity as any).gpx,
          joinedParticipants: joinedUsers.map(u => ({
            oderId: u.oderId,
            odername: u.ordername,
            uid: u.oderId,
            username: u.ordername,
            photoURL: u.photoURL,
          })),
        } : null}
        onClose={() => setShowRatingModal(false)}
        onRatingSubmitted={(_activityId: string, rating: number) => {
          setHasUserRated(true);
          setUserExistingRating(rating);
        }}
      />
    </View>
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
  modalConfirmText: { color: '#fff', fontWeight: '700' },
  bottomToast: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center' },
  bottomToastText: { backgroundColor: 'rgba(26, 233, 239, 0.18)', color: t.text, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, overflow: 'hidden', fontWeight: '600' },
  
  // New Invite Modal Styles
  inviteModalCard: { 
    width: '100%', 
    maxWidth: 420, 
    backgroundColor: t.card, 
    borderRadius: 20, 
    padding: 0, 
    borderWidth: 1, 
    borderColor: t.border,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  inviteModalHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16, 
    paddingBottom: 12,
    borderBottomWidth: 1, 
    borderBottomColor: t.border,
    gap: 12,
  },
  inviteModalIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.isDark ? 'rgba(26, 233, 239, 0.15)' : 'rgba(26, 233, 239, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteModalTitle: { 
    color: t.text, 
    fontSize: 18, 
    fontWeight: 'bold',
  },
  inviteModalSubtitle: { 
    color: t.muted, 
    fontSize: 13,
    marginTop: 2,
  },
  inviteModalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteModalList: { 
    maxHeight: 320, 
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  inviteEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  inviteEmptyTitle: {
    color: t.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  inviteEmptyText: {
    color: t.muted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  inviteFriendRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    gap: 12,
  },
  inviteFriendRowSelected: {
    backgroundColor: t.isDark ? 'rgba(26, 233, 239, 0.12)' : 'rgba(26, 233, 239, 0.08)',
    borderWidth: 1,
    borderColor: t.primary,
  },
  inviteFriendRowJoined: {
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginVertical: 2,
    borderRadius: 10,
    gap: 10,
    opacity: 0.7,
  },
  inviteFriendAvatar: { 
    width: 46, 
    height: 46, 
    borderRadius: 23, 
    borderWidth: 2, 
    borderColor: t.primary,
  },
  inviteFriendName: { 
    color: t.text, 
    fontWeight: '600',
    fontSize: 15,
  },
  inviteFriendHint: {
    color: t.muted,
    fontSize: 12,
    marginTop: 2,
  },
  inviteCheckbox: { 
    width: 24, 
    height: 24, 
    borderRadius: 12, 
    borderWidth: 2, 
    borderColor: t.primary, 
    alignItems: 'center', 
    justifyContent: 'center',
  },
  inviteCheckboxSelected: { 
    backgroundColor: t.primary,
  },
  inviteJoinedSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  inviteJoinedLabel: {
    color: t.muted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inviteJoinedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.isDark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  inviteJoinedBadgeText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '600',
  },
  inviteAllJoinedMsg: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.isDark ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.08)',
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
    gap: 10,
  },
  inviteAllJoinedText: {
    color: t.text,
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  inviteModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: t.border,
    gap: 12,
  },
  inviteModalCancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
  },
  inviteModalCancelText: {
    color: t.muted,
    fontWeight: '600',
    fontSize: 15,
  },
  inviteModalSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
  },
  inviteModalSendBtnDisabled: {
    opacity: 0.5,
  },
  inviteModalSendText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },

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
  
  // Enhanced Menu Modal Styles
  menuModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: t.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: t.border,
    overflow: 'hidden',
  },
  menuModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
    gap: 12,
  },
  menuModalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.isDark ? 'rgba(26, 233, 239, 0.15)' : 'rgba(26, 233, 239, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuModalTitle: {
    color: t.text,
    fontSize: 17,
    fontWeight: 'bold',
  },
  menuModalSubtitle: {
    color: t.muted,
    fontSize: 12,
    marginTop: 1,
  },
  menuModalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuModalActions: {
    padding: 8,
  },
  menuModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    gap: 12,
  },
  menuModalItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuModalItemText: {
    color: t.text,
    fontSize: 15,
    fontWeight: '600',
  },
  menuModalItemHint: {
    color: t.muted,
    fontSize: 12,
    marginTop: 1,
  },
  menuModalDangerSection: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: t.border,
    marginTop: 4,
    paddingTop: 8,
  },
  menuModalDangerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    gap: 12,
  },
  
  // Route modal styles
  routeModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 2,
    borderBottomColor: t.border,
    backgroundColor: t.card,
  },
  routeModalCloseButton: {
    padding: 4,
    borderRadius: 20,
    backgroundColor: t.background,
  },
  routeModalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: t.text,
    letterSpacing: 0.3,
  },
  routeModalSubtitle: {
    fontSize: 14,
    color: t.primary,
    marginTop: 3,
    fontWeight: '600',
  },
  routeStatsOverlay: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: t.card,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-around',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: t.border,
  },
  routeStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  routeStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text,
    marginTop: 4,
  },
  routeStatLabel: {
    fontSize: 11,
    color: t.muted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Rating Card Styles (for past activities from profile)
  ratingCard: {
    backgroundColor: t.card,
    borderRadius: 20,
    padding: 20,
    marginTop: 20,
    borderWidth: 2,
    borderColor: t.isDark ? 'rgba(26, 233, 239, 0.3)' : 'rgba(26, 233, 239, 0.2)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  ratingCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  ratingCardIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: t.isDark ? 'rgba(255, 215, 0, 0.15)' : 'rgba(255, 215, 0, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  ratingCardTextContainer: {
    flex: 1,
  },
  ratingCardTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: t.text,
    marginBottom: 3,
  },
  ratingCardSubtitle: {
    fontSize: 13,
    color: t.muted,
  },
  ratingPreviewStars: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 16,
  },
  ratingCardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.primary,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  ratingCardButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: t.primary,
  },
  ratingCardButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  ratingCardButtonTextSecondary: {
    color: t.primary,
  },
});
