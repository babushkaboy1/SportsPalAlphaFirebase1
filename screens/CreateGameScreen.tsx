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
  Image,
  Pressable,
  Keyboard,
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
import { normalizeDateFormat } from '../utils/storage';
import { auth } from '../firebaseConfig'; // Add this import
import * as Haptics from 'expo-haptics';

const THEME_COLOR = '#1ae9ef';

const sportOptions = [
  'American Football',
  'Badminton',
  'Basketball',
  'Boxing',
  'Calisthenics',
  'Cycling',
  'Gym',
  'Hiking',
  'Martial Arts',
  'Padel',
  'Running',
  'Soccer',
  'Swimming',
  'Table Tennis',
  'Tennis',
  'Volleyball',
  'Yoga',
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
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [createdActivityId, setCreatedActivityId] = useState<string | null>(null);
  const [friendProfiles, setFriendProfiles] = useState<any[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Record<string, boolean>>({});
  const [invitedFriendIds, setInvitedFriendIds] = useState<string[]>([]); // Track invited friends
  const [noSelectionHintVisible, setNoSelectionHintVisible] = useState(false);
  const [invitedState, setInvitedState] = useState(false);
  const noSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toggleJoinActivity, reloadAllActivities, setJoinedActivities, profile } = useActivityContext();
  const route = useRoute<RouteProp<RootStackParamList, 'CreateGame'>>();
  const insets = useSafeAreaInsets();

  // Removed activityName
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [sport, setSport] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [date, setDate] = useState<string>(() => normalizeDateFormat(new Date().toISOString().split('T')[0]));
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
  // Removed activityName
    setDescription('');
    setSport('');
    setLocation('');
    // Restore defaults for date/time
  setDate(normalizeDateFormat(new Date().toISOString().split('T')[0]));
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
    // Build missing fields array
    const missingFields: string[] = [];
  // Removed name validation
    if (!sport) missingFields.push('sport');
    if (!location) missingFields.push('location');
    if (!date) missingFields.push('date');
    if (!time) missingFields.push('time');
    if (!maxParticipants) missingFields.push('max participants');

    if (missingFields.length > 0) {
      // Build a friendly message
      let msg = '';
      if (missingFields.length === 1) {
        msg = `Choose ${missingFields[0]} before creating activity.`;
      } else if (missingFields.length === 2) {
        msg = `Choose ${missingFields[0]} and ${missingFields[1]} before creating activity.`;
      } else {
        msg = `Choose ${missingFields.slice(0, -1).join(', ')} and ${missingFields[missingFields.length - 1]} before creating activity.`;
      }
      Alert.alert('Missing Info', msg);
      return;
    }

    const latitude = selectedCoords?.latitude ?? 37.9838;
    const longitude = selectedCoords?.longitude ?? 23.7275;

    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert('Not signed in', 'Please sign in to create an activity.');
      return;
    }

    // If description is empty, set to 'No description'
    const safeDescription = description && description.trim().length > 0 ? description : 'No description';

    // Get actual username from profile context (or fallback to 'Unknown')
    const username = profile?.username || 'Unknown';

    // Firestore create payload must include creatorId and initial joinedUserIds
    const newGame = {
      description: safeDescription,
      activity: sport,
      location,
      date,
      time,
      creator: username, // always use actual username
      creatorId: uid,
      joinedUserIds: [uid],
      joinedCount: 1,
      maxParticipants,
      distance: 0,
      latitude,
      longitude,
    };

    try {
      setCreating(true);
      const newId = await createActivity(newGame as any); // Save to Firestore and get id
      setJoinedActivities(prev => Array.from(new Set([...prev, newId])));
      await reloadAllActivities();
      try {
        const { getOrCreateChatForActivity } = await import('../utils/firestoreChats');
        await getOrCreateChatForActivity(newId, uid);
      } catch {}

      resetForm();
      setCreatedActivityId(newId);
      setShowSuccessModal(true);
      // Load friends for modal
      const myFriendIds: string[] = Array.isArray(profile?.friends) ? profile.friends : [];
      if (myFriendIds.length) {
        try {
          const users = await import('../utils/firestoreFriends').then(mod => mod.fetchUsersByIds(myFriendIds));
          setFriendProfiles(users);
        } catch {
          setFriendProfiles([]);
        }
      } else {
        setFriendProfiles([]);
      }
    } catch (e) {
      Alert.alert('Error', 'Could not create game. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    // Only restore form state if coming back from PickLocation (pickedCoords is present)
    if (route.params?.pickedCoords) {
      if (route.params?.formState) {
  // Removed activityName restore
        setDescription(route.params.formState.description || '');
        setSport(route.params.formState.sport || '');
  setDate(route.params.formState.date ? normalizeDateFormat(route.params.formState.date) : normalizeDateFormat(new Date().toISOString().split('T')[0]));
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
    if (selectedDate) setDate(normalizeDateFormat(selectedDate.toISOString().split('T')[0]));
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
            style={[styles.pullClearText,
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
            style={[styles.pullClearText,
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

        {/* Success Modal Popup */}
        <Modal
          visible={showSuccessModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowSuccessModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Activity Created!</Text>
              </View>
              <Text style={styles.modalSubtitle}>
                Your activity has been successfully created. You can now invite your friends and let people discover this activity from their Discover page.
              </Text>
              {friendProfiles.length > 0 ? (
                <>
                  <Text style={styles.modalSubtitle}>Select friends to invite to this activity:</Text>
                  <ScrollView style={{ maxHeight: 260 }}>
                    {friendProfiles.map((f: any) => {
                      const invited = invitedFriendIds.includes(f.uid);
                      const selected = !!selectedFriendIds[f.uid];
                      return (
                        <TouchableOpacity
                          key={f.uid}
                          style={[styles.friendRow, invited && { opacity: 0.5 }]} // blur if invited
                          onPress={() => {
                            if (!invited) {
                              setSelectedFriendIds(prev => ({ ...prev, [f.uid]: !prev[f.uid] }));
                            }
                          }}
                          activeOpacity={invited ? 1 : 0.7}
                          disabled={invited}
                        >
                          <View style={styles.friendLeft}>
                            <Image
                              source={{ uri: f.photo || f.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(f.username || 'User')}` }}
                              style={styles.friendAvatar}
                            />
                            <View>
                              <Text style={styles.friendName}>{f.username || 'User'}</Text>
                              {f.bio ? <Text style={styles.friendMeta}>{f.bio}</Text> : null}
                            </View>
                          </View>
                          <View style={[styles.checkbox, (selected || invited) && styles.checkboxSelected]}>
                            {(selected || invited) && <Ionicons name="checkmark" size={16} color="#121212" />}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[styles.modalConfirm,
                        // Button color logic
                        Object.keys(selectedFriendIds).some(id => selectedFriendIds[id] && !invitedFriendIds.includes(id))
                          ? { backgroundColor: '#1ae9ef' } // turquoise
                          : invitedState
                            ? { backgroundColor: '#009fa3' } // dark turquoise after invite
                            : { backgroundColor: '#009fa3' } // dark turquoise when nothing selected
                      ]}
                      onPress={async () => {
                        // Invite logic
                        const selected = Object.keys(selectedFriendIds).filter(id => selectedFriendIds[id] && !invitedFriendIds.includes(id));
                        if (selected.length === 0) {
                          setNoSelectionHintVisible(true);
                          if (noSelectionTimerRef.current) clearTimeout(noSelectionTimerRef.current);
                          noSelectionTimerRef.current = setTimeout(() => setNoSelectionHintVisible(false), 1800);
                          return;
                        }
                        let sent = 0;
                        let skipped = 0;
                        if (!createdActivityId) return;
                        const newlyInvited: string[] = [];
                        for (const friendId of selected) {
                          try {
                            const res = await import('../utils/firestoreInvites').then(mod => mod.sendActivityInvites(friendId, [createdActivityId as string]));
                            if ((res?.sentIds || []).length > 0) {
                              sent += 1;
                              newlyInvited.push(friendId);
                            } else {
                              skipped += 1;
                            }
                          } catch {
                            skipped += 1;
                          }
                        }
                        setInvitedFriendIds(prev => Array.from(new Set([...prev, ...newlyInvited])));
                        setInvitedState(true);
                        // Unselect all after sending
                        setSelectedFriendIds({});
                        Alert.alert('Invites',
                          sent > 0
                            ? `Sent invites to ${sent} friend${sent === 1 ? '' : 's'}${skipped ? ` (skipped ${skipped} already joined)` : ''}.`
                            : `No invites sent. ${skipped} skipped (already joined).`
                        );
                      }}
                      disabled={
                        !Object.keys(selectedFriendIds).some(
                          id => selectedFriendIds[id] && !invitedFriendIds.includes(id)
                        )
                      }
                    >
                      <Text
                        style={[styles.modalConfirmText,
                          Object.keys(selectedFriendIds).some(id => selectedFriendIds[id] && !invitedFriendIds.includes(id))
                            ? { color: '#121212' } // black text when selectable
                            : invitedState
                              ? { color: '#fff' } // white text after invite
                              : { color: '#fff' } // white text when nothing selected
                        ]}
                      >
                        {Object.keys(selectedFriendIds).some(id => selectedFriendIds[id] && !invitedFriendIds.includes(id))
                          ? 'Invite Selected Friends'
                          : invitedState
                            ? 'Selected friends invited'
                            : 'Invite Selected Friends'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <Text style={styles.modalSubtitle}>You have no friends to invite yet.</Text>
              )}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalConfirm}
                  onPress={() => {
                    if (createdActivityId) {
                      setShowSuccessModal(false);
                      navigation.navigate('ActivityDetails', { activityId: createdActivityId });
                    }
                  }}
                >
                  <Text style={styles.modalConfirmText}>Go to Activity Details</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalCancel}
                  onPress={() => setShowSuccessModal(false)}
                >
                  <Text style={styles.modalCancelText}>Close</Text>
                </TouchableOpacity>
              </View>
              {noSelectionHintVisible && (
                <View style={styles.bottomToast} pointerEvents="none">
                  <Text style={styles.bottomToastText}>No friends selected</Text>
                </View>
              )}
            </View>
          </View>
        </Modal>
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
          keyboardShouldPersistTaps="handled"
        >
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

          <Text style={styles.sectionLabel}>Description</Text>
          <TextInput
            style={[styles.input, { height: 80 }]} // 3-4 lines
            placeholder="Describe your activity (optional)"
            placeholderTextColor="#ccc"
            value={description}
            onChangeText={t => setDescription(t.slice(0, 200))}
            multiline
            maxLength={200}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 4 }}>
            <Text style={{ color: '#888', fontSize: 13 }}>{description.length}/200</Text>
          </View>

          <Text style={styles.sectionLabel}>Location</Text>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() =>
              navigation.navigate('PickLocation', {
                initialCoords: selectedCoords,
                darkMapStyle,
                returnTo: 'CreateGame',
                formState: {
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
              placeholder="DD-MM-YYYY"
              placeholderTextColor="#ccc"
              value={normalizeDateFormat(date)}
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
                    value={date ? new Date(date.split('-').reverse().join('-')) : new Date()}
                    mode="date"
                    display="spinner"
                    themeVariant="dark"
                    onChange={(event, selectedDate) => {
                      if (event.type === 'set' && selectedDate) {
                        setDate(normalizeDateFormat(selectedDate.toISOString().split('T')[0]));
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
              value={date ? new Date(date.split('-').reverse().join('-')) : new Date()}
              mode="date"
              display="default"
              onChange={(event, selectedDate) => {
                setShowDatePicker(false);
                if (selectedDate) setDate(normalizeDateFormat(selectedDate.toISOString().split('T')[0]));
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

          <TouchableOpacity
            style={[styles.createButton, creating ? { backgroundColor: '#009fa3' } : null]}
            onPress={creating ? undefined : handleCreateGame}
            disabled={creating}
          >
            {creating && <ActivityIndicator size="small" color="#fff" />}
            <Text style={styles.createButtonText}>{creating ? 'Creating Activity' : 'Create Activity'}</Text>
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
  // Modal styles copied from ActivityDetailsScreen
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 520, backgroundColor: '#1c1c1e', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2a2a2c' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  modalSubtitle: { color: '#9aa0a6', marginBottom: 12 },
  friendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#2a2a2c' },
  friendLeft: { flexDirection: 'row', alignItems: 'center' },
  friendAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: '#1ae9ef' },
  friendName: { color: '#fff', fontWeight: '600' },
  friendMeta: { color: '#9aa0a6', fontSize: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#1ae9ef', alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: '#1ae9ef' },
  modalActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap' },
  modalCancel: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#2b0f12', borderRadius: 10, borderWidth: 1, borderColor: '#5a1a1f' },
  modalCancelText: { color: '#ff4d4f', fontWeight: '700' },
  modalConfirm: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1ae9ef', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  modalConfirmText: { color: '#121212', fontWeight: '700' },
  bottomToast: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center' },
  bottomToastText: { backgroundColor: 'rgba(26, 233, 239, 0.18)', color: '#cdeff0', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, overflow: 'hidden', fontWeight: '600' },
});