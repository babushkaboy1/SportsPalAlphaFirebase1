// context/ActivityContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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

type ActivityContextType = {
  joinedActivities: string[];
  toggleJoinActivity: (activity: Activity, onDeleteNavigate?: () => void) => Promise<void>;
  isActivityJoined: (activityId: string) => boolean;
  setJoinedActivities: React.Dispatch<React.SetStateAction<string[]>>;
  allActivities: Activity[];
  reloadAllActivities: (forceRefresh?: boolean) => Promise<void>;
  profile: any;
  initialActivitiesLoaded: boolean;
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
  const [allActivities, setAllActivities] = useState<Activity[]>([]);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  // Track when the first meaningful activities load (after initial Firestore fetch)
  const [initialActivitiesLoaded, setInitialActivitiesLoaded] = useState(false);

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

  // Fetch user profile
  const fetchUserProfile = async (uid: string) => {
    const userRef = doc(db, 'profiles', uid);
    const docSnap = await getDoc(userRef);
    return docSnap.exists() ? docSnap.data() : null;
  };

  // Load user profile after login
  useEffect(() => {
    if (user) {
      fetchUserProfile(user.uid).then(profile => setProfile(profile));
    }
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
        setAllActivities([]);
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
          console.log('📦 Loaded activities and historical from cache');
          // Merge cached data - filter out duplicates
          const allIds = new Set(cached.map((a: any) => a.id));
          const uniqueHistorical = historicalCached.filter((a: any) => !allIds.has(a.id));
          setAllActivities([...cached, ...uniqueHistorical] as Activity[]);
          // Don't return - continue to fetch fresh data in background
        } else if (cached) {
          console.log('📦 Loaded activities from cache');
          setAllActivities(cached as Activity[]);
          // Don't return - continue to fetch fresh data in background
        }
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
      
      setAllActivities(activitiesWithUsernames);
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
      setAllActivities([]);
      // Fail-safe: don't block splash forever if fetch fails
      if (!initialActivitiesLoaded) setInitialActivitiesLoaded(true);
    }
  }, [initialActivitiesLoaded]); // depend so we can set flag once

  // Only load activities after user is authenticated
  useEffect(() => {
    if (user) {
      reloadAllActivities();
    } else {
      // clear activities and cache when signed out
      setAllActivities([]);
      clearActivityCache();
      setInitialActivitiesLoaded(false);
    }
  }, [user, reloadAllActivities]);

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
        
        // Update allActivities state immediately (preserves creatorUsername!)
        setAllActivities(prev => prev.map(a => 
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
        
        // Update allActivities state immediately (preserves creatorUsername!)
        setAllActivities(prev => prev.map(a => 
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
          setAllActivities(prev => prev.map(a => 
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
          setAllActivities(prev => prev.map(a => 
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
