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
  clearActivityCache 
} from '../utils/activityCache';

type ActivityContextType = {
  joinedActivities: string[];
  toggleJoinActivity: (activity: Activity) => Promise<void>;
  isActivityJoined: (activityId: string) => boolean;
  setJoinedActivities: React.Dispatch<React.SetStateAction<string[]>>;
  allActivities: Activity[];
  reloadAllActivities: (forceRefresh?: boolean) => Promise<void>;
  profile: any; // <-- Add this line
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
        return;
      }

      // Try loading from cache first (instant UI)
      if (!forceRefresh) {
        const cached = await loadActivitiesFromCache();
        if (cached) {
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
      
      setAllActivities(activitiesWithUsernames);
      
      // Save to cache for next time
      await saveActivitiesToCache(activitiesWithUsernames as any);
      console.log('💾 Activities saved to cache');
    } catch (e) {
      console.error('Error loading activities:', e);
      setAllActivities([]);
    }
  }, []); // Empty deps - function doesn't depend on any props/state

  // Only load activities after user is authenticated
  useEffect(() => {
    if (user) {
      reloadAllActivities();
    } else {
      // clear activities and cache when signed out
      setAllActivities([]);
      clearActivityCache();
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

  const toggleJoinActivity = async (activity: Activity): Promise<void> => {
    try {
      if (!user) return;
      const isJoined = joinedActivities.includes(activity.id);
      const joinedCount = activity.joinedUserIds?.length || 0;

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
        profile, // <-- Add this line
      }}
    >
      {children}
    </ActivityContext.Provider>
  );
};
