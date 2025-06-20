import { RouteProp } from '@react-navigation/native';
import React, { useState, useCallback, useEffect } from 'react';
import {
  SafeAreaView,
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
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

const ProfileScreen = () => {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'ActivityDetails'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Profile'>>();
  const userId = route.params?.userId;
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'activities' | 'history' | 'friends'>('activities');
  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const [userJoinedActivities, setUserJoinedActivities] = useState<any[]>([]);
  const [isReady, setIsReady] = useState(false);
  const { joinedActivities, toggleJoinActivity, isActivityJoined, allActivities, profile: contextProfile } = useActivityContext();

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
    const distance = userLocation
      ? `${calculateDistance(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude).toFixed(2)} km away`
      : "N/A";
    const isJoined = isActivityJoined(item.id);

    return (
      <TouchableOpacity 
        style={styles.activityCard} 
        onPress={() => navigation.navigate('ActivityDetails', { activityId: item.id })}
      >
        <View style={styles.cardHeader}>
          <ActivityIcon activity={item.activity} size={32} />
          <Text style={styles.cardTitle}>{item.activity}</Text>
        </View>
        <Text style={styles.cardInfo}>Host: {item.creator}</Text>
        <Text style={styles.cardInfo}>Location: {item.location}</Text>
        <Text style={styles.cardInfo}>Date: {item.date} at {item.time}</Text>
        <Text style={styles.cardInfo}>
          Participants: {(item.joinedUserIds ? item.joinedUserIds.length : item.joinedCount) || 0} / {item.maxParticipants}
        </Text>
        <Text style={styles.distanceText}>{distance}</Text>
        <TouchableOpacity 
          style={[styles.joinButton, isJoined ? styles.joinButtonJoined : null]} 
          onPress={() => handleJoinLeave(item)}
        >
          <Text style={styles.joinButtonText}>{isJoined ? 'Leave' : 'Join'}</Text>
        </TouchableOpacity>
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
      <SafeAreaView style={[styles.container, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#1ae9ef" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Text style={styles.profileNameHeader}>{profile?.username || 'Username'}</Text>
        <TouchableOpacity style={styles.settingsButton} onPress={() => {}}>
          <Ionicons name="settings-outline" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.profileInfo}>
        <View style={styles.profileLeftColumn}>
          <Image style={styles.profileImage} source={{ uri: profile?.photo || 'https://via.placeholder.com/100' }} />
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
    backgroundColor: '#1e1e1e',
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
    padding: 20,
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
  activityCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1ae9ef',
    marginLeft: 10,
  },
  cardInfo: {
    fontSize: 16,
    color: '#ccc',
    marginVertical: 2,
    fontWeight: '500',
  },
  distanceText: {
    color: '#1ae9ef',
    fontSize: 14,
    marginTop: 2,
    fontWeight: 'bold',
  },
  joinButton: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: '#1ae9ef',
    borderRadius: 5,
    alignItems: 'center',
  },
  joinButtonJoined: {
    backgroundColor: '#007b7b',
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  listContainer: {
    paddingBottom: 100,
  },
  settingsButton: {
    padding: 5,
  },
});

export default ProfileScreen;
