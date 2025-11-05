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
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Share, FlatList, Animated, RefreshControl, Alert, Modal, Pressable, TextInput } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, onSnapshot, collection, query as fsQuery, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActivityContext } from '../context/ActivityContext';
import { ActivityIcon } from '../components/ActivityIcons';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { sendFriendRequest, cancelFriendRequest, removeFriend, acceptIncomingRequestFromProfile, declineIncomingRequestFromProfile } from '../utils/firestoreFriends';
import { ensureDmChat } from '../utils/firestoreChats';

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
  const [userJoinedActivities, setUserJoinedActivities] = useState<any[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [requestSent, setRequestSent] = useState(false);
  const [isSelf, setIsSelf] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(false);
  const [theyListMe, setTheyListMe] = useState(false);
  const [favModalVisible, setFavModalVisible] = useState(false);
  const [connectionsModalVisible, setConnectionsModalVisible] = useState(false);
  const [userFriendProfiles, setUserFriendProfiles] = useState<Array<{ uid: string; username: string; photo?: string }>>([]);

  useEffect(() => {
    const fetchProfile = async () => {
      const docRef = doc(db, "profiles", userId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setProfile({ ...docSnap.data(), uid: userId });
      }
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
    const docRef = doc(db, "profiles", userId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      setProfile({ ...docSnap.data(), uid: userId });
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

  const handleShareProfile = async () => {
    try {
      await Share.share({
        message: `Check out ${profile?.username}'s SportsPal profile!`,
      });
    } catch (error) {
      console.error(error);
    }
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
      await Share.share({
        message: `Check out this ${activity.activity} game on SportsPal!`,
      });
    } catch (error) {
      console.error(error);
    }
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

  if (!isReady) {
    return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top']} />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={28} color={theme.primary} />
            </TouchableOpacity>
            <Text style={styles.profileNameHeader} numberOfLines={1}>
              {profile?.username || 'Username'}
            </Text>
          </View>
          <TouchableOpacity style={styles.settingsButton} onPress={handleShareProfile}>
            <Ionicons name="share-social-outline" size={28} color={theme.text} />
          </TouchableOpacity>
        </View>
        {/* Profile hero area: match Profile page spacing and size */}
        <View style={styles.profileInfo}>
          <View style={styles.profileLeftColumn}>
            <Image source={{ uri: profile?.photo || 'https://via.placeholder.com/100' }} style={styles.profileImage} />
          </View>
          {/* Stats next to avatar */}
          <View style={styles.statsColumn}>
            <View style={styles.statsRow}>
              <TouchableOpacity style={styles.statBlock} activeOpacity={0.8} onPress={() => setConnectionsModalVisible(true)}>
                <View style={styles.statNumberWrap}><Text style={styles.statNumber}>{profile?.friends?.length || 0}</Text></View>
                <Text style={styles.statLabel}>Connections</Text>
                <Text style={[styles.statLabel, { opacity: 0 }]}>_</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.statBlock} activeOpacity={0.8} onPress={() => setFavModalVisible(true)}>
                <View style={styles.statNumberWrap}><Text style={styles.statNumber}>{(profile?.sportsPreferences || profile?.selectedSports || []).length}</Text></View>
                <Text style={styles.statLabel}>Favourite{((profile?.sportsPreferences || profile?.selectedSports || []).length === 1) ? '' : 's'}</Text>
                <Text style={[styles.statLabel, { marginTop: -2 }]}>Sports</Text>
              </TouchableOpacity>
              <View style={styles.statBlock}>
                <View style={styles.statNumberWrap}><Text style={styles.statNumber}>{userJoinedActivities.length}</Text></View>
                <Text style={styles.statLabel}>Joined</Text>
                <Text style={[styles.statLabel, { marginTop: -2 }]}>Activities</Text>
              </View>
            </View>
          </View>
        </View>
        {/* Actions row identical to own Profile: center-aligned, same sizes/spacings as Edit Profile & Share Profile */}
        {!isSelf && (
          <View style={styles.profileActionsRow}>
            {incomingRequest ? (
              <>
                <TouchableOpacity
                  style={[styles.profileActionButton, styles.profileActionButtonInverted]}
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
                  <Ionicons name="checkmark-done-outline" size={18} color={'#fff'} style={{ marginRight: 6 }} />
                  <Text style={[styles.profileActionText, styles.profileActionTextInverted]}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.profileActionButton}
                  onPress={async () => {
                    try {
                      await declineIncomingRequestFromProfile(userId);
                      await Haptics.selectionAsync();
                      setIncomingRequest(false);
                    } catch (e) { console.warn('decline from profile failed', e); }
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="close-outline" size={18} color={theme.primary} style={{ marginRight: 4 }} />
                  <Text style={styles.profileActionText}>Delete</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[
                  styles.profileActionButton,
                  (requestSent || isFriend) && styles.profileActionButtonInverted,
                ]}
                onPress={handleAddFriend}
                disabled={false}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={isFriend ? 'checkmark-done-outline' : 'person-add-outline'}
                  size={18}
                  color={(requestSent || isFriend) ? '#fff' : theme.primary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.profileActionText, (requestSent || isFriend) && styles.profileActionTextInverted]}>
                  {isFriend ? 'Connected' : (requestSent ? 'Request Sent' : 'Add Friend')}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.profileActionButton}
              onPress={async () => {
                try {
                  // Open or create a DM regardless of connection status
                  const chatId = await ensureDmChat(userId);
                  navigation.navigate('ChatDetail', { chatId });
                } catch (e) {
                  console.warn('open DM failed', e);
                }
              }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.primary} style={{ marginRight: 4 }} />
              <Text style={styles.profileActionText}>Message</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'games' && styles.activeTab]}
            onPress={() => setActiveTab('games')}
          >
            <Ionicons name="list" size={28} color={activeTab === 'games' ? theme.primary : theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'history' && styles.activeTab]}
            onPress={() => setActiveTab('history')}
          >
            <Ionicons name="time" size={28} color={activeTab === 'history' ? theme.primary : theme.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.contentContainer}>
          {activeTab === 'games' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.tabTitleCentered}>Scheduled Activities</Text>
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
                  <TouchableOpacity style={styles.clearButton} onPress={() => setScheduledSearchQuery('')}>
                    <Ionicons name="close-circle" size={18} color={theme.primary} />
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
                  data={filteredUpcoming}
                  renderItem={renderActivity}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContainer}
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
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={styles.tabTitleCentered}>Activity History</Text>
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
                  <TouchableOpacity style={styles.clearButton} onPress={() => setHistorySearchQuery('')}>
                    <Ionicons name="close-circle" size={18} color={theme.primary} />
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
                  data={filteredHistory}
                  renderItem={renderHistoryActivity}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContainer}
                />
              )}
            </View>
          )}
        </View>
      </Animated.View>
      {/* Favourite sports modal */}
      <Modal
        visible={favModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setFavModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setFavModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 18 }}>Favourite Sports</Text>
              <TouchableOpacity onPress={() => setFavModalVisible(false)} style={{ backgroundColor: theme.danger, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 10 }} />
            {((profile?.sportsPreferences || profile?.selectedSports || []) as string[]).length === 0 ? (
              <Text style={{ color: theme.muted }}>No favourites yet.</Text>
            ) : (
              <FlatList
                data={[...(((profile?.sportsPreferences || profile?.selectedSports || []) as string[]))].sort((a, b) => a.localeCompare(b))}
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
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 18 }}>Connections</Text>
              <TouchableOpacity onPress={() => setConnectionsModalVisible(false)} style={{ backgroundColor: theme.danger, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 10 }} />
            {userFriendProfiles.length > 0 ? (
              <FlatList
                data={userFriendProfiles}
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
                    <Image source={{ uri: item.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username) }} style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: theme.primary }} />
                    <Text style={{ color: theme.text, marginLeft: 10, fontWeight: '600' }}>{item.username}</Text>
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={{ color: theme.muted }}>No connections yet.</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (t: any) => StyleSheet.create({
  tabTitleCentered: {
    color: t.primary,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
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
  contentContainer: {
    paddingHorizontal: 20,
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