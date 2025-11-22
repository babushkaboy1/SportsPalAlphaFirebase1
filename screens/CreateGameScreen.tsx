import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
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
import { normalizeDateFormat, uploadGpxFile } from '../utils/storage';
import { auth } from '../firebaseConfig'; // Add this import
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as FileSystem from 'expo-file-system/legacy';

// Haversine formula to calculate distance between two coordinates
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Parse GPX file and extract statistics
const parseGpxStats = (gpxContent: string) => {
  const stats = {
    distance: '',
    ascent: '',
    descent: '',
    maxElevation: '',
  };

  try {
    // Extract all trackpoints with elevation
    const trkptRegex = /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>[\s\S]*?<ele>([\d.]+)<\/ele>/g;
    const points: Array<{ lat: number; lon: number; ele: number }> = [];
    let match;
    
    while ((match = trkptRegex.exec(gpxContent)) !== null) {
      points.push({
        lat: parseFloat(match[1]),
        lon: parseFloat(match[2]),
        ele: parseFloat(match[3]),
      });
    }

    if (points.length === 0) {
      // Try without elevation for distance-only calculation
      const basicTrkptRegex = /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"/g;
      while ((match = basicTrkptRegex.exec(gpxContent)) !== null) {
        points.push({
          lat: parseFloat(match[1]),
          lon: parseFloat(match[2]),
          ele: 0,
        });
      }
    }

    if (points.length < 2) return stats;

    // Calculate total distance
    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
      totalDistance += calculateDistance(
        points[i - 1].lat,
        points[i - 1].lon,
        points[i].lat,
        points[i].lon
      );
    }
    stats.distance = `${totalDistance.toFixed(2)} km`;

    // Calculate elevation statistics (if elevation data exists)
    const hasElevation = points.some(p => p.ele > 0);
    if (hasElevation) {
      let totalAscent = 0;
      let totalDescent = 0;
      let maxEle = points[0].ele;
      
      for (let i = 1; i < points.length; i++) {
        const elevDiff = points[i].ele - points[i - 1].ele;
        if (elevDiff > 0) totalAscent += elevDiff;
        if (elevDiff < 0) totalDescent += Math.abs(elevDiff);
        if (points[i].ele > maxEle) maxEle = points[i].ele;
      }

      if (totalAscent > 0) stats.ascent = `${Math.round(totalAscent)} m`;
      if (totalDescent > 0) stats.descent = `${Math.round(totalDescent)} m`;
      if (maxEle > 0) stats.maxElevation = `${Math.round(maxEle)} m`;
    }
  } catch (err) {
    console.warn('Error parsing GPX:', err);
  }

  return stats;
};

const THEME_COLOR = '#1ae9ef';

const sportOptions = [
  'American Football',
  'Badminton',
  'Baseball',
  'Basketball',
  'Boxing',
  'Calisthenics',
  'Cricket',
  'Cycling',
  'Field Hockey',
  'Golf',
  'Gym',
  'Hiking',
  'Ice Hockey',
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

// SuccessModal Component with animations
interface SuccessModalProps {
  visible: boolean;
  sport: string;
  friendProfiles: any[];
  selectedFriendIds: Record<string, boolean>;
  invitedFriendIds: string[];
  createdActivityId: string | null;
  noSelectionHintVisible: boolean;
  invitedState: boolean;
  onSelectFriend: (friendId: string) => void;
  onInviteFriends: () => void;
  onGoToDetails: () => void;
  onClose: () => void;
}

const SuccessModal: React.FC<SuccessModalProps> = ({
  visible,
  sport,
  friendProfiles,
  selectedFriendIds,
  invitedFriendIds,
  createdActivityId,
  noSelectionHintVisible,
  invitedState,
  onSelectFriend,
  onInviteFriends,
  onGoToDetails,
  onClose,
}) => {
  const { theme } = useTheme();
  
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const iconScale = useRef(new Animated.Value(0)).current;
  const iconRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Trigger haptic feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Staggered entrance animation
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Delayed icon animation
      setTimeout(() => {
        Animated.parallel([
          Animated.spring(iconScale, {
            toValue: 1,
            tension: 100,
            friction: 5,
            useNativeDriver: true,
          }),
          Animated.timing(iconRotate, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]).start();
      }, 200);
    } else {
      overlayOpacity.setValue(0);
      scaleAnim.setValue(0.7);
      slideAnim.setValue(50);
      iconScale.setValue(0);
      iconRotate.setValue(0);
    }
  }, [visible]);

  const iconRotation = iconRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (!visible) return null;

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalCard: {
      width: '100%',
      maxWidth: 500,
      backgroundColor: theme.card,
      borderRadius: 24,
      padding: 24,
      borderWidth: 1,
      borderColor: theme.border,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.3,
          shadowRadius: 16,
        },
        android: {
          elevation: 12,
        },
      }),
    },
    iconContainer: {
      width: 90,
      height: 90,
      borderRadius: 45,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'center',
      marginBottom: 20,
      borderWidth: 3,
      borderColor: theme.primary,
    },
    title: {
      fontSize: 26,
      fontWeight: 'bold',
      color: theme.primary,
      marginBottom: 8,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: theme.muted,
      textAlign: 'center',
      marginBottom: 20,
      lineHeight: 20,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.text,
      marginBottom: 12,
      marginTop: 8,
    },
    friendsList: {
      maxHeight: 260,
      marginBottom: 16,
    },
    friendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderRadius: 12,
      marginBottom: 8,
      backgroundColor: theme.background,
    },
    friendRowInvited: {
      opacity: 0.5,
    },
    friendLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    friendAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      marginRight: 12,
      borderWidth: 2,
      borderColor: theme.primary,
    },
    friendInfo: {
      flex: 1,
    },
    friendName: {
      color: theme.text,
      fontWeight: '600',
      fontSize: 15,
    },
    friendBio: {
      color: theme.muted,
      fontSize: 12,
      marginTop: 2,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxSelected: {
      backgroundColor: theme.primary,
    },
    noFriends: {
      fontSize: 14,
      color: theme.muted,
      textAlign: 'center',
      marginVertical: 20,
    },
    buttonContainer: {
      gap: 12,
      marginTop: 4,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      paddingHorizontal: 20,
      borderRadius: 12,
      gap: 10,
    },
    primaryButton: {
      backgroundColor: theme.primary,
    },
    primaryButtonDisabled: {
      backgroundColor: theme.primaryStrong,
    },
    secondaryButton: {
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderColor: theme.primary,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#fff', // Always white for primary buttons
    },
    primaryButtonText: {
      color: '#fff', // Always white
    },
    secondaryButtonText: {
      color: theme.primary,
    },
    toast: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 20,
      alignItems: 'center',
    },
    toastText: {
      backgroundColor: 'rgba(26, 233, 239, 0.2)',
      color: theme.text,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 16,
      fontWeight: '600',
      overflow: 'hidden',
    },
  });

  const hasSelectedFriends = Object.keys(selectedFriendIds).some(
    id => selectedFriendIds[id] && !invitedFriendIds.includes(id)
  );

  return (
    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
      <Animated.View
        style={[
          styles.modalCard,
          {
            transform: [
              { scale: scaleAnim },
              { translateY: slideAnim },
            ],
          },
        ]}
      >
        {/* Animated Activity Icon */}
        <Animated.View
          style={[
            styles.iconContainer,
            {
              transform: [
                { scale: iconScale },
                { rotate: iconRotation },
              ],
            },
          ]}
        >
          <ActivityIcon activity={sport} size={56} color={theme.primary} />
        </Animated.View>

        {/* Title & Subtitle */}
        <Text style={styles.title}>🎉 Activity Created!</Text>
        <Text style={styles.subtitle}>
          Your {sport} activity is live! Friends can now discover and join from their feed.
        </Text>

        {/* Friends List */}
        {friendProfiles.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>
              Invite friends to join this activity:
            </Text>
            <ScrollView style={styles.friendsList} showsVerticalScrollIndicator={false}>
              {friendProfiles.map((friend: any) => {
                const invited = invitedFriendIds.includes(friend.uid);
                const selected = !!selectedFriendIds[friend.uid];
                return (
                  <TouchableOpacity
                    key={friend.uid}
                    style={[
                      styles.friendRow,
                      invited && styles.friendRowInvited,
                    ]}
                    onPress={() => onSelectFriend(friend.uid)}
                    activeOpacity={invited ? 1 : 0.7}
                    disabled={invited}
                  >
                    <View style={styles.friendLeft}>
                      <Image
                        source={{
                          uri: friend.photo || friend.photoURL || 
                            `https://ui-avatars.com/api/?name=${encodeURIComponent(friend.username || 'User')}`
                        }}
                        style={styles.friendAvatar}
                      />
                      <View style={styles.friendInfo}>
                        <Text style={styles.friendName}>
                          {friend.username || 'User'}
                        </Text>
                        {friend.bio ? (
                          <Text style={styles.friendBio} numberOfLines={1}>
                            {friend.bio}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View
                      style={[
                        styles.checkbox,
                        (selected || invited) && styles.checkboxSelected,
                      ]}
                    >
                      {(selected || invited) && (
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color={theme.isDark ? '#111' : '#fff'}
                        />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Invite Button */}
            <TouchableOpacity
              style={[
                styles.button,
                hasSelectedFriends ? styles.primaryButton : styles.primaryButtonDisabled,
              ]}
              onPress={onInviteFriends}
              disabled={!hasSelectedFriends}
            >
              <Ionicons
                name="send"
                size={20}
                color="#fff"
              />
              <Text style={styles.buttonText}>
                {invitedState && !hasSelectedFriends
                  ? 'Friends Invited!'
                  : 'Send Invites'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.noFriends}>
            No friends to invite yet. Add friends to invite them to your activities!
          </Text>
        )}

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={onGoToDetails}
          >
            <Ionicons name="information-circle" size={20} color="#fff" />
            <Text style={styles.buttonText}>
              View Activity Details
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={onClose}
          >
            <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>
              Done
            </Text>
          </TouchableOpacity>
        </View>

        {/* Toast */}
        {noSelectionHintVisible && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>Please select friends to invite</Text>
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
};

const CreateGameScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  const [gpxFile, setGpxFile] = useState<any>(null);
  const [gpxUploading, setGpxUploading] = useState(false);
  const [gpxStats, setGpxStats] = useState<any>({
    distance: '',
    ascent: '',
    descent: '',
    maxElevation: '',
    difficulty: '',
    routeType: '',
  });
  const [drawnRoute, setDrawnRoute] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [showRouteDrawer, setShowRouteDrawer] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);

  // Keyboard state for adjusting ScrollView padding so inputs appear above keyboard
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);

  // Refs for route stats inputs so 'Next' moves to the next field
  const distanceRef = useRef<any>(null);
  const ascentRef = useRef<any>(null);
  const descentRef = useRef<any>(null);
  const maxElevationRef = useRef<any>(null);
  const difficultyRef = useRef<any>(null);
  const routeTypeRef = useRef<any>(null);

  // Picker modals
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showParticipantsPicker, setShowParticipantsPicker] = useState(false);
  const [showDifficultyPicker, setShowDifficultyPicker] = useState(false);
  const [showRouteTypePicker, setShowRouteTypePicker] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const pullAnim = useRef(new Animated.Value(0)).current; // pixels pulled down when at top
  const CLEAR_THRESHOLD = 120; // pull distance to clear
  const lastPullRef = useRef(0);
  const HEADER_OVERLAY_OFFSET = 60; // position overlay lower, near the title

  useEffect(() => {
    const timeout = setTimeout(() => setIsReady(true), 500);
    return () => clearTimeout(timeout);
  }, []);

  // Clear GPX when switching away from activities that support GPX (Hiking, Running, Cycling)
  useEffect(() => {
    const supportsGpx = sport === 'Hiking' || sport === 'Running' || sport === 'Cycling';
    if (!supportsGpx) {
      setGpxFile(null);
      setDrawnRoute([]);
      setGpxStats({ distance: '', ascent: '', descent: '', maxElevation: '', difficulty: '', routeType: '' });
    }
  }, [sport]);

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
    setGpxFile(null);
    setGpxUploading(false);
    setDrawnRoute([]);
    setGpxStats({ distance: '', ascent: '', descent: '', maxElevation: '', difficulty: '', routeType: '' });
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

  // GPX picking & upload
  const pickGpxFile = async () => {
    try {
      // dynamic import so app doesn't crash if expo-document-picker isn't installed
      // @ts-ignore - optional dependency, dynamically imported
      const DocumentPicker: any = await import('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      // Support both legacy API ({ type: 'success'|'cancel', uri, name })
      // and newer API ({ assets: [{ uri, name, ... }], canceled })
      if (res?.type === 'cancel' || res?.canceled === true) return;

      // Prefer direct uri, then assets[0].uri
      const uri: string | null = (res as any).uri ?? (res as any)?.assets?.[0]?.uri ?? null;
      if (!uri) {
        console.warn('pickGpxFile: picker returned no uri', res);
        Alert.alert('Unable to read file', 'The selected file did not return a usable URI. Please try again or choose a different file.');
        return;
      }

      const assetName = (res as any).name ?? (res as any)?.assets?.[0]?.name;
      const name = assetName || (uri && uri.split('/').pop()) || 'route.gpx';
      if (!name.toLowerCase().endsWith('.gpx')) {
        Alert.alert('Invalid file', 'Please choose a .gpx file.');
        return;
      }
      
      // Show loading indicator
      setGpxUploading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      // Parse GPX to extract statistics
      try {
        const gpxContent = await FileSystem.readAsStringAsync(uri);
        const stats = parseGpxStats(gpxContent);
        
        // Auto-fill stats if they were successfully extracted
        if (stats.distance) setGpxStats((s: any) => ({ ...s, distance: stats.distance }));
        if (stats.ascent) setGpxStats((s: any) => ({ ...s, ascent: stats.ascent }));
        if (stats.descent) setGpxStats((s: any) => ({ ...s, descent: stats.descent }));
        if (stats.maxElevation) setGpxStats((s: any) => ({ ...s, maxElevation: stats.maxElevation }));
      } catch (parseErr) {
        console.warn('Could not parse GPX stats:', parseErr);
        // Don't block - user can still upload and enter manually
      }
      
      // Start upload
      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert('Not signed in', 'Please sign in to upload GPX files.');
        return;
      }
  // Do NOT upload immediately. Store selection locally and upload when creating the activity.
  setGpxFile({ uri, name });
    } catch (err: any) {
      console.warn('pickGpxFile error', err);
      Alert.alert('Upload failed', err?.message || 'Could not upload GPX file.');
    } finally {
      setGpxUploading(false);
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

    try {
      setCreating(true);
      // If a GPX was selected but not yet uploaded, upload it now and attach the storage info
      let effectiveGpx: any = gpxFile ? { ...gpxFile } : null;
      if (effectiveGpx && !effectiveGpx.storagePath) {
        setGpxUploading(true);
        try {
          const dest = `gpx/${uid}/${Date.now()}_${effectiveGpx.name}`;
          const uploaded = await uploadGpxFile(effectiveGpx.uri, dest);
          // Use the freshly uploaded values immediately to avoid relying on async state
          effectiveGpx = {
            ...effectiveGpx,
            storagePath: uploaded.storagePath,
            downloadUrl: uploaded.downloadUrl,
          };
          console.log('[CreateGame] GPX upload complete:', effectiveGpx);
          // Also reflect in state for UI continuity
          setGpxFile((prev: any) => ({ ...(prev || {}), storagePath: uploaded.storagePath, downloadUrl: uploaded.downloadUrl }));
        } catch (uploadErr) {
          console.warn('GPX upload failed during create:', uploadErr);
          Alert.alert('Upload failed', 'Could not upload GPX file. Activity not created. Please try again.');
          setCreating(false);
          return;
        } finally {
          setGpxUploading(false);
        }
      }

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
        // include gpx metadata if present
        ...(effectiveGpx
          ? {
              gpx: {
                filename: effectiveGpx.name || effectiveGpx.filename || null,
                storagePath: effectiveGpx.storagePath || null,
                downloadUrl: effectiveGpx.downloadUrl || null,
                stats: gpxStats,
              },
            }
          : {}),
        // include drawn route if present
        ...(drawnRoute.length > 0
          ? {
              drawnRoute: drawnRoute,
            }
          : {}),
      };

  console.log('[CreateGame] Creating activity with GPX:', (newGame as any).gpx || '(none)');
  const newId = await createActivity(newGame as any); // Save to Firestore and get id
  console.log('[CreateGame] Activity created with id:', newId);
      setJoinedActivities(prev => Array.from(new Set([...prev, newId])));
      await reloadAllActivities();
      try {
        const { getOrCreateChatForActivity } = await import('../utils/firestoreChats');
        await getOrCreateChatForActivity(newId, uid);
      } catch {}

      // Save the sport type BEFORE resetting form
      const createdSport = sport;
      resetForm();
      setCreatedActivityId(newId);
      // Restore sport temporarily for the success modal
      setSport(createdSport);
      setShowSuccessModal(true);
      // Load friends for modal (exclude self)
      const myFriendIds: string[] = Array.isArray(profile?.friends) ? profile.friends : [];
      if (myFriendIds.length) {
        try {
          const users = await import('../utils/firestoreFriends').then(mod => mod.fetchUsersByIds(myFriendIds));
          // Filter out current user from friends list
          const filteredUsers = users.filter((u: any) => u.uid !== uid);
          setFriendProfiles(filteredUsers);
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

  // Listen for keyboard show/hide and set bottom padding accordingly (works for Android and iOS)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: any) => setKeyboardHeight(e.endCoordinates?.height || 0);
    const onHide = () => setKeyboardHeight(0);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      try { subShow.remove(); } catch {}
      try { subHide.remove(); } catch {}
    };
  }, []);

  if (!isReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <ActivityIndicator size="large" color={theme.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* Pull-to-reset indicator overlay */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pullOverlay,
            {
              top: insets.top + HEADER_OVERLAY_OFFSET,
              opacity: pullAnim.interpolate({
                inputRange: [0, 15, CLEAR_THRESHOLD * 0.5, CLEAR_THRESHOLD],
                outputRange: [0, 0.3, 0.85, 1],
                extrapolate: 'clamp',
              }),
              transform: [
                {
                  scale: pullAnim.interpolate({
                    inputRange: [0, CLEAR_THRESHOLD],
                    outputRange: [0.5, 1.05],
                    extrapolate: 'clamp',
                  }),
                },
                {
                  translateY: pullAnim.interpolate({
                    inputRange: [0, CLEAR_THRESHOLD],
                    outputRange: [-10, 0],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            },
          ]}
        >
          {/* Animated circle background */}
          <Animated.View
            style={[
              styles.resetCircle,
              {
                backgroundColor: theme.card,
                borderColor: pullAnim.interpolate({
                  inputRange: [0, CLEAR_THRESHOLD * 0.5, CLEAR_THRESHOLD],
                  outputRange: [theme.border, theme.primaryStrong, theme.primary],
                  extrapolate: 'clamp',
                }),
                transform: [
                  {
                    rotate: pullAnim.interpolate({
                      inputRange: [0, CLEAR_THRESHOLD],
                      outputRange: ['0deg', '180deg'],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          >
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: pullAnim.interpolate({
                      inputRange: [0, CLEAR_THRESHOLD],
                      outputRange: ['0deg', '-180deg'],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              }}
            >
              <Ionicons 
                name="refresh" 
                size={24} 
                color={theme.primary}
              />
            </Animated.View>
          </Animated.View>

          {/* Progress indicator */}
          <Animated.View
            style={[
              styles.progressBar,
              {
                width: pullAnim.interpolate({
                  inputRange: [0, CLEAR_THRESHOLD],
                  outputRange: ['0%', '100%'],
                  extrapolate: 'clamp',
                }),
                backgroundColor: pullAnim.interpolate({
                  inputRange: [0, CLEAR_THRESHOLD * 0.5, CLEAR_THRESHOLD],
                  outputRange: [theme.border, theme.primaryStrong, theme.primary],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          />

          {/* Text instructions */}
          <Animated.Text
            style={[
              styles.pullResetText,
              {
                color: theme.text,
                opacity: pullAnim.interpolate({
                  inputRange: [0, CLEAR_THRESHOLD * 0.7, CLEAR_THRESHOLD],
                  outputRange: [1, 1, 0],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            Pull down to reset form
          </Animated.Text>

          {/* Release text - appears near threshold */}
          <Animated.Text
            style={[
              styles.pullResetText,
              {
                position: 'absolute',
                top: 88,
                color: theme.primary,
                fontWeight: '700',
                opacity: pullAnim.interpolate({
                  inputRange: [0, CLEAR_THRESHOLD * 0.7, CLEAR_THRESHOLD - 5, CLEAR_THRESHOLD],
                  outputRange: [0, 0, 0.8, 1],
                  extrapolate: 'clamp',
                }),
                transform: [
                  {
                    scale: pullAnim.interpolate({
                      inputRange: [0, CLEAR_THRESHOLD * 0.7, CLEAR_THRESHOLD],
                      outputRange: [0.8, 0.8, 1.1],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          >
            ✓ Release to reset
          </Animated.Text>
        </Animated.View>

        {/* Success Modal Popup */}
        <Modal
          visible={showSuccessModal}
          transparent
          animationType="none"
          onRequestClose={() => setShowSuccessModal(false)}
        >
          {/* Pass sport with fallback to prevent empty/undefined issues */}
          <SuccessModal
            visible={showSuccessModal}
            sport={sport || 'Soccer'}
            friendProfiles={friendProfiles}
            selectedFriendIds={selectedFriendIds}
            invitedFriendIds={invitedFriendIds}
            createdActivityId={createdActivityId}
            noSelectionHintVisible={noSelectionHintVisible}
            invitedState={invitedState}
            onSelectFriend={(friendId: string) => {
              if (!invitedFriendIds.includes(friendId)) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedFriendIds(prev => ({ ...prev, [friendId]: !prev[friendId] }));
              }
            }}
            onInviteFriends={async () => {
              const selected = Object.keys(selectedFriendIds).filter(id => selectedFriendIds[id] && !invitedFriendIds.includes(id));
              if (selected.length === 0) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                setNoSelectionHintVisible(true);
                if (noSelectionTimerRef.current) clearTimeout(noSelectionTimerRef.current);
                noSelectionTimerRef.current = setTimeout(() => setNoSelectionHintVisible(false), 1800);
                return;
              }
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
              setSelectedFriendIds({});
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Invites',
                sent > 0
                  ? `Sent invites to ${sent} friend${sent === 1 ? '' : 's'}${skipped ? ` (skipped ${skipped} already joined)` : ''}.`
                  : `No invites sent. ${skipped} skipped (already joined).`
              );
            }}
            onGoToDetails={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (createdActivityId) {
                setShowSuccessModal(false);
                // Clear sport after navigating since form was already reset
                setSport('');
                navigation.navigate('ActivityDetails', { activityId: createdActivityId });
              }
            }}
            onClose={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowSuccessModal(false);
              // Clear sport after modal closes since form was already reset
              setSport('');
            }}
          />
        </Modal>

        <View style={styles.header}>
          <Text style={styles.headerTitle}>Create Activity</Text>
        </View>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[styles.form, { paddingBottom: Math.max(20, keyboardHeight + 20) }]}
            scrollEventThrottle={16}
            onScroll={handleScroll}
            onScrollEndDrag={handleRelease}
            overScrollMode="always"
            alwaysBounceVertical
            keyboardShouldPersistTaps="handled"
          >
          <Text style={styles.sectionLabel}>Select Sport</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {(
              () => {
                const all = [...new Set(sportOptions)];
                const favs: string[] = (profile?.sportsPreferences || profile?.selectedSports || []) as string[];
                const favSet = new Set(favs.map(s => String(s).toLowerCase()));
                const favList = all.filter(s => favSet.has(s.toLowerCase())).sort((a, b) => a.localeCompare(b));
                const restList = all.filter(s => !favSet.has(s.toLowerCase())).sort((a, b) => a.localeCompare(b));
                return [...favList, ...restList];
              }
            )().map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.sportButton, sport === option && styles.activeButton]}
                onPress={() => setSport(option)}
              >
                <ActivityIcon
                  activity={option}
                  size={32}
                  color={sport === option ? '#fff' : theme.primary}
                />
                <Text style={[styles.sportText, sport === option && { color: '#fff' }]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.sectionLabel}>Description</Text>
          <TextInput
            style={[styles.input, { height: 80 }]} // 3-4 lines
            placeholder="Describe your activity (optional)"
            placeholderTextColor={theme.muted}
            value={description}
            onChangeText={t => setDescription(t.slice(0, 200))}
            multiline
            maxLength={200}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 4 }}>
            <Text style={{ color: theme.muted, fontSize: 13 }}>{description.length}/200</Text>
          </View>

          <Text style={styles.sectionLabel}>{(sport === 'Hiking' || sport === 'Running' || sport === 'Cycling') ? 'Meeting point' : 'Location'}</Text>
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
              placeholder={(sport === 'Hiking' || sport === 'Running' || sport === 'Cycling') ? 'Pick meeting point' : 'Pick a location'}
              placeholderTextColor={theme.muted}
              value={location}
              editable={false}
              pointerEvents="none"
            />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <TouchableOpacity
              style={[
                styles.mapButton,
                selectedCoords ? { backgroundColor: theme.isDark ? '#009fa3' : theme.primaryStrong } : null,
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
                {selectedCoords
                  ? ((sport === 'Hiking' || sport === 'Running' || sport === 'Cycling') ? 'Change meeting point on map' : 'Change Location on Map')
                  : ((sport === 'Hiking' || sport === 'Running' || sport === 'Cycling') ? 'Pick meeting point on map' : 'Pick on Map')}
              </Text>
            </TouchableOpacity>
          </View>

          {(sport === 'Hiking' || sport === 'Running' || sport === 'Cycling') && (
            <>
              <Text style={styles.sectionLabel}>
                {sport === 'Hiking' ? 'Hiking Route (optional)'
                  : sport === 'Running' ? 'Running Route (optional)'
                  : 'Cycling Route (optional)'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                <TouchableOpacity
                  style={[
                    styles.mapButton,
                    gpxFile ? { backgroundColor: theme.isDark ? '#009fa3' : '#1ae9ef' } : null,
                    drawnRoute.length > 0 && { opacity: 0.5 },
                  ]}
                  onPress={pickGpxFile}
                  disabled={gpxUploading || drawnRoute.length > 0}
                >
                  {gpxUploading ? (
                    <ActivityIndicator size="small" color={'#fff'} />
                  ) : (
                    <>
                      <Ionicons name="map" size={18} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>{gpxFile ? 'Replace GPX' : 'Upload GPX'}</Text>
                    </>
                  )}
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[
                    styles.mapButton,
                    drawnRoute.length > 0 ? { backgroundColor: theme.isDark ? '#009fa3' : '#1ae9ef' } : null,
                    gpxFile && { opacity: 0.5 },
                  ]}
                  disabled={!!gpxFile}
                  onPress={() => {
                    if (!selectedCoords) {
                      Alert.alert('Meeting Point Required', 'Please select a meeting point first before drawing a route on the map.');
                      return;
                    }
                    setShowRouteDrawer(true);
                  }}
                >
                  <Ionicons name="pencil" size={16} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                    {drawnRoute.length > 0 ? 'Edit Route' : 'Draw Route'}
                  </Text>
                </TouchableOpacity>
                
                {gpxFile ? (
                  <View style={{ marginLeft: 12, flex: 1, alignItems: 'center' }}>
                    <Text style={{ color: theme.text, fontWeight: '600' }} numberOfLines={1}>{gpxFile.name || gpxFile.filename}</Text>
                    <TouchableOpacity onPress={() => { 
                      setGpxFile(null); 
                      setGpxStats({ distance: '', ascent: '', descent: '', maxElevation: '', difficulty: '', routeType: '' });
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }} style={{ marginTop: 6 }}>
                      <Text style={{ color: theme.danger, fontWeight: '700' }}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ) : drawnRoute.length > 0 ? (
                  <View style={{ marginLeft: 12, flex: 1, alignItems: 'center' }}>
                    <Text style={{ color: theme.text, fontWeight: '600' }}>{drawnRoute.length} points</Text>
                    <TouchableOpacity onPress={() => { 
                      setDrawnRoute([]); 
                      setGpxStats({ distance: '', ascent: '', descent: '', maxElevation: '', difficulty: '', routeType: '' });
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }} style={{ marginTop: 6 }}>
                      <Text style={{ color: theme.danger, fontWeight: '700' }}>Clear Route</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              <View style={styles.routeStatsContainer}>
                <View style={styles.routeStatsHeader}>
                  <Ionicons name="stats-chart" size={20} color={theme.primary} />
                  <Text style={styles.routeStatsTitle}>Route Statistics</Text>
                  <Text style={styles.routeStatsOptional}>(optional)</Text>
                </View>
                
                {gpxUploading ? (
                  <View style={{ paddingVertical: 40, alignItems: 'center', gap: 12 }}>
                    <ActivityIndicator size="large" color={theme.primary} />
                    <Text style={{ color: theme.muted, fontSize: 15 }}>Loading route statistics...</Text>
                  </View>
                ) : (
                  <>
                <View style={styles.statRow}>
                  <View style={styles.statLabelContainer}>
                    <Ionicons name="trail-sign" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                    <Text style={styles.statLabel}>Distance</Text>
                  </View>
                  <TextInput
                    ref={distanceRef}
                    style={styles.statInput}
                    placeholder="e.g. 20.86 km"
                    placeholderTextColor={theme.muted}
                    value={gpxStats.distance}
                    onChangeText={(t) => setGpxStats((s: any) => ({ ...s, distance: t }))}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => ascentRef.current?.focus()}
                    onFocus={() => {
                      setTimeout(() => {
                        scrollRef.current?.scrollTo({ y: 300, animated: true });
                      }, 100);
                    }}
                  />
                </View>
                
                <View style={styles.statRow}>
                  <View style={styles.statLabelContainer}>
                    <Ionicons name="trending-up" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                    <Text style={styles.statLabel}>Ascent</Text>
                  </View>
                  <TextInput
                    ref={ascentRef}
                    style={styles.statInput}
                    placeholder="e.g. 345 m"
                    placeholderTextColor={theme.muted}
                    value={gpxStats.ascent}
                    onChangeText={(t) => setGpxStats((s: any) => ({ ...s, ascent: t }))}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => descentRef.current?.focus()}
                    onFocus={() => {
                      setTimeout(() => {
                        scrollRef.current?.scrollTo({ y: 350, animated: true });
                      }, 100);
                    }}
                  />
                </View>
                
                <View style={styles.statRow}>
                  <View style={styles.statLabelContainer}>
                    <Ionicons name="trending-down" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                    <Text style={styles.statLabel}>Descent</Text>
                  </View>
                  <TextInput
                    ref={descentRef}
                    style={styles.statInput}
                    placeholder="e.g. 1,135 m"
                    placeholderTextColor={theme.muted}
                    value={gpxStats.descent}
                    onChangeText={(t) => setGpxStats((s: any) => ({ ...s, descent: t }))}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => maxElevationRef.current?.focus()}
                    onFocus={() => {
                      setTimeout(() => {
                        scrollRef.current?.scrollTo({ y: 400, animated: true });
                      }, 100);
                    }}
                  />
                </View>
                
                <View style={styles.statRow}>
                  <View style={styles.statLabelContainer}>
                    <Ionicons name="arrow-up-circle" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                    <Text style={styles.statLabel}>Max Elevation</Text>
                  </View>
                  <TextInput
                    ref={maxElevationRef}
                    style={styles.statInput}
                    placeholder="e.g. 1,059 m"
                    placeholderTextColor={theme.muted}
                    value={gpxStats.maxElevation}
                    onChangeText={(t) => setGpxStats((s: any) => ({ ...s, maxElevation: t }))}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => difficultyRef.current?.focus()}
                    onFocus={() => {
                      setTimeout(() => {
                        scrollRef.current?.scrollTo({ y: 450, animated: true });
                      }, 100);
                    }}
                  />
                </View>
                
                <View style={styles.statRow}>
                  <View style={styles.statLabelContainer}>
                    <Ionicons name="speedometer" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                    <Text style={styles.statLabel}>Difficulty</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.statInput, { justifyContent: 'center' }]}
                    onPress={() => setShowDifficultyPicker(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: gpxStats.difficulty ? theme.text : theme.muted, fontWeight: gpxStats.difficulty ? '600' : '400' }}>
                      {gpxStats.difficulty || 'Select difficulty'}
                    </Text>
                  </TouchableOpacity>
                </View>
                
                <View style={styles.statRow}>
                  <View style={styles.statLabelContainer}>
                    <Ionicons name="git-branch" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                    <Text style={styles.statLabel}>Route Type</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.statInput, { justifyContent: 'center' }]}
                    onPress={() => setShowRouteTypePicker(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: gpxStats.routeType ? theme.text : theme.muted, fontWeight: gpxStats.routeType ? '600' : '400' }}>
                      {gpxStats.routeType || 'Select route type'}
                    </Text>
                  </TouchableOpacity>
                </View>
                </>
                )}
              </View>
            </>
          )}

          <Text style={styles.sectionLabel}>Date</Text>
          <TouchableOpacity onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
            <TextInput
              style={styles.input}
              placeholder="DD-MM-YYYY"
              placeholderTextColor={theme.muted}
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
                    themeVariant={theme.isDark ? 'dark' : 'light'}
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
              placeholderTextColor={theme.muted}
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
                    themeVariant={theme.isDark ? 'dark' : 'light'}
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
            <Text style={{ color: theme.isDark ? '#fff' : theme.text, fontWeight: 'bold' }}>
              {maxParticipants}
            </Text>
          </TouchableOpacity>
          {/* Max Participants Picker Modal (iOS uses native spinner, Android uses list) */}
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
                    style={styles.rollerPicker}
                    itemStyle={{ color: theme.text, fontSize: 22 }}
                  >
                    {[...Array(29)].map((_, i) => (
                      <Picker.Item key={i + 2} label={`${i + 2}`} value={i + 2} />
                    ))}
                  </Picker>
                </View>
              </View>
            </Modal>
          )}
          {Platform.OS === 'android' && (
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
                  <ScrollView style={{ maxHeight: 260 }}>
                    {[...Array(29)].map((_, i) => {
                      const value = i + 2;
                      const isSelected = maxParticipants === value;
                      return (
                        <TouchableOpacity
                          key={value}
                          style={{
                            paddingVertical: 16,
                            paddingHorizontal: 20,
                            backgroundColor: isSelected ? theme.primary : 'transparent',
                            borderBottomWidth: 1,
                            borderBottomColor: theme.border,
                          }}
                          onPress={() => setMaxParticipants(value)}
                        >
                          <Text style={{
                            color: isSelected ? '#fff' : theme.text,
                            fontSize: 18,
                            fontWeight: isSelected ? 'bold' : '500',
                            textAlign: 'center',
                          }}>
                            {value}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            </Modal>
          )}

          {/* Difficulty Picker Modal (iOS only) */}
          {Platform.OS === 'ios' && (
            <Modal transparent animationType="slide" visible={showDifficultyPicker} onRequestClose={() => setShowDifficultyPicker(false)}>
              <View style={styles.pickerModal}>
                <View style={styles.rollerContainer}>
                  <View style={styles.rollerHeader}>
                    <TouchableOpacity onPress={() => setShowDifficultyPicker(false)}>
                      <Text style={styles.rollerCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowDifficultyPicker(false)}>
                      <Text style={styles.rollerDone}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <Picker
                    selectedValue={gpxStats.difficulty}
                    onValueChange={(value) => setGpxStats((s: any) => ({ ...s, difficulty: value }))}
                    style={styles.rollerPicker}
                    itemStyle={{ fontSize: 22 }}
                  >
                    <Picker.Item label="Select difficulty" value="" />
                    <Picker.Item label="Easy" value="Easy" />
                    <Picker.Item label="Moderate" value="Moderate" />
                    <Picker.Item label="Hard" value="Hard" />
                    <Picker.Item label="Very Hard" value="Very Hard" />
                    <Picker.Item label="Expert" value="Expert" />
                  </Picker>
                </View>
              </View>
            </Modal>
          )}
          {Platform.OS === 'android' && showDifficultyPicker && (
            <Modal transparent animationType="slide" visible={showDifficultyPicker} onRequestClose={() => setShowDifficultyPicker(false)}>
              <View style={styles.pickerModal}>
                <View style={styles.rollerContainer}>
                  <Picker
                    selectedValue={gpxStats.difficulty}
                    onValueChange={(value) => {
                      setGpxStats((s: any) => ({ ...s, difficulty: value }));
                      setShowDifficultyPicker(false);
                    }}
                    style={{ width: '100%' }}
                    itemStyle={{ fontSize: 22 }}
                  >
                    <Picker.Item label="Select difficulty" value="" />
                    <Picker.Item label="Easy" value="Easy" />
                    <Picker.Item label="Moderate" value="Moderate" />
                    <Picker.Item label="Hard" value="Hard" />
                    <Picker.Item label="Very Hard" value="Very Hard" />
                    <Picker.Item label="Expert" value="Expert" />
                  </Picker>
                </View>
              </View>
            </Modal>
          )}

          {/* Route Type Picker Modal (iOS only) */}
          {Platform.OS === 'ios' && (
            <Modal transparent animationType="slide" visible={showRouteTypePicker} onRequestClose={() => setShowRouteTypePicker(false)}>
              <View style={styles.pickerModal}>
                <View style={styles.rollerContainer}>
                  <View style={styles.rollerHeader}>
                    <TouchableOpacity onPress={() => setShowRouteTypePicker(false)}>
                      <Text style={styles.rollerCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowRouteTypePicker(false)}>
                      <Text style={styles.rollerDone}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <Picker
                    selectedValue={gpxStats.routeType}
                    onValueChange={(value) => setGpxStats((s: any) => ({ ...s, routeType: value }))}
                    style={styles.rollerPicker}
                    itemStyle={{ fontSize: 22 }}
                  >
                    <Picker.Item label="Select route type" value="" />
                    <Picker.Item label="Loop" value="Loop" />
                    <Picker.Item label="Out and back" value="Out and back" />
                    <Picker.Item label="Point to point" value="Point to point" />
                  </Picker>
                </View>
              </View>
            </Modal>
          )}
          {Platform.OS === 'android' && showRouteTypePicker && (
            <Modal transparent animationType="slide" visible={showRouteTypePicker} onRequestClose={() => setShowRouteTypePicker(false)}>
              <View style={styles.pickerModal}>
                <View style={styles.rollerContainer}>
                  <Picker
                    selectedValue={gpxStats.routeType}
                    onValueChange={(value) => {
                      setGpxStats((s: any) => ({ ...s, routeType: value }));
                      setShowRouteTypePicker(false);
                    }}
                    style={{ width: '100%' }}
                    itemStyle={{ fontSize: 22 }}
                  >
                    <Picker.Item label="Select route type" value="" />
                    <Picker.Item label="Loop" value="Loop" />
                    <Picker.Item label="Out and back" value="Out and back" />
                    <Picker.Item label="Point to point" value="Point to point" />
                  </Picker>
                </View>
              </View>
            </Modal>
          )}

          <TouchableOpacity
            style={[
              styles.createButton,
              creating ? { backgroundColor: theme.isDark ? '#009fa3' : theme.primaryStrong } : null
            ]}
            onPress={creating ? undefined : handleCreateGame}
            disabled={creating}
          >
            {creating && <ActivityIndicator size="small" color="#fff" />}
            <Text style={[styles.createButtonText, { color: '#fff' }]}>
              {creating ? 'Creating Activity' : 'Create Activity'}
            </Text>
          </TouchableOpacity>
          </ScrollView>
        </Animated.View>

        {/* Route Drawing Modal */}
        {showRouteDrawer && selectedCoords && (
          <Modal
            visible={showRouteDrawer}
            animationType="slide"
            onRequestClose={() => setShowRouteDrawer(false)}
          >
            <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top }}>
              {/* Header */}
              <View style={{ backgroundColor: theme.card, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
                  <TouchableOpacity onPress={() => setShowRouteDrawer(false)}>
                    <Ionicons name="close" size={28} color={theme.text} />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 18, fontWeight: 'bold', color: theme.primary }}>Draw Your Route</Text>
                  <TouchableOpacity onPress={() => {
                    if (drawnRoute.length < 2) {
                      Alert.alert('Route Too Short', 'Please draw a route with at least 2 points.');
                      return;
                    }
                    
                    // Calculate distance and auto-fill
                    let totalDistance = 0;
                    for (let i = 1; i < drawnRoute.length; i++) {
                      totalDistance += calculateDistance(
                        drawnRoute[i - 1].latitude,
                        drawnRoute[i - 1].longitude,
                        drawnRoute[i].latitude,
                        drawnRoute[i].longitude
                      );
                    }
                    
                    // Set the distance in gpxStats
                    setGpxStats((s: any) => ({ ...s, distance: `${totalDistance.toFixed(2)} km` }));
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    setShowRouteDrawer(false);
                  }}>
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: theme.primary }}>Done</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ paddingHorizontal: 16, paddingBottom: 12, fontSize: 13, color: theme.muted }}>
                  {isDrawingMode ? 'Drawing mode active - drag your finger to draw the route' : 'Scroll and zoom to explore, then enable drawing mode'}
                </Text>
              </View>

              {/* Map */}
              <MapView
                style={{ flex: 1 }}
                initialRegion={{
                  latitude: selectedCoords.latitude,
                  longitude: selectedCoords.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
                scrollEnabled={!isDrawingMode}
                zoomEnabled={!isDrawingMode}
                rotateEnabled={!isDrawingMode}
                pitchEnabled={!isDrawingMode}
                onPanDrag={isDrawingMode ? (e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  setDrawnRoute(prev => {
                    // Avoid adding duplicate points too close together
                    if (prev.length > 0) {
                      const last = prev[prev.length - 1];
                      const distance = Math.sqrt(
                        Math.pow(latitude - last.latitude, 2) + 
                        Math.pow(longitude - last.longitude, 2)
                      );
                      // Only add point if it's far enough from the last one
                      if (distance < 0.0001) return prev;
                    }
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    return [...prev, { latitude, longitude }];
                  });
                } : undefined}
                userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
              >
                {/* Meeting Point Marker */}
                {Platform.OS === 'android' ? (
                  <Marker
                    coordinate={selectedCoords}
                    title="Meeting Point"
                    pinColor={theme.primary}
                  />
                ) : (
                  <Marker
                    coordinate={selectedCoords}
                    title="Meeting Point"
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ backgroundColor: theme.primary, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' }}>
                        <Ionicons name="location" size={24} color="#fff" />
                      </View>
                    </View>
                  </Marker>
                )}

                {/* Drawn Route Polyline */}
                {drawnRoute.length > 1 && (
                  <Polyline
                    coordinates={drawnRoute}
                    strokeColor={theme.primary}
                    strokeWidth={4}
                  />
                )}

                {/* Start and End Markers */}
                {drawnRoute.length > 0 && (
                  <Marker
                    coordinate={drawnRoute[0]}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <View style={{ backgroundColor: '#4CAF50', width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>S</Text>
                    </View>
                  </Marker>
                )}
                {drawnRoute.length > 1 && (
                  <Marker
                    coordinate={drawnRoute[drawnRoute.length - 1]}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <View style={{ backgroundColor: '#f44336', width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>E</Text>
                    </View>
                  </Marker>
                )}
              </MapView>

              {/* Bottom Controls */}
              <View style={{ backgroundColor: theme.card, borderTopWidth: 1, borderTopColor: theme.border, padding: 16, paddingBottom: Math.max(16, insets.bottom) }}>
                {/* Route Distance Display */}
                {drawnRoute.length > 1 && (
                  <View style={{ backgroundColor: theme.background, padding: 12, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: theme.primary }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Ionicons name="trail-sign" size={18} color={theme.primary} />
                      <Text style={{ color: theme.text, fontWeight: 'bold', fontSize: 16 }}>
                        Route Distance: {(() => {
                          let totalDistance = 0;
                          for (let i = 1; i < drawnRoute.length; i++) {
                            totalDistance += calculateDistance(
                              drawnRoute[i - 1].latitude,
                              drawnRoute[i - 1].longitude,
                              drawnRoute[i].latitude,
                              drawnRoute[i].longitude
                            );
                          }
                          return `${totalDistance.toFixed(2)} km`;
                        })()}
                      </Text>
                    </View>
                  </View>
                )}
                
                {/* Drawing Mode Toggle */}
                <TouchableOpacity
                  style={{
                    backgroundColor: isDrawingMode ? theme.primary : theme.card,
                    paddingVertical: 14,
                    borderRadius: 10,
                    alignItems: 'center',
                    marginBottom: 12,
                    borderWidth: 2,
                    borderColor: theme.primary,
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                  onPress={() => {
                    setIsDrawingMode(!isDrawingMode);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  }}
                >
                  <Ionicons name={isDrawingMode ? "lock-closed" : "lock-open"} size={20} color={isDrawingMode ? '#fff' : theme.primary} />
                  <Text style={{ color: isDrawingMode ? '#fff' : theme.primary, fontWeight: 'bold', fontSize: 16 }}>
                    {isDrawingMode ? 'Drawing Mode ON' : 'Enable Drawing'}
                  </Text>
                </TouchableOpacity>
                
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      backgroundColor: theme.danger,
                      paddingVertical: 14,
                      borderRadius: 10,
                      alignItems: 'center',
                      opacity: drawnRoute.length === 0 ? 0.5 : 1,
                    }}
                    onPress={() => {
                      if (drawnRoute.length > 0) {
                        Alert.alert(
                          'Clear Route',
                          'Are you sure you want to clear the entire route?',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Clear', style: 'destructive', onPress: () => setDrawnRoute([]) },
                          ]
                        );
                      }
                    }}
                    disabled={drawnRoute.length === 0}
                  >
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>Clear</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      backgroundColor: drawnRoute.length > 0 ? theme.primary : theme.muted,
                      paddingVertical: 14,
                      borderRadius: 10,
                      alignItems: 'center',
                      opacity: drawnRoute.length === 0 ? 0.5 : 1,
                    }}
                    onPress={() => {
                      if (drawnRoute.length > 0) {
                        const undoCount = Math.min(50, Math.floor(drawnRoute.length / 10));
                        setDrawnRoute(prev => prev.slice(0, -undoCount));
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      }
                    }}
                    disabled={drawnRoute.length === 0}
                  >
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>Undo</Text>
                  </TouchableOpacity>
                </View>
                
                <Text style={{ textAlign: 'center', marginTop: 12, color: theme.muted, fontSize: 13 }}>
                  {drawnRoute.length === 0 ? 'Enable drawing mode to start' : `${drawnRoute.length} point${drawnRoute.length === 1 ? '' : 's'} drawn`}
                </Text>
              </View>
            </View>
          </Modal>
        )}
    </SafeAreaView>
  );
};

export default CreateGameScreen;

const createStyles = (t: ReturnType<typeof useTheme>['theme']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.background,
    paddingHorizontal: 10,
  },
  header: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  headerTitle: {
    fontSize: 28,
    color: t.primary,
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
  sectionLabel: {
    color: t.primary,
    fontSize: 18,
    marginVertical: 8,
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: t.card,
    padding: 12,
    borderRadius: 8,
    color: t.text,
    marginBottom: 10,
    fontWeight: '500',
  },
  sportButton: {
    flexDirection: 'column',
    alignItems: 'center',
    marginHorizontal: 5,
    padding: 10,
    borderRadius: 8,
    backgroundColor: t.card,
  },
  activeButton: {
    backgroundColor: t.primary,
  },
  sportText: {
    color: t.text,
    marginTop: 5,
    fontWeight: '500',
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.primary,
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
    backgroundColor: t.card,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: t.primary,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.isDark ? '#1ae9ef' : t.primary,
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
    backgroundColor: Platform.OS === 'ios' ? (t.isDark ? '#222' : '#fff') : t.card,
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
    color: t.danger,
    fontWeight: 'bold',
    fontSize: 18,
    paddingVertical: 8,
  },
  rollerDone: {
    color: t.primary,
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
    paddingVertical: 10,
  },
  resetCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  progressBar: {
    height: 3,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 8,
    maxWidth: 120,
  },
  pullResetText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  // Modal styles copied from ActivityDetailsScreen
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 520, backgroundColor: t.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: t.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { color: t.text, fontSize: 18, fontWeight: 'bold' },
  modalSubtitle: { color: t.muted, marginBottom: 12 },
  friendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  friendLeft: { flexDirection: 'row', alignItems: 'center' },
  friendAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: t.primary },
  friendName: { color: t.text, fontWeight: '600' },
  friendMeta: { color: t.muted, fontSize: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: t.primary, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: t.primary },
  modalActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap' },
  modalCancel: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: t.card, borderRadius: 10, borderWidth: 1, borderColor: t.danger },
  modalCancelText: { color: t.danger, fontWeight: '700' },
  modalConfirm: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.primary, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  modalConfirmText: { color: t.isDark ? '#111' : '#fff', fontWeight: '700' },
  bottomToast: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center' },
  bottomToastText: { backgroundColor: 'rgba(26, 233, 239, 0.18)', color: t.text, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, overflow: 'hidden', fontWeight: '600' },
  // Route Statistics Styles
  routeStatsContainer: {
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: t.border,
  },
  routeStatsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  routeStatsTitle: {
    color: t.primary,
    fontWeight: '700',
    fontSize: 16,
    marginLeft: 8,
  },
  routeStatsOptional: {
    color: t.muted,
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 6,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingVertical: 4,
  },
  statLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 120,
  },
  statLabel: {
    color: t.text,
    fontWeight: '600',
    fontSize: 14,
  },
  statInput: {
    flex: 1,
    backgroundColor: t.background,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    color: t.text,
    fontWeight: '500',
    fontSize: 14,
    borderWidth: 1,
    borderColor: t.border,
  },
});