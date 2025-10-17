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

const CalendarScreen = ({ navigation, route }: any) => {
  const { joinedActivities, allActivities, reloadAllActivities } = useActivityContext();
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
              colors={["#1ae9ef"]}
              tintColor="#1ae9ef"
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
                // Join/Leave logic (same as Discover)
                const { isActivityJoined, toggleJoinActivity } = useActivityContext();
                const isJoined = isActivityJoined(item.id);
                const handleToggleJoin = async () => {
                  await toggleJoinActivity(item);
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