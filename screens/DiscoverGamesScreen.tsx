import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { auth } from '../firebaseConfig';

// Helper component for host username - now uses cached creatorUsername
function HostUsername({ activity }: { activity: any }) {
  const { theme } = useTheme();
  
  // Use cached creatorUsername from ActivityContext (no more fetching!)
  let displayName = activity.creatorUsername || activity.creator || 'Unknown';
  
  // Show "You" if current user is the creator
  if (auth.currentUser?.uid && activity.creatorId && auth.currentUser.uid === activity.creatorId) {
    displayName = 'You';
  }
  
  return <Text style={{ fontSize: 14, color: theme.muted, fontWeight: '500' }}>{displayName}</Text>;
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
  Animated,
  Modal,
  Pressable,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import * as Location from 'expo-location';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { NavigationProp } from '@react-navigation/native'; // ✅ typed, UI-neutral
import { ActivityIcon } from '../components/ActivityIcons';
import { fetchAllActivities } from '../utils/firestoreActivities';
import { activities as fakeActivities, Activity } from '../data/activitiesData';
import { useActivityContext } from '../context/ActivityContext';
import { getDisplayCreatorUsername } from '../utils/getDisplayCreatorUsername';
import { shareActivity } from '../utils/deepLinking';

// Default discovery radius ≈45-min drive at 80–100 km/h
const DEFAULT_RADIUS_KM = 70;

// Slight darken helper for hex colors (fallbacks to original color on parse failure)
function darkenHex(color: string, amount = 0.12): string {
  try {
    if (!color || typeof color !== 'string') return color;
    const hex = color.trim();
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!match) return color; // non-hex -> keep as-is
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

const sportFilterOptions = [
  'All',
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

type RootStackParamList = {
  ActivityDetails: { activityId: string };
  CreateGame: undefined;
};

type DiscoverNav = NavigationProp<RootStackParamList, 'ActivityDetails'>;

const DiscoverGamesScreen: React.FC<{ navigation: DiscoverNav }> = ({ navigation }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { allActivities, isActivityJoined, toggleJoinActivity, profile, reloadAllActivities } = useActivityContext();

  // Discovery range from settings (default 70 km)
  const [discoveryRange, setDiscoveryRange] = useState(DEFAULT_RADIUS_KM);

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
  const [showMap, setShowMap] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const [mapActivities, setMapActivities] = useState<Activity[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [regionDirty, setRegionDirty] = useState(false);
  const [selectedMapActivity, setSelectedMapActivity] = useState<Activity | null>(null);
  const [mapSelectedFilter, setMapSelectedFilter] = useState('All');
  const [mapSelectedDate, setMapSelectedDate] = useState<Date | null>(null);
  const [isMapDatePickerVisible, setMapDatePickerVisible] = useState(false);
  const [isMapIOSDatePickerVisible, setMapIOSDatePickerVisible] = useState(false);
  const [mapTempDate, setMapTempDate] = useState<Date | null>(null);
  const [showJoinedOnly, setShowJoinedOnly] = useState(true);

  // Load discovery range from AsyncStorage on mount and on screen focus
  useEffect(() => {
    const loadDiscoveryRange = async () => {
      try {
        const saved = await AsyncStorage.getItem('discoveryRange');
        if (saved) {
          setDiscoveryRange(parseInt(saved, 10));
        }
      } catch (error) {
        console.error('Failed to load discovery range:', error);
      }
    };
    loadDiscoveryRange();
  }, []);

  // Reload discovery range when screen comes into focus (instant updates from Settings)
  useFocusEffect(
    useCallback(() => {
      const reloadDiscoveryRange = async () => {
        try {
          const saved = await AsyncStorage.getItem('discoveryRange');
          if (saved) {
            setDiscoveryRange(parseInt(saved, 10));
          }
        } catch (error) {
          console.error('Failed to reload discovery range:', error);
        }
      };
      reloadDiscoveryRange();
    }, [])
  );

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const searchDebounceRef = useRef<number | null>(null);
  const mapRef = useRef<MapView>(null);
  const DEBOUNCE_MS = 300;
  const ITEM_HEIGHT = 120; // estimated fixed height for ActivityCard (used by getItemLayout)

  // Derive sport filter list: All + (favorite sports A-Z) + (rest A-Z)
  const orderedSportFilters = useMemo(() => {
    // base sports excluding 'All'
    const base = sportFilterOptions.filter(s => s !== 'All');
    const favs: string[] = (profile?.sportsPreferences || profile?.selectedSports || []) as string[];
    const favSet = new Set(favs.map(s => String(s).toLowerCase()));
    const favList = base.filter(s => favSet.has(s.toLowerCase())).sort((a, b) => a.localeCompare(b));
    const restList = base.filter(s => !favSet.has(s.toLowerCase())).sort((a, b) => a.localeCompare(b));
    return ['All', ...favList, ...restList];
  }, [profile?.sportsPreferences, profile?.selectedSports]);

  // Load activities from Firestore + fake on mount/refresh
  // NOW USES: Force refresh to bypass cache and fetch fresh data
  const loadActivities = useCallback(async () => {
    setRefreshing(true);
    setRefreshLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      console.log('🔄 Pull-to-refresh: Fetching fresh activities (bypassing cache)');
      // Force refresh = true to bypass cache and fetch fresh from Firestore
      await reloadAllActivities(true);
    } catch (error) {
      console.error('❌ Failed to refresh activities:', error);
    } finally {
      setTimeout(() => {
        setRefreshing(false);
        setRefreshLocked(false);
      }, 1500);
    }
  }, [reloadAllActivities]);

  useEffect(() => {
    loadActivities();
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        let location = await Location.getLastKnownPositionAsync({});
        if (!location) location = await Location.getCurrentPositionAsync({});
        if (location) {
          setUserLocation(location.coords);
          if (!mapRegion) {
            setMapRegion({
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              latitudeDelta: 0.25,
              longitudeDelta: 0.25,
            });
          }
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

    // Filter by distance (use saved discovery range from settings)
    if (userLocation) {
      list = list.filter(a =>
        calculateDistance(userLocation.latitude, userLocation.longitude, a.latitude, a.longitude) <= discoveryRange
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

    // Remove activities that are more than 2 hours in the past
    const isHistorical = (a: any) => {
      const start = getStartDate(a);
      if (!start) return false;
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      return new Date() > end;
    };
    list = list.filter(a => !isHistorical(a));

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
    discoveryRange,
    calculateDistance,
    profile?.sportsPreferences,
  ]);

  // Filter currently loaded activities for visible map region (only upcoming/current within 2 hours)
  // No distance limit on map - can see activities worldwide
  const filterForRegion = useCallback((region: Region | null) => {
    if (!region) return [] as Activity[];
    const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
    const minLat = latitude - latitudeDelta / 2;
    const maxLat = latitude + latitudeDelta / 2;
    const minLon = longitude - longitudeDelta / 2;
    const maxLon = longitude + longitudeDelta / 2;
    
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    
    let filtered = allActivities.filter(a => {
      // Location check
      if (!(typeof a.latitude === 'number' && typeof a.longitude === 'number' &&
        a.latitude >= minLat && a.latitude <= maxLat && a.longitude >= minLon && a.longitude <= maxLon)) {
        return false;
      }
      
      // Time check: only show upcoming or currently happening (within 2 hours past start)
      try {
        const toYmd = (ad: any) => {
          if (!ad) return null;
          if (ad && typeof ad.toDate === 'function') {
            const dt: Date = ad.toDate();
            return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
          }
          if (typeof ad === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) return ad;
            if (/^\d{2}-\d{2}-\d{4}$/.test(ad)) {
              const [dd, mm, yyyy] = ad.split('-');
              return `${yyyy}-${mm}-${dd}`;
            }
          }
          return null;
        };
        
        const ymd = toYmd(a.date);
        if (!ymd) return false;
        
        const [y, m, d] = ymd.split('-').map((x: string) => parseInt(x, 10));
        let hh = 0, mmv = 0;
        if (typeof a.time === 'string' && /^\d{2}:\d{2}$/.test(a.time)) {
          const [h, m2] = a.time.split(':').map((x: string) => parseInt(x, 10));
          hh = h;
          mmv = m2;
        }
        
        const start = new Date(y, m - 1, d, hh, mmv);
        const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
        
        return now <= end;
      } catch {
        return false;
      }
    });
    
    // Apply sport filter
    if (mapSelectedFilter !== 'All') {
      filtered = filtered.filter(a => a.activity === mapSelectedFilter);
    }
    
    // Apply date filter
    if (mapSelectedDate) {
      const y = mapSelectedDate.getFullYear();
      const m = pad(mapSelectedDate.getMonth() + 1);
      const d = pad(mapSelectedDate.getDate());
      const formattedSelected = `${y}-${m}-${d}`;
      
      filtered = filtered.filter(a => {
        const toYmd = (ad: any) => {
          if (!ad) return null;
          if (ad && typeof ad.toDate === 'function') {
            const dt: Date = ad.toDate();
            return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
          }
          if (typeof ad === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) return ad;
            if (/^\d{2}-\d{2}-\d{4}$/.test(ad)) {
              const [dd, mm, yyyy] = ad.split('-');
              return `${yyyy}-${mm}-${dd}`;
            }
          }
          return null;
        };
        return toYmd(a.date) === formattedSelected;
      });
    }
    
    // Apply joined activities filter
    // When OFF, exclude joined activities (show only non-joined)
    if (!showJoinedOnly) {
      filtered = filtered.filter(a => !isActivityJoined(a.id));
    }
    // When ON, show all activities (both joined and non-joined)
    
    return filtered;
  }, [allActivities, mapSelectedFilter, mapSelectedDate, showJoinedOnly, isActivityJoined]);

  // Refresh map activities when activities list changes or region changes (if map open)
  // Only update if not currently loading to prevent infinite refresh loop
  useEffect(() => {
    if (showMap && mapRegion && !mapLoading) {
      setMapActivities(filterForRegion(mapRegion));
    }
  }, [showMap, mapRegion, filterForRegion]);
  
  // Separate effect for initial load when opening map
  useEffect(() => {
    if (showMap && mapRegion && mapActivities.length === 0 && !mapLoading) {
      setMapActivities(filterForRegion(mapRegion));
    }
  }, [showMap]);

  const handleLoadRegionActivities = useCallback(async () => {
    if (!mapRegion || mapLoading) return;
    setMapLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      // Re-fetch all activities
      await reloadAllActivities(true);
      // Small delay to ensure state updates
      await new Promise(resolve => setTimeout(resolve, 100));
      // Filter activities for the current map region
      const filtered = filterForRegion(mapRegion);
      setMapActivities(filtered);
      setRegionDirty(false);
    } catch (e) {
      console.error('Error loading region activities:', e);
    } finally {
      setMapLoading(false);
    }
  }, [mapRegion, mapLoading, reloadAllActivities, filterForRegion]);

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
          <TouchableOpacity
            style={[
              styles.joinButton,
              isActivityJoined(item.id) && {
                // Discover-specific: Leave color mapping per request
                // - Dark theme: use the dark turquoise from light theme (#007E84)
                // - Light theme: slightly darken the current turquoise
                backgroundColor: theme.isDark ? '#007E84' : darkenHex(theme.primary, 0.12),
              },
            ]}
            onPress={handleToggleJoin}
          >
            <Text style={styles.joinButtonText}>
              {isActivityJoined(item.id) ? 'Leave' : 'Join'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => shareActivity(item.id, item.activity)}
          >
            <Ionicons name="share-social-outline" size={20} color={theme.text} />
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
      <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: theme.background }}>
        <Pressable 
          style={styles.headerContainer}
          onPress={Keyboard.dismiss}
          pointerEvents="box-none"
        >
          <View style={{ width: 40 }} />
          <Text style={styles.headerTitle}>Discover Activities</Text>
          <TouchableOpacity
            style={styles.mapToggleButton}
            onPress={() => {
              const next = !showMap;
              setShowMap(next);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (next && mapRegion) {
                const filtered = filterForRegion(mapRegion);
                setMapActivities(filtered);
              }
              if (next && !mapRegion && userLocation) {
                const region = {
                  latitude: userLocation.latitude,
                  longitude: userLocation.longitude,
                  latitudeDelta: 0.25,
                  longitudeDelta: 0.25,
                } as Region;
                setMapRegion(region);
                const filtered = filterForRegion(region);
                setMapActivities(filtered);
              }
            }}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={showMap ? "list" : "location"} 
              size={22} 
              color={theme.primary} 
            />
          </TouchableOpacity>
        </Pressable>

        {!showMap && (
        <Pressable 
          style={styles.topSection}
          onPress={Keyboard.dismiss}
          pointerEvents="box-none"
        >
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color={theme.primary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by activity or host..."
              placeholderTextColor={theme.muted}
              value={rawSearchQuery}
              onChangeText={setRawSearchQuery}
              returnKeyType="search"
            />
            {rawSearchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setRawSearchQuery('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={20} color={theme.primary} />
              </TouchableOpacity>
            )}
          </View>

          <Pressable
            style={styles.sortButtons}
            onPress={Keyboard.dismiss}
            pointerEvents="box-none"
            hitSlop={{ top: 4, bottom: 4 }}
          >
            <TouchableOpacity
              style={[styles.sortButton, isSortingByDistance && styles.activeButton]}
              onPress={toggleSortByDistance}
            >
              <Text style={[
                styles.sortButtonText,
                isSortingByDistance && { color: '#fff' },
              ]}>Sort by Distance</Text>
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
          </Pressable>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterWrapper}>
            {orderedSportFilters.map(option => (
              <TouchableOpacity
                key={option}
                style={[styles.filterChip, selectedFilter === option && styles.filterChipActive]}
                onPress={() => setSelectedFilter(option)}
              >
                <Text style={[
                  styles.filterChipText,
                  selectedFilter === option && { color: '#fff' },
                ]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Pressable>
        )}

        {showMap && (
          <View style={styles.mapContainer}>
            {/* Map Filters */}
            <View style={styles.mapFiltersContainer}>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false} 
                style={styles.mapFilterScroll}
                contentContainerStyle={{ paddingHorizontal: 4 }}
              >
                {orderedSportFilters.map(option => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.mapFilterChip,
                      mapSelectedFilter === option && styles.mapFilterChipActive,
                    ]}
                    onPress={() => {
                      setMapSelectedFilter(option);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      if (mapRegion) {
                        // Update filter will trigger useEffect to refresh activities
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.mapFilterChipText,
                        mapSelectedFilter === option && { color: '#fff' },
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              
              <View style={styles.mapDatePickerRow}>
                <TouchableOpacity
                  style={styles.mapDateButton}
                  onPress={() => {
                    if (Platform.OS === 'ios') {
                      setMapTempDate(mapSelectedDate ?? new Date());
                      setMapIOSDatePickerVisible(true);
                    } else {
                      setMapDatePickerVisible(true);
                    }
                  }}
                >
                  <Ionicons name="calendar-outline" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                  <Text style={styles.mapDateButtonText}>
                    {mapSelectedDate ? mapSelectedDate.toLocaleDateString() : 'Select Date'}
                  </Text>
                </TouchableOpacity>
                {mapSelectedDate && (
                  <TouchableOpacity
                    style={styles.mapClearDateButton}
                    onPress={() => {
                      setMapSelectedDate(null);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      if (mapRegion) {
                        const filtered = filterForRegion(mapRegion);
                        setMapActivities(filtered);
                      }
                    }}
                  >
                    <Ionicons name="close" size={18} color={theme.text} />
                  </TouchableOpacity>
                )}
                
                <TouchableOpacity
                  style={[
                    styles.mapJoinedToggle,
                    showJoinedOnly && styles.mapJoinedToggleActive,
                  ]}
                  onPress={() => {
                    setShowJoinedOnly(!showJoinedOnly);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    if (mapRegion) {
                      const filtered = filterForRegion(mapRegion);
                      setMapActivities(filtered);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons 
                    name={showJoinedOnly ? "checkmark-circle" : "checkmark-circle-outline"} 
                    size={20} 
                    color={showJoinedOnly ? '#fff' : theme.primary} 
                  />
                  <Text style={[
                    styles.mapJoinedToggleText,
                    showJoinedOnly && { color: '#fff' },
                  ]}>Joined Activities</Text>
                </TouchableOpacity>
              </View>
            </View>
            
            {mapRegion && (
              <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={mapRegion}
                showsUserLocation={true}
                showsMyLocationButton={false}
                onRegionChangeComplete={(region) => {
                  setMapRegion(region);
                  setRegionDirty(true);
                }}
              >
                {mapActivities.map(act => (
                  <Marker
                    key={act.id}
                    coordinate={{ latitude: act.latitude, longitude: act.longitude }}
                    onPress={() => setSelectedMapActivity(act)}
                    tracksViewChanges={false}
                  >
                    <View style={styles.markerInner}>
                      <ActivityIcon activity={act.activity} size={20} color={theme.primary} />
                      {isActivityJoined(act.id) && (
                        <View style={styles.markerBadge}>
                          <Ionicons name="checkmark" size={10} color="#fff" />
                        </View>
                      )}
                    </View>
                  </Marker>
                ))}
              </MapView>
            )}
            
            {/* My Location Button */}
            <TouchableOpacity
              style={styles.myLocationButton}
              onPress={async () => {
                if (userLocation && mapRef.current) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  mapRef.current.animateToRegion(
                    {
                      latitude: userLocation.latitude,
                      longitude: userLocation.longitude,
                      latitudeDelta: 0.05,
                      longitudeDelta: 0.05,
                    },
                    500
                  );
                }
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="locate" size={24} color={theme.primary} />
            </TouchableOpacity>
            
            {regionDirty && (
              <TouchableOpacity
                style={styles.mapLoadButton}
                onPress={handleLoadRegionActivities}
                disabled={mapLoading}
                activeOpacity={0.8}
              >
                {mapLoading ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.mapLoadButtonText}>Loading...</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="refresh" size={18} color="#fff" />
                    <Text style={styles.mapLoadButtonText}>Load activities</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            {selectedMapActivity && (
              <View style={styles.mapActivityPanel}>
                <View style={styles.mapPanelHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <ActivityIcon activity={selectedMapActivity.activity} size={28} color={theme.primary} />
                    <Text style={styles.mapActivityPanelTitle}>{selectedMapActivity.activity}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedMapActivity(null)} style={styles.mapActivityPanelClose}>
                    <Ionicons name="close" size={22} color={theme.text} />
                  </TouchableOpacity>
                </View>

                <View style={styles.mapPanelRow}>
                  <Ionicons name="person" size={16} color={theme.primary} />
                  <Text style={styles.mapPanelLabel}>Host:</Text>
                  <HostUsername activity={selectedMapActivity} />
                </View>

                <View style={styles.mapPanelRow}>
                  <Ionicons name="location" size={16} color={theme.primary} />
                  <Text style={styles.mapPanelLabel}>Location:</Text>
                  <Text style={styles.mapPanelValue} numberOfLines={1}>
                    {simplifyLocation(selectedMapActivity.location)}
                  </Text>
                </View>

                <View style={styles.mapPanelRow}>
                  <Ionicons name="calendar" size={16} color={theme.primary} />
                  <Text style={styles.mapPanelLabel}>Date:</Text>
                  <Text style={styles.mapPanelValue}>{selectedMapActivity.date}</Text>
                </View>

                <View style={styles.mapPanelRow}>
                  <Ionicons name="time" size={16} color={theme.primary} />
                  <Text style={styles.mapPanelLabel}>Time:</Text>
                  <Text style={styles.mapPanelValue}>{selectedMapActivity.time}</Text>
                </View>

                <View style={styles.mapPanelRow}>
                  <Ionicons name="people" size={16} color={theme.primary} />
                  <Text style={styles.mapPanelLabel}>Participants:</Text>
                  <Text style={styles.mapPanelValue}>
                    {selectedMapActivity.joinedUserIds ? selectedMapActivity.joinedUserIds.length : selectedMapActivity.joinedCount} / {selectedMapActivity.maxParticipants}
                  </Text>
                </View>

                {userLocation && (
                  <View style={styles.mapPanelRow}>
                    <Ionicons name="navigate" size={16} color={theme.primary} />
                    <Text style={styles.mapPanelLabel}>Distance:</Text>
                    <Text style={styles.mapPanelValue}>
                      {calculateDistance(
                        userLocation.latitude,
                        userLocation.longitude,
                        selectedMapActivity.latitude,
                        selectedMapActivity.longitude
                      ).toFixed(2)} km away
                    </Text>
                  </View>
                )}

                <View style={styles.mapPanelActions}>
                  <TouchableOpacity
                    style={[
                      styles.mapJoinButton,
                      isActivityJoined(selectedMapActivity.id) && {
                        backgroundColor: theme.isDark ? '#007E84' : darkenHex(theme.primary, 0.12),
                      },
                    ]}
                    onPress={async () => {
                      try {
                        await toggleJoinActivity(selectedMapActivity);
                      } catch (err) {
                        console.error('Error toggling join:', err);
                      }
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.mapJoinButtonText}>
                      {isActivityJoined(selectedMapActivity.id) ? 'Leave' : 'Join'}
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    onPress={() => {
                      navigation.navigate('ActivityDetails', { activityId: selectedMapActivity.id });
                      setSelectedMapActivity(null);
                    }}
                    style={styles.mapDetailsButton}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.mapDetailsButtonText}>View Details</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {!showMap && filteredActivities.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 32, marginBottom: 12, paddingHorizontal: 24 }}>
            <Ionicons name="search-outline" size={48} color={theme.primary} style={{ marginBottom: 10 }} />
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
              No activities found
            </Text>
            <Text style={{ color: theme.muted, fontSize: 16, textAlign: 'center', marginBottom: 18 }}>
              Be the first to create an event in your area!
              Others will be able to discover and join your activity from this page!
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('CreateGame')}
              style={{
                paddingVertical: 14,
                paddingHorizontal: 36,
                borderRadius: 24,
                backgroundColor: theme.primary,
                shadowColor: theme.primary,
                shadowOpacity: 0.4,
                shadowRadius: 8,
                elevation: 4,
              }}
              activeOpacity={0.85}
            >
              <Text style={{ color: theme.isDark ? '#111' : '#fff', fontWeight: 'bold', fontSize: 17, letterSpacing: 0.5 }}>
                Create an Event
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!showMap && (
        <FlatList
          data={filteredActivities}
          renderItem={({ item }) => <ActivityCard item={item} />}
          keyExtractor={(item) => item.id}
          getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || refreshLocked}
              onRefresh={loadActivities}
              colors={[theme.isDark ? theme.primary : theme.primaryStrong] as any}
              tintColor={theme.isDark ? theme.primary : theme.primaryStrong}
              progressBackgroundColor="transparent"
            />
          }
          contentContainerStyle={styles.listContainer}
          style={{ backgroundColor: theme.background }}
          // ✅ Perf-friendly knobs (no UI change)
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
        />
        )}

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
                  themeVariant={theme.isDark ? 'dark' : 'light'}
                  onChange={(event, d) => d && setTempDate(d)}
                  style={styles.rollerPicker}
                />
              </View>
            </View>
          </Modal>
        )}
        
        {/* Map Date Pickers */}
        {Platform.OS === 'android' && (
          <DateTimePickerModal
            isVisible={isMapDatePickerVisible}
            mode="date"
            onConfirm={(date) => { 
              setMapSelectedDate(date); 
              setMapDatePickerVisible(false);
              if (mapRegion) {
                const filtered = filterForRegion(mapRegion);
                setMapActivities(filtered);
              }
            }}
            onCancel={() => setMapDatePickerVisible(false)}
          />
        )}
        
        {Platform.OS === 'ios' && (
          <Modal
            transparent
            animationType="slide"
            visible={isMapIOSDatePickerVisible}
            onRequestClose={() => setMapIOSDatePickerVisible(false)}
          >
            <View style={styles.pickerModal}>
              <View style={styles.rollerContainer}>
                <View style={styles.rollerHeader}>
                  <TouchableOpacity onPress={() => setMapIOSDatePickerVisible(false)}>
                    <Text style={styles.rollerCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { 
                    if (mapTempDate) {
                      setMapSelectedDate(mapTempDate); 
                      if (mapRegion) {
                        const filtered = filterForRegion(mapRegion);
                        setMapActivities(filtered);
                      }
                    }
                    setMapIOSDatePickerVisible(false); 
                  }}>
                    <Text style={styles.rollerDone}>Done</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={mapTempDate ?? new Date()}
                  mode="date"
                  display="spinner"
                  themeVariant={theme.isDark ? 'dark' : 'light'}
                  onChange={(event, d) => d && setMapTempDate(d)}
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

const createStyles = (t: ReturnType<typeof useTheme>['theme']) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: t.background },

  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    marginTop: 10,
    marginBottom: 18,
  },
  headerTitle: {
    fontSize: 28,
    color: t.primary,
    fontWeight: 'bold',
    textAlign: 'center',
    flex: 1,
  },
  mapToggleButton: {
    backgroundColor: t.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapContainer: { flex: 1, marginHorizontal: 15, borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  mapFiltersContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  mapDatePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  mapDateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border,
  },
  mapDateButtonText: {
    color: t.text,
    fontSize: 13,
    fontWeight: '500',
  },
  mapClearDateButton: {
    backgroundColor: t.card,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border,
  },
  mapJoinedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border,
    gap: 6,
    marginLeft: 'auto',
  },
  mapJoinedToggleActive: {
    backgroundColor: t.primary,
    borderColor: t.primary,
  },
  mapJoinedToggleText: {
    color: t.text,
    fontSize: 13,
    fontWeight: '600',
  },
  mapFilterScroll: {
    maxHeight: 42,
  },
  mapFilterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: t.card,
    borderRadius: 16,
    marginRight: 6,
    borderWidth: 1,
    borderColor: t.border,
  },
  mapFilterChipActive: {
    backgroundColor: t.primary,
    borderColor: t.primary,
  },
  mapFilterChipText: {
    color: t.text,
    fontSize: 13,
    fontWeight: '500',
  },
  map: { flex: 1 },
  markerInner: { 
    backgroundColor: t.card, 
    padding: 6, 
    borderRadius: 24, 
    borderWidth: 2, 
    borderColor: t.primary,
    position: 'relative',
  },
  markerBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: t.primary,
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: t.card,
  },
  mapLoadButton: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    backgroundColor: t.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: t.primary,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  mapLoadButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  myLocationButton: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    backgroundColor: t.card,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: t.border,
  },
  mapActivityPanel: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: t.card,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
    maxHeight: '60%',
  },
  mapPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  mapActivityPanelTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: t.primary,
    marginLeft: 8,
    flex: 1,
  },
  mapActivityPanelClose: { 
    padding: 6,
    backgroundColor: t.background,
    borderRadius: 6,
  },
  mapPanelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  mapPanelLabel: {
    fontSize: 14,
    color: t.primary,
    fontWeight: '600',
    marginLeft: 8,
    marginRight: 6,
  },
  mapPanelValue: {
    fontSize: 14,
    color: t.muted,
    fontWeight: '500',
    flex: 1,
  },
  mapPanelActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: t.border,
    gap: 10,
  },
  mapJoinButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: t.primary,
    borderRadius: 8,
    alignItems: 'center',
  },
  mapJoinButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  mapDetailsButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: t.card,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
  },
  mapDetailsButtonText: {
    color: t.primary,
    fontWeight: '600',
    fontSize: 15,
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
  rollerCancel: { color: t.danger, fontWeight: 'bold', fontSize: 18, paddingVertical: 8 },
  rollerDone: { color: t.primary, fontWeight: 'bold', fontSize: 18, paddingVertical: 8 },
  rollerPicker: { width: '100%', backgroundColor: 'transparent' },

  topSection: { paddingHorizontal: 15 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10 },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    backgroundColor: 'transparent',
    borderRadius: 8,
    paddingVertical: 0,
    color: t.text,
    fontSize: 16,
  },
  sortButtons: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  sortButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: t.card,
    borderRadius: 5,
    marginRight: 8,
  },
  activeButton: { backgroundColor: t.primary },
  sortButtonText: { color: t.text, fontSize: 14, fontWeight: '500' },
  clearButton: {
    backgroundColor: t.danger,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginLeft: 5,
  },
  clearButtonText: { color: t.text, fontSize: 14, fontWeight: '500' },

  filterWrapper: { flexDirection: 'row', marginVertical: 10 },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: t.card,
    borderRadius: 20,
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: t.primary },
  filterChipText: { color: t.text, fontSize: 14, fontWeight: '500' },

  listContainer: { padding: 15 },

  card: {
    backgroundColor: t.card,
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 18, color: t.primary, fontWeight: 'bold', marginLeft: 10 },

  distanceContainer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distanceNumber: { fontSize: 14, color: t.primary, fontWeight: '600' },
  distanceUnit: { fontSize: 14, color: t.muted, fontWeight: '500' },

  infoRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
  infoIcon: { marginRight: 8 },
  cardInfoLabel: { fontSize: 14, color: t.primary, fontWeight: '600', marginRight: 6 },
  cardInfo: { fontSize: 14, color: t.muted, fontWeight: '500' },

  cardActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  joinButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: t.primary,
    borderRadius: 5,
  },
  joinButtonJoined: { backgroundColor: t.primaryStrong },
  joinButtonText: { color: '#fff', fontWeight: 'bold' },
  shareButton: { padding: 8, backgroundColor: t.card, borderRadius: 5 },
});
