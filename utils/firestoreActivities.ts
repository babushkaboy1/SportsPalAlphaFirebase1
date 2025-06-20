import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { Activity } from '../data/activitiesData';
import { removeUserFromChat } from './firestoreChats';

export const getUserJoinedActivities = async (): Promise<string[]> => {
  const user = auth.currentUser;
  if (!user) return [];
  const querySnapshot = await getDocs(collection(db, 'activities'));
  return querySnapshot.docs
    .filter(doc => {
      const data = doc.data();
      return Array.isArray(data.joinedUserIds) && data.joinedUserIds.includes(user.uid);
    })
    .map(doc => doc.id);
};

export const joinActivity = async (activityId: string, userId: string) => {
  const activityRef = doc(db, 'activities', activityId);
  await updateDoc(activityRef, {
    joinedUserIds: arrayUnion(userId),
  });
};

export const leaveActivity = async (activityId: string, userId: string) => {
  const activityRef = doc(db, 'activities', activityId);
  await updateDoc(activityRef, {
    joinedUserIds: arrayRemove(userId),
  });
  // Remove user from chat participants as well
  await removeUserFromChat(activityId, userId);
};

export const fetchAllActivities = async (): Promise<Activity[]> => {
  const querySnapshot = await getDocs(collection(db, 'activities'));
  return querySnapshot.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as Omit<Activity, 'id'>), // Ensures all Activity fields are present
  }));
};

export const createActivity = async (activity: Omit<Activity, 'id'>) => {
  await addDoc(collection(db, 'activities'), activity);
};

export const fetchUsersByIds = async (userIds: string[]) => {
  if (!userIds.length) return [];
  const usersRef = collection(db, "profiles"); // <-- was "users"
  const users = await Promise.all(
    userIds.map(async (uid) => {
      const docSnap = await getDoc(doc(usersRef, uid));
      return docSnap.exists() ? { ...docSnap.data(), uid } : null;
    })
  );
  return users.filter(Boolean);
};

export const deleteActivity = async (activityId: string) => {
  await deleteDoc(doc(db, 'activities', activityId));
};