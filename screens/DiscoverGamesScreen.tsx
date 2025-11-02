import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

// Helper component for host username

function HostUsername({ activity }: { activity: any }) {
  const [username, setUsername] = useState('');
  useEffect(() => {
    let mounted = true;
    const fetchUsername = async () => {
  const name = await getDisplayCreatorUsername(activity.creatorId, activity.creator);
      if (mounted) setUsername(name);
    };
    fetchUsername();
    return () => { mounted = false; };
  }, [activity.creatorId, activity.creator]);
  return <Text style={styles.cardInfo}>{username}</Text>;
}
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  RefreshControl,
  Platform,
  Share,
  Animated,
  Modal,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { NavigationProp } from '@react-navigation/native'; // ✅ typed, UI-neutral
import { ActivityIcon } from '../components/ActivityIcons';
import { fetchAllActivities } from '../utils/firestoreActivities';
import { activities as fakeActivities, Activity } from '../data/activitiesData';
import { useActivityContext } from '../context/ActivityContext';
import { getDisplayCreatorUsername } from '../utils/getDisplayCreatorUsername';

// Default discovery radius ≈45-min drive at 80–100 km/h
const DEFAULT_RADIUS_KM = 70;

const sportFilterOptions = [
  'All',
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

type RootStackParamList = {
  ActivityDetails: { activityId: string };
  CreateGame: undefined;
};

type DiscoverNav = NavigationProp<RootStackParamList, 'ActivityDetails'>;

const DiscoverGamesScreen: React.FC<{ navigation: DiscoverNav }> = ({ navigation }) => {
  const { allActivities, isActivityJoined, toggleJoinActivity, profile } = useActivityContext();

  // rawSearch holds immediate input, debouncedSearch is used for filtering (debounced)
  const [rawSearchQuery, setRawSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isDatePickerVisible, setDatePickerVisible] = useState(false);
  const [isIOSDatePickerVisible, setIOSDatePickerVisible] = useState(false);
  const [tempDate, setTempDate] = useState<Date | null>(null);
  const [isSortingByDistance, setIsSortingByDistance] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const searchDebounceRef = useRef<number | null>(null);
  const DEBOUNCE_MS = 300;
  const ITEM_HEIGHT = 120; // estimated fixed height for ActivityCard (used by getItemLayout)

  // Load activities from Firestore + fake on mount/refresh
  const loadActivities = useCallback(async () => {
    setRefreshing(true);
    setRefreshLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const firestoreActivities = await fetchAllActivities();
      // Merge with local sample without duplicates (kept behavior)
      const _merged = [
        ...firestoreActivities,
        ...fakeActivities.filter(fake => !firestoreActivities.some(real => real.id === fake.id)),
      ];
      // setAllActivities(_merged);
    } catch {
      // setAllActivities(fakeActivities);
    } finally {
      setTimeout(() => {
        setRefreshing(false);
        setRefreshLocked(false);
      }, 1500);
    }
  }, []);

  useEffect(() => {
    loadActivities();
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        let location = await Location.getLastKnownPositionAsync({});
        if (!location) location = await Location.getCurrentPositionAsync({});
        if (location) {
          setUserLocation(location.coords);
        }
      }
    })();
  }, [loadActivities]);

  // Fade in
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const calculateDistance = useCallback((lat1: number, lon1: number, lat2 = 0, lon2 = 0) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }, []);

  const simplifyLocation = useCallback((location: string) => {
    if (!location) return location;
    const parts = location.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      return `${parts[0]}, ${parts[parts.length - 2] || parts[parts.length - 1]}`;
    }
    return location;
  }, []);

  // Compute filtered/sorted list (UI unchanged)
  const filteredActivities = useMemo(() => {
    let list = [...allActivities];

    if (selectedFilter !== 'All') {
      list = list.filter(a => a.activity === selectedFilter);
    }

    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.toLowerCase();
      list = list.filter(a =>
        a.activity.toLowerCase().includes(q) ||
        a.creator.toLowerCase().includes(q) ||
        (a.location && a.location.toLowerCase().includes(q))
      );
    }

    if (selectedDate) {
      // Format selectedDate as local yyyy-mm-dd (avoid toISOString UTC shift)
      const pad = (n: number) => String(n).padStart(2, '0');
      const y = selectedDate.getFullYear();
      const m = pad(selectedDate.getMonth() + 1);
      const d = pad(selectedDate.getDate());
      const formattedSelected = `${y}-${m}-${d}`;

      const normalizeActivityDate = (ad: any) => {
        if (!ad) return null;
        // Firestore Timestamp
        if (ad && typeof ad.toDate === 'function') {
          const dt: Date = ad.toDate();
          return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        }
        if (typeof ad === 'string') {
          // already yyyy-mm-dd
          if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) return ad;
          // dd-mm-yyyy -> convert
          if (/^\d{2}-\d{2}-\d{4}$/.test(ad)) {
            const [dd, mm, yyyy] = ad.split('-');
            return `${yyyy}-${mm}-${dd}`;
          }
          // fallback: try Date parse
          const parsed = new Date(ad);
          if (!isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
          return ad;
        }
        if (ad instanceof Date) {
          return `${ad.getFullYear()}-${pad(ad.getMonth() + 1)}-${pad(ad.getDate())}`;
        }
        return String(ad).slice(0, 10);
      };

      list = list.filter(a => normalizeActivityDate(a.date) === formattedSelected);
    }

    // Always use 70 km radius from user location when available
    if (userLocation) {
      list = list.filter(a =>
        calculateDistance(userLocation.latitude, userLocation.longitude, a.latitude, a.longitude) <= DEFAULT_RADIUS_KM
      );
    }

    // Build favorite sports set from profile
    const favoriteSports: string[] = (profile?.sportsPreferences || profile?.selectedSports || []) as string[];
    const favSet = new Set(favoriteSports.map(s => String(s).toLowerCase()));

    // Helpers to compute start time and scores
    const pad = (n: number) => String(n).padStart(2, '0');
    const toYmd = (ad: any) => {
      if (!ad) return null;
      if (ad && typeof ad.toDate === 'function') {
        const dt: Date = ad.toDate();
        return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      }
      if (typeof ad === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) return ad;
        if (/^\d{2}-\d{2}-\d{4}$/.test(ad)) { const [dd, mm, yyyy] = ad.split('-'); return `${yyyy}-${mm}-${dd}`; }
        const parsed = new Date(ad); if (!isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
        return null;
      }
      if (ad instanceof Date) return `${ad.getFullYear()}-${pad(ad.getMonth() + 1)}-${pad(ad.getDate())}`;
      return null;
    };

    const getStartDate = (a: any) => {
      const ymd = toYmd(a.date);
      if (!ymd) return null;
      const [y, m, d] = ymd.split('-').map((x: string) => parseInt(x, 10));
      let hh = 0, mmv = 0;
      if (typeof a.time === 'string' && /^\d{2}:\d{2}$/.test(a.time)) {
        const [h, m2] = a.time.split(':').map((x: string) => parseInt(x, 10));
        hh = h; mmv = m2;
      }
      return new Date(y, m - 1, d, hh, mmv);
    };

    const now = new Date();
    const timeScore = (a: any) => {
      const start = getStartDate(a);
      if (!start) return Number.POSITIVE_INFINITY;
      const diffMin = Math.round((start.getTime() - now.getTime()) / 60000);
      // Upcoming first, past to the end
      return diffMin >= 0 ? diffMin : 1_000_000 + Math.abs(diffMin);
    };

    const distanceScore = (a: any) => {
      if (!userLocation) return Number.POSITIVE_INFINITY;
      return calculateDistance(userLocation.latitude, userLocation.longitude, a.latitude, a.longitude);
    };

    const sportName = (a: any) => String(a.activity || '').toLowerCase();
    const isFav = (a: any) => favSet.has(sportName(a));

    // Sorting rules
    const hasDateFilter = !!selectedDate; // list is already filtered to that date
    const isAllSports = selectedFilter === 'All';

    list.sort((a, b) => {
      // Select the strategy based on toggles/filters
      if (!isAllSports) {
        // Single activity filter: time -> distance -> alphabetical
        const t = timeScore(a) - timeScore(b);
        if (t !== 0) return t;
        const d = distanceScore(a) - distanceScore(b);
        if (d !== 0) return d;
        return sportName(a).localeCompare(sportName(b));
      }

      if (isSortingByDistance) {
        // Distance-first: distance -> time -> alphabetical
        const d = distanceScore(a) - distanceScore(b);
        if (d !== 0) return d;
        const t = timeScore(a) - timeScore(b);
        if (t !== 0) return t;
        return sportName(a).localeCompare(sportName(b));
      }

      // Default (no distance sort): favorites first -> alphabetical (within group) -> time soonest
      const favCmp = (isFav(a) === isFav(b)) ? 0 : (isFav(a) ? -1 : 1);
      if (favCmp !== 0) return favCmp;
      const alpha = sportName(a).localeCompare(sportName(b));
      if (alpha !== 0) return alpha;
      return timeScore(a) - timeScore(b);
    });

    return list;
  }, [
    allActivities,
    selectedFilter,
    debouncedSearchQuery,
    selectedDate,
    isSortingByDistance,
    userLocation,
    calculateDistance,
    profile?.sportsPreferences,
  ]);

  // Debounce raw search input -> debouncedSearchQuery
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current as any);
      searchDebounceRef.current = null;
    }
    // @ts-ignore - window.setTimeout returns number in RN env
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearchQuery(rawSearchQuery);
    }, DEBOUNCE_MS) as unknown as number;
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current as any);
        searchDebounceRef.current = null;
      }
    };
  }, [rawSearchQuery]);

  const ActivityCard = React.memo(({ item }: { item: Activity }) => {
    const distance = useMemo(() => {
      if (!userLocation) return null;
      return calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        item.latitude,
        item.longitude
      ).toFixed(2);
    }, [userLocation, item.latitude, item.longitude, calculateDistance]);

    const handleToggleJoin = useCallback(async () => {
      try {
        await toggleJoinActivity(item);
      } catch (err) {
        console.error('Error toggling join state:', err);
      }
    }, [item, toggleJoinActivity]);

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('ActivityDetails', { activityId: item.id })}
        activeOpacity={0.9}
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
            style={[styles.joinButton, isActivityJoined(item.id) && styles.joinButtonJoined]}
            onPress={handleToggleJoin}
          >
            <Text style={styles.joinButtonText}>
              {isActivityJoined(item.id) ? 'Leave' : 'Join'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() =>
              Share.share({
                message: `Join me for ${item.activity} at ${item.location} on ${item.date}!`,
              })
            }
          >
            <Ionicons name="share-social-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  });

  const toggleSortByDistance = useCallback(
    () => setIsSortingByDistance(prev => !prev),
    []
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: '#121212' }}>
        <View style={styles.headerContainer}>
          <Text style={styles.headerTitle}>Discover Activities</Text>
        </View>

        <View style={styles.topSection}>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color="#ccc" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by activity or host..."
              placeholderTextColor="#bbb"
              value={rawSearchQuery}
              onChangeText={setRawSearchQuery}
              returnKeyType="search"
            />
          </View>

          <View style={styles.sortButtons}>
            <TouchableOpacity
              style={[styles.sortButton, isSortingByDistance && styles.activeButton]}
              onPress={toggleSortByDistance}
            >
              <Text style={styles.sortButtonText}>Sort by Distance</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sortButton}
              onPress={() => {
                if (Platform.OS === 'ios') {
                  setTempDate(selectedDate ?? new Date());
                  setIOSDatePickerVisible(true);
                } else {
                  setDatePickerVisible(true);
                }
              }}
            >
              <Text style={styles.sortButtonText}>
                {selectedDate ? selectedDate.toDateString() : 'Select Date'}
              </Text>
            </TouchableOpacity>

            {selectedDate && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={async () => {
                  setSelectedDate(null);
                  await loadActivities();
                }}
              >
                <Text style={styles.clearButtonText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterWrapper}>
            {sportFilterOptions.map(option => (
              <TouchableOpacity
                key={option}
                style={[styles.filterChip, selectedFilter === option && styles.filterChipActive]}
                onPress={() => setSelectedFilter(option)}
              >
                <Text style={styles.filterChipText}>{option}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {filteredActivities.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 32, marginBottom: 12, paddingHorizontal: 24 }}>
            <Ionicons name="search-outline" size={48} color="#1ae9ef" style={{ marginBottom: 10 }} />
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
              No activities found
            </Text>
            <Text style={{ color: '#bbb', fontSize: 16, textAlign: 'center', marginBottom: 18 }}>
              Be the first to create an event in your area!
              Others will be able to discover and join your activity from this page!
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('CreateGame')}
              style={{
                paddingVertical: 14,
                paddingHorizontal: 36,
                borderRadius: 24,
                backgroundColor: '#1ae9ef',
                shadowColor: '#1ae9ef',
                shadowOpacity: 0.4,
                shadowRadius: 8,
                elevation: 4,
              }}
              activeOpacity={0.85}
            >
              <Text style={{ color: '#121212', fontWeight: 'bold', fontSize: 17, letterSpacing: 0.5 }}>
                Create an Event
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <FlatList
          data={filteredActivities}
          renderItem={({ item }) => <ActivityCard item={item} />}
          keyExtractor={(item) => item.id}
          getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || refreshLocked}
              onRefresh={loadActivities}
              colors={['#009fa3']}
              tintColor="#009fa3"
              progressBackgroundColor="transparent"
            />
          }
          contentContainerStyle={styles.listContainer}
          style={{ backgroundColor: '#121212' }}
          // ✅ Perf-friendly knobs (no UI change)
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
        />

        {/* Android date picker (modal wrapper) */}
        {Platform.OS === 'android' && (
          <DateTimePickerModal
            isVisible={isDatePickerVisible}
            mode="date"
            onConfirm={(date) => { setSelectedDate(date); setDatePickerVisible(false); }}
            onCancel={() => setDatePickerVisible(false)}
          />
        )}

        {/* iOS styled date picker */}
        {Platform.OS === 'ios' && (
          <Modal
            transparent
            animationType="slide"
            visible={isIOSDatePickerVisible}
            onRequestClose={() => setIOSDatePickerVisible(false)}
          >
            <View style={styles.pickerModal}>
              <View style={styles.rollerContainer}>
                <View style={styles.rollerHeader}>
                  <TouchableOpacity onPress={() => setIOSDatePickerVisible(false)}>
                    <Text style={styles.rollerCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { if (tempDate) setSelectedDate(tempDate); setIOSDatePickerVisible(false); }}>
                    <Text style={styles.rollerDone}>Done</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={tempDate ?? new Date()}
                  mode="date"
                  display="spinner"
                  themeVariant="dark"
                  onChange={(event, d) => d && setTempDate(d)}
                  style={styles.rollerPicker}
                />
              </View>
            </View>
          </Modal>
        )}
      </Animated.View>
    </SafeAreaView>
  );
};

export default DiscoverGamesScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#121212' },

  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 15,
    marginTop: 10,
    marginBottom: 18,
    position: 'relative',
  },
  headerTitle: {
    fontSize: 28,
    color: '#1ae9ef',
    fontWeight: 'bold',
    textAlign: 'center',
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
  rollerCancel: { color: '#ff5a5f', fontWeight: 'bold', fontSize: 18, paddingVertical: 8 },
  rollerDone: { color: '#1ae9ef', fontWeight: 'bold', fontSize: 18, paddingVertical: 8 },
  rollerPicker: { width: '100%', backgroundColor: 'transparent' },

  topSection: { paddingHorizontal: 15 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e1e', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10 },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    backgroundColor: 'transparent',
    borderRadius: 8,
    paddingVertical: 0,
    color: '#fff',
    fontSize: 16,
  },
  sortButtons: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  sortButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: '#333',
    borderRadius: 5,
    marginRight: 8,
  },
  activeButton: { backgroundColor: '#1ae9ef' },
  sortButtonText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  clearButton: {
    backgroundColor: '#e74c3c',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginLeft: 5,
  },
  clearButtonText: { color: '#fff', fontSize: 14, fontWeight: '500' },

  filterWrapper: { flexDirection: 'row', marginVertical: 10 },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: '#333',
    borderRadius: 20,
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: '#1ae9ef' },
  filterChipText: { color: '#fff', fontSize: 14, fontWeight: '500' },

  listContainer: { padding: 15 },

  card: {
    backgroundColor: '#1e1e1e',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 18, color: '#1ae9ef', fontWeight: 'bold', marginLeft: 10 },

  distanceContainer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distanceNumber: { fontSize: 14, color: '#1ae9ef', fontWeight: '600' },
  distanceUnit: { fontSize: 14, color: '#888', fontWeight: '500' },

  infoRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
  infoIcon: { marginRight: 8 },
  cardInfoLabel: { fontSize: 14, color: '#1ae9ef', fontWeight: '600', marginRight: 6 },
  cardInfo: { fontSize: 14, color: '#ccc', fontWeight: '500' },

  cardActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  joinButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: '#1ae9ef',
    borderRadius: 5,
  },
  joinButtonJoined: { backgroundColor: '#007b7b' },
  joinButtonText: { color: '#fff', fontWeight: 'bold' },
  shareButton: { padding: 8, backgroundColor: '#1e1e1e', borderRadius: 5 },
});
