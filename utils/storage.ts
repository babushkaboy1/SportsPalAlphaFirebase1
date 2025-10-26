import AsyncStorage from '@react-native-async-storage/async-storage';

// Normalize date to dd-mm-yyyy format
export const normalizeDateFormat = (date: string): string => {
  // If already dd-mm-yyyy, return as is
  if (/^\d{2}-\d{2}-\d{4}$/.test(date)) return date;
  // If yyyy-mm-dd, convert to dd-mm-yyyy
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [yyyy, mm, dd] = date.split('-');
    return `${dd}-${mm}-${yyyy}`;
  }
  // If mm/dd/yyyy or other, try to parse
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
    const [mm, dd, yyyy] = date.split('/');
    return `${dd}-${mm}-${yyyy}`;
  }
  console.warn(`Unrecognized date format: ${date}`);
  return date;
};

// Always return dd-mm-yyyy for calendar and display
export const convertToCalendarFormat = (date: string): string => {
  return normalizeDateFormat(date);
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