// screens/CalendarScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform,
  StatusBar,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Animated,
  Alert,
} from 'react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { ActivityProvider, useActivityContext } from '../context/ActivityContext';
import { convertToCalendarFormat, normalizeDateFormat } from '../utils/storage';
import Ionicons from 'react-native-vector-icons/Ionicons'; // Import Ionicons
import { ActivityIcon } from '../components/ActivityIcons'; // ✅ Correct import
import { activities } from '../data/activitiesData';
import * as ExpoCalendar from 'expo-calendar';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';

const CalendarScreen = ({ navigation, route }: any) => {
  const { joinedActivities, allActivities, reloadAllActivities, toggleJoinActivity } = useActivityContext();
  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);
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

  // Load calendar status for all activities from Firebase
  useEffect(() => {
    const loadCalendarStatus = async () => {
      const currentUserId = auth.currentUser?.uid;
      if (!currentUserId || !allActivities.length) return;

      const statusMap: Record<string, boolean> = {};
      
      for (const activity of allActivities) {
        const activityRef = doc(db, 'activities', activity.id);
        const activitySnap = await getDoc(activityRef);
        if (activitySnap.exists()) {
          const data = activitySnap.data();
          const addedToCalendarIds = data.addedToCalendarByUsers || [];
          statusMap[activity.id] = addedToCalendarIds.includes(currentUserId);
        }
      }
      
      setCalendarStatus(statusMap);
    };
    
    loadCalendarStatus();
  }, [allActivities]);
  const insets = useSafeAreaInsets();

  // Today's date as "YYYY-MM-DD"
  const selectedDate = route.params?.selectedDate; // "YYYY-MM-DD"
  const selected = selectedDate ? new Date(selectedDate) : new Date();
  const [currentDate, setCurrentDate] = useState<string>(
    selected.toISOString().split('T')[0]
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [calendarStatus, setCalendarStatus] = useState<Record<string, boolean>>({});

  // Refresh handler
  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await reloadAllActivities(); // <-- reload from Firestore
    setTimeout(() => {
      setRefreshing(false);
      setRefreshLocked(false);
    }, 1500);
  };

  const getMarkedDates = () => {
    let marks: Record<string, any> = {};

    // Add dots for joined activities
    allActivities.forEach((activity) => {
      if (joinedActivities.includes(activity.id)) {
        const calendarDate = convertToCalendarFormat(activity.date);
        marks[calendarDate] = {
          marked: true,
          dots: [{ color: '#1ae9ef' }],
        };
      }
    });

    // Add a turquoise circle to the selected date
    if (currentDate) {
      const selectedCalendarDate = convertToCalendarFormat(currentDate);
      if (!marks[selectedCalendarDate]) {
        marks[selectedCalendarDate] = {
          selected: true,
          customStyles: {
            container: {
              backgroundColor: '#1ae9ef',
              borderRadius: 50,
            },
            text: {
              color: '#fff',
            },
          },
        };
      } else {
        marks[selectedCalendarDate].selected = true;
      }
    }

    return marks;
  };

  // Use the function to get marked dates
  const markedDates = getMarkedDates();

  // Handle date selection:
  const handleDayPress = (day: any) => {
    setCurrentDate(day.dateString); // Always use "YYYY-MM-DD"
  };

  // Filter activities for the selected date.
  const userJoinedActivities = allActivities.filter(a => joinedActivities.includes(a.id));
  const activitiesForDate = userJoinedActivities.filter(
    (activity) => convertToCalendarFormat(activity.date) === convertToCalendarFormat(currentDate)
  );

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
    return emojiMap[sport] || '⚽';
  };

  // Handle add to calendar
  const handleAddToCalendar = async (activity: any) => {
    // Check if already added to calendar
    if (calendarStatus[activity.id]) {
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
              await addToCalendar(activity);
            },
          },
        ],
        { cancelable: true }
      );
      return;
    }
    
    await addToCalendar(activity);
  };

  const addToCalendar = async (activity: any) => {
    try {
      // Request calendar permissions
      const { status } = await ExpoCalendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          "Permission Denied",
          "Calendar permission is required to add this activity to your calendar.",
          [{ text: "OK" }]
        );
        return;
      }

      // Get available calendars
      const calendars = await ExpoCalendar.getCalendarsAsync(ExpoCalendar.EntityTypes.EVENT);
      
      // Filter for writable calendars
      const writableCalendars = calendars.filter((cal: any) => cal.allowsModifications);
      
      if (writableCalendars.length === 0) {
        Alert.alert("No Calendar Available", "No writable calendar found on your device.");
        return;
      }

      // Show calendar selection dialog
      showCalendarPicker(writableCalendars, activity);
    } catch (error) {
      console.error("Error adding to calendar:", error);
      Alert.alert("Error", "Failed to add activity to calendar.");
    }
  };

  const showCalendarPicker = (calendars: any[], activity: any) => {
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
        onPress: async () => await createCalendarEvent(cal.id, activity),
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

  const createCalendarEvent = async (calendarId: string, activity: any) => {
    try {
      // Parse date and time
      const [year, month, day] = activity.date.split('-').map(Number);
      const [hours, minutes] = activity.time.split(':').map(Number);
      
      const startDate = new Date(year, month - 1, day, hours, minutes);
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

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
          { relativeOffset: -360 },
          { relativeOffset: -30 },
        ],
        calendarColor: '#1ae9ef',
      };

      const eventId = await ExpoCalendar.createEventAsync(calendarId, eventDetails);
      
      // Save to Firebase that this user added the activity to calendar
      const currentUserId = auth.currentUser?.uid;
      if (currentUserId) {
        const activityRef = doc(db, 'activities', activity.id);
        await updateDoc(activityRef, {
          addedToCalendarByUsers: arrayUnion(currentUserId)
        });
        
        // Update local state
        setCalendarStatus(prev => ({ ...prev, [activity.id]: true }));
      }
      
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

  console.log('Selected Date:', currentDate);
  console.log('Marked Dates:', markedDates);
  if (process.env.NODE_ENV !== 'production') {
    console.log('Joined Activities:', JSON.stringify(joinedActivities, null, 2));
  }

  useEffect(() => {
    if (joinedActivities && allActivities && allActivities.length > 0) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }
  }, [joinedActivities, allActivities]);

  if (!joinedActivities || !allActivities || allActivities.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <ActivityIndicator size="large" color="#1ae9ef" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <Text style={styles.headerTitle}>Calendar</Text>
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing || refreshLocked}
              onRefresh={onRefresh}
              colors={["#009fa3"]}
              tintColor="#009fa3"
              progressBackgroundColor="transparent"
            />
          }
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <Calendar
            initialDate={currentDate}
            theme={{
              backgroundColor: '#121212',
              calendarBackground: '#121212',
              textSectionTitleColor: '#1ae9ef',
              selectedDayBackgroundColor: '#1ae9ef',
              selectedDayTextColor: '#fff',
              dayTextColor: '#fff',
              todayTextColor: '#1ae9ef',
              arrowColor: '#1ae9ef',
              monthTextColor: '#fff',
            }}
            markedDates={markedDates}
            markingType={'custom'}
            onDayPress={handleDayPress}
          />
          <View style={styles.activitiesContainer}>
            {activitiesForDate.length > 0 ? (
              activitiesForDate.map((item: any) => {
                // Calculate distance if userLocation is available
                let distance = null;
                if (userLocation && item.latitude && item.longitude) {
                  const R = 6371;
                  const dLat = (item.latitude - userLocation.latitude) * Math.PI / 180;
                  const dLon = (item.longitude - userLocation.longitude) * Math.PI / 180;
                  const a = Math.sin(dLat / 2) ** 2 +
                    Math.cos(userLocation.latitude * Math.PI / 180) * Math.cos(item.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
                  distance = (R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))).toFixed(2);
                }
                // Simplify location
                const simplifyLocation = (location: string) => {
                  const parts = location.split(',').map(part => part.trim());
                  if (parts.length >= 2) {
                    return `${parts[0]}, ${parts[parts.length - 2] || parts[parts.length - 1]}`;
                  }
                  return location;
                };
                // Use top-level context values
                const isJoined = joinedActivities.includes(item.id);
                const handleToggleJoin = async () => {
                  await toggleJoinActivity(item);
                  // Reset calendar status when leaving activity
                  if (!joinedActivities.includes(item.id)) {
                    setCalendarStatus(prev => ({ ...prev, [item.id]: false }));
                  }
                };
                return (
                  <TouchableOpacity
                    key={item.id}
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
                    {/* ...existing code... */}
                    <View style={styles.cardActions}>
                      <TouchableOpacity
                        style={[styles.joinButton, isJoined && styles.joinButtonJoined]}
                        onPress={handleToggleJoin}
                      >
                        <Text style={styles.joinButtonText}>
                          {isJoined ? 'Leave' : 'Join'}
                        </Text>
                      </TouchableOpacity>
                      <View style={{ flex: 1 }} />
                      <TouchableOpacity
                        style={[styles.addToCalendarButton, calendarStatus[item.id] && styles.addToCalendarButtonAdded]}
                        onPress={() => handleAddToCalendar(item)}
                      >
                        <Ionicons 
                          name={calendarStatus[item.id] ? "checkmark-circle" : "calendar-outline"} 
                          size={16} 
                          color="#fff" 
                          style={{ marginRight: 6 }}
                        />
                        <Text style={styles.addToCalendarText}>
                          {calendarStatus[item.id] ? "Added to Calendar" : "Add to Calendar"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.shareButton}
                        onPress={() => console.log(`Share event ${item.id}`)}
                      >
                        <Ionicons name="share-social-outline" size={20} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })
            ) : (
              <Text style={styles.noActivitiesText}>
                No activities scheduled for this day.
              </Text>
            )}
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
  safeArea: {
    flex: 1,
    backgroundColor: '#121212',
  },
  headerTitle: {
    fontSize: 28,
    color: '#1ae9ef',
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  activitiesContainer: {
    marginTop: 20,
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
  addToCalendarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#1ae9ef',
    borderRadius: 5,
    marginTop: 8,
    marginBottom: 4,
  },
  addToCalendarButtonAdded: {
    backgroundColor: '#007b7b',
  },
  addToCalendarText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  shareButton: {
    padding: 8,
    backgroundColor: '#1e1e1e',
    borderRadius: 5,
  },
  noActivitiesText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
    fontWeight: '500',
  },
});

export default React.memo(CalendarScreen);