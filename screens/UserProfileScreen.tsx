import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Share, FlatList, Animated, RefreshControl, Alert, Modal, Pressable } from 'react-native';
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

const UserProfileScreen = () => {
  const route = useRoute();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
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
        <Text style={styles.cardInfo}>{item.creator}</Text>
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

  if (!isReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#121212' }} edges={['top']} />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={28} color="#1ae9ef" />
            </TouchableOpacity>
            <Text style={styles.profileNameHeader} numberOfLines={1}>
              {profile?.username || 'Username'}
            </Text>
          </View>
          <TouchableOpacity style={styles.settingsButton} onPress={handleShareProfile}>
            <Ionicons name="share-social-outline" size={28} color="#1ae9ef" />
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
                  <Ionicons name="checkmark-done-outline" size={18} color={'#000'} style={{ marginRight: 6 }} />
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
                  <Ionicons name="close-outline" size={18} color={'#1ae9ef'} style={{ marginRight: 4 }} />
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
                  color={(requestSent || isFriend) ? '#000' : '#1ae9ef'}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.profileActionText, (requestSent || isFriend) && styles.profileActionTextInverted]}>
                  {isFriend ? 'Connected' : (requestSent ? 'Request Sent' : 'Add Friend')}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.profileActionButton}
              disabled={!(isFriend && theyListMe)}
              onPress={async () => {
                try {
                  if (!(isFriend && theyListMe)) {
                    Alert.alert('Connect first', 'You both need to be connected to send a direct message.');
                    return;
                  }
                  const chatId = await ensureDmChat(userId);
                  navigation.navigate('ChatDetail', { chatId });
                } catch (e) {
                  console.warn('open DM failed', e);
                }
              }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color="#1ae9ef" style={{ marginRight: 4 }} />
              <Text style={styles.profileActionText}>Message</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'games' && styles.activeTab]}
            onPress={() => setActiveTab('games')}
          >
            <Ionicons name="list" size={28} color={activeTab === 'games' ? '#1ae9ef' : '#fff'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'history' && styles.activeTab]}
            onPress={() => setActiveTab('history')}
          >
            <Ionicons name="time" size={28} color={activeTab === 'history' ? '#1ae9ef' : '#fff'} />
          </TouchableOpacity>
        </View>
        <View style={styles.contentContainer}>
          {activeTab === 'games' ? (
            <FlatList
              data={userJoinedActivities}
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
          ) : (
            <Text style={styles.tabContent}>Match History</Text>
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
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: '#1ae9ef', fontWeight: 'bold', fontSize: 18 }}>Connections</Text>
              <TouchableOpacity onPress={() => setConnectionsModalVisible(false)} style={{ backgroundColor: '#8e2323', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
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
                    <Image source={{ uri: item.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.username) }} style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#1ae9ef' }} />
                    <Text style={{ color: '#fff', marginLeft: 10, fontWeight: '600' }}>{item.username}</Text>
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={{ color: '#bbb' }}>No connections yet.</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
  container: { flex: 1, backgroundColor: '#121212' },
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
    color: '#1ae9ef',
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
    color: '#1ae9ef',
    fontWeight: '800',
    fontSize: 22,
    textAlign: 'center',
    lineHeight: 26,
  },
  statLabel: {
    color: '#aaa',
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
    borderColor: '#1ae9ef',
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
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: '#1ae9ef',
    flexShrink: 1,
  },
  profileActionButtonSm: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  profileActionButtonInverted: {
    backgroundColor: '#1ae9ef',
    borderColor: '#1ae9ef',
  },
  profileActionText: {
    color: '#1ae9ef',
    fontWeight: 'bold',
    fontSize: 16,
  },
  profileActionTextSm: {
    fontSize: 14,
  },
  profileActionTextInverted: {
    color: '#000',
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
    backgroundColor: '#18191a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: '#121212',
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
  activityCard: {
    backgroundColor: '#1e1e1e',
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
    color: '#1ae9ef',
    marginLeft: 8,
  },
  cardDistanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  cardDistanceText: {
    color: '#1ae9ef',
    fontWeight: 'bold',
    fontSize: 15,
  },
  // ...existing code...
  joinButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: '#1ae9ef',  // Turquoise for Join
    borderRadius: 5,
  },
  joinButtonJoined: {
    backgroundColor: '#007b7b',  // Darker Turquoise for Leave
    borderRadius: 5,
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  shareButton: {
    padding: 8,
    backgroundColor: '#1e1e1e',
    borderRadius: 5,
  },
  listContainer: {
    paddingBottom: 0,
  },
});

export default UserProfileScreen;