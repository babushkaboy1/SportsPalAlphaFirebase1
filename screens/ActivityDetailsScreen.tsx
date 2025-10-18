import React, { useState, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
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
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Calendar from 'expo-calendar';
import { useActivityContext } from '../context/ActivityContext';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activities } from '../data/activitiesData';
import { fetchUsersByIds } from '../utils/firestoreActivities';
import { getOrCreateChatForActivity } from '../utils/firestoreChats';
import { auth } from '../firebaseConfig';
import { testStorageConnection } from '../utils/imageUtils';
import { doc, getDoc, updateDoc, arrayUnion, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { ActivityIcon } from '../components/ActivityIcons';
import { sendActivityInvites } from '../utils/firestoreInvites';

const ActivityDetailsScreen = ({ route, navigation }: any) => {
  const { activityId } = route.params;
  const { allActivities, isActivityJoined, toggleJoinActivity, profile } = useActivityContext();

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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const [isAddedToCalendar, setIsAddedToCalendar] = useState(false);
  // Invite friends modal state
  const [inviteFriendsVisible, setInviteFriendsVisible] = useState(false);
  const [friendProfiles, setFriendProfiles] = useState<any[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Record<string, boolean>>({});
  const [noSelectionHintVisible, setNoSelectionHintVisible] = useState(false);
  const noSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
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
        
        // Check if current user has added this activity to their calendar
        const currentUserId = auth.currentUser?.uid;
        if (currentUserId) {
          const addedToCalendarIds = data.addedToCalendarByUsers || [];
          setIsAddedToCalendar(addedToCalendarIds.includes(currentUserId));
        }
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
    // Live update participants and calendar-added state
    const activityRef = doc(db, 'activities', activity.id);
    const unsub = onSnapshot(activityRef, async (snap) => {
      if (!snap.exists()) return;
      const data: any = snap.data();
      const latestJoined = Array.isArray(data.joinedUserIds) ? data.joinedUserIds : [];
      if (latestJoined.length) {
        const users = await fetchUsersByIds(latestJoined);
        setJoinedUsers(users);
      } else {
        setJoinedUsers([]);
      }
      const currentUserId = auth.currentUser?.uid;
      if (currentUserId) {
        const addedToCalendarIds = data.addedToCalendarByUsers || [];
        setIsAddedToCalendar(addedToCalendarIds.includes(currentUserId));
      }
    }, (error) => {
      if ((error as any)?.code !== 'permission-denied') {
        console.warn('Activity snapshot error:', error);
      }
    });
    return () => unsub();
  }, [activity.id]);

  // Fade in immediately on mount
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, []);

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

  // Simplify location to show only first part and city
  const simplifyLocation = (location: string) => {
    const parts = location.split(',').map(part => part.trim());
    if (parts.length >= 2) {
      return `${parts[0]}, ${parts[parts.length - 2] || parts[parts.length - 1]}`;
    }
    return location;
  };

  // Invite Friends helpers
  const joinedUserIds = Array.isArray((activity as any).joinedUserIds)
    ? (activity as any).joinedUserIds as string[]
    : (joinedUsers?.map((u: any) => u.uid) || []);
  const myFriendIds: string[] = Array.isArray(profile?.friends) ? profile.friends : [];

  useEffect(() => {
    // Load friend profiles when friends list changes or when opening modal
    const loadFriends = async () => {
      try {
        if (myFriendIds.length) {
          const users = await fetchUsersByIds(myFriendIds);
          setFriendProfiles(users);
        } else {
          setFriendProfiles([]);
        }
      } catch (e) {
        setFriendProfiles([]);
      }
    };
    loadFriends();
  }, [JSON.stringify(myFriendIds)]);

  const openInviteFriends = () => {
    setSelectedFriendIds({});
    setInviteFriendsVisible(true);
  };

  const toggleSelectFriend = (uid: string, disabled: boolean) => {
    if (disabled) return;
    setSelectedFriendIds((prev) => ({ ...prev, [uid]: !prev[uid] }));
  };

  const confirmInviteFriends = async () => {
    const selected = Object.keys(selectedFriendIds).filter((id) => selectedFriendIds[id]);
    if (selected.length === 0) {
      // Show a minimal bottom hint instead of closing the modal
      setNoSelectionHintVisible(true);
      if (noSelectionTimerRef.current) clearTimeout(noSelectionTimerRef.current);
      noSelectionTimerRef.current = setTimeout(() => setNoSelectionHintVisible(false), 1800);
      return;
    }
    // Send invites for this single activity to each selected friend
    let sent = 0;
    let skipped = 0;
    await Promise.all(
      selected.map(async (friendId) => {
        try {
          const res = await sendActivityInvites(friendId, [activity.id]);
          if ((res?.sentIds || []).length > 0) sent += 1; else skipped += 1;
        } catch {
          skipped += 1;
        }
      })
    );
    setInviteFriendsVisible(false);
    if (sent > 0 || skipped > 0) {
      const msg = sent > 0
        ? `Sent invites to ${sent} friend${sent === 1 ? '' : 's'}${skipped ? ` (skipped ${skipped} already joined)` : ''}.`
        : `No invites sent. ${skipped} skipped (already joined).`;
      Alert.alert('Invites', msg);
    }
  };

  // Get sport-specific emoji for calendar event
  const getSportEmoji = (sport: string): string => {
    const emojiMap: { [key: string]: string } = {
      'Basketball': '🏀',
      'Soccer': '⚽',
      'Running': '🏃',
      'Gym': '🏋️',
      'Calisthenics': '💪',
      'Padel': '🎾',
      'Tennis': '🎾',
      'Cycling': '🚴',
      'Swimming': '🏊',
      'Badminton': '🏸',
      'Volleyball': '🏐',
    };
    return emojiMap[sport] || '⚽'; // Default to soccer ball if sport not found
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
        'Join to Access Group Chat',
        'You need to join this activity to access the group chat.',
        [
          { text: 'Cancel', style: 'destructive' },
          { text: 'Join Activity', onPress: joinAndOpenChat },
        ],
        { cancelable: true }
      );
      return;
    }
    // If joined, get or create the chat and navigate
    // Extra safety: block if somehow not joined
    if (!isActivityJoined(activity.id)) {
      Alert.alert("Join required", "Join this activity to access its group chat.");
      return;
    }
    const chatId = await getOrCreateChatForActivity(activity.id, auth.currentUser.uid);
    if (!chatId) {
      Alert.alert('Chat unavailable', 'Could not open group chat. Please try again in a moment.');
      return;
    }
    try {
      await waitUntilParticipant(chatId, auth.currentUser.uid);
    } catch {}
    navigation.navigate('ChatDetail', { chatId });
  };

  // Reusable: join activity and open chat
  const joinAndOpenChat = async () => {
    try {
      await toggleJoinActivity(activity);
      if (auth.currentUser) {
        try {
          await waitUntilJoinedToActivity(activity.id, auth.currentUser.uid);
        } catch {}
        const chatId = await getOrCreateChatForActivity(activity.id, auth.currentUser.uid);
        if (!chatId) {
          Alert.alert('Chat unavailable', 'Could not open group chat. Please try again in a moment.');
          return;
        }
        try {
          await waitUntilParticipant(chatId, auth.currentUser.uid);
        } catch {}
        navigation.navigate('ChatDetail', { chatId });
      }
    } finally {
    }
  };

  // Helper: wait briefly until chat doc shows current user in participants
  const waitUntilParticipant = (chatId: string, uid: string, timeoutMs = 2000) => {
    return new Promise<void>((resolve, reject) => {
      const ref = doc(db, 'chats', chatId);
      const unsub = onSnapshot(ref, (snap) => {
        const data: any = snap.data();
        if (snap.exists() && Array.isArray(data?.participants) && data.participants.includes(uid)) {
          unsub();
          resolve();
        }
      }, (err) => {
        unsub();
        resolve(); // don't block navigation on listener error
      });
      setTimeout(() => {
        try { unsub(); } catch {}
        resolve();
      }, timeoutMs);
    });
  };

  // Helper: wait until activity doc joinedUserIds includes current user
  const waitUntilJoinedToActivity = (actId: string, uid: string, timeoutMs = 2000) => {
    return new Promise<void>((resolve) => {
      const ref = doc(db, 'activities', actId);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) return;
          const data: any = snap.data();
          const joined = Array.isArray(data?.joinedUserIds) ? data.joinedUserIds : [];
          if (joined.includes(uid)) {
            try { unsub(); } catch {}
            resolve();
          }
        },
        () => {
          try { unsub(); } catch {}
          resolve();
        }
      );
      setTimeout(() => {
        try { unsub(); } catch {}
        resolve();
      }, timeoutMs);
    });
  };

  const handleAddToCalendar = async () => {
    // Check if user has joined the activity first
    if (!isActivityJoined(activity.id)) {
      Alert.alert(
        "Join to Add to Calendar",
        "You need to join this activity before adding it to your calendar.",
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Join Activity",
            style: "default",
            onPress: async () => {
              await toggleJoinActivity(activity);
              // After joining, proceed to add to calendar
              setTimeout(() => {
                addToCalendar();
              }, 500);
            },
          },
        ],
        { cancelable: true }
      );
      return;
    }
    
    // Check if already added to calendar
    if (isAddedToCalendar) {
      Alert.alert(
        "Already Added",
        "This event is already in your calendar. Want to add it to another calendar account or add it again?",
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Add Again",
            style: "default",
            onPress: async () => {
              await addToCalendar();
            },
          },
        ],
        { cancelable: true }
      );
      return;
    }
    
    // If already joined and not yet added, proceed directly
    await addToCalendar();
  };

  const addToCalendar = async () => {
    try {
      // Request calendar permissions
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          "Permission Denied",
          "Calendar permission is required to add this activity to your calendar.",
          [{ text: "OK" }]
        );
        return;
      }

      // Get available calendars
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      
      // Filter for writable calendars
      const writableCalendars = calendars.filter((cal: any) => cal.allowsModifications);
      
      if (writableCalendars.length === 0) {
        Alert.alert("No Calendar Available", "No writable calendar found on your device.");
        return;
      }

      // Show calendar selection dialog
      showCalendarPicker(writableCalendars);
    } catch (error) {
      console.error("Error adding to calendar:", error);
      Alert.alert("Error", "Failed to add activity to calendar.");
    }
  };

  const showCalendarPicker = (calendars: any[]) => {
    // Group calendars by source (Apple, Google, Outlook, etc.)
    const calendarOptions = calendars.map((cal) => {
      let accountType = cal.source.name || cal.source.type || 'Local';
      // Simplify common calendar source names
      if (accountType.toLowerCase().includes('icloud') || accountType.toLowerCase().includes('ios')) {
        accountType = 'Apple';
      } else if (accountType.toLowerCase().includes('google')) {
        accountType = 'Google';
      } else if (accountType.toLowerCase().includes('outlook') || accountType.toLowerCase().includes('microsoft')) {
        accountType = 'Outlook';
      } else if (accountType.toLowerCase().includes('samsung')) {
        accountType = 'Samsung';
      }
      
      return {
        text: `${accountType} - ${cal.title}`,
        onPress: () => createCalendarEvent(cal.id),
      };
    });

    calendarOptions.push({
      text: "Cancel",
      onPress: async () => {},
    });

    Alert.alert(
      "Choose Calendar",
      "Select which calendar account to add this event to:",
      calendarOptions,
      { cancelable: true }
    );
  };

  const createCalendarEvent = async (calendarId: string) => {
    try {
      // Parse date and time
      const [year, month, day] = activity.date.split('-').map(Number);
      const [hours, minutes] = activity.time.split(':').map(Number);
      
      const startDate = new Date(year, month - 1, day, hours, minutes);
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000); // Default 2 hours duration

      // Get sport-specific emoji
      const sportEmoji = getSportEmoji(activity.activity);

      // Create event details
      const eventDetails = {
        title: `${sportEmoji} ${activity.activity} Session`,
        startDate: startDate,
        endDate: endDate,
        location: activity.location,
        notes: `${activity.activity} session organized via SportsPal\n\nLocation: ${activity.location}\nDate: ${activity.date}\nTime: ${activity.time}`,
        alarms: [
          { relativeOffset: -360 }, // 6 hours before
          { relativeOffset: -30 },  // 30 minutes before
        ],
        // Set turquoise color for the event (iOS Calendar color)
        // Note: Android Google Calendar doesn't support custom colors via this API,
        // but iOS Calendar will display it in turquoise
        calendarColor: '#1ae9ef',
      };

      const eventId = await Calendar.createEventAsync(calendarId, eventDetails);
      // Save to Firebase that this user added the activity to calendar, with eventId
      const currentUserId = auth.currentUser?.uid;
      if (currentUserId) {
        const activityRef = doc(db, 'activities', activity.id);
        // Fetch latest calendarEventIds from Firestore
        const activitySnap = await getDoc(activityRef);
        let calendarEventIds: Record<string, string> = {};
        if (activitySnap.exists()) {
          const data = activitySnap.data();
          calendarEventIds = (data.calendarEventIds as Record<string, string>) || {};
        }
        calendarEventIds[currentUserId] = eventId;
        await updateDoc(activityRef, {
          addedToCalendarByUsers: arrayUnion(currentUserId),
          calendarEventIds
        });
      }
      setIsAddedToCalendar(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Added to Calendar! 📅",
        `${activity.activity} has been added to your calendar with reminders at 6 hours and 30 minutes before the event.`,
        [{ text: "OK" }]
      );
    } catch (error) {
      console.error("Error creating calendar event:", error);
      Alert.alert("Error", "Failed to create calendar event.");
    }
  };

  useEffect(() => {
    const setupChat = async () => {
      if (auth.currentUser && isActivityJoined(activityId)) {
        await getOrCreateChatForActivity(activityId, auth.currentUser.uid);
      }
    };

    setupChat();
  }, [activityId, isActivityJoined(activityId)]);

  useEffect(() => {
    if (isReady) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }
  }, [isReady]);

  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Refetch the latest activity from Firestore
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
    setTimeout(() => {
      setRefreshing(false);
      setRefreshLocked(false);
    }, 1500);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={[styles.backButton, { left: 16, position: 'absolute', zIndex: 10 }]}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={28} color="#1ae9ef" />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <ActivityIcon activity={activity.activity} size={28} />
            <Text style={styles.headerTitle}>{activity.activity} Details</Text>
          </View>
        </View>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || refreshLocked}
              onRefresh={onRefresh}
              colors={["#009fa3"]}
              tintColor="#009fa3"
              progressBackgroundColor="transparent"
            />
          }
        >
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
              <>
                <TouchableOpacity
                  style={[styles.myLocationButton, { position: 'absolute', bottom: 16, right: 16 }]}
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
                <TouchableOpacity
                  style={[styles.activityLocationButton, { position: 'absolute', bottom: 70, right: 16 }]}
                  onPress={() => {
                    mapRef.current?.animateToRegion({
                      latitude: activity.latitude,
                      longitude: activity.longitude,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    });
                  }}
                  activeOpacity={0.7}
                >
                  <ActivityIcon activity={activity.activity} size={28} color="#1ae9ef" />
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Activity Information */}
          <View style={styles.infoContainer}>
            {/* Distance */}
            {userLocation && (
              <View style={styles.infoRow}>
                <Ionicons name="navigate" size={16} color="#1ae9ef" style={styles.infoIcon} />
                <Text style={styles.infoLabel}>Distance:</Text>
                <Text style={styles.infoValue}>{getDistance()} km away</Text>
              </View>
            )}
            
            {/* Host */}
            <View style={styles.infoRow}>
              <Ionicons name="person" size={16} color="#1ae9ef" style={styles.infoIcon} />
              <Text style={styles.infoLabel}>Host:</Text>
              <Text style={styles.infoValue}>{activity.creator}</Text>
            </View>
            
            {/* Location */}
            <View style={styles.infoRow}>
              <Ionicons name="location" size={16} color="#1ae9ef" style={styles.infoIcon} />
              <Text style={styles.infoLabel}>Location:</Text>
              <Text style={styles.infoValue}>{simplifyLocation(activity.location)}</Text>
            </View>
            
            {/* Date */}
            <View style={styles.infoRow}>
              <Ionicons name="calendar" size={16} color="#1ae9ef" style={styles.infoIcon} />
              <Text style={styles.infoLabel}>Date:</Text>
              <Text style={styles.infoValue}>{activity.date}</Text>
            </View>
            
            {/* Time */}
            <View style={styles.infoRow}>
              <Ionicons name="time" size={16} color="#1ae9ef" style={styles.infoIcon} />
              <Text style={styles.infoLabel}>Time:</Text>
              <Text style={styles.infoValue}>{activity.time}</Text>
            </View>
            
            {/* Activity Description */}
            {(activity as any).description && (
              <View style={styles.descriptionSection}>
                <Text style={styles.descriptionTitle}>Activity Description</Text>
                <Text style={styles.description}>
                  {(activity as any).description}
                </Text>
              </View>
            )}
            
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

            {/* Participant Count Bar */}
            <View style={styles.joinContainer}>
              <Text style={styles.joinText}>
                {joinedUsers.length}/{activity.maxParticipants} joined
              </Text>
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

              <TouchableOpacity style={styles.actionButton} onPress={openInviteFriends}>
                  <Ionicons name="person-add" size={20} style={styles.actionIconBold} />
                  <Text style={styles.actionText}>Invite Friends</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionButton} onPress={handleOpenGroupChat}>
                <Ionicons name="chatbubbles" size={20} style={styles.actionIconBold} />
                <Text style={styles.actionText}>Group Chat</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[
                  styles.actionButton,
                  isAddedToCalendar && styles.actionButtonAddedToCalendar,
                ]} 
                onPress={handleAddToCalendar}
              >
                <Ionicons 
                  name={isAddedToCalendar ? "checkmark-circle" : "calendar-outline"} 
                  size={20} 
                  style={[
                    styles.actionIconBold,
                    isAddedToCalendar && styles.actionIconAddedToCalendar,
                  ]} 
                />
                <Text 
                  style={[
                    styles.actionText,
                    isAddedToCalendar && styles.actionTextAddedToCalendar,
                  ]}
                >
                  {isAddedToCalendar ? "Added to Calendar" : "Add to Calendar"}
                </Text>
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
      </Animated.View>
      {/* Invite Friends Modal */}
      <Modal
        visible={inviteFriendsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteFriendsVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setInviteFriendsVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Friends</Text>
              <TouchableOpacity onPress={() => setInviteFriendsVisible(false)}>
                <Ionicons name="close" size={22} color="#9aa0a6" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Select friends to invite to this activity</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {friendProfiles.length === 0 && (
                <Text style={{ color: '#9aa0a6', textAlign: 'center', marginVertical: 20 }}>
                  No friends yet.
                </Text>
              )}
              {friendProfiles.map((f) => {
                const alreadyJoined = joinedUserIds.includes(f.uid);
                const selected = !!selectedFriendIds[f.uid];
                return (
                  <TouchableOpacity
                    key={f.uid}
                    style={[styles.friendRow, alreadyJoined && { opacity: 0.45 }]}
                    onPress={() => toggleSelectFriend(f.uid, alreadyJoined)}
                    disabled={alreadyJoined}
                    activeOpacity={0.7}
                  >
                    <View style={styles.friendLeft}>
                      <Image
                        source={{ uri: f.photo || f.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(f.username || 'User')}` }}
                        style={styles.friendAvatar}
                      />
                      <View>
                        <Text style={styles.friendName}>{f.username || 'User'}</Text>
                        {alreadyJoined && (
                          <Text style={styles.friendMeta}>Already joined</Text>
                        )}
                      </View>
                    </View>
                    {!alreadyJoined && (
                      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                        {selected && <Ionicons name="checkmark" size={16} color="#121212" />}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setInviteFriendsVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={confirmInviteFriends}>
                <Ionicons name="send" size={18} color="#121212" />
                <Text style={styles.modalConfirmText}>Send Invites</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
          {noSelectionHintVisible && (
            <View style={styles.bottomToast} pointerEvents="none">
              <Text style={styles.bottomToastText}>No friends selected</Text>
            </View>
          )}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

export default ActivityDetailsScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121212',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2c',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalSubtitle: {
    color: '#9aa0a6',
    marginBottom: 12,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2c',
  },
  friendLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#1ae9ef',
  },
  friendName: {
    color: '#fff',
    fontWeight: '600',
  },
  friendMeta: {
    color: '#9aa0a6',
    fontSize: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#1ae9ef',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#1ae9ef',
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  modalCancel: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#2b0f12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#5a1a1f',
  },
  modalCancelText: {
    color: '#ff4d4f',
    fontWeight: '700',
  },
  modalConfirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1ae9ef',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  modalConfirmText: {
    color: '#121212',
    fontWeight: '700',
  },
  bottomToast: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    alignItems: 'center',
  },
  bottomToastText: {
    backgroundColor: 'rgba(26, 233, 239, 0.18)',
    color: '#cdeff0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    overflow: 'hidden',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121212',
    position: 'relative',
    marginTop: 10,
    marginBottom: 18,
  },
  backButton: {
    padding: 4,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 28,
    color: '#1ae9ef',
    fontWeight: 'bold',
    textAlign: 'center',
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: '#1ae9ef',
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
  },
  infoIcon: {
    marginRight: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: '#1ae9ef',
    fontWeight: '600',
    marginRight: 6,
  },
  infoValue: {
    fontSize: 14,
    color: '#ccc',
    fontWeight: '500',
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
  descriptionSection: {
    marginTop: 15,
    marginBottom: 10,
  },
  descriptionTitle: {
    color: '#1ae9ef',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    color: '#ccc',
    fontSize: 14,
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
  actionButtonAddedToCalendar: {
    backgroundColor: '#007b7b',  // Darker Turquoise for Added to Calendar
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
  actionTextAddedToCalendar: {
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
  actionIconAddedToCalendar: {
    color: '#fff',
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
  activityLocationButton: {
    backgroundColor: '#1e1e1e',
    borderRadius: 24,
    padding: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    marginBottom: 10,
    zIndex: 10,
  },
});
