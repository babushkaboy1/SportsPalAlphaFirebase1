// context/ActivityContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Activity } from '../data/activitiesData';
import { getUserJoinedActivities, joinActivity, leaveActivity, fetchAllActivities, deleteActivity } from '../utils/firestoreActivities';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { Alert } from 'react-native';
import { doc, getDoc, onSnapshot, query, collection, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { getOrCreateChatForActivity } from '../utils/firestoreChats';
import { 
  saveActivitiesToCache, 
  loadActivitiesFromCache, 
  updateActivityInCache,
  clearActivityCache,
  saveHistoricalActivitiesToCache,
  loadHistoricalActivitiesFromCache
} from '../utils/activityCache';
import { ActivityJoinLeaveModal } from '../components/ActivityJoinLeaveModal';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBlockedUsers, clearBlockedUsersCache, getBlockedUsersCached } from '../utils/firestoreBlocks';

// Default discovery radius
const DEFAULT_RADIUS_KM = 70;

type ActivityContextType = {
  joinedActivities: string[];
  toggleJoinActivity: (activity: Activity, onDeleteNavigate?: () => void) => Promise<void>;
  isActivityJoined: (activityId: string) => boolean;
  setJoinedActivities: React.Dispatch<React.SetStateAction<string[]>>;
  allActivities: Activity[];
  reloadAllActivities: (forceRefresh?: boolean) => Promise<void>;
  profile: any;
  initialActivitiesLoaded: boolean;
  userLocation: { latitude: number; longitude: number } | null;
  discoveryRange: number;
  initialLocationLoaded: boolean;
  blockedUsers: string[];
  reloadBlockedUsers: () => Promise<void>;
  isUserBlockedById: (userId: string) => boolean;
};

const ActivityContext = createContext<ActivityContextType | undefined>(undefined);

export const useActivityContext = () => {
  const context = useContext(ActivityContext);
  if (!context) {
    throw new Error('useActivityContext must be used within an ActivityProvider');
  }
  return context;
};

export const ActivityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [joinedActivities, setJoinedActivities] = useState<string[]>([]);
  const [allActivitiesRaw, setAllActivitiesRaw] = useState<Activity[]>([]);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  // Track when the first meaningful activities load (after initial Firestore fetch)
  const [initialActivitiesLoaded, setInitialActivitiesLoaded] = useState(false);
  
  // Blocked users state
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  
  // Location state - centralized for splash screen coordination
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [discoveryRange, setDiscoveryRange] = useState(DEFAULT_RADIUS_KM);
  const [initialLocationLoaded, setInitialLocationLoaded] = useState(false);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<'join' | 'leave'>('join');
  const [pendingActivity, setPendingActivity] = useState<Activity | null>(null);
  const [modalResolve, setModalResolve] = useState<((value: boolean) => void) | null>(null);

  // Show modal and wait for user decision
  const showJoinLeaveModal = (activity: Activity, mode: 'join' | 'leave'): Promise<boolean> => {
    return new Promise((resolve) => {
      setPendingActivity(activity);
      setModalMode(mode);
      setModalResolve(() => resolve);
      setModalVisible(true);
    });
  };

  const handleModalConfirm = () => {
    setModalVisible(false);
    modalResolve?.(true);
  };

  const handleModalCancel = () => {
    setModalVisible(false);
    modalResolve?.(false);
  };

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return unsubscribe;
  }, []);

  // Load user location and discovery range on app start
  // This runs early so splash screen can wait for it
  useEffect(() => {
    const loadLocationAndRange = async () => {
      try {
        // Load discovery range from AsyncStorage
        const savedRange = await AsyncStorage.getItem('discoveryRange');
        if (savedRange) {
          setDiscoveryRange(parseInt(savedRange, 10));
        }

        // Request location permission and get location
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          // Try last known location first (instant)
          let location = await Location.getLastKnownPositionAsync({});
          if (!location) {
            // Fallback to current position
            location = await Location.getCurrentPositionAsync({});
          }
          if (location) {
            setUserLocation(location.coords);
          }
        }
      } catch (error) {
        console.error('Failed to load location:', error);
      } finally {
        // Mark location as loaded even if it failed (so app doesn't hang)
        setInitialLocationLoaded(true);
      }
    };
    loadLocationAndRange();
  }, []);

  // Fetch user profile
  // Real-time listener for user profile (updates when profile is edited)
  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    const userRef = doc(db, 'profiles', user.uid);
    const unsubscribe = onSnapshot(
      userRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setProfile(docSnap.data());
        } else {
          setProfile(null);
        }
      },
      (error) => {
        if ((error as any)?.code !== 'permission-denied') {
          console.error('Profile subscription error:', error);
        }
        setProfile(null);
      }
    );
    return unsubscribe;
  }, [user]);

  // Load joined activities only after user is set
  useEffect(() => {
    if (!user) return;
    const loadActivities = async () => {
      try {
        const joined = await getUserJoinedActivities();
        setJoinedActivities(joined);
      } catch (error) {
        console.error('Error loading joined activities:', error);
        setJoinedActivities([]);
      }
    };
    loadActivities();
  }, [user]);

  // Load all activities from Firestore with smart caching
  const reloadAllActivities = useCallback(async (forceRefresh = false) => {
    try {
      // Avoid fetching before auth; rules require request.auth != null
      if (!auth.currentUser) {
        setAllActivitiesRaw([]);
        setInitialActivitiesLoaded(false);
        return;
      }

      // Try loading from cache first (instant UI)
      if (!forceRefresh) {
        const [cached, historicalCached] = await Promise.all([
          loadActivitiesFromCache(),
          loadHistoricalActivitiesFromCache()
        ]);
        
        if (cached && historicalCached) {
          console.log('📦 Loaded activities and historical from cache (skipping Firestore read)');
          // Merge cached data - filter out duplicates
          const allIds = new Set(cached.map((a: any) => a.id));
          const uniqueHistorical = historicalCached.filter((a: any) => !allIds.has(a.id));
          setAllActivitiesRaw([...cached, ...uniqueHistorical] as Activity[]);
          if (!initialActivitiesLoaded) setInitialActivitiesLoaded(true);
          return; // Cache is valid - skip Firestore read to save costs!
        } else if (cached) {
          console.log('📦 Loaded activities from cache (skipping Firestore read)');
          setAllActivitiesRaw(cached as Activity[]);
          if (!initialActivitiesLoaded) setInitialActivitiesLoaded(true);
          return; // Cache is valid - skip Firestore read to save costs!
        }
        // Cache expired or empty - continue to fetch from Firestore
      }

      // Fetch fresh data from Firestore
      console.log('🔄 Fetching fresh activities from Firestore');
      const firestoreActivities = await fetchAllActivities();
      
      // Fetch all unique creatorIds
      const creatorIds = Array.from(new Set(firestoreActivities.map(a => a.creatorId).filter((id): id is string => typeof id === 'string')));
      
      // Fetch all creator profiles in parallel
      const profiles = await Promise.all(
        creatorIds.map(async (uid: string) => {
          const { getDoc, doc } = await import('firebase/firestore');
          const { db } = await import('../firebaseConfig');
          const snap = await getDoc(doc(db, 'profiles', uid));
          return snap.exists() ? { uid, username: snap.data().username } : { uid, username: 'Unknown' };
        })
      );
      
      // Map creatorId to username
      const idToUsername: Record<string, string> = {};
      profiles.forEach(p => { if (typeof p.uid === 'string') idToUsername[p.uid] = p.username; });
      
      // Attach creatorUsername to each activity
      const activitiesWithUsernames = firestoreActivities.map(a => ({
        ...a,
        creatorUsername: a.creatorId && idToUsername[a.creatorId] ? idToUsername[a.creatorId] : a.creator,
      }));
      
      // Split into historical vs upcoming activities
      // Historical = start + 2 hours < now (same logic as ProfileScreen)
      const toStartDate = (a: any) => {
        const d = a?.date;
        if (!d || typeof d !== 'string') return null;
        let ymd = d.trim();
        const m1 = ymd.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m1) {
          const [, dd, mm, yyyy] = m1;
          ymd = `${yyyy}-${mm}-${dd}`;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
          const t = new Date(d).getTime();
          if (isNaN(t)) return null;
          const dt = new Date(t);
          ymd = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        }
        const time = (a?.time && typeof a.time === 'string' ? a.time.trim() : '00:00') || '00:00';
        const dt = new Date(`${ymd}T${time}`);
        return isNaN(dt.getTime()) ? null : dt;
      };
      
      const now = Date.now();
      const historicalActivities = activitiesWithUsernames.filter(a => {
        const start = toStartDate(a);
        if (!start) return false;
        const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
        return now > end.getTime();
      });
      
      setAllActivitiesRaw(activitiesWithUsernames);
  // Mark initial load complete after first successful Firestore fetch
  if (!initialActivitiesLoaded) setInitialActivitiesLoaded(true);
      
      // Save to cache for next time
      await saveActivitiesToCache(activitiesWithUsernames as any);
      console.log('💾 Activities saved to cache');
      
      // Save historical activities to separate long-term cache (7 days)
      if (historicalActivities.length > 0) {
        await saveHistoricalActivitiesToCache(historicalActivities as any);
        console.log(`💾 ${historicalActivities.length} historical activities saved to long-term cache`);
      }
    } catch (e) {
      console.error('Error loading activities:', e);
      setAllActivitiesRaw([]);
      // Fail-safe: don't block splash forever if fetch fails
      if (!initialActivitiesLoaded) setInitialActivitiesLoaded(true);
    }
  }, [initialActivitiesLoaded]); // depend so we can set flag once

  // Load blocked users list
  const reloadBlockedUsers = useCallback(async () => {
    if (!auth.currentUser) {
      setBlockedUsers([]);
      return;
    }
    try {
      clearBlockedUsersCache(); // Clear cache to get fresh data
      const blocked = await getBlockedUsers();
      setBlockedUsers(blocked);
      console.log('🚫 Loaded blocked users:', blocked.length);
    } catch (error) {
      console.error('Error loading blocked users:', error);
      setBlockedUsers([]);
    }
  }, []);

  // Helper function to check if a user is blocked
  const isUserBlockedById = useCallback((userId: string) => {
    return blockedUsers.includes(userId);
  }, [blockedUsers]);

  // Don't filter activities - just expose raw activities
  // Blocked user names will be masked in the UI instead
  const allActivities = allActivitiesRaw;

  // Only load activities after user is authenticated
  useEffect(() => {
    if (user) {
      reloadAllActivities();
      reloadBlockedUsers();
    } else {
      // clear activities and cache when signed out
      setAllActivitiesRaw([]);
      clearActivityCache();
      setInitialActivitiesLoaded(false);
      setBlockedUsers([]);
    }
  }, [user, reloadAllActivities, reloadBlockedUsers]);

  // REMOVED EXPENSIVE REAL-TIME SUBSCRIPTION
  // Now using: Cache + Manual Pull-to-Refresh + Optimistic Updates

  // Sync joined activities with Firestore in real-time
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'activities'), where('joinedUserIds', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setJoinedActivities(snapshot.docs.map(doc => doc.id));
      },
      (error) => {
        if ((error as any)?.code !== 'permission-denied') {
          console.error('Activities joined subscription error:', error);
        } else {
          setJoinedActivities([]);
        }
      }
    );
    return unsubscribe;
  }, [user?.uid]);

  const toggleJoinActivity = async (activity: Activity, onDeleteNavigate?: () => void): Promise<void> => {
    try {
      if (!user) return;
      const isJoined = joinedActivities.includes(activity.id);
      const joinedCount = activity.joinedUserIds?.length || 0;

      // Show modal and wait for user confirmation
      const confirmed = await showJoinLeaveModal(activity, isJoined ? 'leave' : 'join');
      if (!confirmed) return; // User cancelled

      // If user is last participant
      if (isJoined && joinedCount === 1 && activity.joinedUserIds?.includes(user.uid)) {
        const isCreator = (activity as any).creatorId && (activity as any).creatorId === user.uid;
        return new Promise<void>((resolve) => {
          Alert.alert(
            "You're the last participant!",
            isCreator
              ? "If you leave, this event and its group chat will be deleted. Are you sure?"
              : "If you leave, this event has no participants and will be deleted, along with its group chat.",
            [
              { text: "Stay", style: "cancel", onPress: () => resolve() },
              { text: isCreator ? "Leave & Delete" : "Leave & Delete", style: "destructive", onPress: async () => {
                  // NAVIGATE IMMEDIATELY BEFORE DELETION
                  if (onDeleteNavigate) {
                    onDeleteNavigate();
                  }
                  
                  try {
                    // Delete chat first while we still have permission (we are a participant)
                    const { deleteActivityChat } = await import('../utils/firestoreChats');
                    await deleteActivityChat(activity.id);
                  } catch {}
                  try {
                    if (isCreator) {
                      // Creator can delete directly
                      await deleteActivity(activity.id);
                    } else {
                      // Non-creator last participant: leave and then attempt to delete (rules updated to allow this)
                      await leaveActivity(activity.id, user.uid);
                      await deleteActivity(activity.id);
                    }
                  } catch {}
                  await reloadAllActivities();
                  const joined = await getUserJoinedActivities();
                  setJoinedActivities(joined);
                  resolve();
                } }
            ]
          );
        });
      }

      // OPTIMISTIC UPDATE: Update UI immediately for instant feedback
      console.log('⚡ Optimistic update:', isJoined ? 'leaving' : 'joining', activity.id);
      
      if (isJoined) {
        // Immediately remove from joined activities
        setJoinedActivities(prev => prev.filter(id => id !== activity.id));
        
        // Update allActivitiesRaw state immediately (preserves creatorUsername!)
        setAllActivitiesRaw(prev => prev.map(a => 
          a.id === activity.id 
            ? {
                ...a,
                joinedCount: Math.max(0, (a.joinedCount || 1) - 1),
                joinedUserIds: a.joinedUserIds?.filter(id => id !== user.uid) || [],
              }
            : a
        ));
        
        // Update cache with decremented count
        await updateActivityInCache(activity.id, {
          joinedCount: Math.max(0, (activity.joinedCount || 1) - 1),
          joinedUserIds: activity.joinedUserIds?.filter(id => id !== user.uid) || [],
        });
      } else {
        // Immediately add to joined activities
        setJoinedActivities(prev => [...prev, activity.id]);
        
        // Update allActivitiesRaw state immediately (preserves creatorUsername!)
        setAllActivitiesRaw(prev => prev.map(a => 
          a.id === activity.id 
            ? {
                ...a,
                joinedCount: (a.joinedCount || 0) + 1,
                joinedUserIds: [...(a.joinedUserIds || []), user.uid],
              }
            : a
        ));
        
        // Update cache with incremented count
        await updateActivityInCache(activity.id, {
          joinedCount: (activity.joinedCount || 0) + 1,
          joinedUserIds: [...(activity.joinedUserIds || []), user.uid],
        });
      }

      // ACTUAL UPDATE: Sync with Firestore in background (NO RELOAD - just sync!)
      try {
        if (isJoined) {
          await leaveActivity(activity.id, user.uid);
          console.log('✅ Successfully left activity in Firestore');
        } else {
          await joinActivity(activity.id, user.uid);
          // Create the group chat if joining
          await getOrCreateChatForActivity(activity.id, user.uid);
          console.log('✅ Successfully joined activity in Firestore');
        }
        // NO RELOAD HERE - optimistic update already handled it!
        // Only sync joined activities list
        const joined = await getUserJoinedActivities();
        setJoinedActivities(joined);
      } catch (error) {
        // ROLLBACK: If sync fails, revert optimistic update
        console.error('❌ Failed to sync with Firestore, rolling back:', error);
        if (isJoined) {
          setJoinedActivities(prev => [...prev, activity.id]);
          setAllActivitiesRaw(prev => prev.map(a => 
            a.id === activity.id 
              ? {
                  ...a,
                  joinedCount: (a.joinedCount || 0) + 1,
                  joinedUserIds: [...(a.joinedUserIds || []), user.uid],
                }
              : a
          ));
          await updateActivityInCache(activity.id, {
            joinedCount: (activity.joinedCount || 0) + 1,
            joinedUserIds: [...(activity.joinedUserIds || []), user.uid],
          });
        } else {
          setJoinedActivities(prev => prev.filter(id => id !== activity.id));
          setAllActivitiesRaw(prev => prev.map(a => 
            a.id === activity.id 
              ? {
                  ...a,
                  joinedCount: Math.max(0, (a.joinedCount || 1) - 1),
                  joinedUserIds: a.joinedUserIds?.filter(id => id !== user.uid) || [],
                }
              : a
          ));
          await updateActivityInCache(activity.id, {
            joinedCount: Math.max(0, (activity.joinedCount || 1) - 1),
            joinedUserIds: activity.joinedUserIds?.filter(id => id !== user.uid) || [],
          });
        }
        throw error; // Re-throw to show error alert
      }
    } catch (error: any) {
      // Swallow expected permission-denied cases (e.g., chat participants updates blocked by rules)
      if (error?.code !== 'permission-denied') {
        console.error('Error toggling join state:', error);
      }
    }
  };

  const isActivityJoined = (activityId: string) => {
    return joinedActivities.includes(activityId);
  };

  return (
    <ActivityContext.Provider
      value={{
        joinedActivities,
        toggleJoinActivity,
        isActivityJoined,
        setJoinedActivities,
        allActivities,
        reloadAllActivities,
        profile,
        initialActivitiesLoaded,
        userLocation,
        discoveryRange,
        initialLocationLoaded,
        blockedUsers,
        reloadBlockedUsers,
        isUserBlockedById,
      }}
    >
      {children}
      <ActivityJoinLeaveModal
        visible={modalVisible}
        mode={modalMode}
        activityName={pendingActivity?.activity || ''}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
      />
    </ActivityContext.Provider>
  );
};
