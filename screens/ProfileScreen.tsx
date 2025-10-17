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
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useActivityContext } from '../context/ActivityContext';
import { ActivityIcon } from '../components/ActivityIcons';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { doc, getDoc } from 'firebase/firestore';
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
            <TextInput style={styles.searchInput} placeholder="Search friends..." placeholderTextColor="#aaa" />
            <FlatList
              data={[{ name: 'John Doe' }, { name: 'Alice' }, { name: 'Bob' }]}
              keyExtractor={(item) => item.name}
              renderItem={({ item }) => <Text style={styles.friendName}>{item.name}</Text>}
            />
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
  searchInput: {
    backgroundColor: '#1e1e1e',
    padding: 10,
    borderRadius: 5,
    marginBottom: 10,
    color: '#fff',
    fontWeight: '500',
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
});

export default ProfileScreen;
