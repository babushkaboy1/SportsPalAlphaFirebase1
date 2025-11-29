
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ...existing code...

function HostUsername({ activity }: { activity: any }) {
  const [username, setUsername] = useState('');
  const { theme } = useTheme();
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
  return <Text style={{ fontSize: 14, color: theme.muted, fontWeight: '500' }}>{username}</Text>;
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { useActivityContext } from '../context/ActivityContext';
import { normalizeDateFormat } from '../utils/storage';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { ActivityIcon } from '../components/ActivityIcons';
import * as ExpoCalendar from 'expo-calendar';
import { shareActivity } from '../utils/deepLinking';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';

/* ---------- Helpers (module-level) ---------- */

// Slight darken helper for hex colors (fallback to original on parse failure)
function darkenHex(color: string, amount = 0.12): string {
  try {
    if (!color || typeof color !== 'string') return color;
    const hex = color.trim();
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!match) return color;
    let r = 0, g = 0, b = 0;
    if (match[1].length === 3) {
      r = parseInt(match[1][0] + match[1][0], 16);
      g = parseInt(match[1][1] + match[1][1], 16);
      b = parseInt(match[1][2] + match[1][2], 16);
    } else {
      r = parseInt(match[1].slice(0, 2), 16);
      g = parseInt(match[1].slice(2, 4), 16);
      b = parseInt(match[1].slice(4, 6), 16);
    }
    const factor = Math.max(0, Math.min(1, 1 - amount));
    const dr = Math.round(r * factor);
    const dg = Math.round(g * factor);
    const db = Math.round(b * factor);
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(dr)}${toHex(dg)}${toHex(db)}`;
  } catch {
    return color;
  }
}

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
    'American Football': '🏈',
    'Badminton': '🏸',
    'Baseball': '⚾',
    'Basketball': '🏀',
    'Boxing': '🥊',
    'Calisthenics': '💪',
    'Cricket': '🏏',
    'Cycling': '🚴',
    'Field Hockey': '🏑',
    'Golf': '⛳',
    'Gym': '🏋️',
    'Hiking': '🥾',
    'Ice Hockey': '🏒',
    'Martial Arts': '🥋',
    'Padel': '🎾',
    'Running': '🏃',
    'Soccer': '⚽',
    'Swimming': '🏊',
    'Table Tennis': '🏓',
    'Tennis': '🎾',
    'Volleyball': '🏐',
    'Yoga': '🧘',
  };
  return emojiMap[sport] || '⚽';
};

/* ---------- Component ---------- */

const CalendarScreen = ({ navigation, route }: any) => {
  const { theme, themeMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
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

  // Calendar status per activity (persisted in AsyncStorage)
  const [calendarStatus, setCalendarStatus] = useState<Record<string, boolean>>({});
  
  // Load calendar status from AsyncStorage on mount and when screen comes into focus
  const loadCalendarStatus = async () => {
    try {
      const stored = await AsyncStorage.getItem('calendarStatus');
      if (stored) {
        setCalendarStatus(JSON.parse(stored));
      } else {
        setCalendarStatus({});
      }
    } catch (error) {
      console.error('Failed to load calendar status:', error);
    }
  };
  
  useEffect(() => {
    loadCalendarStatus();
  }, []);
  
  // Reload calendar status when screen comes into focus (syncs with ActivityDetailsScreen)
  useFocusEffect(
    useCallback(() => {
      loadCalendarStatus();
    }, [])
  );
  
  // Save calendar status to AsyncStorage whenever it changes
  const updateCalendarStatus = async (activityId: string, status: boolean) => {
    try {
      const newStatus = { ...calendarStatus, [activityId]: status };
      setCalendarStatus(newStatus);
      await AsyncStorage.setItem('calendarStatus', JSON.stringify(newStatus));
    } catch (error) {
      console.error('Failed to save calendar status:', error);
    }
  };

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
          marks[calendarDate] = { marked: true, dots: [{ key: 'activity', color: theme.primary }] };
        } else {
          marks[calendarDate].marked = true;
          marks[calendarDate].dots = [{ key: 'activity', color: theme.primary }];
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
          container: { backgroundColor: theme.primary, borderRadius: 50 },
          text: { color: '#fff' },
        },
      };
      if (marks[selectedCalendarDate].dots) {
        // white dot if selected & has activity
        marks[selectedCalendarDate].dots = [{ color: '#fff' }];
      }
    }

    return marks;
  }, [allActivities, joinedActivities, currentDate, theme.primary]);

  // Date press handler (Calendar sends yyyy-mm-dd)
  const handleDayPress = (day: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCurrentDate(normalizeDateFormat(day.dateString));
  };

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

      // Update local state and persist to AsyncStorage
      await updateCalendarStatus(activity.id, true);

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
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: insets.top,
        }}
      >
        <Ionicons name="calendar-outline" size={48} color={theme.primary} style={{ marginBottom: 10 }} />
        <Text style={{ color: theme.text, fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
          No activities found
        </Text>
        <Text style={{ color: theme.muted, fontSize: 16, textAlign: 'center', marginBottom: 18 }}>
          Be the first to create an event!
        </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('CreateGame')}
          style={{ paddingVertical: 14, paddingHorizontal: 36, borderRadius: 24, backgroundColor: theme.primary, marginTop: 10 }}
          activeOpacity={0.85}
        >
          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>Create Activity</Text>
        </TouchableOpacity>
      </View>
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
    <View style={[styles.safeArea, { paddingTop: insets.top }]}> 
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <Text style={styles.headerTitle}>Calendar</Text>
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing || refreshLocked}
              onRefresh={onRefresh}
              colors={[theme.primary] as any}
              tintColor={theme.primary}
              progressBackgroundColor="transparent"
            />
          }
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <Calendar
            key={`${currentDate}-${themeMode}`}
            current={(() => {
              const parts = currentDate.split('-');
              if (parts.length === 3) {
                if (parts[0].length === 4) return currentDate; // already yyyy-mm-dd
                return `${parts[2]}-${parts[1]}-${parts[0]}`; // dd-mm-yyyy -> yyyy-mm-dd
              }
              return currentDate;
            })()}
            style={{ backgroundColor: 'transparent' }}
            theme={{
              backgroundColor: 'transparent',
              calendarBackground: 'transparent',
              // Ensure weekday titles and month text are visible on light theme
              textSectionTitleColor: theme.text,
              monthTextColor: theme.text,
              // Core day styles
              selectedDayBackgroundColor: theme.primary,
              selectedDayTextColor: '#fff',
              dayTextColor: theme.text,
              todayTextColor: theme.primary,
              arrowColor: theme.primary,
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
                const isHistorical = (() => {
                  try {
                    const [dd, mm, yyyy] = normalizeDateFormat(item.date).split('-');
                    const [hours, minutes] = (item.time || '00:00').split(':').map((n: string) => parseInt(n, 10));
                    const start = new Date(Number(yyyy), Number(mm) - 1, Number(dd), hours || 0, minutes || 0);
                    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
                    return Date.now() > end.getTime();
                  } catch {
                    return false;
                  }
                })();
                const handleToggleJoin = async () => {
                  const wasJoined = isJoined;
                  await toggleJoinActivity(item);
                  // If the user just left, clear calendar badge from AsyncStorage
                  if (wasJoined) await updateCalendarStatus(item.id, false);
                };

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.card}
                    onPress={() => navigation.navigate('ActivityDetails', { activityId: item.id })}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.cardHeaderLeft}>
                        <ActivityIcon activity={item.activity} size={32} color={theme.primary} />
                        <Text style={styles.cardTitle}>{item.activity}</Text>
                      </View>
                      {distance && (
                        <View style={styles.distanceContainer}>
                          <Ionicons name="navigate" size={14} color={theme.primary} />
                          <Text style={styles.distanceNumber}>{distance}</Text>
                          <Text style={styles.distanceUnit}>km away</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons name="person" size={16} color={theme.primary} style={styles.infoIcon} />
                      <Text style={styles.cardInfoLabel}>Host:</Text>
                      <HostUsername activity={item} />
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons name="location" size={16} color={theme.primary} style={styles.infoIcon} />
                      <Text style={styles.cardInfoLabel}>Location:</Text>
                      <Text style={styles.cardInfo} numberOfLines={1} ellipsizeMode="tail">
                        {simplifyLocation(item.location)}
                      </Text>
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons name="calendar" size={16} color={theme.primary} style={styles.infoIcon} />
                      <Text style={styles.cardInfoLabel}>Date:</Text>
                      <Text style={styles.cardInfo}>{item.date}</Text>
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons name="time" size={16} color={theme.primary} style={styles.infoIcon} />
                      <Text style={styles.cardInfoLabel}>Time:</Text>
                      <Text style={styles.cardInfo}>{item.time}</Text>
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons name="people" size={16} color={theme.primary} style={styles.infoIcon} />
                      <Text style={styles.cardInfoLabel}>Participants:</Text>
                      <Text style={styles.cardInfo}>
                        {item.joinedUserIds ? item.joinedUserIds.length : item.joinedCount} / {item.maxParticipants}
                      </Text>
                    </View>

                    <View style={styles.cardActions}>
                      {!isHistorical && (
                        <>
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

                          <TouchableOpacity style={styles.shareButton} onPress={() => shareActivity(item.id, item.activity)}>
                            <Ionicons name="share-social-outline" size={20} color="#fff" />
                          </TouchableOpacity>
                        </>
                      )}
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
    </View>
  );
};
const createStyles = (t: ReturnType<typeof useTheme>['theme']) => StyleSheet.create({
  selectedDateHeader: {
    color: t.primary,
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 4,
    marginBottom: 8,
    textAlign: 'center',
  },
  joinButton: {
    paddingHorizontal: 15,
    backgroundColor: t.primary,
    borderRadius: 5,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  joinButtonJoined: {
    // Discover-aligned Leave color mapping for activity cards
    backgroundColor: t.isDark ? '#007E84' : darkenHex(t.primary, 0.12),
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  safeArea: {
    flex: 1,
    backgroundColor: t.background,
  },
  headerTitle: {
    fontSize: 28,
    color: t.primary,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  activitiesContainer: {
    marginTop: 20,
  },
  card: {
    backgroundColor: t.card,
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
    color: t.primary,
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
    color: t.primary,
    fontWeight: '600',
  },
  distanceUnit: {
    fontSize: 14,
    color: t.muted,
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
    color: t.primary,
    fontWeight: '600',
    marginRight: 6,
  },
  cardInfo: {
    fontSize: 14,
    color: t.muted,
    fontWeight: '500',
  },
  addToCalendarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: t.primary,
    borderRadius: 5,
    height: 36,
    justifyContent: 'center',
    marginTop: 0,
    marginBottom: 0,
  },
  addToCalendarButtonAdded: {
    backgroundColor: t.primaryStrong,
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
    backgroundColor: t.card,
    borderRadius: 5,
  },
  noActivitiesText: {
    color: t.muted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
    fontWeight: '500',
  },
});

export default React.memo(CalendarScreen);
