import { RouteProp } from '@react-navigation/native';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  FlatList,
  TextInput,
  StatusBar, // <-- Add this import
  Animated,
  RefreshControl,
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  Alert,
  Clipboard,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
// useActivityContext is already imported above in this file; avoid duplicate
import { ActivityIcon } from '../components/ActivityIcons';
import { ActivityRatingModal } from '../components/ActivityRatingModal';
import UserAvatar from '../components/UserAvatar';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ensureDmChat } from '../utils/firestoreChats';
import { sendFriendRequest, cancelFriendRequest } from '../utils/firestoreFriends';
import { useActivityContext } from '../context/ActivityContext';
import { sendActivityInvites } from '../utils/firestoreInvites';
import { RootStackParamList } from '../types/navigation';
import { doc, getDoc, collection, query as fsQuery, orderBy, startAt, endAt, limit, getDocs, onSnapshot, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { activities } from '../data/activitiesData';

import { getDisplayCreatorUsername } from '../utils/getDisplayCreatorUsername';
import { useTheme } from '../context/ThemeContext';
import { getProfileFromCache, updateProfileInCache } from '../utils/chatCache';
import { shareActivity, shareProfile } from '../utils/deepLinking';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';

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

// Helper component for host username display (shows "You" when appropriate)
function HostUsername({ activity }: { activity: any }) {
  const { theme } = useTheme();
  const [username, setUsername] = React.useState('');
  React.useEffect(() => {
    let mounted = true;
    const fetchUsername = async () => {
      try {
        const name = await getDisplayCreatorUsername(activity.creatorId, activity.creator);
        if (mounted) setUsername(name);
      } catch (e) {
        if (mounted) setUsername(activity.creator || 'User');
      }
    };
    fetchUsername();
    return () => { mounted = false; };
  }, [activity.creatorId, activity.creator]);
  return <Text style={{ fontSize: 14, color: theme.muted, fontWeight: '500' }}>{username}</Text>;
}

type ProfileStackParamList = {
  ProfileMain: undefined;
  ActivityDetails: { activityId: string; fromProfile?: boolean };
  UserProfile: { userId: string };
  Settings: undefined;
  CreateProfile: { mode: string; profileData: any };
};

const ProfileScreen = () => {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<StackNavigationProp<ProfileStackParamList, 'ProfileMain'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Profile'>>();
  const userId = route.params?.userId;
  const insets = useSafeAreaInsets();
  const { joinedActivities, toggleJoinActivity, isActivityJoined, allActivities, profile: contextProfile, reloadAllActivities } = useActivityContext();
  
  // Initialize with contextProfile to avoid 0 flash (if viewing own profile)
  const [profile, setProfile] = useState<any>(() => {
    if (!userId && contextProfile) {
      return contextProfile;
    }
    return null;
  });
  const [activeTab, setActiveTab] = useState<'activities' | 'history' | 'friends'>('activities');
  const pagerRef = useRef<PagerView | null>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const [userJoinedActivities, setUserJoinedActivities] = useState<any[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const [displayedActivitiesCount, setDisplayedActivitiesCount] = useState(5);
  const [displayedHistoryCount, setDisplayedHistoryCount] = useState(5);
  const [displayedConnectionsCount, setDisplayedConnectionsCount] = useState(8);
  const [isLoadingMoreActivities, setIsLoadingMoreActivities] = useState(false);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [isLoadingMoreConnections, setIsLoadingMoreConnections] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteTargetUser, setInviteTargetUser] = useState<{uid: string; username: string; photo?: string} | null>(null);
  const [inviteSelection, setInviteSelection] = useState<Record<string, boolean>>({});
  const myJoinedActivities = allActivities.filter(a => joinedActivities.includes(a.id));
  // Stats modals
  const [favModalVisible, setFavModalVisible] = useState(false);
  const [connectionsModalVisible, setConnectionsModalVisible] = useState(false);
  const [activitiesModalVisible, setActivitiesModalVisible] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  
  // Rating modal state (for rating past activities directly from card)
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingActivity, setRatingActivity] = useState<any>(null);
  const [localRatings, setLocalRatings] = useState<Record<string, number>>({});

  // Activities breakdown by sport
  const activitiesBreakdown = React.useMemo(() => {
    const breakdown: Record<string, { total: number; upcoming: number; past: number }> = {};
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    myJoinedActivities.forEach((activity) => {
      const sport = activity.activity || 'Unknown';
      if (!breakdown[sport]) {
        breakdown[sport] = { total: 0, upcoming: 0, past: 0 };
      }
      breakdown[sport].total++;

      // Check if upcoming or past
      try {
        const [dd, mm, yyyy] = (activity.date || '').split('-');
        const activityDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
        activityDate.setHours(0, 0, 0, 0);
        if (activityDate >= now) {
          breakdown[sport].upcoming++;
        } else {
          breakdown[sport].past++;
        }
      } catch {
        breakdown[sport].past++;
      }
    });

    // Convert to sorted array
    return Object.entries(breakdown)
      .map(([sport, counts]) => ({ sport, ...counts }))
      .sort((a, b) => b.total - a.total);
  }, [myJoinedActivities]);

  // Lightweight bottom toast
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
  useEffect(() => () => { if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current); }, []);

  const openInviteModal = (user: {uid: string; username: string; photo?: string}) => {
    setInviteTargetUser(user);
    // preselect none
    setInviteSelection({});
    setInviteModalVisible(true);
  };

  const toggleSelectInvite = (activityId: string) => {
    setInviteSelection(prev => ({ ...prev, [activityId]: !prev[activityId] }));
  };

  const confirmSendInvites = async () => {
    if (!inviteTargetUser) return;
    const selected = Object.keys(inviteSelection).filter(id => inviteSelection[id]);
    if (selected.length === 0) {
      setInviteModalVisible(false);
      return;
    }
    // Filter out activities the target already joined (UI should already prevent selecting these)
    const notJoined = selected.filter((id) => {
      const act = allActivities.find(a => a.id === id);
      const joinedIds = (act as any)?.joinedUserIds || [];
      return !(Array.isArray(joinedIds) && joinedIds.includes(inviteTargetUser.uid));
    });
    if (notJoined.length === 0) {
      showToast(`${inviteTargetUser.username} is already in those activities`);
      return;
    }
    try {
      const { sentIds } = await sendActivityInvites(inviteTargetUser.uid, notJoined);
      if (sentIds.length > 0) {
        showToast(sentIds.length === 1 ? 'Invite sent' : `Sent ${sentIds.length} invites`);
      } else {
        showToast('No invites sent');
      }
    } catch {
      showToast('Could not send invites');
    }
    setInviteModalVisible(false);
    setInviteSelection({});
  };
  // User search (Friends tab)
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userResults, setUserResults] = useState<Array<{ uid: string; username: string; photo?: string }>>([]);
  const [userSearching, setUserSearching] = useState(false);
  const userSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUid = auth.currentUser?.uid;
  const [friends, setFriends] = useState<Array<{ uid: string; username: string; photo?: string }>>([]);
  const [myFriendIds, setMyFriendIds] = useState<string[]>([]);
  const [myRequestsSent, setMyRequestsSent] = useState<string[]>([]);

  const fetchProfile = async () => {
    let uid = userId;
    if (!uid) {
      const user = auth.currentUser;
      if (!user) return;
      uid = user.uid;
    }

    // ========== LOAD FROM CACHE FIRST (instant UI) ==========
    const cachedProfile = await getProfileFromCache(uid);
    if (cachedProfile) {
      console.log('📦 Loaded profile from cache (instant UI)');
      setProfile({ ...cachedProfile, uid });
    }

    // Fetch fresh from Firestore
    const docRef = doc(db, "profiles", uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data: any = docSnap.data();
      const profileData = { ...data, uid };
      setProfile(profileData);
      
      // ========== SAVE TO CACHE ==========
      await updateProfileInCache({
        uid,
        username: data.username || 'User',
        photo: data.photo || data.photoURL,
        bio: data.bio,
        socials: data.socials,
        selectedSports: data.selectedSports,
      } as any);
    } else {
      setProfile(null);
    }
  };

  const handleShareProfile = async () => {
    try {
      await shareProfile(auth.currentUser?.uid || '', profile?.username || 'User');
    } catch (error) {
      console.error(error);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchProfile();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await fetchProfile();
    await reloadAllActivities();
    setTimeout(() => {
      setRefreshing(false);
      setRefreshLocked(false);
    }, 1500);
  };

  useEffect(() => {
    if (!contextProfile) {
      fetchProfile();
    }
  }, [contextProfile]);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          // Try last known location first (fast)
          let location = await Location.getLastKnownPositionAsync({});
          if (!location) {
            // Fallback to current position (slower)
            location = await Location.getCurrentPositionAsync({});
          }
          if (location) {
            setUserLocation(location.coords);
          }
        }
      } catch (e) {
        // handle error
      }
    })();
  }, []);

  useEffect(() => {
    if (profile && profile.uid && allActivities) {
      setUserJoinedActivities(
        allActivities.filter(a => a.joinedUserIds?.includes(profile.uid))
      );
    }
  }, [allActivities, profile]);

  useEffect(() => {
    if (profile) {
      setIsReady(true);
    }
  }, [profile]);

  // Live friends list for current user
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    
    // Load friends from cache first (instant UI, prevents glitching)
    const loadCachedFriends = async () => {
      try {
        const cached = await getProfileFromCache(me);
        if (cached && Array.isArray((cached as any).friends)) {
          const friendIds: string[] = (cached as any).friends;
          setMyFriendIds(friendIds);
          
          // If we have cached friend profiles, show them immediately
          if (friendIds.length > 0) {
            // Try to load cached profiles for friends
            const cachedFriendProfiles: Array<{ uid: string; username: string; photo?: string }> = [];
            for (const fid of friendIds.slice(0, 20)) { // Limit to 20 to avoid excessive cache lookups
              const fp = await getProfileFromCache(fid);
              if (fp) {
                cachedFriendProfiles.push({
                  uid: fid,
                  username: fp.username || 'User',
                  photo: fp.photo,
                });
              }
            }
            if (cachedFriendProfiles.length > 0) {
              console.log('📦 Loaded friends list from cache (instant UI)');
              cachedFriendProfiles.sort((a, b) => a.username.localeCompare(b.username));
              setFriends(cachedFriendProfiles);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to load cached friends:', e);
      }
    };
    loadCachedFriends();
    
    // Subscribe to my profile to get friend ids (fresh data)
    const unsub = onSnapshot(doc(db, 'profiles', me), async (snap) => {
      if (!snap.exists()) return setFriends([]);
      const data: any = snap.data();
      const friendIds: string[] = data?.friends || [];
      const reqs: string[] = data?.requestsSent || [];
      setMyFriendIds(Array.isArray(friendIds) ? friendIds : []);
      setMyRequestsSent(Array.isArray(reqs) ? reqs : []);
      
      // Update my profile cache with latest friends list
      await updateProfileInCache({
        uid: me,
        username: data.username || 'User',
        photo: data.photo || data.photoURL,
        bio: data.bio,
        selectedSports: data.selectedSports,
        friends: friendIds,
      } as any);
      
      if (!Array.isArray(friendIds) || friendIds.length === 0) {
        setFriends([]);
        return;
      }
      // Fetch friend profiles in batches (where __name__ in) limited to 10 per query
      const chunks: string[][] = [];
      for (let i = 0; i < friendIds.length; i += 10) chunks.push(friendIds.slice(i, i + 10));
      const rows: Array<{ uid: string; username: string; photo?: string }> = [];
      for (const ids of chunks) {
        const q = fsQuery(collection(db, 'profiles'), where('__name__', 'in', ids));
        const snap2 = await getDocs(q);
        snap2.forEach((d) => {
          const p: any = d.data();
          const friendProfile = { uid: d.id, username: p.username || p.username_lower || 'User', photo: p.photo || p.photoURL };
          rows.push(friendProfile);
          
          // Cache each friend's profile
          updateProfileInCache({
            uid: d.id,
            username: p.username || 'User',
            photo: p.photo || p.photoURL,
            bio: p.bio,
            selectedSports: p.selectedSports,
          } as any);
        });
      }
      // Stable order by username
      rows.sort((a, b) => a.username.localeCompare(b.username));
      setFriends(rows);
    }, (error) => {
      if ((error as any)?.code !== 'permission-denied') {
        console.warn('Profile friends subscription error:', error);
      } else {
        setFriends([]);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (isReady) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  }, [isReady]);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  const handleJoinLeave = async (item: any) => {
    await toggleJoinActivity(item);
    // Optionally, force a refresh or navigate to ChatsScreen
    // navigation.navigate('Chats');
  };

  const handleLoadMoreActivities = () => {
    if (isLoadingMoreActivities) return;
    setIsLoadingMoreActivities(true);
    setTimeout(() => {
      setDisplayedActivitiesCount(prev => prev + 5);
      setIsLoadingMoreActivities(false);
    }, 300);
  };

  const handleLoadMoreHistory = () => {
    if (isLoadingMoreHistory) return;
    setIsLoadingMoreHistory(true);
    setTimeout(() => {
      setDisplayedHistoryCount(prev => prev + 5);
      setIsLoadingMoreHistory(false);
    }, 300);
  };

  const handleLoadMoreConnections = () => {
    if (isLoadingMoreConnections) return;
    setIsLoadingMoreConnections(true);
    setTimeout(() => {
      setDisplayedConnectionsCount(prev => prev + 8);
      setIsLoadingMoreConnections(false);
    }, 300);
  };

  // History tab search
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  // Scheduled (upcoming) tab search
  const [scheduledSearchQuery, setScheduledSearchQuery] = useState('');

  // Helpers for upcoming vs history (past = start + 2h < now)
  const toStartDate = (a: any) => {
    const d = a?.date;
    if (!d || typeof d !== 'string') return null;
    let ymd = d.trim();
    const m1 = ymd.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (m1) {
      const [, dd, mm, yyyy] = m1;
      ymd = `${yyyy}-${mm}-${dd}`;
    }
    // If not yyyy-mm-dd, try Date parse
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      const t = new Date(d).getTime();
      if (isNaN(t)) return null;
      const dt = new Date(t);
      ymd = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }
    const time = (a?.time && typeof a.time === 'string' ? a.time.trim() : '00:00') || '00:00';
    const dt = new Date(`${ymd}T${time}`);
    return isNaN(dt.getTime()) ? null : dt;
  };
  const isHistorical = (a: any) => {
    const start = toStartDate(a);
    if (!start) return false;
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return Date.now() > end.getTime();
  };

  // Filter for upcoming activities only (for invite modal)
  const myJoinedActivitiesUpcoming = myJoinedActivities.filter(a => !isHistorical(a));

  const renderActivity = ({ item }: { item: any }) => {
    const distance = userLocation && item.latitude && item.longitude
      ? calculateDistance(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude).toFixed(2)
      : null;
    const isJoined = isActivityJoined(item.id);
    const simplifyLocation = (location: string) => {
      const parts = location.split(',').map(part => part.trim());
      if (parts.length >= 2) {
        return `${parts[0]}, ${parts[parts.length - 2] || parts[parts.length - 1]}`;
      }
      return location;
    };
    return (
      <TouchableOpacity 
        style={styles.card} 
        onPress={() => navigation.navigate('ActivityDetails', { activityId: item.id })}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <ActivityIcon activity={item.activity} size={32} color={theme.primary} />
            <Text style={styles.cardTitle}>{item.activity}</Text>
          </View>
          {distance && (
            <View style={styles.distanceContainer}>
              <Ionicons name="navigate" size={14} color={theme.primary} />
              <Text style={styles.distanceNumber}>{distance}</Text>
              <Text style={styles.distanceUnit}>km away</Text>
            </View>
          )}
        </View>
        {/* Host */}
        <View style={styles.infoRow}>
          <Ionicons name="person" size={16} color={theme.primary} style={styles.infoIcon} />
            <Text style={styles.cardInfoLabel}>Host:</Text>
            <HostUsername activity={item} />
        </View>
        {/* Location */}
        <View style={styles.infoRow}>
          <Ionicons name="location" size={16} color={theme.primary} style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Location:</Text>
          <Text style={styles.cardInfo} numberOfLines={1} ellipsizeMode="tail">
            {simplifyLocation(item.location)}
          </Text>
        </View>
        {/* Date */}
        <View style={styles.infoRow}>
          <Ionicons name="calendar" size={16} color={theme.primary} style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Date:</Text>
          <Text style={styles.cardInfo}>{item.date}</Text>
        </View>
        {/* Time */}
        <View style={styles.infoRow}>
          <Ionicons name="time" size={16} color={theme.primary} style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Time:</Text>
          <Text style={styles.cardInfo}>{item.time}</Text>
        </View>
        {/* Participants */}
        <View style={styles.infoRow}>
          <Ionicons name="people" size={16} color={theme.primary} style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Participants:</Text>
          <Text style={styles.cardInfo}>
            {item.joinedUserIds ? item.joinedUserIds.length : item.joinedCount} / {item.maxParticipants}
          </Text>
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity 
            style={[styles.joinButton, isJoined && styles.joinButtonJoined]} 
            onPress={() => handleJoinLeave(item)}
          >
            <Text style={styles.joinButtonText}>{isJoined ? 'Leave' : 'Join'}</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.shareButton} 
            onPress={() => shareActivity(item.id, item.activity)}
          >
            <Ionicons name="share-social-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // Split joined activities into upcoming and history, and sort
  const upcomingActivities = userJoinedActivities.filter(a => !isHistorical(a));
  const historyActivities = userJoinedActivities.filter(a => isHistorical(a));
  const getStartMs = (a: any) => {
    const dt = toStartDate(a);
    return dt ? dt.getTime() : Number.POSITIVE_INFINITY;
  };
  upcomingActivities.sort((a, b) => getStartMs(a) - getStartMs(b));
  historyActivities.sort((a, b) => getStartMs(b) - getStartMs(a));
  const filteredHistory = historyActivities.filter((a) => {
    const q = historySearchQuery.trim().toLowerCase();
    if (!q) return true;
    const sport = String(a.activity || '').toLowerCase();
    const host = String(a.creator || '').toLowerCase();
    const loc = String(a.location || '').toLowerCase();
    return sport.includes(q) || host.includes(q) || loc.includes(q);
  });
  const filteredUpcoming = upcomingActivities.filter((a) => {
    const q = scheduledSearchQuery.trim().toLowerCase();
    if (!q) return true;
    const sport = String(a.activity || '').toLowerCase();
    const host = String(a.creator || '').toLowerCase();
    const loc = String(a.location || '').toLowerCase();
    return sport.includes(q) || host.includes(q) || loc.includes(q);
  });

  const renderHistoryActivity = ({ item }: { item: any }) => {
    const distance = userLocation && item.latitude && item.longitude
      ? calculateDistance(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude).toFixed(2)
      : null;
    const simplifyLocation = (location: string) => {
      const parts = location.split(',').map(part => part.trim());
      if (parts.length >= 2) {
        return `${parts[0]}, ${parts[parts.length - 2] || parts[parts.length - 1]}`;
      }
      return location;
    };
    // Check if user has rated this activity (from Firebase or local state)
    const firebaseRating = item.ratings?.find((r: any) => r.raterId === auth.currentUser?.uid)?.overall;
    const localRating = localRatings[item.id];
    const userRating = localRating || firebaseRating;
    const hasRated = !!userRating;
    
    const handleRatePress = (e: any) => {
      e.stopPropagation();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setRatingActivity(item);
      setRatingModalVisible(true);
    };
    
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('ActivityDetails', { activityId: item.id, fromProfile: true })}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <ActivityIcon activity={item.activity} size={32} color={theme.primary} />
            <Text style={styles.cardTitle}>{item.activity}</Text>
          </View>
          {/* Rating badge in header */}
          {hasRated && (
            <View style={styles.ratedBadge}>
              <Ionicons name="star" size={14} color="#FFD700" />
              <Text style={styles.ratedBadgeText}>{userRating}</Text>
            </View>
          )}
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="person" size={16} color={theme.primary} style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Host:</Text>
          <HostUsername activity={item} />
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="location" size={16} color={theme.primary} style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Location:</Text>
          <Text style={styles.cardInfo} numberOfLines={1} ellipsizeMode="tail">
            {simplifyLocation(item.location)}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="calendar" size={16} color={theme.primary} style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Date:</Text>
          <Text style={styles.cardInfo}>{item.date}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="time" size={16} color={theme.primary} style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Time:</Text>
          <Text style={styles.cardInfo}>{item.time}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="people" size={16} color={theme.primary} style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Participants:</Text>
          <Text style={styles.cardInfo}>
            {item.joinedUserIds ? item.joinedUserIds.length : item.joinedCount} / {item.maxParticipants}
          </Text>
        </View>
        
        {/* Rating action button (like Join/Leave button in scheduled activities) */}
        <View style={styles.cardActions}>
          <TouchableOpacity 
            style={[
              styles.rateButton,
              hasRated && styles.rateButtonRated,
            ]} 
            onPress={handleRatePress}
          >
            <Ionicons 
              name={hasRated ? 'eye-outline' : 'star-outline'} 
              size={18} 
              color={hasRated ? '#FFD700' : '#fff'} 
            />
            <Text style={[
              styles.rateButtonText,
              hasRated && styles.rateButtonTextRated,
            ]}>
              {hasRated ? `View Rating (${userRating}★)` : 'Rate Activity'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.shareButton} 
            onPress={() => shareActivity(item.id, item.activity)}
          >
            <Ionicons name="share-social-outline" size={20} color={theme.text} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderContent = (tab: 'activities' | 'history' | 'friends') => {
    switch (tab) {
      case 'activities':
        return (
          <View style={{ flex: 1 }}>
            <View style={styles.tabHeaderRow}>
              <View style={styles.tabIconWrap}>
                <Ionicons name="calendar" size={18} color={theme.primary} />
              </View>
              <Text style={styles.tabTitleStyled}>Upcoming</Text>
              {filteredUpcoming.length > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{filteredUpcoming.length}</Text>
                </View>
              )}
            </View>
            <View style={styles.styledSearchBar}>
              <View style={styles.searchIconWrap}>
                <Ionicons name="search" size={18} color={theme.primary} />
              </View>
              <TextInput
                style={styles.styledSearchInput}
                placeholder="Search activities..."
                placeholderTextColor={theme.muted}
                value={scheduledSearchQuery}
                onChangeText={setScheduledSearchQuery}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {scheduledSearchQuery.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.styledClearBtn}
                  onPress={() => setScheduledSearchQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={20} color={theme.muted} />
                </TouchableOpacity>
              )}
            </View>
            {filteredUpcoming.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="calendar-outline" size={48} color={theme.primary} />
                <Text style={styles.emptyStateTitle}>No scheduled activities</Text>
                <Text style={styles.emptyStateText}>Joined activities you schedule will appear here.</Text>
              </View>
            ) : (
              <FlatList
                data={filteredUpcoming.slice(0, displayedActivitiesCount)}
                renderItem={renderActivity}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContainer}
                onEndReached={displayedActivitiesCount < filteredUpcoming.length ? handleLoadMoreActivities : null}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                  isLoadingMoreActivities ? (
                    <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                      <ActivityIndicator size="small" color={theme.primary} />
                    </View>
                  ) : null
                }
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing || refreshLocked}
                    onRefresh={onRefresh}
                    colors={[theme.primary] as any}
                    tintColor={theme.primary}
                    progressBackgroundColor="transparent"
                  />
                }
              />
            )}
          </View>
        );
      case 'history':
        return (
          <View style={{ flex: 1 }}>
            <View style={styles.tabHeaderRow}>
              <View style={styles.tabIconWrap}>
                <Ionicons name="time" size={18} color={theme.primary} />
              </View>
              <Text style={styles.tabTitleStyled}>History</Text>
              {filteredHistory.length > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{filteredHistory.length}</Text>
                </View>
              )}
            </View>
            <View style={styles.styledSearchBar}>
              <View style={styles.searchIconWrap}>
                <Ionicons name="search" size={18} color={theme.primary} />
              </View>
              <TextInput
                style={styles.styledSearchInput}
                placeholder="Search past activities..."
                placeholderTextColor={theme.muted}
                value={historySearchQuery}
                onChangeText={setHistorySearchQuery}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {historySearchQuery.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.styledClearBtn}
                  onPress={() => setHistorySearchQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={20} color={theme.muted} />
                </TouchableOpacity>
              )}
            </View>
            {filteredHistory.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="time-outline" size={48} color={theme.primary} />
                <Text style={styles.emptyStateTitle}>No past activities</Text>
                <Text style={styles.emptyStateText}>Your activity history will appear here.</Text>
              </View>
            ) : (
              <FlatList
                data={filteredHistory.slice(0, displayedHistoryCount)}
                renderItem={renderHistoryActivity}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContainer}
                onEndReached={displayedHistoryCount < filteredHistory.length ? handleLoadMoreHistory : null}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                  isLoadingMoreHistory ? (
                    <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                      <ActivityIndicator size="small" color={theme.primary} />
                    </View>
                  ) : null
                }
              />
            )}
          </View>
        );
      case 'friends':
        return (
          <View style={{ flex: 1 }}>
            <View style={styles.tabHeaderRow}>
              <View style={styles.tabIconWrap}>
                <Ionicons name="people" size={18} color={theme.primary} />
              </View>
              <Text style={styles.tabTitleStyled}>Connections</Text>
              {friends.length > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{friends.length}</Text>
                </View>
              )}
            </View>
            {/* Search users (on top) */}
            <View style={styles.styledSearchBar}>
              <View style={styles.searchIconWrap}>
                <Ionicons name="search" size={18} color={theme.primary} />
              </View>
              <TextInput
                style={styles.styledSearchInput}
                placeholder="Find people..."
                placeholderTextColor={theme.muted}
                value={userSearchQuery}
                onChangeText={(text) => {
                  setUserSearchQuery(text);
                  if (userSearchDebounce.current) clearTimeout(userSearchDebounce.current);
                  if (!text || !text.trim()) {
                    setUserResults([]);
                    setUserSearching(false);
                    return;
                  }
                  userSearchDebounce.current = setTimeout(async () => {
                    const qText = text.trim();
                    const qLower = qText.toLowerCase();
                    setUserSearching(true);
                    try {
                      // Prefix search; prefer case-insensitive via username_lower, fallback to username
                      const ref = collection(db, 'profiles');
                      const q1 = fsQuery(ref, orderBy('username_lower'), startAt(qLower), endAt(qLower + '\uf8ff'), limit(20));
                      const q2 = fsQuery(ref, orderBy('username'), startAt(qText), endAt(qText + '\uf8ff'), limit(20));
                      // Run sequentially to keep it simple and predictable
                      const results: Record<string, { uid: string; username: string; photo?: string }> = {};
                      try {
                        const snap1 = await getDocs(q1);
                        snap1.forEach(d => {
                          const data: any = d.data();
                          const uid = d.id;
                          const username = data.username || data.username_lower || '';
                          if (username) results[uid] = { uid, username, photo: data.photo || data.photoURL };
                        });
                      } catch (_) {}
                      try {
                        const snap2 = await getDocs(q2);
                        snap2.forEach(d => {
                          const data: any = d.data();
                          const uid = d.id;
                          const username = data.username || '';
                          if (username) results[uid] = { uid, username, photo: data.photo || data.photoURL };
                        });
                      } catch (_) {}
                      // to array
                      const rows = Object.values(results)
                        .filter(r => r.username && r.uid !== currentUid)
                        .slice(0, 20);
                      setUserResults(rows);
                    } catch (e) {
                      setUserResults([]);
                    } finally {
                      setUserSearching(false);
                    }
                  }, 300);
                }}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {userSearchQuery.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.styledClearBtn}
                  onPress={() => {
                    setUserSearchQuery('');
                    setUserResults([]);
                    Keyboard.dismiss();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={20} color={theme.muted} />
                </TouchableOpacity>
              )}
            </View>
            {/* Connections list (hidden while searching) */}
            {userSearchQuery.trim().length === 0 && (
              friends.length === 0 ? (
                <Text style={styles.mutedText}>No connections yet.</Text>
              ) : (
                <FlatList
                    data={friends.slice(0, displayedConnectionsCount)}
                    keyExtractor={(item) => item.uid}
                    contentContainerStyle={{ paddingVertical: 6, paddingBottom: Math.max(insets.bottom, 16) }}
                    onEndReached={displayedConnectionsCount < friends.length ? handleLoadMoreConnections : null}
                    onEndReachedThreshold={0.5}
                    ListFooterComponent={
                    isLoadingMoreConnections ? (
                      <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.primary} />
                      </View>
                    ) : null
                  }
                  renderItem={({ item }) => (
                    <View style={styles.friendRow}>
                      <TouchableOpacity
                        style={styles.friendTouchable}
                        activeOpacity={0.8}
                        onPress={() => navigation.navigate('UserProfile', { userId: item.uid })}
                      >
                        <UserAvatar
                          photoUrl={item.photo}
                          username={item.username}
                          size={48}
                          style={styles.friendAvatar}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="tail">{item.username}</Text>
                          <View style={styles.friendStatusRow}>
                            <Ionicons name="checkmark-circle" size={12} color={theme.primary} />
                            <Text style={styles.friendStatusText}>Connected</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                      <View style={styles.friendActions}>
                        <TouchableOpacity style={styles.inviteBtn} onPress={() => openInviteModal(item)}>
                          <Ionicons name="add-circle-outline" size={18} color="#fff" />
                          <Text style={styles.inviteBtnText}>Invite</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.msgBtn}
                          onPress={async () => {
                            try {
                              const chatId = await ensureDmChat(item.uid);
                              navigation.navigate('ChatDetail' as any, { chatId });
                            } catch (e) {
                              console.warn('open DM from friends failed', e);
                            }
                          }}
                        >
                          <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.primary} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                />
              )
            )}
            {userSearchQuery.trim().length === 0 && friends.length === 0 ? (
              <TouchableOpacity activeOpacity={1} onPress={() => Keyboard.dismiss()} style={styles.emptyState}>
                <Ionicons name="people-outline" size={48} color={theme.primary} />
                <Text style={styles.emptyStateTitle}>Build Your Network</Text>
                <Text style={styles.emptyStateText}>
                  Search for friends by username to connect with people.
                </Text>
              </TouchableOpacity>
            ) : userSearchQuery.trim().length > 0 && userSearching ? (
              <View style={styles.emptyState}> 
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={styles.emptyStateText}>Searching…</Text>
              </View>
            ) : userSearchQuery.trim().length > 0 && userResults.length === 0 ? (
              <TouchableOpacity activeOpacity={1} onPress={() => Keyboard.dismiss()} style={styles.emptyState}>
                <Ionicons name="search-outline" size={48} color={theme.muted} />
                <Text style={styles.emptyStateTitle}>No users found</Text>
                <Text style={styles.emptyStateText}>Try a different username.</Text>
              </TouchableOpacity>
            ) : userSearchQuery.trim().length > 0 ? (
              <FlatList
                  data={userResults}
                  keyExtractor={(item) => item.uid}
                  contentContainerStyle={{ paddingVertical: 6, paddingBottom: Math.max(insets.bottom, 16) }}
                  keyboardShouldPersistTaps="always"
                  keyboardDismissMode="on-drag"
                  bounces={false}
                  overScrollMode={Platform.OS === 'android' ? 'never' : undefined}
                  renderItem={({ item }) => {
                    const isFriend = myFriendIds.includes(item.uid);
                    const isRequested = myRequestsSent.includes(item.uid);
                    return (
                      <View style={styles.searchResultRow}>
                        <TouchableOpacity
                          style={styles.searchResultTouchable}
                          activeOpacity={0.8}
                          onPress={() => {
                            Keyboard.dismiss();
                            navigation.navigate('UserProfile', { userId: item.uid });
                          }}
                        >
                          <UserAvatar
                            photoUrl={item.photo}
                            username={item.username}
                            size={48}
                            style={styles.searchResultAvatar}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.searchResultName}>{item.username}</Text>
                            {isFriend && (
                              <View style={styles.friendStatusRow}>
                                <Ionicons name="checkmark-circle" size={12} color={theme.primary} />
                                <Text style={styles.friendStatusText}>Already connected</Text>
                              </View>
                            )}
                          </View>
                        </TouchableOpacity>
                        {isFriend ? (
                          <TouchableOpacity
                            style={styles.connectedBadgeBtn}
                            activeOpacity={0.85}
                            onPress={() => navigation.navigate('UserProfile', { userId: item.uid })}
                          >
                            <Ionicons name={'checkmark-done'} size={16} color={'#fff'} />
                          </TouchableOpacity>
                        ) : isRequested ? (
                          <TouchableOpacity
                            style={styles.requestSentBtn}
                            activeOpacity={0.85}
                            onPress={async () => {
                              setMyRequestsSent((prev) => prev.filter((id) => id !== item.uid));
                              try {
                                await cancelFriendRequest(item.uid);
                              } catch (e) {}
                            }}
                          >
                            <Ionicons name={'time-outline'} size={16} color={theme.primary} />
                            <Text style={styles.requestSentBtnText}>Pending</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={styles.addFriendBtn}
                            activeOpacity={0.85}
                            onPress={async () => {
                              setMyRequestsSent((prev) => (prev.includes(item.uid) ? prev : [...prev, item.uid]));
                              try {
                                await sendFriendRequest(item.uid);
                              } catch (e) {
                                setMyRequestsSent((prev) => prev.filter((id) => id !== item.uid));
                              }
                            }}
                          >
                            <Ionicons name="person-add" size={16} color="#fff" />
                            <Text style={styles.addFriendBtnText}>Add</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.messageIconBtn}
                          onPress={async () => {
                            try {
                              const chatId = await ensureDmChat(item.uid);
                              navigation.navigate('ChatDetail' as any, { chatId });
                            } catch (e) {}
                          }}
                        >
                          <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.primary} />
                        </TouchableOpacity>
                      </View>
                    );
                  }}
                />
            ) : null}
            {/* Invite modal */}
            <Modal
              visible={inviteModalVisible}
              animationType="fade"
              transparent
              onRequestClose={() => setInviteModalVisible(false)}
            >
              <Pressable style={styles.modalOverlay} onPress={() => setInviteModalVisible(false)}>
                <Pressable style={styles.inviteModalCard} onPress={(e) => e.stopPropagation()}>
                  {/* Header */}
                  <View style={styles.inviteModalHeader}>
                    <View style={styles.inviteModalIconWrap}>
                      <Ionicons name="paper-plane" size={24} color={theme.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inviteModalTitle}>Invite {inviteTargetUser?.username || 'User'}</Text>
                      <Text style={styles.inviteModalSubtitle}>Select activities to invite them to</Text>
                    </View>
                    <TouchableOpacity 
                      style={styles.inviteModalCloseBtn} 
                      onPress={() => setInviteModalVisible(false)}
                    >
                      <Ionicons name="close" size={20} color={theme.muted} />
                    </TouchableOpacity>
                  </View>

                  {/* Activity List */}
                  {myJoinedActivitiesUpcoming.length === 0 ? (
                    <View style={styles.inviteEmptyState}>
                      <Ionicons name="calendar-outline" size={48} color={theme.muted} style={{ marginBottom: 12 }} />
                      <Text style={styles.inviteEmptyTitle}>No upcoming activities</Text>
                      <Text style={styles.inviteEmptyText}>
                        Join or create activities to invite your connections.
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      data={myJoinedActivitiesUpcoming}
                      keyExtractor={(a) => a.id}
                      style={styles.inviteActivityList}
                      showsVerticalScrollIndicator={false}
                      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                      renderItem={({ item }) => {
                        const targetAlreadyJoined = !!(inviteTargetUser && Array.isArray(item?.joinedUserIds) && item.joinedUserIds.includes(inviteTargetUser.uid));
                        const isSelected = inviteSelection[item.id];
                        return (
                          <TouchableOpacity
                            style={[
                              styles.inviteActivityRow, 
                              targetAlreadyJoined && styles.inviteActivityRowJoined,
                              isSelected && !targetAlreadyJoined && styles.inviteActivityRowSelected
                            ]}
                            activeOpacity={targetAlreadyJoined ? 1 : 0.7}
                            onPress={() => {
                              if (targetAlreadyJoined) {
                                showToast(`${inviteTargetUser?.username || 'User'} already joined`);
                                return;
                              }
                              toggleSelectInvite(item.id);
                            }}
                          >
                            <View style={styles.inviteActivityIcon}>
                              <ActivityIcon activity={item.activity} size={28} color={theme.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.inviteActivityTitle} numberOfLines={1}>{item.activity}</Text>
                              <Text style={styles.inviteActivityMeta}>
                                <Ionicons name="calendar-outline" size={11} color={theme.muted} /> {item.date}  •  <Ionicons name="time-outline" size={11} color={theme.muted} /> {item.time}
                              </Text>
                              <Text style={styles.inviteActivityParticipants}>
                                <Ionicons name="people-outline" size={11} color={theme.muted} /> {item.joinedUserIds?.length || 0}/{item.maxParticipants} joined
                              </Text>
                            </View>
                            {targetAlreadyJoined ? (
                              <View style={styles.inviteAlreadyJoinedBadge}>
                                <Ionicons name="checkmark-circle" size={14} color="#10b981" />
                                <Text style={styles.inviteAlreadyJoinedText}>Joined</Text>
                              </View>
                            ) : (
                              <View style={[styles.inviteCheckbox, isSelected && styles.inviteCheckboxSelected]}>
                                {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      }}
                    />
                  )}

                  {/* Footer */}
                  <View style={styles.inviteModalFooter}>
                    <TouchableOpacity 
                      style={styles.inviteModalCancelBtn} 
                      onPress={() => setInviteModalVisible(false)}
                    >
                      <Text style={styles.inviteModalCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[
                        styles.inviteModalSendBtn,
                        Object.values(inviteSelection).filter(Boolean).length === 0 && styles.inviteModalSendBtnDisabled
                      ]} 
                      onPress={confirmSendInvites}
                    >
                      <Ionicons name="paper-plane" size={16} color="#fff" />
                      <Text style={styles.inviteModalSendText}>
                        {Object.values(inviteSelection).filter(Boolean).length > 0
                          ? `Send (${Object.values(inviteSelection).filter(Boolean).length})`
                          : 'Send Invites'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </Pressable>
              </Pressable>
            </Modal>
          </View>
        );
    }
  };

  const tabs: Array<"activities" | "history" | "friends"> = ["activities", "history", "friends"];

  const handleTabPress = (tab: 'activities' | 'history' | 'friends', index: number) => {
    Keyboard.dismiss();
    setActiveTab(tab);
    const pager = pagerRef.current as PagerView | (PagerView & { setPageWithoutAnimation?: (i: number) => void }) | null;
    if (pager) {
      if (typeof (pager as any).setPageWithoutAnimation === 'function') {
        (pager as any).setPageWithoutAnimation(index);
      } else {
        pager.setPage(index);
      }
    }
  };

  const handlePageSelected = (event: PagerViewOnPageSelectedEvent) => {
    const index = event.nativeEvent.position;
    const nextTab = tabs[index];
    if (nextTab) {
      setActiveTab(nextTab);
    }
  };

  const getIconName = (tab: "activities" | "history" | "friends"): keyof typeof Ionicons.glyphMap => {
    switch (tab) {
      case "activities":
        return "list";
      case "history":
        return "time";
      case "friends":
        return "people";
      default:
        return "help"; // Fallback icon
    }
  };

  // Show loading indicator until profile is loaded
  if (!isReady) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]} />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}> 
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* ===== COMPACT PROFILE HEADER ===== */}
        {/* Username Header Row */}
        <View style={styles.usernameHeaderRow}>
          <Text style={styles.usernameTitle}>{profile?.username || 'Username'}</Text>
          <TouchableOpacity
            style={styles.settingsIconBtn}
            onPress={() => navigation.navigate('Settings')}
          >
            <Ionicons name="settings-outline" size={24} color={theme.primary} />
          </TouchableOpacity>
        </View>

        {/* Profile Info Row: Avatar + Stats + Bio */}
        <View style={styles.profileCompactRow}>
          {/* Left: Avatar */}
          <TouchableOpacity 
            activeOpacity={0.85} 
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setImageViewerVisible(true);
            }}
          >
            <View style={[styles.avatarRingCompact, styles.avatarShadow]}>
              <UserAvatar
                photoUrl={profile?.photo}
                username={profile?.username}
                size={80}
                style={styles.profileAvatarCompact}
              />
            </View>
          </TouchableOpacity>

          {/* Right: Stats */}
          <View style={styles.statsCompactContainer}>
            <TouchableOpacity style={styles.statCompactItem} activeOpacity={0.7} onPress={() => setConnectionsModalVisible(true)}>
              <Text style={styles.statCompactValue}>{friends.length}</Text>
              <Text style={styles.statCompactLabel}>Connections</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.statCompactItem} activeOpacity={0.7} onPress={() => setFavModalVisible(true)}>
              <Text style={styles.statCompactValue}>{(contextProfile?.sportsPreferences || contextProfile?.selectedSports || []).length}</Text>
              <Text style={styles.statCompactLabel}>Sports</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.statCompactItem} activeOpacity={0.7} onPress={() => setActivitiesModalVisible(true)}>
              <Text style={styles.statCompactValue}>{myJoinedActivities.length}</Text>
              <Text style={styles.statCompactLabel}>Activities</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Bio + Social Row */}
        {(profile?.bio || profile?.socials?.instagram || profile?.socials?.facebook) ? (
          <View style={styles.bioSocialCompactRow}>
            {profile?.bio ? (
              <Text style={styles.bioCompactText}>
                {profile.bio}
              </Text>
            ) : null}
            {(profile?.socials?.instagram || profile?.socials?.facebook) ? (
              <View style={styles.socialCompactRow}>
                {profile.socials.instagram ? (
                  <TouchableOpacity 
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const value = profile.socials.instagram;
                      const isLink = value.startsWith('http://') || value.startsWith('https://');
                      if (isLink) {
                        Linking.openURL(value).catch(() => Alert.alert('Error', 'Could not open link'));
                      } else {
                        Alert.alert('Instagram', value, [
                          { text: 'Copy', onPress: () => { Clipboard.setString(value); showToast('Copied'); }},
                          { text: 'Cancel', style: 'cancel' }
                        ]);
                      }
                    }}
                  >
                    <LinearGradient
                      colors={['#F58529', '#DD2A7B', '#8134AF', '#515BD4']}
                      start={{ x: 0, y: 1 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.instagramGradientBtn}
                    >
                      <Ionicons name="logo-instagram" size={20} color="#fff" />
                    </LinearGradient>
                  </TouchableOpacity>
                ) : null}
                {profile.socials.facebook ? (
                  <TouchableOpacity 
                    style={styles.facebookBtn}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const value = profile.socials.facebook;
                      const isLink = value.startsWith('http://') || value.startsWith('https://');
                      if (isLink) {
                        Linking.openURL(value).catch(() => Alert.alert('Error', 'Could not open link'));
                      } else {
                        Alert.alert('Facebook', value, [
                          { text: 'Copy', onPress: () => { Clipboard.setString(value); showToast('Copied'); }},
                          { text: 'Cancel', style: 'cancel' }
                        ]);
                      }
                    }}
                  >
                    <Ionicons name="logo-facebook" size={20} color="#fff" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Action Buttons */}
        {(!userId || userId === auth.currentUser?.uid) ? (
          <View style={styles.actionCompactRow}>
            <TouchableOpacity
              style={styles.actionCompactBtnPrimary}
              onPress={() => navigation.navigate('CreateProfile', { mode: 'edit', profileData: profile })}
            >
              <Ionicons name="pencil" size={16} color="#fff" />
              <Text style={styles.actionCompactBtnPrimaryText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.actionCompactBtnSecondary} 
              onPress={() => navigation.navigate('SportsPalPass' as never)}
            >
              <Ionicons name="wallet" size={16} color={theme.primary} />
              <Text style={styles.actionCompactBtnSecondaryText}>Pass</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.actionCompactBtnIcon} 
              onPress={() => shareProfile(auth.currentUser?.uid || '', profile?.username || 'User')}
            >
              <Ionicons name="share-outline" size={18} color={theme.primary} />
            </TouchableOpacity>
          </View>
        ) : null}

        {userId && userId !== auth.currentUser?.uid && (
          <View style={styles.actionCompactRow}>
            <TouchableOpacity style={styles.actionCompactBtnPrimary} onPress={() => {/* Add friend logic */}}>
              <Ionicons name="person-add" size={16} color="#fff" />
              <Text style={styles.actionCompactBtnPrimaryText}>Connect</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionCompactBtnSecondary} onPress={() => {/* Message logic */}}>
              <Ionicons name="chatbubble" size={16} color={theme.primary} />
              <Text style={styles.actionCompactBtnSecondaryText}>Message</Text>
            </TouchableOpacity>
          </View>
        )}

      <View style={styles.tabBar}>
        {tabs.map((tab, index) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab, { flex: 1 }]}
            onPress={() => handleTabPress(tab, index)}
          >
            <Ionicons
              name={getIconName(tab)}
              size={28}
              color={activeTab === tab ? theme.primary : theme.muted}
            />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.pagerContainer}>
        <PagerView
          ref={pagerRef}
          style={styles.pager}
          initialPage={tabs.indexOf(activeTab)}
          onPageSelected={handlePageSelected}
          overScrollMode="never"
        >
          {tabs.map((tab) => (
            <View key={tab} style={styles.pagerPage}>
              {renderContent(tab)}
            </View>
          ))}
        </PagerView>
      </View>
      {/* Favourite sports modal */}
      <Modal
        visible={favModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setFavModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setFavModalVisible(false)}
          />
          <View style={[styles.modalCard, { maxHeight: '70%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View>
                <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 18 }}>Favourite Sports</Text>
                <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
                  {((contextProfile?.sportsPreferences || contextProfile?.selectedSports || []) as string[]).length} sport{((contextProfile?.sportsPreferences || contextProfile?.selectedSports || []) as string[]).length === 1 ? '' : 's'} selected
                </Text>
              </View>
              <TouchableOpacity onPress={() => setFavModalVisible(false)} style={{ backgroundColor: theme.danger, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            {((contextProfile?.sportsPreferences || contextProfile?.selectedSports || []) as string[]).length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <Ionicons name="heart-outline" size={48} color={theme.muted} />
                <Text style={{ color: theme.muted, marginTop: 12, textAlign: 'center' }}>No favourite sports yet.</Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 400 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                showsVerticalScrollIndicator={true}
              >
                {[...(((contextProfile?.sportsPreferences || contextProfile?.selectedSports || []) as string[]))].sort((a, b) => a.localeCompare(b)).map((item, index) => (
                  <View key={item + index} style={{ 
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    backgroundColor: theme.card,
                    padding: 14,
                    borderRadius: 14,
                    borderLeftWidth: 4,
                    borderLeftColor: theme.primary,
                    marginBottom: 10,
                  }}>
                    <View style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: `${theme.primary}15`,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                    }}>
                      <ActivityIcon activity={item} size={26} color={theme.primary} />
                    </View>
                    <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15, flex: 1 }}>{item}</Text>
                    <Ionicons name="heart" size={20} color={theme.primary} />
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Connections modal */}
      <Modal
        visible={connectionsModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setConnectionsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setConnectionsModalVisible(false)}
          />
          <View style={[styles.modalCard, { maxHeight: '70%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View>
                <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 18 }}>Connections</Text>
                <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
                  {friends.length} connection{friends.length === 1 ? '' : 's'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setConnectionsModalVisible(false)} style={{ backgroundColor: theme.danger, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            {friends.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <Ionicons name="people-outline" size={48} color={theme.muted} />
                <Text style={{ color: theme.muted, marginTop: 12, textAlign: 'center' }}>No connections yet.</Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 400 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                showsVerticalScrollIndicator={true}
              >
                {friends.map((item, index) => (
                  <TouchableOpacity
                    key={item.uid}
                    style={{ 
                      flexDirection: 'row', 
                      alignItems: 'center', 
                      backgroundColor: theme.card,
                      padding: 12,
                      borderRadius: 14,
                      marginBottom: 10,
                    }}
                    activeOpacity={0.8}
                    onPress={() => {
                      setConnectionsModalVisible(false);
                      navigation.navigate('UserProfile' as any, { userId: item.uid });
                    }}
                  >
                    <UserAvatar
                      photoUrl={item.photo}
                      username={item.username}
                      size={44}
                      borderColor={theme.primary}
                      borderWidth={2}
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>{item.username}</Text>
                      <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>Tap to view profile</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={theme.muted} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Activities Breakdown Modal */}
      <Modal
        visible={activitiesModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setActivitiesModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setActivitiesModalVisible(false)}
          />
          <View style={[styles.modalCard, { maxHeight: '70%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View>
                <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 18 }}>Activity Breakdown</Text>
                <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
                  {myJoinedActivities.length} total activit{myJoinedActivities.length === 1 ? 'y' : 'ies'} joined
                </Text>
              </View>
              <TouchableOpacity onPress={() => setActivitiesModalVisible(false)} style={{ backgroundColor: theme.danger, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            
            {activitiesBreakdown.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <Ionicons name="fitness-outline" size={48} color={theme.muted} />
                <Text style={{ color: theme.muted, marginTop: 12, textAlign: 'center' }}>No activities joined yet.</Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 400 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                showsVerticalScrollIndicator={true}
              >
                {activitiesBreakdown.map((item, index) => (
                  <View key={item.sport} style={{ 
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    backgroundColor: theme.card,
                    padding: 14,
                    borderRadius: 14,
                    borderLeftWidth: 4,
                    borderLeftColor: index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : theme.primary,
                    marginBottom: 10,
                  }}>
                    {/* Rank Medal/Badge */}
                    {index <= 2 ? (
                      <View style={{ marginRight: 12, alignItems: 'center', width: 36, height: 46 }}>
                        {/* Ribbon - positioned behind */}
                        <View style={{ position: 'absolute', top: 0, flexDirection: 'row', zIndex: 0 }}>
                          <View style={{
                            width: 10,
                            height: 20,
                            backgroundColor: index === 0 ? '#DC143C' : index === 1 ? '#4169E1' : '#228B22',
                            transform: [{ skewX: '-10deg' }],
                            borderTopLeftRadius: 2,
                          }} />
                          <View style={{
                            width: 10,
                            height: 20,
                            backgroundColor: index === 0 ? '#FF6347' : index === 1 ? '#6495ED' : '#32CD32',
                            transform: [{ skewX: '10deg' }],
                            borderTopRightRadius: 2,
                          }} />
                        </View>
                        {/* Medal Circle - positioned in front */}
                        <View style={{
                          position: 'absolute',
                          top: 12,
                          zIndex: 1,
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor: index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : '#CD7F32',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 3,
                          borderColor: index === 0 ? '#DAA520' : index === 1 ? '#A9A9A9' : '#8B4513',
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.3,
                          shadowRadius: 2,
                          elevation: 4,
                        }}>
                          {/* Inner ring */}
                          <View style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: index === 0 ? '#B8860B' : index === 1 ? '#808080' : '#A0522D',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            <Text style={{ 
                              fontSize: 14, 
                              fontWeight: '900', 
                              color: index === 0 ? '#8B6914' : index === 1 ? '#4A4A4A' : '#5D3A1A',
                            }}>
                              {index + 1}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ) : (
                      <View style={{
                        width: 36,
                        height: 46,
                        borderRadius: 16,
                        backgroundColor: `${theme.muted}15`,
                        borderWidth: 2,
                        borderColor: `${theme.muted}30`,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 12,
                      }}>
                        <Text style={{ 
                          fontSize: 16, 
                          fontWeight: '700', 
                          color: theme.muted 
                        }}>
                          {index + 1}
                        </Text>
                      </View>
                    )}
                    
                    {/* Sport Icon */}
                    <ActivityIcon activity={item.sport} size={32} color={theme.primary} />
                    
                    {/* Sport Name & Details */}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>{item.sport}</Text>
                      <View style={{ flexDirection: 'row', marginTop: 4, gap: 12 }}>
                        {item.upcoming > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Ionicons name="calendar" size={12} color={theme.primary} />
                            <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '600' }}>{item.upcoming} upcoming</Text>
                          </View>
                        )}
                        {item.past > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Ionicons name="time" size={12} color={theme.muted} />
                            <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '500' }}>{item.past} past</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    
                    {/* Total Count Badge */}
                    <View style={{
                      backgroundColor: `${theme.primary}20`,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                    }}>
                      <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 16 }}>{item.total}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Bottom toast */}
      <Animated.View
        pointerEvents={toastMsg ? 'auto' : 'none'}
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
          transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
          opacity: toastAnim,
        }}
      >
        <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{toastMsg}</Text>
      </Animated.View>

      {/* Full-Screen Image Viewer */}
      <Modal
        visible={imageViewerVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setImageViewerVisible(false);
        }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.95)', justifyContent: 'center', alignItems: 'center' }}>
          <TouchableOpacity
            style={{ position: 'absolute', top: 50, right: 20, zIndex: 10 }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setImageViewerVisible(false);
            }}
          >
            <Ionicons name="close" size={32} color="#fff" />
          </TouchableOpacity>
          {profile?.photo ? (
            <Image
              source={{ uri: profile.photo }}
              style={{ width: '90%', height: '70%' }}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : (
            <UserAvatar
              photoUrl={null}
              username={profile?.username}
              size={250}
            />
          )}
        </View>
      </Modal>

      {/* Activity Rating Modal */}
      <ActivityRatingModal
        visible={ratingModalVisible}
        onClose={() => {
          setRatingModalVisible(false);
          setRatingActivity(null);
        }}
        activity={ratingActivity}
        onRatingSubmitted={(activityId, rating) => {
          // Update local state for immediate UI feedback
          setLocalRatings(prev => ({ ...prev, [activityId]: rating }));
          setRatingModalVisible(false);
          setRatingActivity(null);
        }}
      />

      </Animated.View>
    </View>
  );
};

const createStyles = (t: ReturnType<typeof useTheme>['theme']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.background,
  },
  joinedBadge: {
    color: t.muted,
    fontSize: 12,
    fontWeight: '600',
  },

  // ===== COMPACT PROFILE HEADER STYLES =====
  usernameHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    position: 'relative',
  },
  usernameTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: t.primary,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  settingsIconBtn: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  avatarRingCompact: {
    padding: 3,
    borderRadius: 46,
    borderWidth: 2.5,
    borderColor: t.primary,
  },
  avatarShadow: {
    shadowColor: t.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  profileAvatarCompact: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  statsCompactContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginLeft: 16,
  },
  statCompactItem: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  statCompactValue: {
    fontSize: 20,
    fontWeight: '800',
    color: t.primary,
  },
  statCompactLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: t.muted,
    marginTop: 2,
  },
  bioSocialCompactRow: {
    paddingHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bioCompactText: {
    fontSize: 13,
    color: t.text,
    lineHeight: 18,
    opacity: 0.85,
    flex: 1,
  },
  socialCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  socialCompactBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.border,
  },
  instagramGradientBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facebookBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1877F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  actionCompactBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.primary,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 6,
  },
  actionCompactBtnPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  actionCompactBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: t.primary,
    gap: 5,
  },
  actionCompactBtnSecondaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: t.primary,
  },
  actionCompactBtnIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: t.primary,
  },

  // Legacy styles (kept for other parts of the screen)
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 0,
    paddingHorizontal: 20,
    marginTop: 0,
    marginBottom: 0,
  },
  profileNameHeader: {
    fontSize: 24,
    color: t.primary,
    fontWeight: 'bold',
    textAlign: 'left',
  },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
  },
  profileLeftColumn: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  statsColumn: {
    flex: 1,
    justifyContent: 'center',
    marginLeft: 16,
    minHeight: 100,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  statBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 84,
  },
  statNumber: {
    color: t.primary,
    fontWeight: '800',
    fontSize: 22,
    textAlign: 'center',
    lineHeight: 26,
  },
  statNumberWrap: {
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statLabel: {
    color: t.muted,
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: t.primary,
  },
  profileActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 10,
  },
  profileActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: t.primary,
  },
  profileActionText: {
    color: t.primary,
    fontWeight: 'bold',
    fontSize: 16,
  },
  bioSocialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 6,
    minHeight: 50,
  },
  bioSectionHorizontal: {
    flex: 1,
    marginRight: 10,
    justifyContent: 'center',
  },
  bioIconRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bioText: {
    color: t.text,
    fontSize: 13,
    lineHeight: 18,
  },
  socialSectionHorizontal: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  socialIconButton: {
    padding: 6,
    marginHorizontal: 6,
  },
  bioSection: {
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginBottom: 8,
  },
  socialSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 10,
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: 'transparent',
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: t.primary,
  },
  contentContainer: {
    paddingHorizontal: 20,
    flex: 1,
  },
  pagerContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  pager: {
    flex: 1,
  },
  pagerPage: {
    flex: 1,
  },
  tabContent: {
    fontSize: 18,
    color: t.text,
    fontWeight: '500',
  },
  friendsTab: {
    marginTop: 10,
  },
  // Connections Search Bar
  connectionsSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: t.primary + '30',
    marginBottom: 16,
  },
  connectionsSearchIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: t.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionsSearchInput: {
    backgroundColor: 'transparent',
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 36,
    color: t.text,
    fontWeight: '500',
    fontSize: 15,
  },
  connectionsClearBtn: {
    marginRight: 8,
    height: 28,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Section Headers
  connectionsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  connectionsSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: t.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  connectionsBadge: {
    marginLeft: 8,
    backgroundColor: t.primary,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  connectionsBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  // Empty State
  connectionsEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 30,
  },
  connectionsEmptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: t.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  connectionsEmptyTitle: {
    color: t.text,
    fontWeight: '700',
    fontSize: 18,
    marginBottom: 8,
  },
  connectionsEmptyText: {
    color: t.muted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  // Friend Row (connected users)
  friendTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  friendAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: t.primary,
    marginRight: 12,
  },
  friendStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  friendStatusText: {
    fontSize: 11,
    color: t.primary,
    marginLeft: 4,
    fontWeight: '500',
  },
  // Search Result Row
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: t.border,
  },
  searchResultTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  searchResultAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: t.muted + '50',
    marginRight: 12,
  },
  searchResultName: {
    color: t.text,
    fontSize: 16,
    fontWeight: '600',
  },
  // Action Buttons
  connectedBadgeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestSentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: t.primary,
    backgroundColor: t.primary + '15',
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderStyle: 'dashed',
  },
  requestSentBtnText: {
    color: t.primary,
    fontWeight: '600',
    fontSize: 12,
    marginLeft: 4,
  },
  addFriendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.primary,
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 12,
    shadowColor: t.primary,
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  addFriendBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 4,
  },
  messageIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: t.primary,
    backgroundColor: t.primary + '10',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  userSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 10,
  },
  clearButton: {
    marginLeft: 8,
    height: 24,
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    backgroundColor: t.card,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginBottom: 0,
    minHeight: 36,
    color: t.text,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  emptyStateTitle: {
    color: t.primary,
    fontWeight: 'bold',
    fontSize: 16,
    marginTop: 10,
  },
  emptyStateText: {
    color: t.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: t.border,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: t.primary,
    marginRight: 12,
  },
  userName: {
    color: t.text,
    fontSize: 16,
    fontWeight: '600',
  },
  friendName: {
    color: t.text,
    fontSize: 16,
    paddingVertical: 5,
    fontWeight: '600',
  },
  card: {
    backgroundColor: t.card,
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 18,
    color: t.primary,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  distanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  distanceNumber: {
    fontSize: 14,
    color: t.primary,
    fontWeight: '600',
  },
  distanceUnit: {
    fontSize: 14,
    color: t.muted,
    fontWeight: '500',
  },
  // Rating badges for history cards
  ratedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  ratedBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFD700',
  },
  tapToRateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.isDark ? 'rgba(26, 233, 239, 0.12)' : 'rgba(26, 233, 239, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: t.isDark ? 'rgba(26, 233, 239, 0.3)' : 'rgba(26, 233, 239, 0.2)',
  },
  tapToRateText: {
    fontSize: 11,
    fontWeight: '600',
    color: t.primary,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
  },
  infoIcon: {
    marginRight: 8,
  },
  cardInfoLabel: {
    fontSize: 14,
    color: t.primary,
    fontWeight: '600',
    marginRight: 6,
  },
  cardInfo: {
    fontSize: 14,
    color: t.muted,
    fontWeight: '500',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  joinButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: t.primary,
    borderRadius: 5,
  },
  joinButtonJoined: {
    // Discover-aligned Leave color mapping
    backgroundColor: t.isDark ? '#007E84' : darkenHex(t.primary, 0.12),
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  // Rate button styles for history cards
  rateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: t.primary,
    borderRadius: 8,
    gap: 8,
    flex: 1,
    marginRight: 10,
  },
  rateButtonRated: {
    backgroundColor: t.isDark ? 'rgba(255, 215, 0, 0.2)' : 'rgba(255, 215, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.4)',
  },
  rateButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  rateButtonTextRated: {
    color: '#FFD700',
  },
  shareButton: {
    padding: 8,
    backgroundColor: t.card,
    borderRadius: 5,
  },
  listContainer: {
    paddingBottom: 0,
  },
  settingsButton: {
    padding: 5,
  },
  sectionTitle: {
    color: t.primary,
    fontSize: 18,
    fontWeight: '700',
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
  },
  tabTitleCentered: {
    color: t.primary,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  // New styled tab headers
  tabHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  tabIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: t.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  tabTitleStyled: {
    fontSize: 18,
    fontWeight: '700',
    color: t.text,
  },
  tabBadge: {
    marginLeft: 10,
    backgroundColor: t.primary,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 28,
    alignItems: 'center',
  },
  tabBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  // Styled search bar
  styledSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 14,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: t.primary + '25',
    marginBottom: 16,
  },
  searchIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: t.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  styledSearchInput: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 38,
    color: t.text,
    fontWeight: '500',
    fontSize: 15,
  },
  styledClearBtn: {
    marginRight: 8,
    height: 30,
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutedText: {
    color: t.muted,
    fontSize: 14,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 0,
    marginBottom: 10,
    borderRadius: 14,
    borderLeftWidth: 3,
    borderLeftColor: t.primary,
  },
  friendActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.primary,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    shadowColor: t.primary,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  inviteBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 4,
  },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: t.primary,
    backgroundColor: `${t.primary}10`,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  msgBtnText: {
    color: t.primary,
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 4,
  },
  // Filled variant matching msgBtn size for Connected/Requested
  msgBtnFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.primary,
    borderWidth: 1.5,
    borderColor: t.primary,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 12,
    shadowColor: t.primary,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  msgBtnTextInverted: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 4,
  },
  
  profileActionButtonSm: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  profileActionButtonInverted: {
    backgroundColor: t.primary,
    borderColor: t.primary,
  },
  
  profileActionTextSm: {
    fontSize: 14,
  },
  profileActionTextInverted: {
    color: '#fff',
  },
  connectedPill: {
    backgroundColor: t.primaryStrong,
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  connectedPillText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  requestedPill: {
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.primary,
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  requestedPillText: {
    color: t.primary,
    fontWeight: '700',
  },
  // Invite modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: t.border,
  },
  modalTitle: {
    color: t.primary,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 8,
  },
  modalEmpty: {
    color: t.muted,
    fontSize: 14,
    marginVertical: 4,
  },
  activityPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.background,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: t.border,
  },
  activityPickLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activityPickTitle: {
    color: t.text,
    fontWeight: '600',
  },
  activityPickMeta: {
    color: t.muted,
    fontSize: 12,
    marginTop: 2,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  modalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  modalBtnCancel: {
    borderColor: t.border,
    backgroundColor: t.background,
  },
  modalBtnPrimary: {
    borderColor: t.primary,
    backgroundColor: t.primary,
  },
  modalBtnTextCancel: {
    color: t.text,
    fontWeight: '600',
  },
  modalBtnTextPrimary: {
    color: '#fff',
    fontWeight: '700',
  },
  
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.isDark ? 'rgba(26, 233, 239, 0.15)' : 'rgba(26, 233, 239, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteModalTitle: {
    color: t.text,
    fontSize: 17,
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
  inviteActivityList: {
    maxHeight: 300,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
  inviteActivityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    gap: 12,
  },
  inviteActivityRowSelected: {
    backgroundColor: t.isDark ? 'rgba(26, 233, 239, 0.12)' : 'rgba(26, 233, 239, 0.08)',
    borderWidth: 1,
    borderColor: t.primary,
  },
  inviteActivityRowJoined: {
    opacity: 0.55,
  },
  inviteActivityIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: t.isDark ? 'rgba(26, 233, 239, 0.1)' : 'rgba(26, 233, 239, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteActivityTitle: {
    color: t.text,
    fontWeight: '600',
    fontSize: 15,
  },
  inviteActivityMeta: {
    color: t.muted,
    fontSize: 12,
    marginTop: 3,
  },
  inviteActivityParticipants: {
    color: t.muted,
    fontSize: 11,
    marginTop: 2,
  },
  inviteAlreadyJoinedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.isDark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  inviteAlreadyJoinedText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '600',
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
});

export default ProfileScreen;
