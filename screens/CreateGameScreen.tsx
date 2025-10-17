import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  StatusBar,
  Modal,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ActivityIcon } from '../components/ActivityIcons';
import { useActivityContext } from '../context/ActivityContext';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createActivity, joinActivity, fetchAllActivities } from '../utils/firestoreActivities';
import { auth } from '../firebaseConfig'; // Add this import
import * as Haptics from 'expo-haptics';

const THEME_COLOR = '#1ae9ef';

const sportOptions = [
  'Basketball', 'Soccer', 'Running', 'Gym',
  'Calisthenics', 'Padel', 'Tennis', 'Cycling',
  'Swimming', 'Badminton', 'Volleyball',
];

type NavigationProp = StackNavigationProp<RootStackParamList, 'MainTabs'>;

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
];

const CreateGameScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { toggleJoinActivity, reloadAllActivities, setJoinedActivities } = useActivityContext();
  const route = useRoute<RouteProp<RootStackParamList, 'CreateGame'>>();
  const insets = useSafeAreaInsets();

  const [activityName, setActivityName] = useState('');
  const [description, setDescription] = useState('');
  const [sport, setSport] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState<string>(() => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  });
  const [maxParticipants, setMaxParticipants] = useState<number>(10);
  const [selectedCoords, setSelectedCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  // Picker modals
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showParticipantsPicker, setShowParticipantsPicker] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef(null);
  const pullAnim = useRef(new Animated.Value(0)).current; // pixels pulled down when at top
  const CLEAR_THRESHOLD = 110; // pull distance to clear
  const lastPullRef = useRef(0);
  const HEADER_OVERLAY_OFFSET = 68; // position overlay lower, near the title

  useEffect(() => {
    const timeout = setTimeout(() => setIsReady(true), 500);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const setAddressFromCoords = async () => {
      if (selectedCoords) {
        try {
          const [address] = await Location.reverseGeocodeAsync(selectedCoords);
          if (address) {
            // Simplified format: "StreetName StreetNumber PostalCode"
            const streetNumber = (address as any).streetNumber || (address.name && /^\d+$/.test(address.name) ? address.name : '');
            const street = address.street || '';
            const first = [street, streetNumber].filter(Boolean).join(' ').trim();
            const addressString = [first, address.postalCode].filter(Boolean).join(' ').trim();
            setLocation(addressString);
          } else {
            setLocation(`Lat: ${selectedCoords.latitude.toFixed(5)}, Lng: ${selectedCoords.longitude.toFixed(5)}`);
          }
        } catch (e) {
          setLocation(`Lat: ${selectedCoords.latitude.toFixed(5)}, Lng: ${selectedCoords.longitude.toFixed(5)}`);
        }
      }
    };
    setAddressFromCoords();
  }, [selectedCoords]);

  // Reset form fields
  const resetForm = () => {
    setActivityName('');
    setDescription('');
    setSport('');
    setLocation('');
    // Restore defaults for date/time
    setDate(new Date().toISOString().split('T')[0]);
    const now = new Date();
    setTime(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
    setMaxParticipants(10);
    setSelectedCoords(null);
  };

  const handleScroll = (e: any) => {
    const y = e.nativeEvent.contentOffset?.y ?? 0;
    if (y < 0) {
      const d = Math.min(-y, CLEAR_THRESHOLD + 40);
      pullAnim.setValue(d);
      lastPullRef.current = d;
    } else if (lastPullRef.current !== 0) {
      pullAnim.setValue(0);
      lastPullRef.current = 0;
    }
  };

  const handleRelease = async () => {
    const pulled = lastPullRef.current;
    if (pulled >= CLEAR_THRESHOLD) {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
      // Clear the form
      resetForm();
      // Affirm animation then collapse
      Animated.sequence([
        Animated.timing(pullAnim, { toValue: CLEAR_THRESHOLD + 20, duration: 120, useNativeDriver: false }),
        Animated.timing(pullAnim, { toValue: 0, duration: 280, useNativeDriver: false }),
      ]).start();
    } else {
      // Just collapse header
      Animated.timing(pullAnim, { toValue: 0, duration: 180, useNativeDriver: false }).start();
    }
  };

  const handleCreateGame = async () => {
    if (!activityName || !sport || !location || !date || !time) {
      Alert.alert('Missing Info', 'Please fill in all fields.');
      return;
    }

    const latitude = selectedCoords?.latitude ?? 37.9838;
    const longitude = selectedCoords?.longitude ?? 23.7275;

    // Do NOT include id or isJoined, Firestore will generate id
    const newGame = {
      name: activityName,
      description,
      activity: sport,
      location,
      date,
      time,
      creator: 'You', // Replace with user name if available
      joinedCount: 1,
      maxParticipants,
      distance: 0,
      latitude,
      longitude,
    };

    try {
      await createActivity(newGame); // Save to Firestore

      // Fetch the new game from Firestore (to get its id)
      const allGames = await fetchAllActivities();
      const createdGame = allGames.find(
        g =>
          g.creator === 'You' && // or use userId if you have it
          g.activity === sport &&
          g.date === date &&
          g.time === time &&
          g.location === location
      );

      if (createdGame) {
        const user = auth.currentUser;
        if (user) {
          await joinActivity(createdGame.id, user.uid); // Pass user.uid
          setJoinedActivities(prev => [...prev, createdGame.id]);
          await reloadAllActivities();
        }
      }

      Alert.alert('Game Created', 'Your game has been successfully created!');
      resetForm();
      navigation.navigate('MainTabs', {
        screen: 'Calendar',
        params: { selectedDate: date },
      });
    } catch (e) {
      Alert.alert('Error', 'Could not create game. Please try again.');
    }
  };

  useEffect(() => {
    // Only restore form state if coming back from PickLocation (pickedCoords is present)
    if (route.params?.pickedCoords) {
      if (route.params?.formState) {
        setActivityName(route.params.formState.activityName || '');
        setDescription(route.params.formState.description || '');
        setSport(route.params.formState.sport || '');
        setDate(route.params.formState.date || new Date().toISOString().split('T')[0]);
        setTime(route.params.formState.time || (() => {
          const now = new Date();
          return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        })());
        setMaxParticipants(route.params.formState.maxParticipants || 10);
      }
      setSelectedCoords(route.params.pickedCoords);
    }
    // Do NOT reset form fields unless a game is created!
  }, [route.params?.pickedCoords]);

  // Date/time picker handlers
  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) setDate(selectedDate.toISOString().split('T')[0]);
  };

  const onTimeChange = (event: any, selectedTime?: Date) => {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (selectedTime) {
      const hours = selectedTime.getHours().toString().padStart(2, '0');
      const minutes = selectedTime.getMinutes().toString().padStart(2, '0');
      setTime(`${hours}:${minutes}`);
    }
  };

  useEffect(() => {
    if (isReady) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  }, [isReady]);

  if (!isReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <ActivityIndicator size="large" color="#1ae9ef" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* Fixed pull-to-clear overlay above the title */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pullOverlay,
            {
              top: insets.top + HEADER_OVERLAY_OFFSET,
              opacity: pullAnim.interpolate({
                inputRange: [0, 20, CLEAR_THRESHOLD * 0.4, CLEAR_THRESHOLD],
                outputRange: [0, 0.25, 0.8, 1],
                extrapolate: 'clamp',
              }),
              transform: [
                {
                  scale: pullAnim.interpolate({
                    inputRange: [0, CLEAR_THRESHOLD],
                    outputRange: [0.6, 1],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.clearBadge}>
            <Ionicons name="close" size={18} color="#fff" />
          </View>
          <Animated.Text
            style={[
              styles.pullClearText,
              {
                opacity: pullAnim.interpolate({
                  inputRange: [0, CLEAR_THRESHOLD * 0.6, CLEAR_THRESHOLD],
                  outputRange: [0.8, 1, 0],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            Pull to clear form
          </Animated.Text>
          <Animated.Text
            style={[
              styles.pullClearText,
              {
                position: 'absolute',
                top: 32,
                opacity: pullAnim.interpolate({
                  inputRange: [0, CLEAR_THRESHOLD - 10, CLEAR_THRESHOLD, CLEAR_THRESHOLD + 10],
                  outputRange: [0, 0, 0.95, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            Release to clear
          </Animated.Text>
        </Animated.View>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Create Activity</Text>
        </View>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.form}
          scrollEventThrottle={16}
          onScroll={handleScroll}
          onScrollEndDrag={handleRelease}
          overScrollMode="always"
          alwaysBounceVertical
        >
          <Text style={styles.sectionLabel}>Name your activity</Text>
          <TextInput
            style={styles.input}
            placeholder="Activity Name"
            placeholderTextColor="#ccc"
            value={activityName}
            onChangeText={setActivityName}
          />

          <Text style={styles.sectionLabel}>Description</Text>
          <TextInput
            style={[styles.input, { height: 80 }]}
            placeholder="Description"
            placeholderTextColor="#ccc"
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <Text style={styles.sectionLabel}>Select Sport</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {sportOptions.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.sportButton, sport === option && styles.activeButton]}
                onPress={() => setSport(option)}
              >
                <ActivityIcon
                  activity={option}
                  size={32}
                  color={sport === option ? '#fff' : THEME_COLOR}
                />
                <Text style={styles.sportText}>{option}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.sectionLabel}>Location</Text>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() =>
              navigation.navigate('PickLocation', {
                initialCoords: selectedCoords,
                darkMapStyle,
                returnTo: 'CreateGame',
                formState: {
                  activityName,
                  description,
                  sport,
                  date,
                  time,
                  maxParticipants,
                },
              })
            }
          >
            <TextInput
              style={styles.input}
              placeholder="Pick a location"
              placeholderTextColor="#ccc"
              value={location}
              editable={false}
              pointerEvents="none"
            />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <TouchableOpacity
              style={[
                styles.mapButton,
                selectedCoords ? { backgroundColor: '#009fa3' } : null,
              ]}
              onPress={() =>
                navigation.navigate('PickLocation', {
                  initialCoords: selectedCoords,
                  darkMapStyle,
                  returnTo: 'CreateGame',
                  formState: {
                    activityName,
                    description,
                    sport,
                    date,
                    time,
                    maxParticipants,
                  },
                })
              }
            >
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                {selectedCoords ? 'Change Location on Map' : 'Pick on Map'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Date</Text>
          <TouchableOpacity onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#ccc"
              value={date}
              editable={false}
              pointerEvents="none"
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.mapButton} onPress={() => setShowDatePicker(true)}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Choose Date</Text>
          </TouchableOpacity>
          {/* Date Picker Modal (iOS only) */}
          {Platform.OS === 'ios' && (
            <Modal transparent animationType="slide" visible={showDatePicker} onRequestClose={() => setShowDatePicker(false)}>
              <View style={styles.pickerModal}>
                <View style={styles.rollerContainer}>
                  <View style={styles.rollerHeader}>
                    <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                      <Text style={styles.rollerCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                      <Text style={styles.rollerDone}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={date ? new Date(date) : new Date()}
                    mode="date"
                    display="spinner"
                    themeVariant="dark"
                    onChange={(event, selectedDate) => {
                      if (event.type === 'set' && selectedDate) {
                        setDate(selectedDate.toISOString().split('T')[0]);
                      }
                    }}
                    minimumDate={new Date()}
                    style={styles.rollerPicker}
                  />
                </View>
              </View>
            </Modal>
          )}
          {Platform.OS === 'android' && showDatePicker && (
            <DateTimePicker
              value={date ? new Date(date) : new Date()}
              mode="date"
              display="default"
              onChange={(event, selectedDate) => {
                setShowDatePicker(false);
                if (selectedDate) setDate(selectedDate.toISOString().split('T')[0]);
              }}
              minimumDate={new Date()}
            />
          )}

          <Text style={styles.sectionLabel}>Time</Text>
          <TouchableOpacity onPress={() => setShowTimePicker(true)} activeOpacity={0.7}>
            <TextInput
              style={styles.input}
              placeholder="HH:MM"
              placeholderTextColor="#ccc"
              value={time}
              editable={false}
              pointerEvents="none"
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.mapButton} onPress={() => setShowTimePicker(true)}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Choose Time</Text>
          </TouchableOpacity>
          {/* Time Picker Modal (iOS only) */}
          {Platform.OS === 'ios' && (
            <Modal transparent animationType="slide" visible={showTimePicker} onRequestClose={() => setShowTimePicker(false)}>
              <View style={styles.pickerModal}>
                <View style={styles.rollerContainer}>
                  <View style={styles.rollerHeader}>
                    <TouchableOpacity onPress={() => setShowTimePicker(false)}>
                      <Text style={styles.rollerCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowTimePicker(false)}>
                      <Text style={styles.rollerDone}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={time ? new Date(`1970-01-01T${time}:00`) : new Date()}
                    mode="time"
                    display="spinner"
                    themeVariant="dark"
                    onChange={(event, selectedTime) => {
                      if (event.type === 'set' && selectedTime) {
                        const hours = selectedTime.getHours().toString().padStart(2, '0');
                        const minutes = selectedTime.getMinutes().toString().padStart(2, '0');
                        setTime(`${hours}:${minutes}`);
                      }
                    }}
                    style={styles.rollerPicker}
                  />
                </View>
              </View>
            </Modal>
          )}
          {Platform.OS === 'android' && showTimePicker && (
            <DateTimePicker
              value={time ? new Date(`1970-01-01T${time}:00`) : new Date()}
              mode="time"
              display="default"
              onChange={(event, selectedTime) => {
                setShowTimePicker(false);
                if (selectedTime) {
                  const hours = selectedTime.getHours().toString().padStart(2, '0');
                  const minutes = selectedTime.getMinutes().toString().padStart(2, '0');
                  setTime(`${hours}:${minutes}`);
                }
              }}
            />
          )}

          <Text style={styles.sectionLabel}>Max Participants</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => setShowParticipantsPicker(true)}
            activeOpacity={0.7}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>
              {maxParticipants}
            </Text>
          </TouchableOpacity>
          {/* Max Participants Picker Modal (iOS only) */}
          {Platform.OS === 'ios' && (
            <Modal transparent animationType="slide" visible={showParticipantsPicker} onRequestClose={() => setShowParticipantsPicker(false)}>
              <View style={styles.pickerModal}>
                <View style={styles.rollerContainer}>
                  <View style={styles.rollerHeader}>
                    <TouchableOpacity onPress={() => setShowParticipantsPicker(false)}>
                      <Text style={styles.rollerCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowParticipantsPicker(false)}>
                      <Text style={styles.rollerDone}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <Picker
                    selectedValue={maxParticipants}
                    onValueChange={setMaxParticipants}
                    style={{ width: '100%', color: '#fff' }}
                    itemStyle={{ color: '#fff', fontSize: 22 }}
                  >
                    {[...Array(29)].map((_, i) => (
                      <Picker.Item key={i + 2} label={`${i + 2}`} value={i + 2} />
                    ))}
                  </Picker>
                </View>
              </View>
            </Modal>
          )}
          {Platform.OS === 'android' && showParticipantsPicker && (
            <Modal transparent animationType="slide" visible={showParticipantsPicker} onRequestClose={() => setShowParticipantsPicker(false)}>
              <View style={styles.pickerModal}>
                <View style={styles.rollerContainer}>
                  <Picker
                    selectedValue={maxParticipants}
                    onValueChange={(value) => {
                      setMaxParticipants(value);
                      setShowParticipantsPicker(false);
                    }}
                    style={{ width: '100%' }}
                    itemStyle={{ fontSize: 22 }}
                  >
                    {[...Array(29)].map((_, i) => (
                      <Picker.Item key={i + 2} label={`${i + 2}`} value={i + 2} />
                    ))}
                  </Picker>
                </View>
              </View>
            </Modal>
          )}

          <TouchableOpacity style={styles.createButton} onPress={handleCreateGame}>
            <Text style={styles.createButtonText}>Create Activity</Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
};

export default CreateGameScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingHorizontal: 10,
  },
  header: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  headerTitle: {
    fontSize: 28,
    color: THEME_COLOR,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  form: {
    paddingBottom: 0,
  },
  unfoldHeader: {
    width: '100%',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
    backgroundColor: 'transparent',
  },
  clearBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#009fa3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  pullClearText: {
    color: '#9aa0a6',
    fontSize: 12,
  },
  sectionLabel: {
    color: THEME_COLOR,
    fontSize: 18,
    marginVertical: 8,
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: '#1e1e1e',
    padding: 12,
    borderRadius: 8,
    color: '#fff',
    marginBottom: 10,
    fontWeight: '500',
  },
  sportButton: {
    flexDirection: 'column',
    alignItems: 'center',
    marginHorizontal: 5,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#1e1e1e',
  },
  activeButton: {
    backgroundColor: THEME_COLOR,
  },
  sportText: {
    color: '#fff',
    marginTop: 5,
    fontWeight: '500',
  },
  mapButton: {
    backgroundColor: THEME_COLOR,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginVertical: 6,
    alignSelf: 'flex-start',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 2,
  },
  participantButton: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: THEME_COLOR,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME_COLOR,
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 18,
    marginLeft: 8,
    fontWeight: 'bold',
  },
  pickerModal: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  rollerContainer: {
    backgroundColor: Platform.OS === 'ios' ? '#222' : '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 0,
    paddingTop: 8,
    alignItems: 'center',
  },
  rollerHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  rollerCancel: {
    color: '#ff5a5f',
    fontWeight: 'bold',
    fontSize: 18,
    paddingVertical: 8,
  },
  rollerDone: {
    color: THEME_COLOR,
    fontWeight: 'bold',
    fontSize: 18,
    paddingVertical: 8,
  },
  rollerPicker: {
    width: '100%',
    backgroundColor: 'transparent',
  },
  pullOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
});