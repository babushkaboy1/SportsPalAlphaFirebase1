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
  Share,
  StatusBar, // <-- Add this import
  Animated,
  RefreshControl,
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
// useActivityContext is already imported above in this file; avoid duplicate
import { ActivityIcon } from '../components/ActivityIcons';
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

type ProfileStackParamList = {
  ProfileMain: undefined;
  ActivityDetails: { activityId: string };
  UserProfile: { userId: string };
  Settings: undefined;
  CreateProfile: { mode: string; profileData: any };
};

const ProfileScreen = () => {
  const navigation = useNavigation<StackNavigationProp<ProfileStackParamList, 'ProfileMain'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Profile'>>();
  const userId = route.params?.userId;
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'activities' | 'history' | 'friends'>('activities');
  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const [userJoinedActivities, setUserJoinedActivities] = useState<any[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { joinedActivities, toggleJoinActivity, isActivityJoined, allActivities, profile: contextProfile, reloadAllActivities } = useActivityContext();
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteTargetUser, setInviteTargetUser] = useState<{uid: string; username: string; photo?: string} | null>(null);
  const [inviteSelection, setInviteSelection] = useState<Record<string, boolean>>({});
  const myJoinedActivities = allActivities.filter(a => joinedActivities.includes(a.id));
  // Stats modals
  const [favModalVisible, setFavModalVisible] = useState(false);
  const [connectionsModalVisible, setConnectionsModalVisible] = useState(false);

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
    const docRef = doc(db, "profiles", uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      setProfile({ ...docSnap.data(), uid }); // <-- Ensure uid is present
    } else {
      setProfile(null);
    }
  };

  const handleShareProfile = async () => {
    try {
      await Share.share({
        message: `Check out my profile on SportsPal! Username: ${profile?.username}`,
      });
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
    // Subscribe to my profile to get friend ids
    const unsub = onSnapshot(doc(db, 'profiles', me), async (snap) => {
      if (!snap.exists()) return setFriends([]);
      const data: any = snap.data();
      const friendIds: string[] = data?.friends || [];
      const reqs: string[] = data?.requestsSent || [];
      setMyFriendIds(Array.isArray(friendIds) ? friendIds : []);
      setMyRequestsSent(Array.isArray(reqs) ? reqs : []);
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
          rows.push({ uid: d.id, username: p.username || p.username_lower || 'User', photo: p.photo || p.photoURL });
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
            <ActivityIcon activity={item.activity} size={32} />
            <Text style={styles.cardTitle}>{item.activity}</Text>
          </View>
          {distance && (
            <View style={styles.distanceContainer}>
              <Ionicons name="navigate" size={14} color="#1ae9ef" />
              <Text style={styles.distanceNumber}>{distance}</Text>
              <Text style={styles.distanceUnit}>km away</Text>
            </View>
          )}
        </View>
        {/* Host */}
        <View style={styles.infoRow}>
          <Ionicons name="person" size={16} color="#1ae9ef" style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Host:</Text>
          <Text style={styles.cardInfo}>{item.creatorUsername || item.creator}</Text>
        </View>
        {/* Location */}
        <View style={styles.infoRow}>
          <Ionicons name="location" size={16} color="#1ae9ef" style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Location:</Text>
          <Text style={styles.cardInfo} numberOfLines={1} ellipsizeMode="tail">
            {simplifyLocation(item.location)}
          </Text>
        </View>
        {/* Date */}
        <View style={styles.infoRow}>
          <Ionicons name="calendar" size={16} color="#1ae9ef" style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Date:</Text>
          <Text style={styles.cardInfo}>{item.date}</Text>
        </View>
        {/* Time */}
        <View style={styles.infoRow}>
          <Ionicons name="time" size={16} color="#1ae9ef" style={styles.infoIcon} />
          <Text style={styles.cardInfoLabel}>Time:</Text>
          <Text style={styles.cardInfo}>{item.time}</Text>
        </View>
        {/* Participants */}
        <View style={styles.infoRow}>
          <Ionicons name="people" size={16} color="#1ae9ef" style={styles.infoIcon} />
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
            onPress={() => Share.share({ message: `Join me for ${item.activity} at ${item.location} on ${item.date}!` })}
          >
            <Ionicons name="share-social-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const sortedActivities = userJoinedActivities.slice().sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'activities':
        return (
          <FlatList
            data={sortedActivities}
            renderItem={renderActivity}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            refreshControl={
              <RefreshControl
                refreshing={refreshing || refreshLocked}
                onRefresh={onRefresh}
                colors={["#009fa3"]}
                tintColor="#009fa3"
                progressBackgroundColor="transparent"
              />
            }
          />
        );
      case 'history':
        return <Text style={styles.tabContent}>Activity History</Text>;
      case 'friends':
        return (
          <View style={styles.friendsTab}>
            {/* Search users (on top) */}
            <View style={styles.userSearchRow}>
              <Ionicons name="search" size={16} color="#1ae9ef" style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.searchInput, { flex: 1 }]}
                placeholder="Search users..."
                placeholderTextColor="#aaa"
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
                  <Ionicons name="close-circle" size={18} color="#1ae9ef" />
                </TouchableOpacity>
              )}
            </View>
            {/* Connections list (hidden while searching) */}
            {userSearchQuery.trim().length === 0 && (
              friends.length === 0 ? (
                <Text style={styles.mutedText}>No connections yet.</Text>
              ) : (
                <FlatList
                  data={friends}
                  keyExtractor={(item) => item.uid}
                  contentContainerStyle={{ paddingVertical: 6, paddingBottom: Math.max(insets.bottom, 16) }}
                  renderItem={({ item }) => (
                    <View style={styles.friendRow}>
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}
                        activeOpacity={0.8}
                        onPress={() => navigation.navigate('UserProfile', { userId: item.uid })}
                      >
                        <Image
                          source={{ uri: item.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username) }}
                          style={styles.userAvatar}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="tail">{item.username}</Text>
                        </View>
                      </TouchableOpacity>
                      <View style={styles.friendActions}>
                        <TouchableOpacity style={styles.inviteBtn} onPress={() => openInviteModal(item)}>
                          <Ionicons name="add-circle-outline" size={18} color="#000" />
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
                          <Ionicons name="chatbubble-ellipses-outline" size={18} color="#1ae9ef" />
                          <Text style={styles.msgBtnText}>Message</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                />
              )
            )}
            {userSearchQuery.trim().length === 0 ? (
              <TouchableOpacity activeOpacity={1} onPress={() => Keyboard.dismiss()} style={styles.emptyState}>
                <Ionicons name="people-outline" size={48} color="#1ae9ef" />
                <Text style={styles.emptyStateTitle}>Create connections</Text>
                <Text style={styles.emptyStateText}>
                  Search by username to discover people. Start typing a name.
                </Text>
              </TouchableOpacity>
            ) : userSearching ? (
              <View style={styles.emptyState}> 
                <ActivityIndicator size="large" color="#1ae9ef" />
                <Text style={styles.emptyStateText}>Searching…</Text>
              </View>
            ) : userResults.length === 0 ? (
              <TouchableOpacity activeOpacity={1} onPress={() => Keyboard.dismiss()} style={styles.emptyState}>
                <Ionicons name="person-circle-outline" size={48} color="#1ae9ef" />
                <Text style={styles.emptyStateTitle}>No matches yet</Text>
                <Text style={styles.emptyStateText}>Try a different spelling.</Text>
              </TouchableOpacity>
            ) : (
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
                        <Image
                          source={{ uri: item.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username) }}
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
                          <Ionicons name={'checkmark-done-outline'} size={18} color={'#000'} style={{ marginRight: 4 }} />
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
                          <Ionicons name={'person-add-outline'} size={18} color={'#000'} style={{ marginRight: 4 }} />
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
                          <Ionicons name="person-add-outline" size={18} color={'#1ae9ef'} style={{ marginRight: 4 }} />
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
                        <Ionicons name="chatbubble-ellipses-outline" size={18} color="#1ae9ef" />
                        <Text style={styles.msgBtnText}>Message</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />
            )}
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
                  {myJoinedActivities.length === 0 ? (
                    <Text style={styles.modalEmpty}>You haven't joined any activities yet.</Text>
                  ) : (
                    <FlatList
                      data={myJoinedActivities}
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
                            <ActivityIcon activity={item.activity} size={22} color="#1ae9ef" />
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
                              color={inviteSelection[item.id] ? '#1ae9ef' : '#666'}
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
      <SafeAreaView style={styles.container} edges={['top']} />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <View style={styles.headerRow}>
        <Text style={styles.profileNameHeader}>{profile?.username || 'Username'}</Text>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => navigation.navigate('Settings')} // Navigate to SettingsScreen
        >
          <Ionicons name="settings-outline" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.profileInfo}>
        <View style={styles.profileLeftColumn}>
          <Image source={{ uri: profile?.photo || 'https://via.placeholder.com/100' }} style={styles.profileImage} />
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
              <View style={styles.statNumberWrap}><Text style={styles.statNumber}>{(profile?.sportsPreferences || profile?.selectedSports || []).length}</Text></View>
              <Text style={styles.statLabel}>Favourite{((profile?.sportsPreferences || profile?.selectedSports || []).length === 1) ? '' : 's'}</Text>
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

      {!userId || userId === auth.currentUser?.uid ? (
        <View style={styles.profileActionsRow}>
          <TouchableOpacity
            style={styles.profileActionButton}
            onPress={() => navigation.navigate('CreateProfile', { mode: 'edit', profileData: profile })}
          >
            <Ionicons name="create-outline" size={18} color="#1ae9ef" style={{ marginRight: 6 }} />
            <Text style={styles.profileActionText}>Edit Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileActionButton} onPress={handleShareProfile}>
            <Ionicons name="share-social-outline" size={18} color="#1ae9ef" style={{ marginRight: 6 }} />
            <Text style={styles.profileActionText}>Share Profile</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {userId && userId !== auth.currentUser?.uid && (
        <View style={styles.profileActionsRow}>
          <TouchableOpacity style={styles.profileActionButton} onPress={() => {/* Add friend logic */}}>
            <Ionicons name="person-add-outline" size={18} color="#1ae9ef" style={{ marginRight: 6 }} />
            <Text style={styles.profileActionText}>Add Friend</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileActionButton} onPress={() => {/* Message logic */}}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#1ae9ef" style={{ marginRight: 6 }} />
            <Text style={styles.profileActionText}>Message</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab, { flex: 1 }]}
            onPress={() => setActiveTab(tab)}
          >
            <Ionicons
              name={getIconName(tab)}
              size={28}
              color={activeTab === tab ? '#1ae9ef' : '#fff'}
            />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.contentContainer}>{renderContent()}</View>
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
              <Text style={{ color: '#1ae9ef', fontWeight: 'bold', fontSize: 18 }}>Favourite Sports</Text>
              <TouchableOpacity onPress={() => setFavModalVisible(false)} style={{ backgroundColor: '#8e2323', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 10 }} />
            {((profile?.sportsPreferences || profile?.selectedSports || []) as string[]).length === 0 ? (
              <Text style={{ color: '#bbb' }}>No favourites yet.</Text>
            ) : (
              <FlatList
                data={(profile?.sportsPreferences || profile?.selectedSports || []) as string[]}
                keyExtractor={(s, i) => s + i}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                renderItem={({ item }) => (
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                    <ActivityIcon activity={item} size={22} />
                    <Text style={{ color: '#fff', marginLeft: 10, fontWeight: '600' }}>{item}</Text>
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
              <Text style={{ color: '#1ae9ef', fontWeight: 'bold', fontSize: 18 }}>Connections</Text>
              <TouchableOpacity onPress={() => setConnectionsModalVisible(false)} style={{ backgroundColor: '#8e2323', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 10 }} />
            {friends.length === 0 ? (
              <Text style={{ color: '#bbb' }}>No connections yet.</Text>
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
                    <Image source={{ uri: item.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username) }} style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#1ae9ef' }} />
                    <Text style={{ color: '#fff', marginLeft: 10, fontWeight: '600' }}>{item.username}</Text>
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
          borderColor: '#2a2a2a',
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
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  shareButton: {
    padding: 8,
    backgroundColor: '#1e1e1e',
    borderRadius: 5,
  },
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  joinedBadge: {
    color: '#bbb',
    fontSize: 12,
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 0, // Remove platform-specific logic
    paddingHorizontal: 20,
    marginTop: 0,
    marginBottom: 0,
  },
  profileNameHeader: {
    fontSize: 24,
    color: '#1ae9ef',
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
    minHeight: 100, // match profileImage height to center vertically
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
    color: '#1ae9ef',
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
    color: '#aaa',
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
    borderColor: '#1ae9ef',
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
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#1ae9ef',
  },
  profileActionText: {
    color: '#1ae9ef',
    fontWeight: 'bold',
    fontSize: 16,
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: '#121212',
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#1ae9ef',
  },
  contentContainer: {
    paddingHorizontal: 20,
    flex: 1,
  },
  tabContent: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '500',
  },
  friendsTab: {
    marginTop: 10,
  },
  userSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    backgroundColor: '#1e1e1e',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginBottom: 0,
    minHeight: 36,
    color: '#fff',
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  emptyStateTitle: {
    color: '#1ae9ef',
    fontWeight: 'bold',
    fontSize: 16,
    marginTop: 10,
  },
  emptyStateText: {
    color: '#bbb',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1ae9ef',
    marginRight: 8,
  },
  userName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  friendName: {
    color: '#fff',
    fontSize: 16,
    paddingVertical: 5,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#1e1e1e',
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
    color: '#1ae9ef',
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
    color: '#1ae9ef',
    fontWeight: '600',
  },
  distanceUnit: {
    fontSize: 14,
    color: '#888',
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
    color: '#1ae9ef',
    fontWeight: '600',
    marginRight: 6,
  },
  cardInfo: {
    fontSize: 14,
    color: '#ccc',
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
    backgroundColor: '#1ae9ef',
    borderRadius: 5,
  },
  joinButtonJoined: {
    backgroundColor: '#007b7b',
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
    color: '#1ae9ef',
    fontSize: 18,
    fontWeight: '700',
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
  },
  mutedText: {
    color: '#aaa',
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
    backgroundColor: '#1ae9ef',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginRight: 6,
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
  // Filled variant matching msgBtn size for Connected/Requested
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
  
  profileActionButtonSm: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  profileActionButtonInverted: {
    backgroundColor: '#1ae9ef',
    borderColor: '#1ae9ef',
  },
  
  profileActionTextSm: {
    fontSize: 14,
  },
  profileActionTextInverted: {
    color: '#000',
  },
  connectedPill: {
    backgroundColor: '#007b7b',
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
    backgroundColor: '#1e1e1e',
    borderWidth: 1,
    borderColor: '#1ae9ef',
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  requestedPillText: {
    color: '#1ae9ef',
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
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  modalTitle: {
    color: '#1ae9ef',
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 8,
  },
  modalEmpty: {
    color: '#bbb',
    fontSize: 14,
    marginVertical: 4,
  },
  activityPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#121212',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  activityPickLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activityPickTitle: {
    color: '#fff',
    fontWeight: '600',
  },
  activityPickMeta: {
    color: '#999',
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
    borderColor: '#444',
    backgroundColor: '#121212',
  },
  modalBtnPrimary: {
    borderColor: '#1ae9ef',
    backgroundColor: '#1ae9ef',
  },
  modalBtnTextCancel: {
    color: '#ddd',
    fontWeight: '600',
  },
  modalBtnTextPrimary: {
    color: '#000',
    fontWeight: '700',
  },
  addFriendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1ae9ef',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  addFriendBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 6,
  },
});

export default ProfileScreen;
