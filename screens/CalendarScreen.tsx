
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

// ...existing code...

function HostUsername({ activity }: { activity: any }) {
  const [username, setUsername] = useState('');
  useEffect(() => {
    let mounted = true;
    const fetchUsername = async () => {
      // Use auth from firebaseConfig
      const { auth } = require('../firebaseConfig');
      const currentUserId = auth.currentUser?.uid;
      let name = activity.creator;
      if (currentUserId && activity.creatorId === currentUserId) {
        name = 'You';
      }
      if (!name || name === 'You') {
        // fallback to getDisplayCreatorUsername for edge cases
        name = await getDisplayCreatorUsername(activity.creatorId, activity.creator);
      }
      if (mounted) setUsername(name);
    };
    fetchUsername();
    return () => { mounted = false; };
  }, [activity.creatorId, activity.creator]);
  return <Text style={styles.cardInfo}>{username}</Text>;
}
// screens/CalendarScreen.tsx
import { getDisplayCreatorUsername } from '../utils/getDisplayCreatorUsername';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Animated,
  Alert,
} from 'react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { useActivityContext } from '../context/ActivityContext';
import { normalizeDateFormat } from '../utils/storage';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { ActivityIcon } from '../components/ActivityIcons';
import * as ExpoCalendar from 'expo-calendar';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';

/* ---------- Helpers (module-level) ---------- */

const simplifyLocation = (location: string) => {
  const parts = location.split(',').map(p => p.trim());
  if (parts.length >= 2) return `${parts[0]}, ${parts[parts.length - 2] || parts[parts.length - 1]}`;
  return location;
};

const kmDistance = (
  from: { latitude: number; longitude: number } | null,
  to: { latitude: number; longitude: number } | null
) => {
  if (!from || !to) return null;
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return (R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))).toFixed(2);
};

const getSportEmoji = (sport: string): string => {
  const emojiMap: Record<string, string> = {
    Basketball: '🏀',
    Soccer: '⚽',
    Running: '🏃',
    Gym: '🏋️',
    Calisthenics: '💪',
    Padel: '🎾',
    Tennis: '🎾',
    Cycling: '🚴',
    Swimming: '🏊',
    Badminton: '🏸',
    Volleyball: '🏐',
  };
  return emojiMap[sport] || '⚽';
};

/* ---------- Component ---------- */

const CalendarScreen = ({ navigation, route }: any) => {
  const { joinedActivities, allActivities, reloadAllActivities, toggleJoinActivity } = useActivityContext();

  // User location
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          let location = await Location.getLastKnownPositionAsync({});
          if (!location) location = await Location.getCurrentPositionAsync({});
          if (location) setUserLocation(location.coords);
        }
      } catch {}
    })();
  }, []);

  // Calendar status per activity
  const [calendarStatus, setCalendarStatus] = useState<Record<string, boolean>>({});
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
          const addedToCalendarIds = (data as any).addedToCalendarByUsers || [];
          statusMap[activity.id] = addedToCalendarIds.includes(currentUserId);
        }
      }
      setCalendarStatus(statusMap);
    };
    loadCalendarStatus();
  }, [allActivities]);

  // Selected date (dd-mm-yyyy)
  const selectedDate = route.params?.selectedDate;
  const [currentDate, setCurrentDate] = useState<string>(() =>
    normalizeDateFormat(selectedDate || new Date().toISOString().split('T')[0])
  );
  useEffect(() => {
    if (selectedDate) setCurrentDate(normalizeDateFormat(selectedDate));
  }, [route.params?.selectedDate]);

  // Ensure currentDate updates when screen is focused with selectedDate
  useFocusEffect(
    React.useCallback(() => {
      if (route.params?.selectedDate) {
        setCurrentDate(normalizeDateFormat(route.params.selectedDate));
      }
    }, [route.params?.selectedDate])
  );

  // Pull-to-refresh
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await reloadAllActivities();
    setTimeout(() => {
      setRefreshing(false);
      setRefreshLocked(false);
    }, 1500);
  };

  // Fade-in
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (joinedActivities && allActivities && allActivities.length > 0) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    }
  }, [joinedActivities, allActivities]);

  // Marked dates for calendar
  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};

    // turquoise dot for joined activities (activity.date is dd-mm-yyyy)
    allActivities.forEach((activity) => {
      if (joinedActivities.includes(activity.id)) {
        const [dd, mm, yyyy] = activity.date.split('-');
        const calendarDate = `${yyyy}-${mm}-${dd}`;
        if (!marks[calendarDate]) {
          marks[calendarDate] = { marked: true, dots: [{ key: 'activity', color: '#1ae9ef' }] };
        } else {
          marks[calendarDate].marked = true;
          marks[calendarDate].dots = [{ key: 'activity', color: '#1ae9ef' }];
        }
      }
    });

    // selected date fill
    if (currentDate) {
      const [dd, mm, yyyy] = currentDate.split('-');
      const selectedCalendarDate = `${yyyy}-${mm}-${dd}`;
      marks[selectedCalendarDate] = {
        ...(marks[selectedCalendarDate] || {}),
        selected: true,
        customStyles: {
          container: { backgroundColor: '#1ae9ef', borderRadius: 50 },
          text: { color: '#fff' },
        },
      };
      if (marks[selectedCalendarDate].dots) {
        // white dot if selected & has activity
        marks[selectedCalendarDate].dots = [{ color: '#fff' }];
      }
    }

    return marks;
  }, [allActivities, joinedActivities, currentDate]);

  // Date press handler (Calendar sends yyyy-mm-dd)
  const handleDayPress = (day: any) => setCurrentDate(normalizeDateFormat(day.dateString));

  /* ---------- Add to Calendar flow ---------- */

  const handleAddToCalendar = async (activity: any) => {
    if (calendarStatus[activity.id]) {
      Alert.alert(
        'Already Added',
        'This event is already in your calendar. Want to add it again?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Again', onPress: async () => await addToCalendar(activity) },
        ],
        { cancelable: true }
      );
      return;
    }
    await addToCalendar(activity);
  };

  const addToCalendar = async (activity: any) => {
    try {
      const { status } = await ExpoCalendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Calendar permission is required to add this activity to your calendar.', [
          { text: 'OK' },
        ]);
        return;
      }

      const calendars = await ExpoCalendar.getCalendarsAsync(ExpoCalendar.EntityTypes.EVENT);
      const writableCalendars = calendars.filter((cal: any) => cal.allowsModifications);
      if (!writableCalendars.length) {
        Alert.alert('No Calendar Available', 'No writable calendar found on your device.');
        return;
      }

      showCalendarPicker(writableCalendars, activity);
    } catch (error) {
      console.error('Error adding to calendar:', error);
      Alert.alert('Error', 'Failed to add activity to calendar.');
    }
  };

  const showCalendarPicker = (calendars: any[], activity: any) => {
    const options = calendars.map((cal) => {
      let accountType = cal.source?.name || cal.source?.type || 'Local';
      const l = String(accountType).toLowerCase();
      if (l.includes('icloud') || l.includes('ios')) accountType = 'Apple';
      else if (l.includes('google')) accountType = 'Google';
      else if (l.includes('outlook') || l.includes('microsoft')) accountType = 'Outlook';
      else if (l.includes('samsung')) accountType = 'Samsung';

      return {
        text: `${accountType} - ${cal.title}`,
        onPress: async () => await createCalendarEvent(cal.id, activity),
      };
    });

    options.push({ text: 'Cancel', onPress: async () => {} });

    Alert.alert('Choose Calendar', 'Select which calendar account to add this event to:', options, { cancelable: true });
  };

  const createCalendarEvent = async (calendarId: string, activity: any) => {
    try {
      const [day, month, year] = activity.date.split('-').map(Number);
      const [hours, minutes] = activity.time.split(':').map(Number);
      const startDate = new Date(year, month - 1, day, hours, minutes);
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      const sportEmoji = getSportEmoji(activity.activity);
      const eventDetails: any = {
        title: `${sportEmoji} ${activity.activity} Session`,
        startDate,
        endDate,
        location: activity.location,
        notes: `${activity.activity} session organized via SportsPal\n\nLocation: ${activity.location}\nDate: ${activity.date}\nTime: ${activity.time}`,
        alarms: [{ relativeOffset: -360 }, { relativeOffset: -30 }],
        calendarColor: '#1ae9ef',
      };

      await ExpoCalendar.createEventAsync(calendarId, eventDetails);

      // Save to Firebase that this user added the activity to calendar
      const currentUserId = auth.currentUser?.uid;
      if (currentUserId) {
        const activityRef = doc(db, 'activities', activity.id);
        await updateDoc(activityRef, { addedToCalendarByUsers: arrayUnion(currentUserId) });
        setCalendarStatus((prev) => ({ ...prev, [activity.id]: true }));
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Added to Calendar! 📅',
        `${activity.activity} has been added to your calendar with reminders at 6 hours and 30 minutes before the event.`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error creating calendar event:', error);
      Alert.alert('Error', 'Failed to create calendar event.');
    }
  };

  /* ---------- UI ---------- */

  if (!allActivities || allActivities.length === 0) {
    // No activities exist in the system
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <Ionicons name="calendar-outline" size={48} color="#1ae9ef" style={{ marginBottom: 10 }} />
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
          No activities found
        </Text>
        <Text style={{ color: '#bbb', fontSize: 16, textAlign: 'center', marginBottom: 18 }}>
          Be the first to create an event!
        </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('CreateGame')}
          style={{ paddingVertical: 14, paddingHorizontal: 36, borderRadius: 24, backgroundColor: '#1ae9ef', marginTop: 10 }}
          activeOpacity={0.85}
        >
          <Text style={{ color: '#121212', fontWeight: 'bold', fontSize: 16 }}>Create Activity</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // If user has no joined activities, show a friendly message
  const userJoinedActivities = allActivities.filter((a) => joinedActivities.includes(a.id));
  const activitiesForDate = userJoinedActivities.filter(
    (a) => normalizeDateFormat(a.date) === normalizeDateFormat(currentDate)
  );
  if (!userJoinedActivities || userJoinedActivities.length === 0) {
    // Show calendar UI with no marked/joined activities, and a friendly message below
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
              colors={['#009fa3']}
              tintColor="#009fa3"
              progressBackgroundColor="transparent"
            />
          }
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <Calendar
            key={currentDate}
            current={(() => {
              const parts = currentDate.split('-');
              if (parts.length === 3) {
                if (parts[0].length === 4) return currentDate; // already yyyy-mm-dd
                return `${parts[2]}-${parts[1]}-${parts[0]}`; // dd-mm-yyyy -> yyyy-mm-dd
              }
              return currentDate;
            })()}
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
            markingType={'multi-dot'}
            onDayPress={handleDayPress}
          />

          <View style={styles.activitiesContainer}>
            {activitiesForDate.length > 0 ? (
              activitiesForDate.map((item: any) => {
                const distance = kmDistance(userLocation, {
                  latitude: item.latitude,
                  longitude: item.longitude,
                });

                const isJoined = joinedActivities.includes(item.id);
                const handleToggleJoin = async () => {
                  const wasJoined = isJoined;
                  await toggleJoinActivity(item);
                  // If the user just left, clear local calendar badge
                  if (wasJoined) setCalendarStatus((prev) => ({ ...prev, [item.id]: false }));
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

                    <View style={styles.infoRow}>
                      <Ionicons name="person" size={16} color="#1ae9ef" style={styles.infoIcon} />
                      <Text style={styles.cardInfoLabel}>Host:</Text>
                      <HostUsername activity={item} />
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons name="location" size={16} color="#1ae9ef" style={styles.infoIcon} />
                      <Text style={styles.cardInfoLabel}>Location:</Text>
                      <Text style={styles.cardInfo} numberOfLines={1} ellipsizeMode="tail">
                        {simplifyLocation(item.location)}
                      </Text>
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons name="calendar" size={16} color="#1ae9ef" style={styles.infoIcon} />
                      <Text style={styles.cardInfoLabel}>Date:</Text>
                      <Text style={styles.cardInfo}>{item.date}</Text>
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons name="time" size={16} color="#1ae9ef" style={styles.infoIcon} />
                      <Text style={styles.cardInfoLabel}>Time:</Text>
                      <Text style={styles.cardInfo}>{item.time}</Text>
                    </View>

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
                        onPress={handleToggleJoin}
                      >
                        <Text style={styles.joinButtonText}>{isJoined ? 'Leave' : 'Join'}</Text>
                      </TouchableOpacity>

                      <View style={{ flex: 1 }} />

                      <TouchableOpacity
                        style={[styles.addToCalendarButton, calendarStatus[item.id] && styles.addToCalendarButtonAdded]}
                        onPress={() => handleAddToCalendar(item)}
                      >
                        <Ionicons
                          name={calendarStatus[item.id] ? 'checkmark-circle' : 'calendar-outline'}
                          size={16}
                          color="#fff"
                          style={{ marginRight: 6 }}
                        />
                        <Text style={styles.addToCalendarText}>
                          {calendarStatus[item.id] ? 'Added to Calendar' : 'Add to Calendar'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.shareButton} onPress={() => console.log(`Share event ${item.id}`)}>
                        <Ionicons name="share-social-outline" size={20} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })
            ) : (
              <Text style={styles.noActivitiesText}>No activities scheduled for this day.</Text>
            )}
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  selectedDateHeader: {
    color: '#1ae9ef',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 4,
    marginBottom: 8,
    textAlign: 'center',
  },
  joinButton: {
    paddingHorizontal: 15,
    backgroundColor: '#1ae9ef',
    borderRadius: 5,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
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
    paddingHorizontal: 12,
    backgroundColor: '#1ae9ef',
    borderRadius: 5,
    height: 36,
    justifyContent: 'center',
    marginTop: 0,
    marginBottom: 0,
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
    justifyContent: 'space-between',
    alignItems: 'center',
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
