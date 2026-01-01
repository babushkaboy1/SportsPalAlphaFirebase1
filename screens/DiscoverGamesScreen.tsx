import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { auth } from '../firebaseConfig';
import { useActivityContext } from '../context/ActivityContext';

// Helper component for host username - now uses cached creatorUsername
function HostUsername({ activity }: { activity: any }) {
  const { theme } = useTheme();
  const { isUserBlockedById } = useActivityContext();
  
  // Check if creator is blocked
  if (activity.creatorId && isUserBlockedById(activity.creatorId)) {
    return <Text style={{ fontSize: 14, color: theme.muted, fontWeight: '500' }}>Blocked User</Text>;
  }
  
  // Use cached creatorUsername from ActivityContext (no more fetching!)
  let displayName = activity.creatorUsername || activity.creator || 'Unknown';
  
  // Show "You" if current user is the creator
  if (auth.currentUser?.uid && activity.creatorId && auth.currentUser.uid === activity.creatorId) {
    displayName = 'You';
  }
  
  return <Text style={{ fontSize: 14, color: theme.muted, fontWeight: '500' }}>{displayName}</Text>;
}

// Helper component for blocked user card in search results
function BlockedUserSearchCard({ user }: { user: { uid: string } }) {
  const { theme } = useTheme();
  const navigation = useNavigation();
  
  return (
    <TouchableOpacity
      style={{
        backgroundColor: theme.card,
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderLeftWidth: 4,
        borderLeftColor: theme.muted,
        opacity: 0.6,
      }}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        (navigation as any).navigate('UserProfile', { userId: user.uid });
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ 
          width: 56, 
          height: 56, 
          borderRadius: 28, 
          backgroundColor: theme.muted, 
          justifyContent: 'center', 
          alignItems: 'center',
          borderWidth: 2,
          borderColor: theme.muted,
        }}>
          <Ionicons name="ban" size={24} color={theme.text} />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: theme.muted }}>Blocked User</Text>
            <View style={{ backgroundColor: `${theme.danger}20`, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: theme.danger }}>BLOCKED</Text>
            </View>
          </View>
          <Text style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>Tap to view profile</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={theme.muted} />
      </View>
    </TouchableOpacity>
  );
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
import MapView, { Marker, Region, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import * as Location from 'expo-location';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { NavigationProp } from '@react-navigation/native'; // ✅ typed, UI-neutral
import { ActivityIcon } from '../components/ActivityIcons';
import { fetchAllActivities } from '../utils/firestoreActivities';
import { activities as fakeActivities, Activity } from '../data/activitiesData';
import { getDisplayCreatorUsername } from '../utils/getDisplayCreatorUsername';
import { shareActivity } from '../utils/deepLinking';
import { db } from '../firebaseConfig';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import UserAvatar from '../components/UserAvatar';

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

// Note: We intentionally use the default Google Maps styling on Android
// (no dark theme customMapStyle) so it matches the system look.

type RootStackParamList = {
  ActivityDetails: { activityId: string };
  CreateGame: undefined;
};

type DiscoverNav = NavigationProp<RootStackParamList, 'ActivityDetails'>;

const DiscoverGamesScreen: React.FC<{ navigation: DiscoverNav }> = ({ navigation }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { allActivities, isActivityJoined, toggleJoinActivity, profile, reloadAllActivities, userLocation, discoveryRange: contextDiscoveryRange, isUserBlockedById } = useActivityContext();
  const insets = useSafeAreaInsets();

  // Discovery range from context (loaded from AsyncStorage in ActivityContext)
  const [discoveryRange, setDiscoveryRange] = useState(contextDiscoveryRange);

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
  // userLocation comes from context (loaded before splash hides)
  const [showMap, setShowMap] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const [mapActivities, setMapActivities] = useState<Activity[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [selectedMapActivity, setSelectedMapActivity] = useState<Activity | null>(null);
  const [mapSelectedFilter, setMapSelectedFilter] = useState('All');
  const [mapSelectedDate, setMapSelectedDate] = useState<Date | null>(null);
  const [isMapDatePickerVisible, setMapDatePickerVisible] = useState(false);
  const [isMapIOSDatePickerVisible, setMapIOSDatePickerVisible] = useState(false);
  const [mapTempDate, setMapTempDate] = useState<Date | null>(null);
  const [showJoinedOnly, setShowJoinedOnly] = useState(true);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<Array<{ name: string; lat: number; lon: number }>>([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const locationSearchDebounceRef = useRef<number | null>(null);
  const [displayedActivitiesCount, setDisplayedActivitiesCount] = useState(8);
  const [isLoadingMoreActivities, setIsLoadingMoreActivities] = useState(false);
  const [searchedUsers, setSearchedUsers] = useState<Array<{ uid: string; username: string; photo?: string; bio?: string; sportsPreferences?: string[] }>>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const userSearchDebounceRef = useRef<number | null>(null);
  const [selectedClusterActivities, setSelectedClusterActivities] = useState<Activity[] | null>(null);
  const [clusterPanelIndex, setClusterPanelIndex] = useState(0);
  const mapFilterDebounceRef = useRef<number | null>(null);

  // Sync discovery range when context changes (e.g., on settings update)
  useEffect(() => {
    setDiscoveryRange(contextDiscoveryRange);
  }, [contextDiscoveryRange]);

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

  const handleLoadMoreActivities = () => {
    if (isLoadingMoreActivities) return;
    setIsLoadingMoreActivities(true);
    setTimeout(() => {
      setDisplayedActivitiesCount(prev => prev + 8);
      setIsLoadingMoreActivities(false);
    }, 300);
  };

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

  // Initial load - location is already loaded from context before splash hides
  useEffect(() => {
    loadActivities();
    // Set initial map region from context location
    if (userLocation && !mapRegion) {
      setMapRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.25,
        longitudeDelta: 0.25,
      });
    }
  }, [loadActivities, userLocation, mapRegion]);

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
      // Get UIDs of searched users to include their activities
      const searchedUserIds = searchedUsers.map(u => u.uid);
      
      list = list.filter(a =>
        a.activity.toLowerCase().includes(q) ||
        a.creator.toLowerCase().includes(q) ||
        (a.creatorUsername && a.creatorUsername.toLowerCase().includes(q)) ||
        (a.location && a.location.toLowerCase().includes(q)) ||
        // Include activities created by matched users
        (a.creatorId && searchedUserIds.includes(a.creatorId))
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
    searchedUsers,
  ]);

  // Count activities per searched user (for display in user cards)
  const activitiesPerUser = useMemo(() => {
    const counts: Record<string, number> = {};
    searchedUsers.forEach(user => {
      counts[user.uid] = filteredActivities.filter(a => a.creatorId === user.uid).length;
    });
    return counts;
  }, [searchedUsers, filteredActivities]);

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
    
    // Apply search filter
    if (mapSearchQuery.trim()) {
      const q = mapSearchQuery.toLowerCase();
      filtered = filtered.filter(a =>
        a.activity.toLowerCase().includes(q) ||
        a.creator.toLowerCase().includes(q) ||
        (a.location && a.location.toLowerCase().includes(q))
      );
    }
    
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
  }, [allActivities, mapSelectedFilter, mapSelectedDate, showJoinedOnly, isActivityJoined, mapSearchQuery]);

  // Group activities by location for clustering (activities at same lat/lng)
  const groupedMapActivities = useMemo(() => {
    const groups: { key: string; lat: number; lng: number; activities: Activity[] }[] = [];
    const locationMap = new Map<string, Activity[]>();
    
    mapActivities.forEach(act => {
      // Round to 5 decimal places (~1m precision) to group nearby activities
      const lat = Math.round(act.latitude * 100000) / 100000;
      const lng = Math.round(act.longitude * 100000) / 100000;
      const key = `${lat},${lng}`;
      
      if (!locationMap.has(key)) {
        locationMap.set(key, []);
      }
      locationMap.get(key)!.push(act);
    });
    
    locationMap.forEach((activities, key) => {
      const [lat, lng] = key.split(',').map(Number);
      groups.push({ key, lat, lng, activities });
    });
    
    return groups;
  }, [mapActivities]);

  // Refresh map activities when activities list changes or region/filters change (if map open)
  // Debounced to prevent race conditions when spamming filters
  useEffect(() => {
    if (!showMap || !mapRegion) return;

    // Clear any pending debounce
    if (mapFilterDebounceRef.current) {
      clearTimeout(mapFilterDebounceRef.current);
    }

    // Capture current filter values
    const currentFilter = mapSelectedFilter;
    const currentDate = mapSelectedDate;
    const currentJoined = showJoinedOnly;
    const currentSearch = mapSearchQuery;
    const currentRegion = mapRegion;

    // Debounce the filter update
    mapFilterDebounceRef.current = setTimeout(() => {
      // Apply filters with captured values
      setMapActivities(filterForRegion(currentRegion));
    }, 100) as unknown as number;

    return () => {
      if (mapFilterDebounceRef.current) {
        clearTimeout(mapFilterDebounceRef.current);
      }
    };
  }, [showMap, mapRegion, filterForRegion, mapSelectedFilter, mapSelectedDate, showJoinedOnly, mapSearchQuery]);
  
  // Separate effect for initial load when opening map
  useEffect(() => {
    if (showMap && mapRegion && mapActivities.length === 0 && !mapLoading) {
      setMapActivities(filterForRegion(mapRegion));
    }
  }, [showMap]);

  const handleLoadRegionActivities = useCallback(async () => {
    if (!mapRegion || mapLoading) return;
    setMapLoading(true);
    try {
      // Filter activities for the current map region from existing data
      const filtered = filterForRegion(mapRegion);
      setMapActivities(filtered);
    } catch (e) {
      console.error('Error loading region activities:', e);
    } finally {
      setMapLoading(false);
    }
  }, [mapRegion, mapLoading, filterForRegion]);

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

  // User search with debouncing - search profiles by username_lower
  useEffect(() => {
    if (userSearchDebounceRef.current) {
      clearTimeout(userSearchDebounceRef.current as any);
      userSearchDebounceRef.current = null;
    }

    if (!debouncedSearchQuery.trim() || debouncedSearchQuery.trim().length < 2) {
      setSearchedUsers([]);
      return;
    }

    // @ts-ignore - window.setTimeout returns number in RN env
    userSearchDebounceRef.current = setTimeout(async () => {
      setIsSearchingUsers(true);
      try {
        const searchLower = debouncedSearchQuery.toLowerCase().trim();
        const profilesRef = collection(db, 'profiles');
        
        // Search for usernames that start with the search query
        const q = query(
          profilesRef,
          where('username_lower', '>=', searchLower),
          where('username_lower', '<=', searchLower + '\uf8ff'),
          limit(5)
        );
        
        const snapshot = await getDocs(q);
        const users: Array<{ uid: string; username: string; photo?: string; bio?: string; sportsPreferences?: string[] }> = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Don't show current user in search results
          if (doc.id !== auth.currentUser?.uid) {
            users.push({
              uid: doc.id,
              username: data.username || 'User',
              photo: data.photo || data.photoURL,
              bio: data.bio,
              sportsPreferences: data.sportsPreferences || data.selectedSports,
            });
          }
        });
        
        setSearchedUsers(users);
      } catch (error) {
        console.error('User search error:', error);
        setSearchedUsers([]);
      } finally {
        setIsSearchingUsers(false);
      }
    }, DEBOUNCE_MS) as unknown as number;

    return () => {
      if (userSearchDebounceRef.current) {
        clearTimeout(userSearchDebounceRef.current as any);
        userSearchDebounceRef.current = null;
      }
    };
  }, [debouncedSearchQuery]);

  // Location search with debouncing
  useEffect(() => {
    if (locationSearchDebounceRef.current) {
      clearTimeout(locationSearchDebounceRef.current as any);
      locationSearchDebounceRef.current = null;
    }

    if (!mapSearchQuery.trim()) {
      setLocationSuggestions([]);
      return;
    }

    // @ts-ignore - window.setTimeout returns number in RN env
    locationSearchDebounceRef.current = setTimeout(async () => {
      setIsSearchingLocation(true);
      try {
        // Using Nominatim (OpenStreetMap) geocoding API - free and no API key required
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(mapSearchQuery)}&limit=5`,
          {
            headers: {
              'User-Agent': 'SportsPal/1.0',
            },
          }
        );
        const data = await response.json();
        const suggestions = data.map((item: any) => ({
          name: item.display_name,
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
        }));
        setLocationSuggestions(suggestions);
      } catch (error) {
        console.error('Location search error:', error);
        setLocationSuggestions([]);
      } finally {
        setIsSearchingLocation(false);
      }
    }, DEBOUNCE_MS) as unknown as number;

    return () => {
      if (locationSearchDebounceRef.current) {
        clearTimeout(locationSearchDebounceRef.current as any);
        locationSearchDebounceRef.current = null;
      }
    };
  }, [mapSearchQuery]);

  const handleLocationSelect = useCallback((lat: number, lon: number) => {
    if (mapRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const newRegion = {
        latitude: lat,
        longitude: lon,
        latitudeDelta: 0.15,
        longitudeDelta: 0.15,
      };
      setMapRegion(newRegion);
      mapRef.current.animateToRegion(newRegion, 500);
      setLocationSuggestions([]);
      setMapSearchQuery('');
    }
  }, []);

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

  // User profile card for search results
  const UserProfileCard = React.memo(({ user, activitiesCount }: { 
    user: { uid: string; username: string; photo?: string; bio?: string; sportsPreferences?: string[] };
    activitiesCount: number;
  }) => {
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftWidth: 4, borderLeftColor: theme.primary }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          (navigation as any).navigate('UserProfile', { userId: user.uid });
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <UserAvatar
            photoUrl={user.photo}
            username={user.username}
            size={56}
            borderColor={theme.primary}
            borderWidth={2}
          />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: theme.text }}>{user.username}</Text>
              <View style={{ backgroundColor: `${theme.primary}20`, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: theme.primary }}>USER</Text>
              </View>
            </View>
            {user.bio ? (
              <Text style={{ fontSize: 13, color: theme.muted, marginTop: 4 }} numberOfLines={1}>{user.bio}</Text>
            ) : null}
            {user.sportsPreferences && user.sportsPreferences.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 }}>
                {user.sportsPreferences.slice(0, 4).map((sport, idx) => (
                  <View key={idx} style={{ backgroundColor: `${theme.primary}12`, padding: 4, borderRadius: 6 }}>
                    <ActivityIcon activity={sport} size={16} color={theme.primary} />
                  </View>
                ))}
                {user.sportsPreferences.length > 4 && (
                  <Text style={{ fontSize: 12, color: theme.muted, fontWeight: '500' }}>+{user.sportsPreferences.length - 4}</Text>
                )}
              </View>
            )}
          </View>
          <View style={{ alignItems: 'center' }}>
            <Ionicons name="chevron-forward" size={22} color={theme.muted} />
            {activitiesCount > 0 && (
              <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{activitiesCount} {activitiesCount === 1 ? 'activity' : 'activities'}</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  });

  const toggleSortByDistance = useCallback(
    () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsSortingByDistance(prev => !prev);
    },
    []
  );

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
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
              placeholder="Search activities or users..."
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
              <Ionicons name="navigate" size={14} color={isSortingByDistance ? '#fff' : theme.primary} style={{ marginRight: 6 }} />
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
              <Ionicons name="calendar" size={14} color={theme.primary} style={{ marginRight: 6 }} />
              <Text style={styles.sortButtonText}>
                {selectedDate ? selectedDate.toDateString() : 'Select Date'}
              </Text>
            </TouchableOpacity>

            {selectedDate && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={async () => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedDate(null);
                  await loadActivities();
                }}
              >
                <Ionicons name="close" size={16} color={theme.text} />
              </TouchableOpacity>
            )}
          </Pressable>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterWrapper}>
            {orderedSportFilters.map(option => (
              <TouchableOpacity
                key={option}
                style={[styles.filterChip, selectedFilter === option && styles.filterChipActive]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedFilter(option);
                }}
              >
                {option !== 'All' && (
                  <View style={{ marginRight: 6 }}>
                    <ActivityIcon 
                      activity={option} 
                      size={14} 
                      color={selectedFilter === option ? '#fff' : theme.primary}
                    />
                  </View>
                )}
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
              {/* Search Bar with Suggestions */}
              <View>
                <View style={styles.mapSearchContainer}>
                  <Ionicons name="search" size={18} color={theme.primary} />
                  <TextInput
                    style={styles.mapSearchInput}
                    placeholder="Search cities, countries..."
                    placeholderTextColor={theme.muted}
                    value={mapSearchQuery}
                    onChangeText={setMapSearchQuery}
                    returnKeyType="search"
                    onSubmitEditing={() => {
                      if (locationSuggestions.length > 0) {
                        handleLocationSelect(locationSuggestions[0].lat, locationSuggestions[0].lon);
                      }
                    }}
                  />
                  {isSearchingLocation && (
                    <ActivityIndicator size="small" color={theme.primary} style={{ marginRight: 4 }} />
                  )}
                  {mapSearchQuery.length > 0 && !isSearchingLocation && (
                    <TouchableOpacity
                      onPress={() => {
                        setMapSearchQuery('');
                        setLocationSuggestions([]);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={20} color={theme.primary} />
                    </TouchableOpacity>
                  )}
                </View>
                
                {/* Location Suggestions Dropdown */}
                {locationSuggestions.length > 0 && (
                  <View style={styles.locationSuggestionsContainer}>
                    <ScrollView 
                      style={styles.locationSuggestionsList}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                    >
                      {locationSuggestions.map((suggestion, index) => (
                        <TouchableOpacity
                          key={index}
                          style={styles.locationSuggestionItem}
                          onPress={() => handleLocationSelect(suggestion.lat, suggestion.lon)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="location" size={16} color={theme.primary} style={{ marginRight: 8 }} />
                          <Text style={styles.locationSuggestionText} numberOfLines={1}>
                            {suggestion.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Buttons Row */}
              <View style={styles.mapSortButtons}>
                <TouchableOpacity
                  style={[styles.mapSortButton, showJoinedOnly && styles.mapActiveButton]}
                  onPress={() => {
                    const newValue = !showJoinedOnly;
                    setShowJoinedOnly(newValue);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="checkmark-circle" size={14} color={showJoinedOnly ? '#fff' : theme.primary} style={{ marginRight: 6 }} />
                  <Text style={[
                    styles.mapSortButtonText,
                    showJoinedOnly && { color: '#fff' },
                  ]}>Joined Activities</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.mapSortButton}
                  onPress={() => {
                    if (Platform.OS === 'ios') {
                      setMapTempDate(mapSelectedDate ?? new Date());
                      setMapIOSDatePickerVisible(true);
                    } else {
                      setMapDatePickerVisible(true);
                    }
                  }}
                >
                  <Ionicons name="calendar" size={14} color={theme.primary} style={{ marginRight: 6 }} />
                  <Text style={styles.mapSortButtonText}>
                    {mapSelectedDate ? mapSelectedDate.toDateString() : 'Select Date'}
                  </Text>
                </TouchableOpacity>

                {mapSelectedDate && (
                  <TouchableOpacity
                    style={styles.mapClearButton}
                    onPress={() => {
                      setMapSelectedDate(null);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                  >
                    <Ionicons name="close" size={16} color={theme.text} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Sport Filters */}
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false} 
                style={styles.mapFilterWrapper}
              >
                {orderedSportFilters.map((option, index) => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.mapFilterChip,
                      mapSelectedFilter === option && styles.mapFilterChipActive,
                      index === 0 && { marginLeft: 0 },
                      index === orderedSportFilters.length - 1 && { marginRight: 15 },
                    ]}
                    onPress={() => {
                      setMapSelectedFilter(option);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                  >
                    {option !== 'All' && (
                      <View style={{ marginRight: 6 }}>
                        <ActivityIcon 
                          activity={option} 
                          size={14} 
                          color={mapSelectedFilter === option ? '#fff' : theme.primary}
                        />
                      </View>
                    )}
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
            </View>
            
            {mapRegion && (
              <MapView
                ref={mapRef}
                style={styles.map}
                // iOS: default (Apple Maps), Android: Google Maps
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                initialRegion={mapRegion}
                showsUserLocation={true}
                showsMyLocationButton={false}
                userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
                // Disable Android default toolbar (navigation/directions button)
                toolbarEnabled={false}
                // Disable Google Maps logo and controls
                liteMode={false}
                mapPadding={{ top: 0, right: 0, bottom: 0, left: 0 }}
                showsCompass={false}
                showsScale={false}
                showsBuildings={true}
                showsTraffic={false}
                showsIndoors={true}
                onRegionChangeComplete={(region) => {
                  setMapRegion(region);
                }}
              >
                {groupedMapActivities.map(group => (
                  <Marker
                    key={group.key}
                    coordinate={{ latitude: group.lat, longitude: group.lng }}
                    onPress={() => {
                      if (group.activities.length === 1) {
                        setSelectedMapActivity(group.activities[0]);
                        setSelectedClusterActivities(null);
                      } else {
                        setSelectedClusterActivities(group.activities);
                        setClusterPanelIndex(0);
                        setSelectedMapActivity(null);
                      }
                    }}
                    tracksViewChanges={Platform.OS === 'android'}
                  >
                    {group.activities.length === 1 ? (
                      <View style={styles.markerInner}>
                        <ActivityIcon activity={group.activities[0].activity} size={20} color={theme.primary} />
                        {isActivityJoined(group.activities[0].id) && (
                          <View style={styles.markerBadge}>
                            <Ionicons name="checkmark" size={10} color={theme.isDark ? '#000' : '#fff'} />
                          </View>
                        )}
                      </View>
                    ) : (
                      <View style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: theme.primary,
                        borderWidth: 2,
                        borderColor: theme.card,
                        alignItems: 'center',
                        justifyContent: 'center',
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.25,
                        shadowRadius: 3,
                        elevation: 4,
                      }}>
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                          {group.activities.length}
                        </Text>
                      </View>
                    )}
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

            {/* Cluster Panel - shows when multiple activities at same location */}
            {selectedClusterActivities && selectedClusterActivities.length > 0 && (
              <View style={styles.mapActivityPanel}>
                {/* Header with count badge */}
                <View style={styles.mapPanelHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <View style={{ 
                      width: 32, 
                      height: 32, 
                      borderRadius: 16, 
                      backgroundColor: theme.primary, 
                      alignItems: 'center', 
                      justifyContent: 'center',
                    }}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                        {selectedClusterActivities.length}
                      </Text>
                    </View>
                    <Text style={styles.mapActivityPanelTitle}>Activities here</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedClusterActivities(null)} style={styles.mapActivityPanelClose}>
                    <Ionicons name="close" size={22} color={theme.text} />
                  </TouchableOpacity>
                </View>

                {/* Navigation with dots indicator */}
                <View style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  marginBottom: 16,
                  gap: 16,
                }}>
                  <TouchableOpacity
                    onPress={() => setClusterPanelIndex(prev => Math.max(0, prev - 1))}
                    disabled={clusterPanelIndex === 0}
                    style={{ 
                      opacity: clusterPanelIndex === 0 ? 0.3 : 1, 
                      padding: 8,
                      backgroundColor: theme.background,
                      borderRadius: 20,
                    }}
                  >
                    <Ionicons name="chevron-back" size={20} color={theme.primary} />
                  </TouchableOpacity>
                  
                  {/* Dots indicator */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {selectedClusterActivities.map((_, idx) => (
                      <TouchableOpacity 
                        key={idx}
                        onPress={() => setClusterPanelIndex(idx)}
                      >
                        <View style={{
                          width: idx === clusterPanelIndex ? 20 : 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: idx === clusterPanelIndex ? theme.primary : `${theme.primary}40`,
                        }} />
                      </TouchableOpacity>
                    ))}
                  </View>
                  
                  <TouchableOpacity
                    onPress={() => setClusterPanelIndex(prev => Math.min(selectedClusterActivities.length - 1, prev + 1))}
                    disabled={clusterPanelIndex === selectedClusterActivities.length - 1}
                    style={{ 
                      opacity: clusterPanelIndex === selectedClusterActivities.length - 1 ? 0.3 : 1, 
                      padding: 8,
                      backgroundColor: theme.background,
                      borderRadius: 20,
                    }}
                  >
                    <Ionicons name="chevron-forward" size={20} color={theme.primary} />
                  </TouchableOpacity>
                </View>

                {/* Current activity card */}
                {(() => {
                  const currentActivity = selectedClusterActivities[clusterPanelIndex];
                  return (
                    <View style={{
                      backgroundColor: theme.background,
                      borderRadius: 10,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: theme.border,
                    }}>
                      {/* Activity header with icon and title */}
                      <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                          <ActivityIcon activity={currentActivity.activity} size={32} color={theme.primary} />
                          <Text style={styles.cardTitle}>{currentActivity.activity}</Text>
                        </View>
                        {isActivityJoined(currentActivity.id) && (
                          <View style={{ 
                            backgroundColor: `${theme.primary}20`, 
                            paddingHorizontal: 8, 
                            paddingVertical: 4, 
                            borderRadius: 12,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                          }}>
                            <Ionicons name="checkmark-circle" size={14} color={theme.primary} />
                            <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '600' }}>Joined</Text>
                          </View>
                        )}
                      </View>

                      {/* Info rows matching card style */}
                      <View style={styles.infoRow}>
                        <Ionicons name="person" size={16} color={theme.primary} style={styles.infoIcon} />
                        <Text style={styles.cardInfoLabel}>Host:</Text>
                        <HostUsername activity={currentActivity} />
                      </View>

                      <View style={styles.infoRow}>
                        <Ionicons name="calendar" size={16} color={theme.primary} style={styles.infoIcon} />
                        <Text style={styles.cardInfoLabel}>Date:</Text>
                        <Text style={styles.cardInfo}>{currentActivity.date}</Text>
                      </View>

                      <View style={styles.infoRow}>
                        <Ionicons name="time" size={16} color={theme.primary} style={styles.infoIcon} />
                        <Text style={styles.cardInfoLabel}>Time:</Text>
                        <Text style={styles.cardInfo}>{currentActivity.time}</Text>
                      </View>

                      <View style={styles.infoRow}>
                        <Ionicons name="people" size={16} color={theme.primary} style={styles.infoIcon} />
                        <Text style={styles.cardInfoLabel}>Participants:</Text>
                        <Text style={styles.cardInfo}>
                          {currentActivity.joinedUserIds ? currentActivity.joinedUserIds.length : currentActivity.joinedCount} / {currentActivity.maxParticipants}
                        </Text>
                      </View>

                      {/* Action buttons matching card style */}
                      <View style={styles.cardActions}>
                        <TouchableOpacity
                          style={[
                            styles.joinButton,
                            { flex: 1, alignItems: 'center' },
                            isActivityJoined(currentActivity.id) && {
                              backgroundColor: theme.isDark ? '#007E84' : darkenHex(theme.primary, 0.12),
                            },
                          ]}
                          onPress={async () => {
                            try {
                              await toggleJoinActivity(currentActivity);
                            } catch (err) {
                              console.error('Error toggling join:', err);
                            }
                          }}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.joinButtonText}>
                            {isActivityJoined(currentActivity.id) ? 'Leave' : 'Join'}
                          </Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity
                          onPress={() => {
                            navigation.navigate('ActivityDetails', { activityId: currentActivity.id });
                            setSelectedClusterActivities(null);
                          }}
                          style={[styles.shareButton, { flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }]}
                          activeOpacity={0.85}
                        >
                          <Ionicons name="open-outline" size={16} color={theme.text} />
                          <Text style={{ color: theme.text, fontWeight: '600', fontSize: 14 }}>Details</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })()}
              </View>
            )}
          </View>
        )}



        {!showMap && (
        <FlatList
          data={filteredActivities.slice(0, displayedActivitiesCount)}
          renderItem={({ item }) => <ActivityCard item={item} />}
          keyExtractor={(item) => item.id}
          getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
          onEndReached={displayedActivitiesCount < filteredActivities.length ? handleLoadMoreActivities : null}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={
            searchedUsers.length > 0 ? (
              <View style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                  <Ionicons name="people" size={18} color={theme.primary} />
                  <Text style={{ fontSize: 15, fontWeight: '700', color: theme.primary }}>Users Found</Text>
                  {isSearchingUsers && <ActivityIndicator size="small" color={theme.primary} style={{ marginLeft: 8 }} />}
                </View>
                {searchedUsers.map((user) => (
                  isUserBlockedById(user.uid) 
                    ? <BlockedUserSearchCard key={user.uid} user={user} />
                    : <UserProfileCard key={user.uid} user={user} activitiesCount={activitiesPerUser[user.uid] || 0} />
                ))}
                {filteredActivities.length > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 8, gap: 8 }}>
                    <Ionicons name="fitness" size={18} color={theme.primary} />
                    <Text style={{ fontSize: 15, fontWeight: '700', color: theme.primary }}>Activities</Text>
                  </View>
                )}
              </View>
            ) : null
          }
          ListFooterComponent={
            isLoadingMoreActivities ? (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 60, minHeight: 600 }}>
              
              {/* Background Icons - Scattered colorfully */}
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                 {/* Top Left - Soccer */}
                 <View style={{ position: 'absolute', top: '8%', left: '6%', transform: [{ rotate: '-15deg' }], opacity: 0.6 }}>
                    <ActivityIcon activity="Soccer" size={48} color="#10B981" />
                 </View>
                 {/* Top Right - Basketball */}
                 <View style={{ position: 'absolute', top: '10%', right: '8%', transform: [{ rotate: '18deg' }], opacity: 0.6 }}>
                    <ActivityIcon activity="Basketball" size={46} color="#F59E0B" />
                 </View>
                 {/* Middle Left - Tennis */}
                 <View style={{ position: 'absolute', top: '32%', left: '2%', transform: [{ rotate: '-12deg' }], opacity: 0.55 }}>
                    <ActivityIcon activity="Tennis" size={42} color="#EF4444" />
                 </View>
                 {/* Middle Center Left - Cycling */}
                 <View style={{ position: 'absolute', top: '48%', left: '10%', transform: [{ rotate: '8deg' }], opacity: 0.5 }}>
                    <ActivityIcon activity="Cycling" size={40} color="#06B6D4" />
                 </View>
                 {/* Middle Right - Volleyball */}
                 <View style={{ position: 'absolute', top: '35%', right: '4%', transform: [{ rotate: '22deg' }], opacity: 0.55 }}>
                    <ActivityIcon activity="Volleyball" size={44} color="#8B5CF6" />
                 </View>
                 {/* Middle Center Right - Running */}
                 <View style={{ position: 'absolute', top: '50%', right: '12%', transform: [{ rotate: '-18deg' }], opacity: 0.5 }}>
                    <ActivityIcon activity="Running" size={38} color="#EC4899" />
                 </View>
                 {/* Bottom Left - Gym */}
                 <View style={{ position: 'absolute', bottom: '25%', left: '8%', transform: [{ rotate: '-25deg' }], opacity: 0.55 }}>
                    <ActivityIcon activity="Gym" size={46} color="#6366F1" />
                 </View>
                 {/* Bottom Center Left - Swimming */}
                 <View style={{ position: 'absolute', bottom: '12%', left: '18%', transform: [{ rotate: '15deg' }], opacity: 0.5 }}>
                    <ActivityIcon activity="Swimming" size={36} color="#14B8A6" />
                 </View>
                 {/* Bottom Right - Hiking */}
                 <View style={{ position: 'absolute', bottom: '20%', right: '10%', transform: [{ rotate: '12deg' }], opacity: 0.55 }}>
                    <ActivityIcon activity="Hiking" size={42} color="#F97316" />
                 </View>
                 {/* Bottom Center Right - Yoga */}
                 <View style={{ position: 'absolute', bottom: '8%', right: '22%', transform: [{ rotate: '-8deg' }], opacity: 0.5 }}>
                    <ActivityIcon activity="Yoga" size={34} color="#A855F7" />
                 </View>
                 {/* Top Center - Baseball */}
                 <View style={{ position: 'absolute', top: '5%', left: '42%', transform: [{ rotate: '25deg' }], opacity: 0.45 }}>
                    <ActivityIcon activity="Baseball" size={32} color="#3B82F6" />
                 </View>
                 {/* Middle Far Right - Padel */}
                 <View style={{ position: 'absolute', top: '58%', right: '2%', transform: [{ rotate: '-20deg' }], opacity: 0.45 }}>
                    <ActivityIcon activity="Padel" size={34} color="#FBBF24" />
                 </View>
              </View>

              {/* Central Content */}
              <View style={{ alignItems: 'center', paddingHorizontal: 28, zIndex: 10 }}>
                {/* Glowing Icon */}
                <View style={{ 
                  width: 100, 
                  height: 100, 
                  borderRadius: 50, 
                  backgroundColor: `${theme.primary}15`,
                  alignItems: 'center', 
                  justifyContent: 'center',
                  marginBottom: 24,
                  borderWidth: 2,
                  borderColor: `${theme.primary}30`,
                  shadowColor: theme.primary,
                  shadowOpacity: 0.5,
                  shadowRadius: 25,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 10
                }}>
                  <Ionicons 
                    name={selectedFilter !== 'All' || selectedDate || debouncedSearchQuery ? "search" : "rocket"} 
                    size={48} 
                    color={theme.primary} 
                  />
                </View>

                {/* Context Badge - shows active filters */}
                {(selectedFilter !== 'All' || selectedDate || debouncedSearchQuery) && (
                  <View
                    style={{
                      backgroundColor: `${theme.primary}20`,
                      paddingHorizontal: 16,
                      paddingVertical: 8,
                      borderRadius: 20,
                      marginBottom: 16,
                      borderWidth: 1,
                      borderColor: `${theme.primary}40`,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Ionicons name="filter" size={14} color={theme.primary} />
                    <Text
                      style={{
                        color: theme.primary,
                        fontSize: 13,
                        fontWeight: '600',
                      }}
                    >
                      {selectedFilter !== 'All' ? selectedFilter : ''}
                      {selectedFilter !== 'All' && selectedDate ? ' • ' : ''}
                      {selectedDate ? selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                      {(selectedFilter !== 'All' || selectedDate) && debouncedSearchQuery ? ' • ' : ''}
                      {debouncedSearchQuery ? `"${debouncedSearchQuery}"` : ''}
                    </Text>
                  </View>
                )}

                {/* Main Message */}
                <Text style={{ 
                  fontSize: 26, 
                  fontWeight: '800', 
                  color: theme.text, 
                  textAlign: 'center', 
                  marginBottom: 12,
                  letterSpacing: 0.3
                }}>
                  {selectedFilter !== 'All' || selectedDate || debouncedSearchQuery 
                    ? 'No Matches Found' 
                    : 'Be the Spark'}
                </Text>
                
                {/* Sub Message */}
                <Text style={{ 
                  fontSize: 15, 
                  color: theme.muted, 
                  textAlign: 'center', 
                  lineHeight: 23, 
                  marginBottom: 28,
                  fontWeight: '500',
                  paddingHorizontal: 8
                }}>
                  {selectedFilter !== 'All' || selectedDate || debouncedSearchQuery 
                    ? `No activities match your current filters within ${discoveryRange}km. Try adjusting your search or be the first to create one!`
                    : 'No activities nearby yet, others might be waiting for someone to take the lead.\n\nCreate an activity and bring the community together!'}
                </Text>

                {/* Action Buttons */}
                <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {/* Clear Filters button - only show when filters are active */}
                  {(selectedFilter !== 'All' || selectedDate || debouncedSearchQuery) && (
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedFilter('All');
                        setSelectedDate(null);
                        setRawSearchQuery('');
                        setDebouncedSearchQuery('');
                      }}
                      style={{
                        backgroundColor: theme.card,
                        paddingVertical: 14,
                        paddingHorizontal: 24,
                        borderRadius: 25,
                        borderWidth: 1.5,
                        borderColor: theme.primary,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8
                      }}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="close-circle" size={20} color={theme.primary} />
                      <Text style={{ color: theme.primary, fontSize: 15, fontWeight: '700' }}>
                        Clear Filters
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Create Activity button */}
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      navigation.navigate('CreateGame');
                    }}
                    style={{
                      backgroundColor: theme.primary,
                      paddingVertical: 14,
                      paddingHorizontal: 24,
                      borderRadius: 25,
                      shadowColor: theme.primary,
                      shadowOpacity: 0.4,
                      shadowRadius: 12,
                      shadowOffset: { width: 0, height: 5 },
                      elevation: 8,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8
                    }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add-circle" size={20} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                      Create Activity
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Distance hint */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 24,
                    backgroundColor: `${theme.muted}12`,
                    paddingVertical: 10,
                    paddingHorizontal: 16,
                    borderRadius: 12,
                    gap: 8,
                  }}
                >
                  <Ionicons name="navigate-circle-outline" size={18} color={theme.muted} />
                  <Text
                    style={{
                      color: theme.muted,
                      fontSize: 13,
                      fontWeight: '500',
                    }}
                  >
                    Searching within {discoveryRange}km • Adjust in Settings
                  </Text>
                </View>
              </View>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing || refreshLocked}
              onRefresh={loadActivities}
              colors={[theme.isDark ? theme.primary : theme.primaryStrong] as any}
              tintColor={theme.isDark ? theme.primary : theme.primaryStrong}
              progressBackgroundColor="transparent"
            />
          }
          contentContainerStyle={filteredActivities.length === 0 ? { flexGrow: 1 } : styles.listContainer}
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
            onConfirm={(date) => { 
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSelectedDate(date); 
              setDatePickerVisible(false); 
            }}
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
                  <TouchableOpacity onPress={() => { 
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    if (tempDate) setSelectedDate(tempDate); 
                    setIOSDatePickerVisible(false); 
                  }}>
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
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    </View>
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
  mapContainer: { flex: 1, borderRadius: 0, overflow: 'hidden' },
  mapFiltersContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: 15,
  },
  mapSearchContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: t.card, 
    borderRadius: 8, 
    paddingHorizontal: 10, 
    paddingVertical: 8, 
    marginBottom: 10 
  },
  mapSearchInput: {
    flex: 1,
    marginLeft: 8,
    backgroundColor: 'transparent',
    borderRadius: 8,
    paddingVertical: 0,
    color: t.text,
    fontSize: 16,
  },
  locationSuggestionsContainer: {
    backgroundColor: t.card,
    borderRadius: 8,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
    maxHeight: 200,
  },
  locationSuggestionsList: {
    maxHeight: 200,
  },
  locationSuggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  locationSuggestionText: {
    flex: 1,
    color: t.text,
    fontSize: 14,
    fontWeight: '500',
  },
  mapSortButtons: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginBottom: 10
  },
  mapSortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: t.card,
    borderRadius: 5,
    marginRight: 8,
  },
  mapActiveButton: { backgroundColor: t.primary },
  mapSortButtonText: { color: t.text, fontSize: 14, fontWeight: '500' },
  mapClearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.danger,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginLeft: 5,
  },
  mapClearButtonText: { color: t.text, fontSize: 14, fontWeight: '500' },
  mapFilterWrapper: { 
    flexDirection: 'row',
    marginVertical: 10,
  },
  mapFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: t.card,
    borderRadius: 20,
    marginRight: 8,
  },
  mapFilterChipActive: { backgroundColor: t.primary },
  mapFilterChipText: { color: t.text, fontSize: 14, fontWeight: '500' },
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: t.card,
    borderRadius: 5,
    marginRight: 8,
  },
  activeButton: { backgroundColor: t.primary },
  sortButtonText: { color: t.text, fontSize: 14, fontWeight: '500' },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.danger,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginLeft: 5,
  },
  clearButtonText: { color: t.text, fontSize: 14, fontWeight: '500' },

  filterWrapper: { flexDirection: 'row', marginVertical: 10 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
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
