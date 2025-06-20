// screens/CalendarScreen.tsx
import React, { useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform,
  StatusBar,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { ActivityProvider, useActivityContext } from '../context/ActivityContext';
import { convertToCalendarFormat, normalizeDateFormat } from '../utils/storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons'; // Import Ionicons
import { ActivityIcon } from '../components/ActivityIcons'; // ✅ Correct import
import { activities } from '../data/activitiesData';

const CalendarScreen = ({ navigation, route }: any) => {
  const { joinedActivities, allActivities, reloadAllActivities } = useActivityContext();
  const insets = useSafeAreaInsets();

  // Today's date as "YYYY-MM-DD"
  const selectedDate = route.params?.selectedDate; // "YYYY-MM-DD"
  const selected = selectedDate ? new Date(selectedDate) : new Date();
  const [currentDate, setCurrentDate] = useState<string>(
    selected.toISOString().split('T')[0]
  );
  const [refreshing, setRefreshing] = useState(false);

  // Refresh handler
  const onRefresh = async () => {
    setRefreshing(true);
    await reloadAllActivities(); // <-- reload from Firestore
    setRefreshing(false);
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

  if (!joinedActivities || !allActivities || allActivities.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1ae9ef" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { paddingTop: insets.top }]}>
      <Text style={styles.headerTitle}>Calendar</Text>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
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
            activitiesForDate.map((activity: any) => (
              <TouchableOpacity
                key={activity.id}
                style={styles.activityItem}
                onPress={() => {
                  navigation.navigate('ActivityDetails', { activityId: activity.id });
                }}
              >
                <View style={styles.activityInfo}>
                  <ActivityIcon activity={activity.activity} size={32} />
                  <View style={styles.activityDetails}>
                    <Text style={styles.activityText}>
                      <Text style={{ color: '#1ae9ef', fontWeight: 'bold' }}>{activity.activity}</Text>
                      {` at ${activity.time}`}
                    </Text>
                    <Text style={styles.activityLocation}>
                      Location: {activity.location}
                    </Text>
                    <Text style={styles.activityCreator}>
                      Host: {activity.creator}
                    </Text>
                    <Text style={styles.activityJoinStatus}>
                      {(activity.joinedUserIds ? activity.joinedUserIds.length : activity.joinedCount) || 0} / {activity.maxParticipants} joined
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.shareButton}
                    onPress={() => console.log(`Share event ${activity.id}`)}
                  >
                    <Ionicons name="share-social-outline" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.noActivitiesText}>
              No activities scheduled for this day.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 10,
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
  activityItem: {
    backgroundColor: '#1e1e1e',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  activityInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activityDetails: {
    flex: 1,
    marginLeft: 10,
  },
  activityText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  activityLocation: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '500',
  },
  activityCreator: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '500',
  },
  activityJoinStatus: {
    color: '#1ae9ef',
    fontSize: 14,
    fontWeight: 'bold',
  },
  noActivitiesText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
    fontWeight: '500',
  },
  shareButton: {
    padding: 8,
    backgroundColor: '#1e1e1e',
    borderRadius: 5,
  },
});

export default React.memo(CalendarScreen);