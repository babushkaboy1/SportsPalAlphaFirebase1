import { RouteProp } from '@react-navigation/native';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
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
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
// useActivityContext is already imported above in this file; avoid duplicate
import { ActivityIcon } from '../components/ActivityIcons';
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
  ActivityDetails: { activityId: string };
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
  const [imageViewerVisible, setImageViewerVisible] = useState(false);

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
        {/* No action buttons for history */}
      </TouchableOpacity>
    );
  };

  const renderContent = (tab: 'activities' | 'history' | 'friends') => {
    switch (tab) {
      case 'activities':
        return (
          <View style={{ flex: 1 }}>
            <TouchableOpacity activeOpacity={1} onPress={() => Keyboard.dismiss()}>
              <Text style={styles.tabTitleCentered}>Scheduled Activities</Text>
            </TouchableOpacity>
            <View style={styles.userSearchRow}>
              <Ionicons name="search" size={16} color={theme.primary} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.searchInput, { flex: 1 }]}
                placeholder="Search activity or host..."
                placeholderTextColor={theme.muted}
                value={scheduledSearchQuery}
                onChangeText={setScheduledSearchQuery}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {scheduledSearchQuery.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => setScheduledSearchQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={18} color={theme.primary} />
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
            <TouchableOpacity activeOpacity={1} onPress={() => Keyboard.dismiss()}>
              <Text style={styles.tabTitleCentered}>Activity History</Text>
            </TouchableOpacity>
            <View style={styles.userSearchRow}>
              <Ionicons name="search" size={16} color={theme.primary} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.searchInput, { flex: 1 }]}
                placeholder="Search activity or host..."
                placeholderTextColor={theme.muted}
                value={historySearchQuery}
                onChangeText={setHistorySearchQuery}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {historySearchQuery.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => setHistorySearchQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={18} color={theme.primary} />
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
            <TouchableOpacity activeOpacity={1} onPress={() => Keyboard.dismiss()}>
              <Text style={styles.tabTitleCentered}>Connections</Text>
            </TouchableOpacity>
            {/* Search users (on top) */}
            <View style={styles.userSearchRow}>
              <Ionicons name="search" size={16} color={theme.primary} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.searchInput, { flex: 1 }]}
                placeholder="Search users..."
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
                  style={styles.clearButton}
                  onPress={() => {
                    setUserSearchQuery('');
                    setUserResults([]);
                    Keyboard.dismiss();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={18} color={theme.primary} />
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
                        style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}
                        activeOpacity={0.8}
                        onPress={() => navigation.navigate('UserProfile', { userId: item.uid })}
                      >
                        <UserAvatar
                          photoUrl={item.photo}
                          username={item.username}
                          size={44}
                          style={styles.userAvatar}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="tail">{item.username}</Text>
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
                          <Text style={styles.msgBtnText}>Message</Text>
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
                <Text style={styles.emptyStateTitle}>Create connections</Text>
                <Text style={styles.emptyStateText}>
                  Search by username to discover people. Start typing a name.
                </Text>
              </TouchableOpacity>
            ) : userSearchQuery.trim().length > 0 && userSearching ? (
              <View style={styles.emptyState}> 
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={styles.emptyStateText}>Searching…</Text>
              </View>
            ) : userSearchQuery.trim().length > 0 && userResults.length === 0 ? (
              <TouchableOpacity activeOpacity={1} onPress={() => Keyboard.dismiss()} style={styles.emptyState}>
                <Ionicons name="person-circle-outline" size={48} color={theme.primary} />
                <Text style={styles.emptyStateTitle}>No matches yet</Text>
                <Text style={styles.emptyStateText}>Try a different spelling.</Text>
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
                    <View style={[styles.userRow, { alignItems: 'center' }]}>
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                        activeOpacity={0.8}
                        onPress={() => {
                          Keyboard.dismiss();
                          navigation.navigate('UserProfile', { userId: item.uid });
                        }}
                      >
                        <UserAvatar
                          photoUrl={item.photo}
                          username={item.username}
                          size={44}
                          style={styles.userAvatar}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.userName}>{item.username}</Text>
                        </View>
                      </TouchableOpacity>
                      {isFriend ? (
                        <TouchableOpacity
                          style={styles.msgBtnFilled}
                          activeOpacity={0.85}
                          onPress={() => {/* Optional: could open profile or show menu */}}
                        >
                          <Ionicons name={'checkmark-done-outline'} size={18} color={'#fff'} style={{ marginRight: 4 }} />
                          <Text style={styles.msgBtnTextInverted}>Connected</Text>
                        </TouchableOpacity>
                      ) : isRequested ? (
                        <TouchableOpacity
                          style={styles.msgBtnFilled}
                          activeOpacity={0.85}
                          onPress={async () => {
                            // Optimistically revert to "Add Friend"
                            setMyRequestsSent((prev) => prev.filter((id) => id !== item.uid));
                            try {
                              await cancelFriendRequest(item.uid);
                            } catch (e) {}
                          }}
                        >
                          <Ionicons name={'person-add-outline'} size={18} color={'#fff'} style={{ marginRight: 4 }} />
                          <Text style={styles.msgBtnTextInverted}>Request Sent</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={styles.msgBtn}
                          activeOpacity={0.85}
                          onPress={async () => {
                            // Optimistically mark as requested
                            setMyRequestsSent((prev) => (prev.includes(item.uid) ? prev : [...prev, item.uid]));
                            try {
                              await sendFriendRequest(item.uid);
                            } catch (e) {
                              // Rollback if failed
                              setMyRequestsSent((prev) => prev.filter((id) => id !== item.uid));
                            }
                          }}
                        >
                          <Ionicons name="person-add-outline" size={18} color={theme.primary} style={{ marginRight: 4 }} />
                          <Text style={styles.msgBtnText}>Add Friend</Text>
                        </TouchableOpacity>
                      )}
                      {/* Message button remains as-is */}
                      <TouchableOpacity
                        style={[styles.msgBtn, { marginLeft: 8 }]}
                        onPress={async () => {
                          try {
                            const chatId = await ensureDmChat(item.uid);
                            navigation.navigate('ChatDetail' as any, { chatId });
                          } catch (e) {}
                        }}
                      >
                        <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.primary} />
                        <Text style={styles.msgBtnText}>Message</Text>
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
                <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
                  <Text style={styles.modalTitle}>Invite {inviteTargetUser?.username || 'user'}</Text>
                  {myJoinedActivitiesUpcoming.length === 0 ? (
                    <Text style={styles.modalEmpty}>You haven't joined any upcoming activities.</Text>
                  ) : (
                    <FlatList
                      data={myJoinedActivitiesUpcoming}
                      keyExtractor={(a) => a.id}
                      renderItem={({ item }) => {
                        const targetAlreadyJoined = !!(inviteTargetUser && Array.isArray(item?.joinedUserIds) && item.joinedUserIds.includes(inviteTargetUser.uid));
                        return (
                        <Pressable
                          style={[styles.activityPickRow, targetAlreadyJoined && { opacity: 0.45 }]}
                          onPress={() => {
                            if (targetAlreadyJoined) {
                              showToast(`${inviteTargetUser?.username || 'User'} is already in this activity`);
                              return;
                            }
                            toggleSelectInvite(item.id);
                          }}
                        >
                          <View style={styles.activityPickLeft}>
                            <ActivityIcon activity={item.activity} size={22} color={theme.primary} />
                            <View>
                              <Text style={styles.activityPickTitle} numberOfLines={1}>{item.activity}</Text>
                              <Text style={styles.activityPickMeta}>{item.date} • {item.time}</Text>
                            </View>
                          </View>
                          {targetAlreadyJoined ? (
                            <Text style={styles.joinedBadge}>Joined</Text>
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
                      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                      style={{ maxHeight: 280, marginVertical: 8 }}
                    />
                  )}
                  <View style={styles.modalActions}>
                    <TouchableOpacity style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setInviteModalVisible(false)}>
                      <Text style={styles.modalBtnTextCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={confirmSendInvites}>
                      <Text style={styles.modalBtnTextPrimary}>Send</Text>
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
        <View style={styles.headerRow}>
        <Text style={styles.profileNameHeader}>{profile?.username || 'Username'}</Text>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => navigation.navigate('Settings')} // Navigate to SettingsScreen
        >
          <Ionicons name="settings-outline" size={28} color={theme.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.profileInfo}>
        <View style={styles.profileLeftColumn}>
          <TouchableOpacity 
            activeOpacity={0.8} 
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setImageViewerVisible(true);
            }}
          >
            <UserAvatar
              photoUrl={profile?.photo}
              username={profile?.username}
              size={100}
              style={styles.profileImage}
            />
          </TouchableOpacity>
        </View>
        {/* Stats next to avatar */}
        <View style={styles.statsColumn}>
          <View style={styles.statsRow}>
            <TouchableOpacity style={styles.statBlock} activeOpacity={0.8} onPress={() => setConnectionsModalVisible(true)}>
              <View style={styles.statNumberWrap}><Text style={styles.statNumber}>{friends.length}</Text></View>
              <Text style={styles.statLabel}>Connections</Text>
              {/* spacer to match two-line labels on other stats */}
              <Text style={[styles.statLabel, { opacity: 0 }]}>_</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.statBlock} activeOpacity={0.8} onPress={() => setFavModalVisible(true)}>
              <View style={styles.statNumberWrap}><Text style={styles.statNumber}>{(contextProfile?.sportsPreferences || contextProfile?.selectedSports || []).length}</Text></View>
              <Text style={styles.statLabel}>Favourite{((contextProfile?.sportsPreferences || contextProfile?.selectedSports || []).length === 1) ? '' : 's'}</Text>
              <Text style={[styles.statLabel, { marginTop: -2 }]}>Sports</Text>
            </TouchableOpacity>
            <View style={styles.statBlock}>
              <View style={styles.statNumberWrap}><Text style={styles.statNumber}>{myJoinedActivities.length}</Text></View>
              <Text style={styles.statLabel}>Joined</Text>
              <Text style={[styles.statLabel, { marginTop: -2 }]}>Activities</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Bio and Social Media Row - Above Action Buttons */}
      {(profile?.bio || profile?.socials?.instagram || profile?.socials?.facebook) ? (
        <View style={styles.bioSocialRow}>
          {/* Bio Section - Left Side (to center) */}
            <View style={styles.bioSectionHorizontal}>
              {profile?.bio ? (
                <Text style={styles.bioText} numberOfLines={2} ellipsizeMode="tail">
                  {profile.bio}
                </Text>
              ) : null}
            </View>

            {/* Social Media Icons - Right Side (from center) */}
            {(profile?.socials?.instagram || profile?.socials?.facebook) ? (
            <View style={styles.socialSectionHorizontal}>
              {profile.socials.instagram ? (
                <TouchableOpacity 
                  style={styles.socialIconButton} 
                  onPress={() => {
                    const value = profile.socials.instagram;
                    const isLink = value.startsWith('http://') || value.startsWith('https://');
                    
                    if (isLink) {
                      Linking.openURL(value).catch(() => {
                        Alert.alert('Error', 'Could not open link');
                      });
                    } else {
                      Alert.alert(
                        'Instagram',
                        value,
                        [
                          { text: 'Copy', onPress: () => {
                            Clipboard.setString(value);
                            Alert.alert('Copied', 'Instagram handle copied to clipboard');
                          }},
                          { text: 'Cancel', style: 'cancel' }
                        ]
                      );
                    }
                  }}
                >
                  <Ionicons name="logo-instagram" size={26} color={theme.primary} />
                </TouchableOpacity>
              ) : null}
              {profile.socials.facebook ? (
                <TouchableOpacity 
                  style={styles.socialIconButton} 
                  onPress={() => {
                    const value = profile.socials.facebook;
                    const isLink = value.startsWith('http://') || value.startsWith('https://');
                    
                    if (isLink) {
                      Linking.openURL(value).catch(() => {
                        Alert.alert('Error', 'Could not open link');
                      });
                    } else {
                      Alert.alert(
                        'Facebook',
                        value,
                        [
                          { text: 'Copy', onPress: () => {
                            Clipboard.setString(value);
                            Alert.alert('Copied', 'Facebook handle copied to clipboard');
                          }},
                          { text: 'Cancel', style: 'cancel' }
                        ]
                      );
                    }
                  }}
                >
                  <Ionicons name="logo-facebook" size={26} color={theme.primary} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {!userId || userId === auth.currentUser?.uid ? (
        <View style={styles.profileActionsRow}>
          <TouchableOpacity
            style={styles.profileActionButton}
            onPress={() => navigation.navigate('CreateProfile', { mode: 'edit', profileData: profile })}
          >
            <Ionicons name="create-outline" size={18} color={theme.primary} style={{ marginRight: 6 }} />
            <Text style={styles.profileActionText}>Edit Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileActionButton} onPress={handleShareProfile}>
            <Ionicons name="share-social-outline" size={18} color={theme.primary} style={{ marginRight: 6 }} />
            <Text style={styles.profileActionText}>Share Profile</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {userId && userId !== auth.currentUser?.uid && (
        <View style={styles.profileActionsRow}>
          <TouchableOpacity style={styles.profileActionButton} onPress={() => {/* Add friend logic */}}>
            <Ionicons name="person-add-outline" size={18} color={theme.primary} style={{ marginRight: 6 }} />
            <Text style={styles.profileActionText}>Add Friend</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileActionButton} onPress={() => {/* Message logic */}}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.primary} style={{ marginRight: 6 }} />
            <Text style={styles.profileActionText}>Message</Text>
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
        <Pressable style={styles.modalOverlay} onPress={() => setFavModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 18 }}>Favourite Sports</Text>
              <TouchableOpacity onPress={() => setFavModalVisible(false)} style={{ backgroundColor: theme.danger, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 10 }} />
            {((contextProfile?.sportsPreferences || contextProfile?.selectedSports || []) as string[]).length === 0 ? (
              <Text style={{ color: theme.muted }}>No favourites yet.</Text>
            ) : (
              <FlatList
                data={[...(((contextProfile?.sportsPreferences || contextProfile?.selectedSports || []) as string[]))].sort((a, b) => a.localeCompare(b))}
                keyExtractor={(s, i) => s + i}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                renderItem={({ item }) => (
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                    <ActivityIcon activity={item} size={22} color={theme.primary} />
                    <Text style={{ color: theme.text, marginLeft: 10, fontWeight: '600' }}>{item}</Text>
                  </View>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Connections modal */}
      <Modal
        visible={connectionsModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setConnectionsModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setConnectionsModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 18 }}>Connections</Text>
              <TouchableOpacity onPress={() => setConnectionsModalVisible(false)} style={{ backgroundColor: theme.danger, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 10 }} />
            {friends.length === 0 ? (
              <Text style={{ color: theme.muted }}>No connections yet.</Text>
            ) : (
              <FlatList
                data={friends}
                keyExtractor={(u) => u.uid}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
                    activeOpacity={0.8}
                    onPress={() => {
                      setConnectionsModalVisible(false);
                      navigation.navigate('UserProfile' as any, { userId: item.uid });
                    }}
                  >
                    <UserAvatar
                      photoUrl={item.photo}
                      username={item.username}
                      size={36}
                      borderColor={theme.primary}
                      borderWidth={1}
                    />
                    <Text style={{ color: theme.text, marginLeft: 10, fontWeight: '600' }}>{item.username}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </Pressable>
        </Pressable>
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
          <Image
            source={{ uri: profile?.photo || 'https://via.placeholder.com/100' }}
            style={{ width: '90%', height: '70%', resizeMode: 'contain' }}
          />
        </View>
      </Modal>

      </Animated.View>
    </View>
  );
};

const createStyles = (t: ReturnType<typeof useTheme>['theme']) => StyleSheet.create({
  shareButton: {
    padding: 8,
    backgroundColor: t.card,
    borderRadius: 5,
  },
  container: {
    flex: 1,
    backgroundColor: t.background,
  },
  joinedBadge: {
    color: t.muted,
    fontSize: 12,
    fontWeight: '600',
  },
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
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: t.primary,
    marginRight: 8,
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
    fontWeight: '500',
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
    marginTop: 10,
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
    backgroundColor: 'transparent',
    paddingVertical: 8,
    paddingHorizontal: 0,
    marginHorizontal: 0,
    marginBottom: 8,
    borderRadius: 0,
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
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginRight: 6,
  },
  inviteBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11,
    marginLeft: 6,
  },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.primary,
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  msgBtnText: {
    color: t.primary,
    fontWeight: '700',
    fontSize: 11,
    marginLeft: 6,
  },
  // Filled variant matching msgBtn size for Connected/Requested
  msgBtnFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.primary,
    borderWidth: 1,
    borderColor: t.primary,
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  msgBtnTextInverted: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11,
    marginLeft: 6,
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
    backgroundColor: 'rgba(0,0,0,0.5)',
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
  addFriendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.primary,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  addFriendBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 6,
  },
});

export default ProfileScreen;
