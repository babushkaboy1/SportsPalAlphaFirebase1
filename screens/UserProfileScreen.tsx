import { getDisplayCreatorUsername } from '../utils/getDisplayCreatorUsername';
import { useTheme } from '../context/ThemeContext';

function HostUsername({ activity }: { activity: any }) {
  const [username, setUsername] = useState('');
  const { theme } = useTheme();
  useEffect(() => {
    let mounted = true;
    const fetchUsername = async () => {
      const name = await getDisplayCreatorUsername(activity.creatorId, activity.creator);
      if (mounted) setUsername(name);
    };
    fetchUsername();
    return () => { mounted = false; };
  }, [activity.creatorId, activity.creator]);
  return <Text style={{ fontSize: 14, color: theme.muted, fontWeight: '500' }}>{username}</Text>;
}
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Animated, RefreshControl, Alert, Modal, Pressable, TextInput, Clipboard, Keyboard, Linking, ActivityIndicator, PanResponder, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { doc, getDoc, onSnapshot, collection, query as fsQuery, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActivityContext } from '../context/ActivityContext';
import { ActivityIcon } from '../components/ActivityIcons';
import UserAvatar from '../components/UserAvatar';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { sendFriendRequest, cancelFriendRequest, removeFriend, acceptIncomingRequestFromProfile, declineIncomingRequestFromProfile } from '../utils/firestoreFriends';
import { shareActivity, shareProfile } from '../utils/deepLinking';
import { ensureDmChat } from '../utils/firestoreChats';
import { getProfileFromCache, updateProfileInCache } from '../utils/chatCache';
import { blockUser, isUserBlocked } from '../utils/firestoreBlocks';

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

const UserProfileScreen = () => {
  const route = useRoute();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const { userId } = route.params as { userId: string };
  const [profile, setProfile] = useState<any>(null);
  const { allActivities, reloadAllActivities, isActivityJoined, toggleJoinActivity } = useActivityContext();
  const [activeTab, setActiveTab] = useState<'games' | 'history'>('games');
  const tabs: Array<'games' | 'history'> = ['games', 'history'];
  const pagerRef = useRef<PagerView | null>(null);
  const activeTabRef = useRef(activeTab);
  const [userJoinedActivities, setUserJoinedActivities] = useState<any[]>([]);
  const listContentPadding = useMemo(
    () => ({ paddingBottom: Math.max(insets.bottom, 24) }),
    [insets.bottom]
  );

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const backSwipeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        if (activeTabRef.current !== 'games') return false;
        if (!navigation.canGoBack()) return false;
        // Only trigger if starting from very left edge and swiping right
        if (gestureState.x0 > 40) return false;
        if (gestureState.dx < 15) return false;
        if (Math.abs(gestureState.dy) > Math.abs(gestureState.dx)) return false;
        return true;
      },
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderMove: () => {},
      onPanResponderRelease: (_, gestureState) => {
        if (activeTabRef.current !== 'games') return;
        if (!navigation.canGoBack()) return;
        if (gestureState.x0 <= 40 && gestureState.dx > 80 && Math.abs(gestureState.dy) < 100) {
          navigation.goBack();
        }
      },
      onPanResponderTerminationRequest: () => true,
    })
  ).current;




  const [isReady, setIsReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const [displayedActivitiesCount, setDisplayedActivitiesCount] = useState(5);
  const [displayedHistoryCount, setDisplayedHistoryCount] = useState(5);
  const [displayedConnectionsCount, setDisplayedConnectionsCount] = useState(8);
  const [isLoadingMoreActivities, setIsLoadingMoreActivities] = useState(false);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [isLoadingMoreConnections, setIsLoadingMoreConnections] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [requestSent, setRequestSent] = useState(false);
  const [isSelf, setIsSelf] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(false);
  const [theyListMe, setTheyListMe] = useState(false);
  const [favModalVisible, setFavModalVisible] = useState(false);
  const [connectionsModalVisible, setConnectionsModalVisible] = useState(false);
  const [activitiesModalVisible, setActivitiesModalVisible] = useState(false);
  const [userFriendProfiles, setUserFriendProfiles] = useState<Array<{ uid: string; username: string; photo?: string }>>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  // Activities breakdown by sport for this user
  const activitiesBreakdown = React.useMemo(() => {
    const breakdown: Record<string, { total: number; upcoming: number; past: number }> = {};
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    userJoinedActivities.forEach((activity) => {
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
  }, [userJoinedActivities]);

  useEffect(() => {
    const fetchProfile = async () => {
      // Load from cache first (instant UI)
      const cached = await getProfileFromCache(userId);
      if (cached) {
        console.log('📦 Loaded user profile from cache (instant UI)');
        setProfile({ ...cached, uid: userId });
        setIsReady(true);
      }

      // Fetch fresh from Firestore
      const docRef = doc(db, "profiles", userId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data: any = docSnap.data();
        setProfile({ ...data, uid: userId });
        
        // Save to cache
        await updateProfileInCache({
          uid: userId,
          username: data.username || 'User',
          photo: data.photo || data.photoURL,
          bio: data.bio,
          socials: data.socials,
          selectedSports: data.selectedSports || data.sportsPreferences,
          friends: data.friends,
        } as any);
        setIsReady(true);
      }
      
      // Check if user is blocked
      const blocked = await isUserBlocked(userId);
      setIsBlocked(blocked);
    };
    fetchProfile();
  }, [userId]);

  // Prefill and live-sync Add Friend button state from current user's profile
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    setIsSelf(me === userId);
    if (me === userId) {
      setRequestSent(false);
      setIsFriend(false);
      return;
    }
    const unsub = onSnapshot(doc(db, 'profiles', me), (snap) => {
      if (!snap.exists()) return;
      const data: any = snap.data();
      const sent: string[] = data?.requestsSent || [];
      const friends: string[] = data?.friends || [];
      // If they sent me a request, I will NOT have sent marker, and I will NOT be friends yet; infer by checking their requestsSent
      setRequestSent(Array.isArray(sent) && sent.includes(userId));
      setIsFriend(Array.isArray(friends) && friends.includes(userId));
    }, (error) => {
      if ((error as any)?.code !== 'permission-denied') {
        console.warn('Self profile subscription error:', error);
      }
    });
    return () => unsub();
  }, [userId]);

  // Detect incoming request and mutual friendship from the viewed user's profile
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me || me === userId) return;
    const unsub = onSnapshot(doc(db, 'profiles', userId), (snap) => {
      if (!snap.exists()) { setIncomingRequest(false); return; }
      const data: any = snap.data();
      const theirSent: string[] = data?.requestsSent || [];
      const theirFriends: string[] = data?.friends || [];
      setIncomingRequest(Array.isArray(theirSent) && theirSent.includes(me));
      setTheyListMe(Array.isArray(theirFriends) && theirFriends.includes(me));
      // Keep viewed profile's friends/sports in sync for stats
      setProfile((prev: any) => prev ? { ...prev, friends: theirFriends, sportsPreferences: data?.sportsPreferences || prev.sportsPreferences } : prev);
    }, (error) => {
      if ((error as any)?.code !== 'permission-denied') {
        console.warn('Viewed profile subscription error:', error);
      }
    });
    return () => unsub();
  }, [userId]);

  // Get user location for distance calculation
  useEffect(() => {
    const getUserLocation = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        let location = await Location.getLastKnownPositionAsync({});
        if (!location) {
          location = await Location.getCurrentPositionAsync({});
        }
        if (location) {
          setUserLocation(location.coords);
        }
      }
    };
    getUserLocation();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    // Fetch fresh profile
    const docRef = doc(db, "profiles", userId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data: any = docSnap.data();
      setProfile({ ...data, uid: userId });
      
      // Update cache
      await updateProfileInCache({
        uid: userId,
        username: data.username || 'User',
        photo: data.photo || data.photoURL,
        bio: data.bio,
        socials: data.socials,
        selectedSports: data.selectedSports || data.sportsPreferences,
        friends: data.friends,
      } as any);
    }
    
    await reloadAllActivities();
    setTimeout(() => {
      setRefreshing(false);
      setRefreshLocked(false);
    }, 1500);
  };

  // Load viewed user's friend profiles when opening connections modal
  useEffect(() => {
    const load = async () => {
      try {
        const ids: string[] = Array.isArray(profile?.friends) ? profile!.friends : [];
        if (!connectionsModalVisible || ids.length === 0) { setUserFriendProfiles([]); return; }
  const rows: Array<{ uid: string; username: string; photo?: string }> = [];
        for (let i = 0; i < ids.length; i += 10) {
          const batch = ids.slice(i, i + 10);
          const q = fsQuery(collection(db, 'profiles'), where('__name__', 'in', batch));
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const p: any = d.data();
            rows.push({ uid: d.id, username: p.username || p.username_lower || 'User', photo: p.photo || p.photoURL });
          });
        }
        rows.sort((a, b) => a.username.localeCompare(b.username));
        setUserFriendProfiles(rows);
      } catch (e) {
        setUserFriendProfiles([]);
      }
    };
    load();
  }, [connectionsModalVisible, profile?.friends]);

  const handleAddFriend = async () => {
    try {
      if (isFriend) {
        // Ask to remove connection
        Alert.alert(
          'Remove connection',
          'Do you want to remove this connection?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove', style: 'destructive', onPress: async () => {
                try {
                  await removeFriend(userId);
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setIsFriend(false);
                  setRequestSent(false);
                } catch (_) {}
              }
            }
          ]
        );
      } else if (!requestSent) {
        await sendFriendRequest(userId);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setRequestSent(true);
      } else {
        await cancelFriendRequest(userId);
        await Haptics.selectionAsync();
        setRequestSent(false);
      }
    } catch (e) {
      console.warn('friendRequest toggle failed', e);
    }
  };

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

  useEffect(() => {
    if (isReady) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  }, [isReady]);

  const handleShareProfile = () => {
    shareProfile(userId, profile?.username || 'User');
  };

  const handleReportUser = () => {
    setMenuVisible(false);
    Alert.alert(
      'Report User',
      'Why are you reporting this user?',
      [
        { text: 'Inappropriate behavior', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
        { text: 'Spam or fake account', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
        { text: 'Harassment', onPress: () => Alert.alert('Reported', 'Thank you for your report.') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleBlockUser = () => {
    setMenuVisible(false);
    Alert.alert(
      'Block User',
      `Are you sure you want to block ${profile?.username || 'this user'}?\n\n• You won't see their profile or activities\n• They can't send you messages\n• Your connection will be removed\n• They won't be notified`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(userId);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setIsBlocked(true);
              Alert.alert('Blocked', `${profile?.username || 'User'} has been blocked.`, [
                {
                  text: 'OK',
                  onPress: () => navigation.goBack(),
                },
              ]);
            } catch (error) {
              console.error('Error blocking user:', error);
              Alert.alert('Error', 'Failed to block user. Please try again.');
            }
          },
        },
      ]
    );
  };

  // Helper functions for card info
  const simplifyLocation = (location: string) => {
    if (!location) return '';
    const parts = location.split(',').map(part => part.trim());
    if (parts.length >= 2) {
      return `${parts[0]}, ${parts[parts.length - 2] || parts[parts.length - 1]}`;
    }
    return location;
  };

  // Calculate distance between two coordinates
  const calculateDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  const handleShareActivity = async (activity: any) => {
    try {
      await shareActivity(activity.id, activity.activity);
    } catch (error) {
      console.error(error);
    }
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

  const renderActivity = ({ item }: { item: any }) => {
    // Calculate distance if userLocation is available
    const distance = userLocation && item.latitude && item.longitude
      ? calculateDistanceKm(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude).toFixed(2)
      : null;

    return (
    <TouchableOpacity
      style={styles.activityCard}
      onPress={() => navigation.navigate('ActivityDetails', { activityId: item.id })}
      activeOpacity={0.92}
    >
      {/* Card Header: Icon, Title, Distance */}
      <View style={styles.cardHeaderRow}>
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
          style={[styles.joinButton, isActivityJoined(item.id) && styles.joinButtonJoined]}
          onPress={() => toggleJoinActivity(item)}
        >
          <Text style={styles.joinButtonText}>
            {isActivityJoined(item.id) ? 'Leave' : 'Join'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.shareButton} onPress={() => handleShareActivity(item)}>
          <Ionicons name="share-social-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
    );
  };

  // Split into upcoming vs history using start+2h rule
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [scheduledSearchQuery, setScheduledSearchQuery] = useState('');
  const toStartDate = (a: any) => {
    const d = a?.date;
    if (!d || typeof d !== 'string') return null;
    let ymd = d.trim();
    const m1 = ymd.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (m1) { const [, dd, mm, yyyy] = m1; ymd = `${yyyy}-${mm}-${dd}`; }
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
  const upcomingActivities = userJoinedActivities.filter(a => !isHistorical(a));
  const historyActivities = userJoinedActivities.filter(a => isHistorical(a));
  const getStartMs = (a: any) => { const dt = toStartDate(a); return dt ? dt.getTime() : Number.POSITIVE_INFINITY; };
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
      ? calculateDistanceKm(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude).toFixed(2)
      : null;
    return (
      <TouchableOpacity
        style={styles.activityCard}
        onPress={() => navigation.navigate('ActivityDetails', { activityId: item.id })}
        activeOpacity={0.92}
      >
        <View style={styles.cardHeaderRow}>
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

  const handleTabPress = (tab: 'games' | 'history', index: number) => {
    Keyboard.dismiss();
    setActiveTab(tab);
    const pager = pagerRef.current as (PagerView & { setPageWithoutAnimation?: (page: number) => void }) | null;
    if (!pager) return;
    if (typeof (pager as any).setPageWithoutAnimation === 'function') {
      (pager as any).setPageWithoutAnimation(index);
    } else {
      pager.setPage(index);
    }
  };

  const handlePageSelected = (event: PagerViewOnPageSelectedEvent) => {
    const index = event.nativeEvent.position;
    const nextTab = tabs[index];
    if (nextTab && nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  };

  const getIconName = (tab: 'games' | 'history'): keyof typeof Ionicons.glyphMap => (
    tab === 'games' ? 'list' : 'time'
  );

  if (!isReady) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top,
        }}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: theme.background }}>
        {/* ===== COMPACT PROFILE HEADER ===== */}
        {/* Username Header Row with Back + Menu */}
        <View style={styles.usernameHeaderRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backIconBtn}>
            <Ionicons name="arrow-back" size={24} color={theme.primary} />
          </TouchableOpacity>
          <Text style={styles.usernameTitle} numberOfLines={1}>
            {profile?.username || 'Username'}
          </Text>
          <TouchableOpacity style={styles.menuIconBtn} onPress={() => setMenuVisible(true)}>
            <Ionicons name="ellipsis-vertical" size={22} color={theme.primary} />
          </TouchableOpacity>
        </View>

        {/* Profile Info Row: Avatar + Stats */}
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
              <Text style={styles.statCompactValue}>{profile?.friends?.length || 0}</Text>
              <Text style={styles.statCompactLabel}>Connections</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.statCompactItem} activeOpacity={0.7} onPress={() => setFavModalVisible(true)}>
              <Text style={styles.statCompactValue}>{(profile?.sportsPreferences || profile?.selectedSports || []).length}</Text>
              <Text style={styles.statCompactLabel}>Sports</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.statCompactItem} activeOpacity={0.7} onPress={() => setActivitiesModalVisible(true)}>
              <Text style={styles.statCompactValue}>{userJoinedActivities.length}</Text>
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
                          { text: 'Copy', onPress: () => { Clipboard.setString(value); Alert.alert('Copied', 'Instagram handle copied'); }},
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
                          { text: 'Copy', onPress: () => { Clipboard.setString(value); Alert.alert('Copied', 'Facebook handle copied'); }},
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
        {!isSelf && (
          <View style={styles.actionCompactRow}>
            {incomingRequest ? (
              <>
                <TouchableOpacity
                  style={styles.actionCompactBtnPrimary}
                  onPress={async () => {
                    try {
                      await acceptIncomingRequestFromProfile(userId);
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setIsFriend(true);
                      setIncomingRequest(false);
                    } catch (e) { console.warn('accept from profile failed', e); }
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="checkmark-done" size={16} color="#fff" />
                  <Text style={styles.actionCompactBtnPrimaryText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionCompactBtnSecondary}
                  onPress={async () => {
                    try {
                      await declineIncomingRequestFromProfile(userId);
                      await Haptics.selectionAsync();
                      setIncomingRequest(false);
                    } catch (e) { console.warn('decline from profile failed', e); }
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="close" size={16} color={theme.primary} />
                  <Text style={styles.actionCompactBtnSecondaryText}>Decline</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[
                  (requestSent || isFriend) ? styles.actionCompactBtnPrimary : styles.actionCompactBtnSecondary,
                ]}
                onPress={handleAddFriend}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={isFriend ? 'checkmark-done' : 'person-add'}
                  size={16}
                  color={(requestSent || isFriend) ? '#fff' : theme.primary}
                />
                <Text style={(requestSent || isFriend) ? styles.actionCompactBtnPrimaryText : styles.actionCompactBtnSecondaryText}>
                  {isFriend ? 'Connected' : (requestSent ? 'Pending' : 'Connect')}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.actionCompactBtnSecondary}
              onPress={async () => {
                try {
                  const chatId = await ensureDmChat(userId);
                  navigation.navigate('ChatDetail', { chatId });
                } catch (e) {
                  console.warn('open DM failed', e);
                }
              }}
            >
              <Ionicons name="chatbubble" size={16} color={theme.primary} />
              <Text style={styles.actionCompactBtnSecondaryText}>Message</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.actionCompactBtnIcon} 
              onPress={handleShareProfile}
            >
              <Ionicons name="share-outline" size={18} color={theme.primary} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.tabBar}>
          {tabs.map((tab, index) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.activeTab]}
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
            <View
              key="games"
              style={styles.pagerPage}
              {...backSwipeResponder.panHandlers}
            >
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
                    <TouchableOpacity style={styles.styledClearBtn} onPress={() => setScheduledSearchQuery('')}>
                      <Ionicons name="close-circle" size={20} color={theme.muted} />
                    </TouchableOpacity>
                  )}
                </View>
                {filteredUpcoming.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="calendar-outline" size={48} color={theme.primary} />
                    <Text style={styles.tabTitleCentered}>No scheduled activities</Text>
                    <Text style={styles.emptyStateText}>Their upcoming activities will appear here.</Text>
                  </View>
                ) : (
                  <FlatList
                    data={filteredUpcoming.slice(0, displayedActivitiesCount)}
                    renderItem={renderActivity}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={[styles.listContainer, listContentPadding]}
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
            </View>
            <View key="history" style={styles.pagerPage}>
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
                    <TouchableOpacity style={styles.styledClearBtn} onPress={() => setHistorySearchQuery('')}>
                      <Ionicons name="close-circle" size={20} color={theme.muted} />
                    </TouchableOpacity>
                  )}
                </View>
                {filteredHistory.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="time-outline" size={48} color={theme.primary} />
                    <Text style={styles.tabTitleCentered}>No past activities</Text>
                    <Text style={styles.emptyStateText}>Their past activities will appear here.</Text>
                  </View>
                ) : (
                  <FlatList
                    data={filteredHistory.slice(0, displayedHistoryCount)}
                    renderItem={renderHistoryActivity}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={[styles.listContainer, listContentPadding]}
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
            </View>
          </PagerView>
        </View>
      </Animated.View>
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
                  {((profile?.sportsPreferences || profile?.selectedSports || []) as string[]).length} sport{((profile?.sportsPreferences || profile?.selectedSports || []) as string[]).length === 1 ? '' : 's'} selected
                </Text>
              </View>
              <TouchableOpacity onPress={() => setFavModalVisible(false)} style={{ backgroundColor: theme.danger, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            {((profile?.sportsPreferences || profile?.selectedSports || []) as string[]).length === 0 ? (
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
                {[...(((profile?.sportsPreferences || profile?.selectedSports || []) as string[]))].sort((a, b) => a.localeCompare(b)).map((item, index) => (
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
                  {userFriendProfiles.length} connection{userFriendProfiles.length === 1 ? '' : 's'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setConnectionsModalVisible(false)} style={{ backgroundColor: theme.danger, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            {userFriendProfiles.length === 0 ? (
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
                {userFriendProfiles.map((item) => (
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
                  {userJoinedActivities.length} total activit{userJoinedActivities.length === 1 ? 'y' : 'ies'} joined
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

      {/* Menu Modal */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setMenuVisible(false)}>
          <Pressable style={{ backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border, maxWidth: 280, width: '80%' }}>
            <TouchableOpacity onPress={() => setMenuVisible(false)} style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, backgroundColor: theme.background, borderRadius: 15, padding: 2 }}>
              <Ionicons name="close-circle" size={24} color={theme.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}
              onPress={handleShareProfile}
            >
              <Ionicons name="share-social-outline" size={22} color={theme.primary} />
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>Share Profile</Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: theme.border }} />
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}
              onPress={handleBlockUser}
            >
              <Ionicons name="ban-outline" size={22} color={theme.danger} />
              <Text style={{ color: theme.danger, fontSize: 16, fontWeight: '600' }}>Block User</Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: theme.border }} />
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}
              onPress={handleReportUser}
            >
              <Ionicons name="flag-outline" size={22} color={theme.danger} />
              <Text style={{ color: theme.danger, fontSize: 16, fontWeight: '600' }}>Report User</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

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
    </View>
  );
};

const createStyles = (t: any) => StyleSheet.create({
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
    flex: 1,
    marginHorizontal: 50,
  },
  backIconBtn: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconBtn: {
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
    flex: 1,
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

  // Tab and list styles
  tabTitleCentered: {
    color: t.primary,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  // Styled tab headers
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
  searchInput: {
    backgroundColor: t.card,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 5,
    minHeight: 36,
    color: t.text,
    fontWeight: '500',
  },
  clearButton: {
    marginLeft: 8,
    height: 24,
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  emptyStateText: {
    color: t.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
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
  container: { flex: 1, backgroundColor: t.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 0,
    marginBottom: 0,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: { padding: 5 },
  profileNameHeader: {
    fontSize: 24,
    color: t.primary,
    fontWeight: 'bold',
    textAlign: 'left',
  },
  settingsButton: {
    padding: 5,
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
  statLabel: {
    color: t.muted,
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  statNumberWrap: {
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
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
  // New: actions bar mirroring Profile page (left cluster + right message)
  profileActionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 10,
    gap: 8,
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  actionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: t.primary,
    flexShrink: 1,
  },
  profileActionButtonSm: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  profileActionButtonInverted: {
    backgroundColor: t.primary,
    borderColor: t.primary,
  },
  profileActionText: {
    color: t.primary,
    fontWeight: 'bold',
    fontSize: 16,
  },
  profileActionTextSm: {
    fontSize: 14,
  },
  profileActionTextInverted: {
    color: '#fff',
  },
  // Modal styles reused for stats popovers
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: t.border,
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: 'transparent',
    marginBottom: 0,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 6,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: t.primary,
  },
  pagerContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  pager: {
    flex: 1,
    backgroundColor: t.background,
  },
  pagerPage: {
    flex: 1,
    backgroundColor: t.background,
  },
  contentContainer: {
    flex: 1,
  },
  tabContent: {
    fontSize: 18,
    color: t.text,
    fontWeight: '500',
  },
  activityCard: {
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: t.primary,
    marginLeft: 8,
  },
  cardDistanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  cardDistanceText: {
    color: t.primary,
    fontWeight: 'bold',
    fontSize: 15,
  },
  // ...existing code...
  joinButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: t.primary,  // Join
    borderRadius: 5,
  },
  joinButtonJoined: {
    // Discover-aligned Leave color mapping for activity cards
    backgroundColor: t.isDark ? '#007E84' : darkenHex(t.primary, 0.12),
    borderRadius: 5,
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  shareButton: {
    padding: 8,
    backgroundColor: t.card,
    borderRadius: 5,
  },
  listContainer: {
    paddingBottom: 0,
  },
});

export default UserProfileScreen;