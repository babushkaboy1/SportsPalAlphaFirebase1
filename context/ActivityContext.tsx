// context/ActivityContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { Activity } from '../data/activitiesData';
import { getUserJoinedActivities, joinActivity, leaveActivity, fetchAllActivities, deleteActivity } from '../utils/firestoreActivities';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { activities as fakeActivities } from '../data/activitiesData';
import { Alert } from 'react-native';

type ActivityContextType = {
  joinedActivities: string[];
  toggleJoinActivity: (activity: Activity) => Promise<void>;
  isActivityJoined: (activityId: string) => boolean;
  setJoinedActivities: React.Dispatch<React.SetStateAction<string[]>>;
  allActivities: Activity[];
  reloadAllActivities: () => Promise<void>;
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

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return unsubscribe;
  }, []);

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

  // Load all activities (Firestore + fake)
  const reloadAllActivities = async () => {
    try {
      const firestoreActivities = await fetchAllActivities();
      setAllActivities(firestoreActivities);
    } catch (e) {
      console.error('Error loading activities:', e);
      setAllActivities([]);
    }
  };

  useEffect(() => {
    reloadAllActivities();
  }, []);

  const toggleJoinActivity = async (activity: Activity): Promise<void> => {
    try {
      if (!user) return;
      const isJoined = joinedActivities.includes(activity.id);
      const joinedCount = activity.joinedUserIds?.length || 0;

      // If user is leaving and is the last participant
      if (isJoined && joinedCount === 1 && activity.joinedUserIds?.includes(user.uid)) {
        Alert.alert(
          "You're the last participant!",
          "If you leave, this event will be deleted for everyone. Are you sure you want to leave?",
          [
            { text: "Stay", style: "cancel" },
            { text: "Leave & Delete", style: "destructive", onPress: async () => {
                await leaveActivity(activity.id, user.uid);
                // Delete the activity from Firestore
                await deleteActivity(activity.id);
                await reloadAllActivities();
                const joined = await getUserJoinedActivities();
                setJoinedActivities(joined);
              }
            }
          ]
        );
        return;
      }

      // Normal join/leave logic
      if (isJoined) {
        await leaveActivity(activity.id, user.uid);
      } else {
        await joinActivity(activity.id, user.uid);
      }
      await reloadAllActivities();
      const joined = await getUserJoinedActivities();
      setJoinedActivities(joined);
    } catch (error) {
      console.error('Error toggling join state:', error);
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
      }}
    >
      {children}
    </ActivityContext.Provider>
  );
};
