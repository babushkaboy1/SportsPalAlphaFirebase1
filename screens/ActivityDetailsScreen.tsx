import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Linking,
  Platform,
  StatusBar,
  Image,
  InteractionManager,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useActivityContext } from '../context/ActivityContext';
import MapView, { Marker, UrlTile, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activities } from '../data/activitiesData';
import { fetchUsersByIds } from '../utils/firestoreActivities';
import { getOrCreateChatForActivity } from '../utils/firestoreChats';
import { auth } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';

const ActivityDetailsScreen = ({ route, navigation }: any) => {
  const { activityId } = route.params;
  const { allActivities, isActivityJoined, toggleJoinActivity } = useActivityContext();

  const activity = allActivities.find(a => a.id === activityId);

  if (!activity) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
        <Text style={{ color: '#fff', fontSize: 18 }}>Activity not found.</Text>
      </SafeAreaView>
    );
  }

  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const [joinedUsers, setJoinedUsers] = useState<any[]>([]);
  const [isReady, setIsReady] = useState(false);
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();

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
    const loadUsers = async () => {
      // Always fetch the latest activity from Firestore
      const activityRef = doc(db, 'activities', activity.id);
      const activitySnap = await getDoc(activityRef);
      let latestJoinedUserIds: string[] = [];
      if (activitySnap.exists()) {
        const data = activitySnap.data();
        latestJoinedUserIds = Array.isArray(data.joinedUserIds) ? data.joinedUserIds : [];
      }
      if (latestJoinedUserIds.length) {
        const users = await fetchUsersByIds(latestJoinedUserIds);
        setJoinedUsers(users);
      } else {
        setJoinedUsers([]);
      }
      setIsReady(true);
    };
    loadUsers();
  }, [activityId]);

  // Calculate distance in km
  const getDistance = () => {
    if (!userLocation) return null;
    const toRad = (value: number) => (value * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(activity.latitude - userLocation.latitude);
    const dLon = toRad(activity.longitude - userLocation.longitude);
    const lat1 = toRad(userLocation.latitude);
    const lat2 = toRad(activity.latitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return (R * c).toFixed(2);
  };

  // Navigate to Chat screen
  const handleChat = () => {
    navigation.navigate('Chat', { activityId: activity.id });
  };

  // Get directions using the preferred maps app
  const handleGetDirections = async () => {
    let currentLocation;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Location Permission Denied", "Permission to access location was denied.");
        return;
      }
      const locationResult = await Location.getCurrentPositionAsync({});
      currentLocation = `${locationResult.coords.latitude},${locationResult.coords.longitude}`;
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Could not fetch your current location.");
      return;
    }
    const destination = `${activity.latitude},${activity.longitude}`;
    Alert.alert(
      'Choose Map',
      'Select which map app to use for directions.',
      [
        {
          text: 'Google Maps',
          onPress: () => {
            const url = `https://www.google.com/maps/dir/?api=1&origin=${currentLocation}&destination=${destination}&travelmode=driving`;
            Linking.openURL(url);
          },
        },
        {
          text: 'Apple Maps',
          onPress: () => {
            const url = `http://maps.apple.com/?saddr=${currentLocation}&daddr=${destination}&dirflg=d`;
            Linking.openURL(url);
          },
        },
        {
          text: 'Waze',
          onPress: () => {
            const url = `https://waze.com/ul?ll=${destination}&navigate=yes`;
            Linking.openURL(url);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  const handleJoinLeave = async () => {
    await toggleJoinActivity(activity);

    // Refetch the latest activity from Firestore
    const activityRef = doc(db, 'activities', activity.id);
    const activitySnap = await getDoc(activityRef);
    let latestJoinedUserIds: string[] = [];
    if (activitySnap.exists()) {
      const data = activitySnap.data();
      latestJoinedUserIds = Array.isArray(data.joinedUserIds) ? data.joinedUserIds : [];
    }

    // Now fetch the latest users
    if (latestJoinedUserIds.length) {
      const users = await fetchUsersByIds(latestJoinedUserIds);
      setJoinedUsers(users);
    } else {
      setJoinedUsers([]);
    }
  };

  const handleOpenGroupChat = async () => {
    if (!auth.currentUser) {
      Alert.alert(
        "Not Signed In",
        "You need to be signed in to access the group chat.",
        [{ text: "OK", style: "destructive" }]
      );
      return;
    }

    if (!isActivityJoined(activity.id)) {
      Alert.alert(
        "Join to Access Group Chat",
        "You need to join this activity to access the group chat.",
        [
          {
            text: "Cancel",
            style: "destructive",
          },
          {
            text: "Join Activity",
            style: "default",
            onPress: async () => {
              await toggleJoinActivity(activity);
              // After joining, get or create the chat and navigate
              if (auth.currentUser) {
                const chatId = await getOrCreateChatForActivity(activity.id, auth.currentUser.uid);
                navigation.navigate('ChatDetail', { chatId });
              }
            },
          },
        ],
        { cancelable: true }
      );
      return;
    }
    // If joined, get or create the chat and navigate
    const chatId = await getOrCreateChatForActivity(activity.id, auth.currentUser.uid);
    navigation.navigate('ChatDetail', { chatId });
  };

  useEffect(() => {
    const setupChat = async () => {
      if (auth.currentUser && isActivityJoined(activityId)) {
        await getOrCreateChatForActivity(activityId, auth.currentUser.uid);
      }
    };

    setupChat();
  }, [activityId, isActivityJoined(activityId)]);

  if (!isReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1ae9ef" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
  <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backButton, { left: 16, position: 'absolute', zIndex: 10 }]}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={28} color="#1ae9ef" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Activity Details</Text>
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        {/* Map Overview */}
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={{ flex: 1, borderRadius: 10 }}
            provider={Platform.OS === 'android' ? PROVIDER_DEFAULT : undefined}
            initialRegion={{
              latitude: activity.latitude,
              longitude: activity.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
            showsUserLocation={!!userLocation}
            showsMyLocationButton={false}
          >
            {Platform.OS === 'android' && (
              <UrlTile
                urlTemplate="https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maximumZ={19}
                flipY={false}
              />
            )}
            <Marker
              coordinate={{
                latitude: activity.latitude,
                longitude: activity.longitude,
              }}
              title={activity.activity}
              description={activity.location}
            />
          </MapView>
          {userLocation && (
            <TouchableOpacity
              style={styles.myLocationButton}
              onPress={() => {
                mapRef.current?.animateToRegion({
                  latitude: userLocation.latitude,
                  longitude: userLocation.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                });
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="locate" size={28} color="#1ae9ef" />
            </TouchableOpacity>
          )}
        </View>

        {/* Activity Information */}
        <View style={styles.infoContainer}>
          <Text style={styles.title}>{activity.activity}</Text>
          <Text style={styles.location}>{activity.location}</Text>
          {userLocation && (
            <Text style={styles.distanceText}>
              {getDistance()} km away
            </Text>
          )}
          <Text style={styles.detail}>
            Date: {activity.date} at {activity.time}
          </Text>
          <Text style={styles.detail}>Hosted by: {activity.creator}</Text>
          <View style={styles.joinContainer}>
            <Text style={styles.joinText}>
              {(activity.joinedUserIds?.length ?? activity.joinedCount)}/{activity.maxParticipants} joined
            </Text>
          </View>
          <Text style={styles.description}>
            Stay active and make new friends by joining this exciting {activity.activity} event!
          </Text>

          {/* Participants List */}
          <View style={{ marginVertical: 10 }}>
            <Text style={{ color: '#1ae9ef', fontWeight: 'bold', fontSize: 16, marginBottom: 8 }}>
              Participants
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {joinedUsers.map(user => (
                <TouchableOpacity
                  key={user.uid}
                  style={{ alignItems: 'center', marginRight: 16 }}
                  onPress={() => {
                    if (user.uid === auth.currentUser?.uid) {
                      navigation.navigate('MainTabs', { screen: 'Profile' });
                    } else {
                      navigation.navigate('UserProfile', { userId: user.uid });
                    }
                  }}
                >
                  <Image
                    source={{ uri: user.photo || user.photoURL || 'https://ui-avatars.com/api/?name=' + (user.username || 'User') }}
                    style={{ width: 54, height: 54, borderRadius: 27, borderWidth: 2, borderColor: '#1ae9ef' }}
                  />
                  <Text style={{ color: '#fff', marginTop: 6, fontWeight: 'bold' }}>{user.username}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                isActivityJoined(activity.id) && styles.actionButtonJoined,
              ]}
              onPress={handleJoinLeave}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.actionText,
                  isActivityJoined(activity.id) && styles.actionTextJoined,
                ]}
              >
                {isActivityJoined(activity.id) ? 'Leave Activity' : 'Join Activity'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton} onPress={handleOpenGroupChat}>
              <Ionicons name="chatbubbles" size={20} style={styles.actionIconBold} />
              <Text style={styles.actionText}>Group Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={handleGetDirections}>
              <Ionicons name="navigate" size={24} style={styles.actionIconBold} />
              <Text style={styles.actionText}>Get Directions</Text>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate("MainTabs", { screen: "Discover" })}>
          <Text>Go to Discover</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ActivityDetailsScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121212',
    position: 'relative',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 28,
    color: '#1ae9ef',
    fontWeight: 'bold',
    textAlign: 'center',
    flex: 1,
  },
  mapContainer: {
    height: 250,
    width: '100%',
    marginVertical: 10,
    borderRadius: 10,
    overflow: 'hidden',
  },
  infoContainer: {
    paddingHorizontal: 15,
    paddingVertical: 15,
  },
  title: {
    color: '#1ae9ef',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  location: {
    color: '#ccc',
    fontSize: 16,
    marginBottom: 10,
  },
  distanceText: {
    color: '#1ae9ef',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 10,
  },
  detail: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 5,
  },
  joinContainer: {
    marginVertical: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
  },
  joinText: {
    color: '#1ae9ef',
    fontSize: 16,
    fontWeight: 'bold',
  },
  description: {
    color: '#ccc',
    fontSize: 14,
    marginTop: 15,
    lineHeight: 20,
  },
  actionsContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  actionButton: {
    flexDirection: 'row',
    backgroundColor: '#1ae9ef',  // Terea Turquoise for Join
    padding: 15,
    borderRadius: 8,
    marginVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
    width: '90%',
  },
  actionButtonJoined: {
    backgroundColor: '#007b7b',  // Darker Turquoise for Leave
  },
  actionText: {
    color: '#121212',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1.1,
  },
  actionTextJoined: {
    color: '#fff',
  },
  actionIcon: {
    color: '#121212',
  },
  actionIconBold: {
    color: '#121212',
    fontWeight: 'bold',
    marginRight: 6,
  },
  myLocationButton: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    backgroundColor: '#1e1e1e',
    borderRadius: 24,
    padding: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    zIndex: 10,
  },
});
