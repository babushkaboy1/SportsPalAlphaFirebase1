// context/ActivityContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { Activity } from '../data/activitiesData';
import { getUserJoinedActivities, joinActivity, leaveActivity, fetchAllActivities, deleteActivity } from '../utils/firestoreActivities';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { Alert } from 'react-native';
import { doc, getDoc, onSnapshot, query, collection, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { getOrCreateChatForActivity } from '../utils/firestoreChats';

type ActivityContextType = {
  joinedActivities: string[];
  toggleJoinActivity: (activity: Activity) => Promise<void>;
  isActivityJoined: (activityId: string) => boolean;
  setJoinedActivities: React.Dispatch<React.SetStateAction<string[]>>;
  allActivities: Activity[];
  reloadAllActivities: () => Promise<void>;
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

  // Load all activities from Firestore only
  const reloadAllActivities = async () => {
    try {
      // Avoid fetching before auth; rules require request.auth != null
      if (!auth.currentUser) {
        setAllActivities([]);
        return;
      }
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
    } catch (e) {
      console.error('Error loading activities:', e);
      setAllActivities([]);
    }
  };

  // Only load activities after user is authenticated
  useEffect(() => {
    if (user) {
      reloadAllActivities();
    } else {
      // clear activities when signed out
      setAllActivities([]);
    }
  }, [user]);

  // Real-time subscription to all activities to keep UI in sync
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(
      collection(db, 'activities'),
      (snapshot) => {
        const activities = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Activity[];
        setAllActivities(activities);
      },
      (error) => {
        if ((error as any)?.code !== 'permission-denied') {
          console.error('Activities subscription error:', error);
        } else {
          setAllActivities([]);
        }
      }
    );
    return unsubscribe;
  }, [user]);

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

      if (isJoined) {
        await leaveActivity(activity.id, user.uid);
      } else {
        await joinActivity(activity.id, user.uid);
        // --- ADD THIS: create the group chat if joining ---
        await getOrCreateChatForActivity(activity.id, user.uid);
      }
      await reloadAllActivities();
      const joined = await getUserJoinedActivities();
      setJoinedActivities(joined);
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
