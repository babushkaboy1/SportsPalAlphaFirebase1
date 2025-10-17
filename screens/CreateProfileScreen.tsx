// screens/CreateProfileScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ScrollView,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { MediaType } from 'expo-image-picker';
import Logo from '../components/Logo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { createUserWithEmailAndPassword, reauthenticateWithCredential, EmailAuthProvider, updatePassword } from 'firebase/auth';
import { doc, setDoc, query, where, getDocs, collection } from 'firebase/firestore';
import { auth, db, storage } from '../firebaseConfig';
import { compressImage, uploadProfileImage, testStorageConnection } from '../utils/imageUtils';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import * as ImageManipulator from 'expo-image-manipulator';

// Sports Options for the grid
const sportsOptions = [
  'Basketball', 'Soccer', 'Running', 'Gym', 'Calisthenics', 'Padel',
  'Tennis', 'Cycling', 'Swimming', 'Badminton', 'Volleyball', 'Boxing',
  'Yoga', 'Martial Arts', 'Table Tennis', 'American Football'
];

const CreateProfileScreen = ({ navigation, route }: any) => {
  const isEdit = route?.params?.mode === 'edit';
  const profileData = route?.params?.profileData;

  const [username, setUsername] = useState(profileData?.username || '');
  const [email, setEmail] = useState(profileData?.email || '');
  // Phone removed per request
  const [password, setPassword] = useState(profileData?.password || '');
  const [location, setLocation] = useState(profileData?.location || '');
  const [photo, setPhoto] = useState<string | null>(profileData?.photo || null);
  // Preselect favorites in edit mode (supports either key name from stored profile)
  const [selectedSports, setSelectedSports] = useState<string[]>(profileData?.sportsPreferences || profileData?.selectedSports || []);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  // Change password flow (edit mode)
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isPasswordVerified, setIsPasswordVerified] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changePwError, setChangePwError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordStrength, setPasswordStrength] = useState<{score: number; color: string; label: string; percent: number}>({ score: 0, color: '#cc3030', label: 'Very weak', percent: 0 });
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  // Fade in on mount
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, []);

  // Simulate a loading period for the profile data (remove in production)
  useEffect(() => {
    const timeout = setTimeout(() => setIsReady(true), 500);
    return () => clearTimeout(timeout);
  }, []);

  // Username policy (Instagram-like): 1–30 chars, letters/numbers/periods/underscores only, case-insensitive unique
  const validateUsername = (name: string): string | null => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 30) return 'Username must be 1–30 characters.';
    if (!/^[A-Za-z0-9._]+$/.test(trimmed)) return 'Use letters, numbers, periods and underscores only (no spaces or @).';
    return null;
  };

  useEffect(() => {
    setUsernameError(validateUsername(username));
  }, [username]);

  // Password policy checks and strength
  const getPasswordChecks = (pwd: string) => ({
    len: pwd.length >= 8,
    upper: /[A-Z]/.test(pwd),
    number: /\d/.test(pwd),
    symbol: /[^A-Za-z0-9]/.test(pwd),
  });

  const computeStrength = (pwd: string) => {
    const c = getPasswordChecks(pwd);
    const score = [c.len, c.upper, c.number, c.symbol].filter(Boolean).length;
    const percent = (score / 4) * 100;
    const color = score <= 1 ? '#cc3030' : score === 2 ? '#e67e22' : score === 3 ? '#f1c40f' : '#2ecc71';
    const label = score <= 1 ? 'Very weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Great';
    return { score, color, label, percent };
  };

  useEffect(() => {
    setPasswordStrength(computeStrength(password));
    setPasswordError(null);
  }, [password]);

  // Track strength for new password in edit change flow
  const [newPasswordStrength, setNewPasswordStrength] = useState<{score: number; color: string; label: string; percent: number}>(computeStrength(''));
  useEffect(() => {
    setNewPasswordStrength(computeStrength(newPassword));
  }, [newPassword]);

  const handleVerifyCurrentPassword = async () => {
    try {
      setIsVerifying(true);
      setChangePwError(null);
      const user = auth.currentUser;
      if (!user || !user.email) {
        Alert.alert('Error', 'No logged in user.');
        setIsVerifying(false);
        return;
      }
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      setIsPasswordVerified(true);
      Alert.alert('Verified', 'Current password confirmed.');
    } catch (e: any) {
      console.warn('Reauth failed', e);
      setChangePwError('Incorrect current password.');
      Alert.alert('Incorrect Password', 'Please check your current password and try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSaveNewPassword = async () => {
    try {
      setChangePwError(null);
      const user = auth.currentUser;
      if (!user) {
        Alert.alert('Error', 'No logged in user.');
        return;
      }
      const checks = getPasswordChecks(newPassword);
      if (!(checks.len && checks.upper && checks.number && checks.symbol)) {
        setChangePwError('Password must meet all requirements.');
        Alert.alert('Weak Password', 'Please meet all password requirements.');
        return;
      }
      if (newPassword !== confirmNewPassword) {
        setChangePwError('Passwords do not match.');
        Alert.alert('Password Mismatch', 'Passwords do not match.');
        return;
      }
      await updatePassword(user, newPassword);
      Alert.alert('Success', 'Your password has been updated.');
      // Reset state
      setShowChangePassword(false);
      setCurrentPassword('');
      setIsPasswordVerified(false);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (e: any) {
      console.error('Update password failed', e);
      Alert.alert('Error', e?.message || 'Could not update password.');
    }
  };

  const pickImage = async () => {
    Alert.alert(
      'Select Profile Picture',
      'Choose a photo from:',
      [
        {
          text: 'Camera',
          onPress: async () => {
            const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
            if (!permissionResult.granted) {
              Alert.alert('Permission required', 'Permission to access your camera is needed!');
              return;
            }

            let result = await ImagePicker.launchCameraAsync({
              allowsEditing: true,
              aspect: [1, 1],
              quality: 0.7,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
              setPhoto(result.assets[0].uri);
            }
          },
        },
        {
          text: 'Gallery',
          onPress: async () => {
            const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permissionResult.granted) {
              Alert.alert('Permission required', 'Permission to access your media library is needed!');
              return;
            }

            let result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: 'images',
              allowsEditing: true,
              aspect: [1, 1],
              quality: 0.7,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
              setPhoto(result.assets[0].uri);
            }
          },
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ],
      { cancelable: true }
    );
  };

  // Toggle the selection of a sport
  const toggleSport = (sport: string) => {
    if (selectedSports.includes(sport)) {
      setSelectedSports(selectedSports.filter(s => s !== sport));
    } else {
      setSelectedSports([...selectedSports, sport]);
    }
  };

  // Make handleContinue async so we can await saveProfile
  const handleContinue = async () => {
    console.log("🚦 handleContinue called");
    if (!email || !username) {
      Alert.alert('Missing Info', 'Please fill in all required fields.');
      return;
    }

    // Validate username format
    const uErr = validateUsername(username);
    if (uErr) {
      setUsernameError(uErr);
      Alert.alert('Invalid Username', uErr);
      return;
    }

    // Detect if the current user is a Google user
    const isGoogleUserLocal = !!auth.currentUser?.providerData.find((p) => p.providerId === 'google.com');

    // In create mode for non-Google users, validate password and confirm
    if (!isEdit && !isGoogleUserLocal) {
      const checks = getPasswordChecks(password);
      if (!(checks.len && checks.upper && checks.number && checks.symbol)) {
        setPasswordError('Password must be at least 8 characters and include an uppercase letter, a number, and a symbol.');
        Alert.alert('Weak Password', 'Please meet all password requirements.');
        return;
      }
      if (password !== confirmPassword) {
        setPasswordError('Passwords do not match.');
        Alert.alert('Password Mismatch', 'Passwords do not match.');
        return;
      }
    }

    setIsLoading(true);
    try {
      let userId: string | undefined = auth.currentUser?.uid;
      let photoURL: string | null = null;

      if (isEdit) {
        // EDIT MODE
        userId = auth.currentUser?.uid;
        if (!userId) {
          Alert.alert('Error', 'No user is logged in.');
          setIsLoading(false);
          return;
        }

        // Username uniqueness (case-insensitive) if changed
        if (username) {
          const profilesCol = collection(db, 'profiles');
          const q = query(profilesCol, where('username_lower', '==', username.toLowerCase()));
          const snap = await getDocs(q);
          const takenByOther = snap.docs.some(d => d.id !== userId);
          if (takenByOther) {
            setUsernameError('This username is already taken.');
            Alert.alert('Username Taken', 'Please choose a different username.');
            setIsLoading(false);
            return;
          }
        }

        // Upload photo if it's a new local file (not already a URL)
        if (photo && !photo.startsWith('http')) {
          console.log("📸 Uploading new profile photo...");
          const compressedUri = await compressImage(photo);
          photoURL = await uploadProfileImage(compressedUri, userId);
          console.log("✅ Photo uploaded:", photoURL);
        } else if (photo && photo.startsWith('http')) {
          // Keep existing photo URL
          photoURL = photo;
        }

        const profileData = {
          username,
          email,
          location,
          photo: photoURL,
          sportsPreferences: selectedSports,
          username_lower: username ? username.toLowerCase() : null,
        };
        
        await setDoc(doc(db, "profiles", userId), profileData, { merge: true });
        Alert.alert('Success', 'Your profile has been updated!');
        navigation.goBack();
      } else {
        // CREATE MODE
        if (!password) {
          Alert.alert('Missing Info', 'Please enter a password.');
          setIsLoading(false);
          return;
        }

        // Username uniqueness (case-insensitive)
        if (username) {
          const profilesCol = collection(db, 'profiles');
          const q = query(profilesCol, where('username_lower', '==', username.toLowerCase()));
          const snap = await getDocs(q);
          if (!snap.empty) {
            setUsernameError('This username is already in use.');
            Alert.alert('Username Taken', 'Please choose a different username.');
            setIsLoading(false);
            return;
          }
        }
        
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        userId = userCredential.user.uid;
        
        if (photo) {
          console.log("📸 Uploading profile photo for new user...");
          const compressedUri = await compressImage(photo);
          photoURL = await uploadProfileImage(compressedUri, userId);
          console.log("✅ Photo uploaded:", photoURL);
        }
        
        const profileData = {
          username,
          email,
          location,
          photo: photoURL,
          sportsPreferences: selectedSports,
          username_lower: username ? username.toLowerCase() : null,
        };
        
        await setDoc(doc(db, "profiles", userId), profileData);
        Alert.alert('Success', 'Your profile has been created!');
        navigation.navigate('MainTabs');
      }
    } catch (error: any) {
      console.error("❌ Error saving profile:", error);
      if (error?.code === 'auth/email-already-in-use') {
        Alert.alert('Email In Use', 'An account with this email already exists.');
      } else if (error?.code === 'auth/invalid-email') {
        Alert.alert('Invalid Email', 'Please enter a valid email address.');
      } else if (error?.code === 'auth/weak-password') {
        Alert.alert('Weak Password', 'Please strengthen your password.');
      } else {
        Alert.alert('Error', error.message || 'Failed to save profile. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Detect if the current user is a Google user
  const isGoogleUser = !!auth.currentUser?.providerData.find(
    (p) => p.providerId === 'google.com'
  );

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <ScrollView
      style={styles.scrollView}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 30 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Back button (always show) */}
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 10, left: 16, position: 'absolute', zIndex: 10 }]}
        onPress={() => navigation.goBack()}
        accessibilityLabel="Go Back"
      >
        <Ionicons name="arrow-back" size={28} color="#1ae9ef" />
      </TouchableOpacity>

      {/* Centered, smaller logo */}
      <View style={styles.logoWrapper}>
        <Logo />
      </View>

      <Text style={styles.title}>{isEdit ? 'Edit Profile' : 'Create Your Profile'}</Text>

      {/* Profile Photo Section */}
      <TouchableOpacity style={styles.photoButton} onPress={pickImage} activeOpacity={0.7}>
        {photo ? (
          <>
            <Image source={{ uri: photo }} style={styles.photo} />
            <View style={styles.photoEditBadge}>
              <Ionicons name="camera" size={20} color="#fff" />
            </View>
          </>
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="camera" size={40} color="#1ae9ef" />
            <Text style={styles.photoButtonText}>Add Photo</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Input Fields */}
      <View style={styles.formContainer}>
        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor="#999"
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={[styles.input, (isEdit ? styles.inputDisabled : null)]}
          placeholder="Email"
          placeholderTextColor="#999"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!isEdit && !isGoogleUser}
        />
        {/* Phone field removed */}
        {/* Password / Change Password Section */}
        {!isGoogleUser ? (
          isEdit ? (
            <>
              {!showChangePassword ? (
                <TouchableOpacity style={styles.changePasswordButton} onPress={() => setShowChangePassword(true)}>
                  <Text style={styles.changePasswordButtonText}>Change password</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ width: '100%' }}>
                  {!isPasswordVerified ? (
                    <>
                      <TextInput
                        style={styles.input}
                        placeholder="Current Password"
                        placeholderTextColor="#999"
                        secureTextEntry
                        value={currentPassword}
                        onChangeText={setCurrentPassword}
                      />
                      {changePwError ? <Text style={styles.errorText}>{changePwError}</Text> : null}
                      <TouchableOpacity style={styles.verifyButton} onPress={handleVerifyCurrentPassword} disabled={isVerifying}>
                        {isVerifying ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.changePasswordButtonText}>Verify</Text>
                        )}
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <View style={styles.requirementsBox}>
                        <Text style={styles.requirementsTitle}>Your password must include:</Text>
                        {(() => { const c = getPasswordChecks(newPassword); return (
                          <>
                            <Text style={[styles.requirementItem, { color: c.len ? '#2ecc71' : '#bbb' }]}>• At least 8 characters</Text>
                            <Text style={[styles.requirementItem, { color: c.upper ? '#2ecc71' : '#bbb' }]}>• One uppercase letter</Text>
                            <Text style={[styles.requirementItem, { color: c.number ? '#2ecc71' : '#bbb' }]}>• One number</Text>
                            <Text style={[styles.requirementItem, { color: c.symbol ? '#2ecc71' : '#bbb' }]}>• One symbol</Text>
                          </>
                        ); })()}
                      </View>
                      <View style={styles.strengthBarContainer}>
                        <View style={styles.strengthBarBg}>
                          <View style={[styles.strengthBarFill, { width: `${newPasswordStrength.percent}%`, backgroundColor: newPasswordStrength.color }]} />
                        </View>
                        <Text style={[styles.strengthLabel, { color: newPasswordStrength.color }]}>{newPasswordStrength.label}</Text>
                      </View>
                      <TextInput
                        style={styles.input}
                        placeholder="New Password"
                        placeholderTextColor="#999"
                        secureTextEntry
                        value={newPassword}
                        onChangeText={setNewPassword}
                      />
                      <TextInput
                        style={styles.input}
                        placeholder="Confirm New Password"
                        placeholderTextColor="#999"
                        secureTextEntry
                        value={confirmNewPassword}
                        onChangeText={setConfirmNewPassword}
                      />
                      {changePwError ? <Text style={styles.errorText}>{changePwError}</Text> : null}
                      <TouchableOpacity style={styles.verifyButton} onPress={handleSaveNewPassword}>
                        <Text style={styles.changePasswordButtonText}>Save new password</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}
            </>
          ) : (
            // Create mode password fields
            <>
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#999"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm Password"
                placeholderTextColor="#999"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}
              {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
              <View style={styles.strengthBarContainer}>
                <View style={styles.strengthBarBg}>
                  <View style={[styles.strengthBarFill, { width: `${passwordStrength.percent}%`, backgroundColor: passwordStrength.color }]} />
                </View>
                <Text style={[styles.strengthLabel, { color: passwordStrength.color }]}>{passwordStrength.label}</Text>
              </View>
              <View style={styles.requirementsBox}>
                <Text style={styles.requirementsTitle}>Your password must include:</Text>
                {(() => { const c = getPasswordChecks(password); return (
                  <>
                    <Text style={[styles.requirementItem, { color: c.len ? '#2ecc71' : '#bbb' }]}>• At least 8 characters</Text>
                    <Text style={[styles.requirementItem, { color: c.upper ? '#2ecc71' : '#bbb' }]}>• One uppercase letter</Text>
                    <Text style={[styles.requirementItem, { color: c.number ? '#2ecc71' : '#bbb' }]}>• One number</Text>
                    <Text style={[styles.requirementItem, { color: c.symbol ? '#2ecc71' : '#bbb' }]}>• One symbol</Text>
                  </>
                ); })()}
              </View>
            </>
          )
        ) : (
          <Text style={{ color: '#aaa', marginBottom: 10 }}>
            You signed up with Google. Log in with Google anytime.
          </Text>
        )}
        <TextInput
          style={styles.input}
          placeholder="City / Neighborhood"
          placeholderTextColor="#999"
          value={location}
          onChangeText={setLocation}
        />
      </View>

      <Text style={styles.subtitle}>Select Your Favorite Sports</Text>

      {/* Sports Selection Grid */}
      <View style={styles.sportsGrid}>
        {sportsOptions.map((sport, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.sportButton,
              selectedSports.includes(sport) && styles.sportButtonSelected,
            ]}
            onPress={() => toggleSport(sport)}
          >
            <Text
              style={[
                styles.sportButtonText,
                selectedSports.includes(sport) && styles.sportButtonTextSelected,
              ]}
            >
              {sport}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
        <Text style={styles.continueButtonText}>Continue</Text>
      </TouchableOpacity>

      {/* Spinner for loading state */}
      {isLoading && <ActivityIndicator size="large" color="#1ae9ef" style={styles.loadingIndicator} />}
    </ScrollView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#121212',
  },
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'flex-start',
    // Remove marginTop here if present
  },
  logoWrapper: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0, // aligns with back button
    marginBottom: 20,
  },
  logo: {
    width: 80,
    height: 80,
    alignSelf: 'center',
    resizeMode: 'contain',
  },
  backButton: {
    padding: 4,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 28,
    color: '#1ae9ef',
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
    width: '100%',
  },
  photoButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderColor: '#1ae9ef',
    borderWidth: 2,
    backgroundColor: '#1e1e1e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#1ae9ef',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    position: 'relative',
  },
  photoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoButtonText: {
    color: '#1ae9ef',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 8,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  photoEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1ae9ef',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#121212',
  },
  formContainer: {
    width: '100%',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    backgroundColor: '#1e1e1e',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    marginVertical: 8,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  subtitle: {
    fontSize: 18,
    color: '#ccc',
    marginVertical: 15,
    textAlign: 'center',
  },
  sportsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 30,
  },
  sportButton: {
    width: '28%',
    margin: '2%',
    paddingVertical: 10,
    paddingHorizontal: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1ae9ef',
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
  },
  sportButtonSelected: {
    backgroundColor: '#1ae9ef',
  },
  sportButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1ae9ef',
    textAlign: 'center',
  },
  sportButtonTextSelected: {
    color: '#fff',
  },
  continueButton: {
    backgroundColor: '#1ae9ef',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
    shadowColor: '#1ae9ef',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  changePasswordButton: {
    backgroundColor: '#1ae9ef',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignItems: 'center',
    width: '100%',
    marginTop: 4,
    marginBottom: 10,
    shadowColor: '#1ae9ef',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  verifyButton: {
    backgroundColor: '#1ae9ef',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
    marginBottom: 12,
    shadowColor: '#1ae9ef',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  changePasswordButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  loadingIndicator: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -20,
    marginLeft: -20,
  },
  errorText: {
    color: '#ff6b6b',
    marginBottom: 6,
  },
  strengthBarContainer: {
    width: '100%',
    marginTop: 6,
    marginBottom: 8,
  },
  strengthBarBg: {
    width: '100%',
    height: 8,
    borderRadius: 8,
    backgroundColor: '#2a2a2a',
    overflow: 'hidden',
  },
  strengthBarFill: {
    height: 8,
    borderRadius: 8,
  },
  strengthLabel: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  requirementsBox: {
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 6,
  },
  requirementsTitle: {
    color: '#ddd',
    fontWeight: '700',
    marginBottom: 6,
  },
  requirementItem: {
    color: '#bbb',
    fontSize: 13,
    marginVertical: 2,
  },
});

export default React.memo(CreateProfileScreen);