import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Share, FlatList, Animated, RefreshControl } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActivityContext } from '../context/ActivityContext';
import { ActivityIcon } from '../components/ActivityIcons';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';

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
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={28} color="#1ae9ef" />
          </TouchableOpacity>
          <Text style={styles.profileNameHeader}>{profile?.username || 'Username'}</Text>
          <TouchableOpacity style={styles.settingsButton} onPress={handleShareProfile}>
            <Ionicons name="share-social-outline" size={28} color="#1ae9ef" />
          </TouchableOpacity>
        </View>
        <View style={styles.profileInfo}>
          <View style={styles.profileLeftColumn}>
            <Image source={{ uri: profile?.photo || 'https://via.placeholder.com/100' }} style={styles.profileImage} />
          </View>
        </View>
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
                  colors={["#1ae9ef"]}
                  tintColor="#1ae9ef"
                  progressBackgroundColor="transparent"
                />
              }
            />
          ) : (
            <Text style={styles.tabContent}>Match History</Text>
          )}
        </View>
      </Animated.View>
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