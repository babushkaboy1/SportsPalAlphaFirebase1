import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  RefreshControl,
  Platform,
  StatusBar,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { ActivityIcon } from '../components/ActivityIcons';
import { fetchAllActivities } from '../utils/firestoreActivities';
import { activities as fakeActivities, Activity } from '../data/activitiesData';
import { ActivityProvider, useActivityContext } from '../context/ActivityContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const sportFilterOptions = [
  'All', 'Basketball', 'Soccer', 'Running', 'Gym',
  'Calisthenics', 'Padel', 'Tennis', 'Cycling',
  'Swimming', 'Badminton', 'Volleyball',
];

const DiscoverGamesScreen = ({ navigation }: any) => {
  const { allActivities, isActivityJoined, toggleJoinActivity } = useActivityContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isDatePickerVisible, setDatePickerVisible] = useState(false);
  const [isSortingByDistance, setIsSortingByDistance] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const [filteredActivities, setFilteredActivities] = useState<Activity[]>([]);
  const insets = useSafeAreaInsets();

  // Load activities from Firestore + fake on mount/refresh
  const loadActivities = async () => {
    setRefreshing(true);
    try {
      const firestoreActivities = await fetchAllActivities();
      const merged = [
        ...firestoreActivities,
        ...fakeActivities.filter(
          fake => !firestoreActivities.some(real => real.id === fake.id)
        ),
      ];
      // setAllActivities(merged);
    } catch (e) {
      // setAllActivities(fakeActivities);
    }
    setRefreshing(false);
  };

  useEffect(() => {
    loadActivities();
    getUserLocation();
  }, []);

  // Filtering and sorting
  useEffect(() => {
    let filtered = [...allActivities];

    if (selectedFilter !== 'All') {
      filtered = filtered.filter(activity => activity.activity === selectedFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(activity =>
        activity.activity.toLowerCase().includes(query) ||
        activity.creator.toLowerCase().includes(query) ||
        (activity.location && activity.location.toLowerCase().includes(query))
      );
    }

    if (selectedDate) {
      const formattedDate = selectedDate.toISOString().split('T')[0];
      filtered = filtered.filter(activity => activity.date === formattedDate);
    }

    if (isSortingByDistance && userLocation) {
      filtered.sort((a, b) =>
        calculateDistance(userLocation.latitude, userLocation.longitude, a.latitude, a.longitude) -
        calculateDistance(userLocation.latitude, userLocation.longitude, b.latitude, b.longitude)
      );
    }

    setFilteredActivities(filtered); // <-- This is the fix
  }, [allActivities, searchQuery, selectedFilter, selectedDate, isSortingByDistance, userLocation]);

  const getUserLocation = async () => {
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
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  const ActivityCard = ({ item, navigation }: { item: Activity; navigation: any }) => {
    const [isJoined, setIsJoined] = useState(item.isJoined);

    useEffect(() => {
      setIsJoined(item.isJoined);
    }, [item.isJoined]);

    const handleToggleJoin = async (item: Activity) => {
      try {
        await toggleJoinActivity(item);
        // Optionally, force a refresh or navigate to ChatsScreen
        // navigation.navigate('Chats');
      } catch (error) {
        console.error("Error toggling join state:", error);
      }
    };

    const handleJoinLeave = async () => {
      await toggleJoinActivity(item);
      setTimeout(() => {
        navigation.goBack(); // or any navigation action
      }, 150); // 150ms delay to allow state to update
    };

    const distance = userLocation
      ? `${calculateDistance(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude).toFixed(2)} km away`
      : "N/A";

    return (
      <TouchableOpacity 
        style={styles.card} 
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
          Participants: {item.joinedUserIds ? item.joinedUserIds.length : item.joinedCount} / {item.maxParticipants}
        </Text>
        <Text style={styles.distanceText}>{distance}</Text>
        <View style={styles.cardActions}>
          <TouchableOpacity 
            style={[styles.joinButton, isActivityJoined(item.id) && styles.joinButtonJoined]} 
            onPress={() => handleToggleJoin(item)}
          >
            <Text style={styles.joinButtonText}>
              {isActivityJoined(item.id) ? 'Leave' : 'Join'}
            </Text>
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

  const toggleSortByDistance = () => {
    setIsSortingByDistance((prev) => !prev);
  };

  if (refreshing || !allActivities || allActivities.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <ActivityIndicator size="large" color="#1ae9ef" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Text style={styles.headerTitle}>Discover Activities</Text>
      <View style={styles.topSection}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by sport or host..."
          placeholderTextColor="#bbb"
          onChangeText={setSearchQuery}
        />
        <View style={styles.sortButtons}>
          <TouchableOpacity
            style={[styles.sortButton, isSortingByDistance && styles.activeButton]}
            onPress={toggleSortByDistance}
          >
            <Text style={styles.sortButtonText}>Sort by Distance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sortButton}
            onPress={() => setDatePickerVisible(true)}
          >
            <Text style={styles.sortButtonText}>
              {selectedDate ? selectedDate.toDateString() : 'Select Date'}
            </Text>
          </TouchableOpacity>
          {selectedDate && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={async () => {
                setSelectedDate(null);
                await loadActivities();
              }}
            >
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        <ScrollView horizontal style={styles.filterWrapper}>
          {sportFilterOptions.map((option) => (
            <TouchableOpacity key={option} style={[styles.filterChip, selectedFilter === option && styles.filterChipActive]} onPress={() => setSelectedFilter(option)}>
              <Text style={styles.filterChipText}>{option}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      {filteredActivities.length === 0 && (
        <View style={{ alignItems: 'center', marginTop: 32, marginBottom: 12, paddingHorizontal: 24 }}>
          <Ionicons name="search-outline" size={48} color="#1ae9ef" style={{ marginBottom: 10 }} />
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
            No activities found
          </Text>
          <Text style={{ color: '#bbb', fontSize: 16, textAlign: 'center', marginBottom: 18 }}>
            Be the first to create an event in your area! 
            Others will be able to discover and join your activity from this page!
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('CreateGame')}
            style={{
              paddingVertical: 14,
              paddingHorizontal: 36,
              borderRadius: 24,
              backgroundColor: '#1ae9ef',
              shadowColor: '#1ae9ef',
              shadowOpacity: 0.4,
              shadowRadius: 8,
              elevation: 4,
            }}
            activeOpacity={0.85}
          >
            <Text style={{ color: '#121212', fontWeight: 'bold', fontSize: 17, letterSpacing: 0.5 }}>
              Create an Event
            </Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        data={filteredActivities}
        renderItem={({ item }) => (
          <ActivityCard item={item} navigation={navigation} />
        )}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={loadActivities} />
        }
        contentContainerStyle={styles.listContainer}
      />
      <DateTimePickerModal
        isVisible={isDatePickerVisible}
        mode="date"
        onConfirm={(date) => { setSelectedDate(date); setDatePickerVisible(false); }}
        onCancel={() => setDatePickerVisible(false)}
      />
    </SafeAreaView>
  );
};

export default DiscoverGamesScreen;


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121212',
  },
  topSection: {
    paddingHorizontal: 15, // Only horizontal padding, not vertical
  },
  headerTitle: {
    fontSize: 28,
    color: '#1ae9ef',
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  searchInput: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    padding: 10,
    color: '#fff',
    fontSize: 16,
    marginBottom: 10,
  },
  sortButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sortButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: '#333',
    borderRadius: 5,
    marginRight: 8,
  },
  activeButton: {
    backgroundColor: '#1ae9ef',
  },
  sortButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  clearButton: {
    backgroundColor: '#e74c3c',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginLeft: 5,
  },
  clearButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  filterWrapper: {
    flexDirection: 'row',
    marginVertical: 10,
  },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: '#333',
    borderRadius: 20,
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#1ae9ef',
  },
  filterChipText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  listContainer: {
    padding: 15,
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
    marginBottom: 5,
  },
  cardTitle: {
    fontSize: 18,
    color: '#1ae9ef',
    fontWeight: 'bold',
    marginLeft: 10,
  },
  cardInfo: {
    fontSize: 14,
    color: '#ccc',
    marginVertical: 2,
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
    backgroundColor: '#1ae9ef',  // Terea Turquoise for Join
    borderRadius: 5,
  },
  joinButtonJoined: {
    backgroundColor: '#007b7b',  // Darker Turquoise for Leave
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
  mapView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPlaceholder: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  debugContainer: {
    padding: 15,
    backgroundColor: '#121212',
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
  },
  debugTitle: {
    color: '#1ae9ef',
    fontWeight: 'bold',
    marginBottom: 10,
  },
  debugText: {
    color: '#ccc',
    fontSize: 12,
    lineHeight: 18,
  },
  distanceText: {
    color: '#1ae9ef',
    fontSize: 14,
    marginTop: 2,
    fontWeight: 'bold',
  },
  joinShareContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  iconButton: {
    padding: 8,
    backgroundColor: '#333',
    borderRadius: 8,
  },
  iconText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 5,
    textAlign: 'center',
  },
  distanceInfo: {
    color: '#1ae9ef',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 5,
  },
});

