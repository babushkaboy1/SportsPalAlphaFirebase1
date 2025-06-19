import AsyncStorage from '@react-native-async-storage/async-storage';

// Normalize date to yyyy-mm-dd format
export const normalizeDateFormat = (date: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (/^\d{2}-\d{2}-\d{4}$/.test(date)) {
    const [dd, mm, yyyy] = date.split('-');
    return `${yyyy}-${mm}-${dd}`;
  }
  console.warn(`Unrecognized date format: ${date}`);
  return date;
};

export const convertToCalendarFormat = (date: string): string => {
  if (date.includes('-')) {
    const parts = date.split('-');
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1]}-${parts[2]}`; // yyyy-mm-dd
    }
    return `${parts[2]}-${parts[1]}-${parts[0]}`; // dd-mm-yyyy to yyyy-mm-dd
  }
  return date;
};

// Save Profile
export const saveProfile = async (profileData: any) => {
  try {
    await AsyncStorage.setItem('profileData', JSON.stringify(profileData));
    console.log('Profile saved successfully!');
  } catch (error) {
    console.error('Error saving profile data:', error);
  }
};

// Load Profile
export const loadProfile = async () => {
  try {
    const jsonValue = await AsyncStorage.getItem('profileData');
    return jsonValue != null ? JSON.parse(jsonValue) : null;
  } catch (error) {
    console.error('Error loading profile data:', error);
    return null;
  }
};

// Update Profile
export const updateProfile = async (newData: any) => {
  try {
    const currentData = await loadProfile();
    const updatedData = { ...currentData, ...newData };
    await saveProfile(updatedData);
    console.log('Profile updated successfully!');
  } catch (error) {
    console.error('Error updating profile data:', error);
  }
};

// Clear Profile
export const clearProfile = async () => {
  try {
    await AsyncStorage.removeItem('profileData');
    console.log('Profile cleared successfully!');
  } catch (error) {
    console.error('Error clearing profile data:', error);
  }
};