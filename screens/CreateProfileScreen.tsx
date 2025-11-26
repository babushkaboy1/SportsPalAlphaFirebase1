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
  Modal,
  Keyboard,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import * as ImagePicker from 'expo-image-picker';
import { MediaType } from 'expo-image-picker';
import Logo from '../components/Logo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { reauthenticateWithCredential, EmailAuthProvider, updatePassword } from 'firebase/auth';
import { doc, setDoc, query, where, getDocs, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db, storage } from '../firebaseConfig';
import { compressImage, uploadProfileImage, testStorageConnection } from '../utils/imageUtils';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { Linking } from 'react-native';
import { ActivityIcon } from '../components/ActivityIcons';

// Sports Options for the grid (alphabetical order; grid renders 3 per row)
const sportsOptions = [
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

const CreateProfileScreen = ({ route }: any) => {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const isEdit = route?.params?.mode === 'edit';
  const profileData = route?.params?.profileData;
  const emailLocked = profileData?.emailLocked || false; // Lock email for social sign-ins

  const [username, setUsername] = useState(profileData?.username || '');
  const [bio, setBio] = useState(profileData?.bio || '');
  const [photo, setPhoto] = useState<string | null>(profileData?.photo || null);
  const [instagram, setInstagram] = useState(profileData?.socials?.instagram || '');
  const [facebook, setFacebook] = useState(profileData?.socials?.facebook || '');
  const [selectedSports, setSelectedSports] = useState<string[]>(profileData?.sportsPreferences || profileData?.selectedSports || []);
  const [birthDay, setBirthDay] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [acceptedAdulthood, setAcceptedAdulthood] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  // Change password flow (edit mode)
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isPasswordVerified, setIsPasswordVerified] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changePwError, setChangePwError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const instagramRef = useRef<TextInput>(null);
  const facebookRef = useRef<TextInput>(null);
  const birthMonthRef = useRef<TextInput>(null);
  const birthYearRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  // Keyboard state for adjusting ScrollView padding so inputs appear above keyboard
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);

  // Terms & Community Guidelines acceptance (create mode only)
  const [termsModalVisible, setTermsModalVisible] = useState(false);
  const [communityModalVisible, setCommunityModalVisible] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedCommunity, setAcceptedCommunity] = useState(false);

  // Fade in on mount
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, []);

  // Initialize birth date from profile data if editing
  useEffect(() => {
    if (profileData?.birthDate) {
      const [day, month, year] = profileData.birthDate.split('-');
      setBirthDay(day || '');
      setBirthMonth(month || '');
      setBirthYear(year || '');
    }
  }, [profileData?.birthDate]);

  // Simulate a loading period for the profile data (remove in production)
  useEffect(() => {
    const timeout = setTimeout(() => setIsReady(true), 500);
    return () => clearTimeout(timeout);
  }, []);

  // Listen for keyboard show/hide and set bottom padding accordingly (works for Android and iOS)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: any) => setKeyboardHeight(e.endCoordinates?.height || 0);
    const onHide = () => setKeyboardHeight(0);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      try { subShow.remove(); } catch {}
      try { subHide.remove(); } catch {}
    };
  }, []);

  // Username policy (Instagram-like): 1–30 chars, letters/numbers/periods/underscores only, case-insensitive unique
  const validateUsername = (name: string): string | null => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 30) return 'Username must be 1–30 characters.';
    if (!/^[A-Za-z0-9._]+$/.test(trimmed)) return 'Use letters, numbers, periods and underscores only (no spaces or @).';
    return null;
  };

  // Only show username error after submit attempt in create mode
  const [showUsernameError, setShowUsernameError] = useState(false);

  // Track strength for new password in edit change flow (for change password in edit mode)
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
        return;
      }
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      setIsPasswordVerified(true);
      Alert.alert('Verified', 'Current password confirmed.');
    } catch (e: any) {
    console.warn('Reauth failed', e);
    setChangePwError('Incorrect current password.');
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

  // Calculate age from DD-MM-YYYY birth date string
  const calculateAge = (dateString: string): number => {
    if (!dateString || !dateString.includes('-')) return 0;
    
    const [day, month, year] = dateString.split('-').map(Number);
    const birthDate = new Date(year, month - 1, day); // month is 0-indexed
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  };

  // Check username availability with debounce
  const checkUsernameAvailability = async (usernameToCheck: string) => {
    if (!usernameToCheck || usernameToCheck.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    setIsCheckingUsername(true);
    try {
      const profilesCol = collection(db, 'profiles');
      const q = query(profilesCol, where('username_lower', '==', usernameToCheck.toLowerCase()));
      const snap = await getDocs(q);
      const userId = auth.currentUser?.uid;
      const takenByOther = snap.docs.some(d => d.id !== userId);
      
      setUsernameAvailable(!takenByOther);
    } catch (error) {
      console.error('Username check error:', error);
      setUsernameAvailable(null);
    } finally {
      setIsCheckingUsername(false);
    }
  };

  // Debounced username check
  useEffect(() => {
    const timer = setTimeout(() => {
      if (username) {
        checkUsernameAvailability(username);
      }
    }, 500); // 500ms delay
    
    return () => clearTimeout(timer);
  }, [username]);

  // Validate birth date from separate fields
  const validateBirthDate = (): string | null => {
    if (!birthDay || !birthMonth || !birthYear) return 'Please enter your complete birth date.';
    
    const day = parseInt(birthDay, 10);
    const month = parseInt(birthMonth, 10);
    const year = parseInt(birthYear, 10);

    if (day < 1 || day > 31) return 'Day must be between 1 and 31.';
    if (month < 1 || month > 12) return 'Month must be between 1 and 12.';
    if (year < 1900 || year > new Date().getFullYear()) return 'Please enter a valid year.';

    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return 'Invalid date.';
    }

    const age = calculateAge(`${birthDay.padStart(2, '0')}-${birthMonth.padStart(2, '0')}-${year}`);
    if (age < 18) return 'You must be at least 18 years old.';
    if (age > 120) return 'Please enter a valid birth date.';

    return null;
  };

  // Make handleContinue async so we can await saveProfile
  const [awaitingEmailVerification, setAwaitingEmailVerification] = useState(false);
  const handleContinue = async () => {
    console.log("🚦 handleContinue called");
    if (!username) {
      Alert.alert('Missing Info', 'Please enter a username.');
      return;
    }

    // In create mode, validate birth date and adulthood acceptance
    if (!isEdit) {
      const birthDateError = validateBirthDate();
      if (birthDateError) {
        Alert.alert('Birth Date Required', birthDateError);
        return;
      }

      if (!acceptedAdulthood) {
        Alert.alert('Age Verification Required', 'Please confirm you are 18 years or older.');
        return;
      }

      // Enforce Terms & Community Guidelines acceptance
      if (!acceptedTerms || !acceptedCommunity) {
        Alert.alert('Accept Policies', 'Please accept the Terms of Service and Community Guidelines to continue.');
        return;
      }
    }

    // Validate username format
    const uErr = validateUsername(username);
    if (uErr) {
      setUsernameError(uErr);
      setShowUsernameError(true);
      return;
    }

    setIsLoading(true);
    try {
      let userId: string | undefined = auth.currentUser?.uid;
      let photoURL: string | null = null;

      if (!userId) {
        Alert.alert('Error', 'No user is logged in.');
        setIsLoading(false);
        return;
      }

      // Username uniqueness (case-insensitive)
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
        console.log("📸 Uploading profile photo...");
        const compressedUri = await compressImage(photo);
        photoURL = await uploadProfileImage(compressedUri, userId);
        console.log("✅ Photo uploaded:", photoURL);
      } else if (photo && photo.startsWith('http')) {
        photoURL = photo;
      } else {
        // No photo selected - generate placeholder with first letter of username
        photoURL = null;
      }

      const profileDataToSave: any = {
        username,
        email: auth.currentUser?.email || '',
        bio,
        birthDate: !isEdit ? `${birthDay.padStart(2, '0')}-${birthMonth.padStart(2, '0')}-${birthYear}` : (profileData?.birthDate || `${birthDay.padStart(2, '0')}-${birthMonth.padStart(2, '0')}-${birthYear}`),
        socials: {
          instagram,
          facebook,
        },
        photo: photoURL,
        sportsPreferences: selectedSports,
        username_lower: username ? username.toLowerCase() : null,
        uid: userId,
        emailVerified: !!auth.currentUser?.emailVerified,
        updatedAt: serverTimestamp(),
      };

      // Only add these fields when creating a new profile
      if (!isEdit) {
        profileDataToSave.acceptedTerms = true;
        profileDataToSave.acceptedCommunityGuidelines = true;
        profileDataToSave.termsAcceptedAt = serverTimestamp();
        profileDataToSave.createdAt = serverTimestamp();
      }

      await setDoc(doc(db, "profiles", userId), profileDataToSave, { merge: true });
      
      if (isEdit) {
        Alert.alert('Success', 'Your profile has been updated!');
        navigation.goBack();
      } else {
        Alert.alert('Success', 'Your profile has been created!');
        // Navigate to EmailVerificationGate instead of MainTabs
        navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'EmailVerificationGate' }] }));
      }
    } catch (error: any) {
      console.error("❌ Error saving profile:", error);
      if (error?.code === 'permission-denied') {
        Alert.alert('Permission denied', 'Your email may not be verified yet. Tap "I verified — Refresh" and try again.');
        setIsLoading(false);
        return;
      }
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
  const isFacebookUser = !!auth.currentUser?.providerData.find(
    (p) => p.providerId === 'facebook.com'
  );
  const isAppleUser = !!auth.currentUser?.providerData.find(
    (p) => p.providerId === 'apple.com'
  );
  const isSocialAuthUser = isGoogleUser || isFacebookUser || isAppleUser;
  const isPasswordUser = !!auth.currentUser?.providerData.find(
    (p) => p.providerId === 'password'
  );

  const mainCtaLabel = isEdit ? 'Save' : 'Continue';

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <ScrollView
      ref={scrollRef}
      style={styles.scrollView}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 30, paddingBottom: Math.max(20, keyboardHeight + 20) }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Back button (always show) */}
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 10, left: 16, position: 'absolute', zIndex: 10 }]}
        onPress={() => navigation.goBack()}
        accessibilityLabel="Go Back"
      >
  <Ionicons name="arrow-back" size={28} color={theme.primary} />
      </TouchableOpacity>

      {/* Save button (edit mode only) */}
      {isEdit && (
        <TouchableOpacity
          style={[styles.backButton, { top: insets.top + 10, right: 16, position: 'absolute', zIndex: 10 }]}
          onPress={handleContinue}
          accessibilityLabel="Save Profile"
        >
          <Ionicons name="checkmark" size={28} color={theme.primary} />
        </TouchableOpacity>
      )}

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
            <Ionicons name="camera" size={40} color={theme.primary} />
            <Text style={styles.photoButtonText}>Add Photo</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Input Fields */}
      <View style={styles.formContainer}>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor="#999"
            value={username}
            onChangeText={setUsername}
          />
          {username.length >= 3 && (
            <View style={styles.usernameStatus}>
              {isCheckingUsername ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : usernameAvailable === true ? (
                <Ionicons name="checkmark-circle" size={20} color="#4ECDC4" />
              ) : usernameAvailable === false ? (
                <Ionicons name="close-circle" size={20} color="#FF6B6B" />
              ) : null}
            </View>
          )}
        </View>
        {!isEdit && showUsernameError && usernameError ? (
          <Text style={styles.errorText}>{usernameError}</Text>
        ) : null}
        {username.length >= 3 && usernameAvailable === false ? (
          <Text style={styles.errorText}>Username is already taken</Text>
        ) : null}
        {username.length >= 3 && usernameAvailable === true ? (
          <Text style={styles.successText}>Username is available!</Text>
        ) : null}
        {/* Bio field replaces location */}
        <TextInput
          style={[styles.input, styles.bioInput]}
          placeholder="Tell us about yourself... (optional)"
          placeholderTextColor="#999"
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={2}
          maxLength={62}
          textAlignVertical="top"
        />
        <Text style={styles.characterCount}>{bio.length}/62</Text>

        {/* Birth Date Field (Create mode only) */}
        {!isEdit && (
          <View>
            <Text style={styles.subtitle}>Date of Birth</Text>
            <Text style={styles.dobSubtitle}>You must be at least 18 years old to use SportsPal</Text>
            
            <View style={styles.dobRowContainer}>
              <View style={[styles.dobFieldContainer, { flex: 1 }]}>
                <Text style={styles.dobLabel}>Day</Text>
                <TextInput
                  style={styles.dobFieldInput}
                  placeholder="DD"
                  placeholderTextColor="#999"
                  value={birthDay}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/\D/g, '');
                    if (cleaned.length <= 2) {
                      setBirthDay(cleaned);
                      if (cleaned.length === 2) {
                        birthMonthRef.current?.focus();
                      }
                    }
                  }}
                  keyboardType="numeric"
                  maxLength={2}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => birthMonthRef.current?.focus()}
                  onFocus={() => {
                    setTimeout(() => {
                      scrollRef.current?.scrollTo({ y: 300, animated: true });
                    }, 100);
                  }}
                />
              </View>
              
              <View style={[styles.dobFieldContainer, { flex: 1, marginHorizontal: 10 }]}>
                <Text style={styles.dobLabel}>Month</Text>
                <TextInput
                  ref={birthMonthRef}
                  style={styles.dobFieldInput}
                  placeholder="MM"
                  placeholderTextColor="#999"
                  value={birthMonth}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/\D/g, '');
                    if (cleaned.length <= 2) {
                      setBirthMonth(cleaned);
                      if (cleaned.length === 2) {
                        birthYearRef.current?.focus();
                      }
                    }
                  }}
                  keyboardType="numeric"
                  maxLength={2}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => birthYearRef.current?.focus()}
                  onFocus={() => {
                    setTimeout(() => {
                      scrollRef.current?.scrollTo({ y: 300, animated: true });
                    }, 100);
                  }}
                />
              </View>
              
              <View style={[styles.dobFieldContainer, { flex: 1.5 }]}>
                <Text style={styles.dobLabel}>Year</Text>
                <TextInput
                  ref={birthYearRef}
                  style={styles.dobFieldInput}
                  placeholder="YYYY"
                  placeholderTextColor="#999"
                  value={birthYear}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/\D/g, '');
                    if (cleaned.length <= 4) setBirthYear(cleaned);
                  }}
                  keyboardType="numeric"
                  maxLength={4}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onFocus={() => {
                    setTimeout(() => {
                      scrollRef.current?.scrollTo({ y: 300, animated: true });
                    }, 100);
                  }}
                />
              </View>
            </View>
                
            {birthDay && birthMonth && birthYear ? (() => {
              const error = validateBirthDate();
              if (error) {
                return <Text style={styles.dobError}>{error}</Text>;
              }
              const age = calculateAge(`${birthDay.padStart(2, '0')}-${birthMonth.padStart(2, '0')}-${birthYear}`);
              return (
                <View style={styles.dobSuccess}>
                  <Ionicons name="checkmark-circle" size={16} color="#4ECDC4" />
                  <Text style={styles.dobSuccessText}>Verified age: {age} years old</Text>
                </View>
              );
            })() : null}
          </View>
        )}

        {/* Phone field removed */}
        {/* Password / Change Password Section */}
        {!isSocialAuthUser ? (
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
          ) : null
        ) : null}
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
            <View style={styles.sportButtonContent}>
              <ActivityIcon
                activity={sport}
                size={16}
                color={selectedSports.includes(sport) ? '#fff' : theme.primary}
              />
              <Text
                style={[
                  styles.sportButtonText,
                  selectedSports.includes(sport) && styles.sportButtonTextSelected,
                ]}
              >
                {sport}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Social Media Section (Optional) */}
      <Text style={styles.subtitle}>Social Media (Optional)</Text>
      <Text style={styles.helperText}>Add your social links or usernames</Text>

      <View style={styles.socialInputContainer}>
        <Ionicons name="logo-instagram" size={24} color={theme.primary} style={styles.socialIcon} />
        <TextInput
          ref={instagramRef}
          style={styles.socialInput}
          placeholder="Instagram (link or @username)"
          placeholderTextColor="#999"
          value={instagram}
          onChangeText={setInstagram}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => facebookRef.current?.focus()}
          onFocus={() => {
            setTimeout(() => {
              scrollRef.current?.scrollTo({ y: 1100, animated: true });
            }, 100);
          }}
        />
      </View>

      <View style={styles.socialInputContainer}>
        <Ionicons name="logo-facebook" size={24} color={theme.primary} style={styles.socialIcon} />
        <TextInput
          ref={facebookRef}
          style={styles.socialInput}
          placeholder="Facebook (link or username)"
          placeholderTextColor="#999"
          value={facebook}
          onChangeText={setFacebook}
          returnKeyType="done"
          blurOnSubmit={true}
          onFocus={() => {
            setTimeout(() => {
              scrollRef.current?.scrollTo({ y: 1150, animated: true });
            }, 100);
          }}
        />
      </View>

      {/* Legal Agreements Section (Create mode only) */}
      {!isEdit && (
        <>
          <Text style={styles.subtitle}>Legal Agreements</Text>
          
          {/* Terms of Service Button */}
          <TouchableOpacity
            style={styles.legalButton}
            onPress={() => setTermsModalVisible(true)}
          >
            <Ionicons name="document-text-outline" size={22} color={theme.primary} />
            <Text style={styles.legalButtonText}>Terms of Service</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.muted} />
          </TouchableOpacity>

          {/* Community Guidelines Button */}
          <TouchableOpacity
            style={styles.legalButton}
            onPress={() => setCommunityModalVisible(true)}
          >
            <Ionicons name="people-outline" size={22} color={theme.primary} />
            <Text style={styles.legalButtonText}>Community Guidelines</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.muted} />
          </TouchableOpacity>

          {/* Acceptance Checkboxes */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAcceptedAdulthood(!acceptedAdulthood)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, acceptedAdulthood && styles.checkboxChecked]}>
              {acceptedAdulthood && <Ionicons name="checkmark" size={18} color="#fff" />}
            </View>
            <Text style={styles.checkboxLabel}>
              I confirm that I am at least 18 years old and legally permitted to use SportsPal in my jurisdiction.
            </Text>
          </TouchableOpacity>
          {!acceptedAdulthood && birthDay && birthMonth && birthYear ? (() => {
            const err = validateBirthDate();
            if (!err) return (
              <Text style={styles.ageConfirmText}>
                ✓ Birth date indicates you are 18+
              </Text>
            );
            return null;
          })() : null}

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAcceptedTerms(!acceptedTerms)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
              {acceptedTerms && <Ionicons name="checkmark" size={18} color="#fff" />}
            </View>
            <Text style={styles.checkboxLabel}>
              I have read and accept the{' '}
              <Text 
                style={{ fontWeight: 'bold', color: theme.primary, textDecorationLine: 'underline' }}
                onPress={(e) => {
                  e.stopPropagation();
                  Linking.openURL('https://sportspal-1b468.web.app/terms.html').catch(() => {
                    Alert.alert('Error', 'Could not open browser');
                  });
                }}
              >
                Terms of Service
              </Text>
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAcceptedCommunity(!acceptedCommunity)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, acceptedCommunity && styles.checkboxChecked]}>
              {acceptedCommunity && <Ionicons name="checkmark" size={18} color="#fff" />}
            </View>
            <Text style={styles.checkboxLabel}>
              I agree to comply with the{' '}
              <Text 
                style={{ fontWeight: 'bold', color: theme.primary, textDecorationLine: 'underline' }}
                onPress={(e) => {
                  e.stopPropagation();
                  Linking.openURL('https://sportspal-1b468.web.app/community-guidelines.html').catch(() => {
                    Alert.alert('Error', 'Could not open browser');
                  });
                }}
              >
                Community Guidelines
              </Text>
            </Text>
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity
        style={[
          styles.continueButton,
          (!isEdit && (!acceptedTerms || !acceptedCommunity || !acceptedAdulthood)) ? { opacity: 0.6 } : null,
        ]}
        onPress={handleContinue}
        disabled={(!isEdit && (!acceptedTerms || !acceptedCommunity || !acceptedAdulthood))}
      >
        <Text style={styles.continueButtonText}>{mainCtaLabel}</Text>
      </TouchableOpacity>

      {/* Spinner for loading state */}
      {isLoading && <ActivityIndicator size="large" color="#1ae9ef" style={styles.loadingIndicator} />}
    </ScrollView>

    {/* Terms of Service Modal */}
    <Modal transparent visible={termsModalVisible} onRequestClose={() => setTermsModalVisible(false)} animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { maxHeight: '80%', width: '90%' }]}>
          <Ionicons name="document-text-outline" size={26} color={theme.primary} style={{ marginBottom: 8 }} />
          <Text style={styles.modalTitle}>Terms of Service</Text>
          <ScrollView style={{ width: '100%', marginTop: 16 }} showsVerticalScrollIndicator={true}>
            <Text style={styles.legalText}>
              <Text style={{ fontWeight: 'bold', fontSize: 14 }}>Last Updated: November 2025{'\n\n'}</Text>
              
              <Text style={{ fontWeight: 'bold' }}>0) Who we are and how these Terms work{'\n\n'}</Text>
              These Terms of Service ("Terms") are a legally binding agreement between you and SportsPal ("SportsPal," "we," "us," "our") governing your access to and use of the SportsPal mobile apps, websites, and related services (the "Service"). Our contact: sportspalapplication@gmail.com.{'\n\n'}
              By creating an account, using the Service, or clicking "Agree," you accept these Terms. If you do not agree, do not use the Service.{'\n\n'}
              Supplemental terms (e.g., privacy policy, community guidelines, feature-specific rules) are incorporated by reference. Some countries grant consumers non-waivable rights — nothing here limits those.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>1) Eligibility; Accounts; Security{'\n\n'}</Text>
              <Text style={{ fontWeight: '600' }}>Age.</Text> You must be at least 16 if you are in the EEA/UK (or the age of digital consent in your country) and at least 13 elsewhere. If you are under 18 (or the age of majority in your region), you must have parental permission.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Account.</Text> Provide accurate information, keep your credentials safe, and do not share your account. You are responsible for all activity under your account.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>One person, one account.</Text> No account farming, resale, or transfer without our written consent.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Verification.</Text> We may request verification (e.g., email, phone, device checks). We can refuse, suspend, or reclaim usernames.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>2) The Service (what SportsPal is — and is not){'\n\n'}</Text>
              <Text style={{ fontWeight: '600' }}>Platform only.</Text> SportsPal is a platform to discover activities and connect with people. We do not organize, supervise, or control activities, and we do not guarantee any user's identity, background, safety, skill level, or compatibility.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>No emergency services; no professional advice.</Text> SportsPal is not a medical, legal, or emergency service. Dial your local emergency number for urgent situations.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Beta/changes.</Text> Features may change or be discontinued at any time. We may limit or revoke access without liability.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>3) Community Rules (use responsibly){'\n\n'}</Text>
              You agree you will not:{'\n\n'}
              • Harass, threaten, stalk, dox, or otherwise harm others.{'\n'}
              • Post or transmit hateful, pornographic, exploitative, or illegal content; or content that infringes others' rights.{'\n'}
              • Organize or promote dangerous or illegal activities, weapons, or drugs.{'\n'}
              • Impersonate any person or entity, or misrepresent your affiliation, age, sex, or identity.{'\n'}
              • Data-mine, scrape, spider, or use bots; reverse engineer or circumvent security.{'\n'}
              • Upload malware or interfere with the Service's operation.{'\n'}
              • Use the Service for advertising or commercial solicitation without our written permission.{'\n'}
              • Use location spoofing or falsify activity locations.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Enforcement.</Text> We may remove content, restrict features, or suspend/terminate accounts at any time for suspected violations, to protect users, or to comply with law — with or without notice. We are not obligated to explain our moderation decisions.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>4) Content and Licenses{'\n\n'}</Text>
              <Text style={{ fontWeight: '600' }}>Your Content.</Text> You own the content you post (photos, text, messages, activity listings, etc.). By posting, you grant to SportsPal a worldwide, non-exclusive, transferable, sublicensable, royalty-free license to host, store, use, copy, modify, adapt, translate, create derivative works of, reproduce, publish, publicly perform/display, and distribute your content solely to operate, improve, promote, and provide the Service (including backups, moderation, and distribution via service providers).{'\n\n'}
              <Text style={{ fontWeight: '600' }}>License to other users.</Text> You also grant other users a non-exclusive license to access and display your content within the Service as intended (e.g., viewing your profile or activity posts).{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Feedback.</Text> If you submit ideas or suggestions, you grant us a perpetual, irrevocable, worldwide, royalty-free license to use them without restriction.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Moral rights.</Text> To the extent permitted by law, you waive any moral rights you may have in your content for the purposes above.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>5) Location and Discovery{'\n\n'}</Text>
              <Text style={{ fontWeight: '600' }}>Location features.</Text> If enabled, we process your location (approximate or precise) to show you nearby content and users, improve safety, and combat spam/fraud.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Display.</Text> We do not publish your exact real-time location to other users; discovery typically uses approximate distance.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Accuracy.</Text> Location services may be inaccurate or unavailable. You can change permissions in device settings.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>6) Safety; Offline Interactions; Assumption of Risk; Release{'\n\n'}</Text>
              <Text style={{ fontWeight: '600' }}>Your responsibility.</Text> You are solely responsible for your interactions on and off the Service. We do not conduct criminal background checks and do not vet users, even if we offer optional checks.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Meetups.</Text> If you meet others, exercise caution: meet in public places, tell a friend, check venues, arrange your own transport, leave if you feel unsafe.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Sports injuries and hazards.</Text> Sports and physical activities involve risk of injury, illness, property damage, or worse. By participating, you voluntarily assume all risks arising from your participation and interactions.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Release.</Text> To the maximum extent permitted by law, you release and hold harmless SportsPal and its affiliates, officers, employees, and partners from any claims, demands, and damages (direct and indirect) arising from or related to user conduct, meetups, and activities arranged through the Service. This does not affect rights you cannot waive by law.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>7) No Background Checks; Optional Safety Tools{'\n\n'}</Text>
              We may offer optional tools (ID checks, verification badges, in-app reporting, blocks, tips). They improve signals but are not guarantees. Absence or presence of a badge means nothing definitive about a user.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>8) Communications; Notifications; SMS{'\n\n'}</Text>
              By providing contact details, you consent to receive transactional communications (e.g., security alerts, activity updates). Marketing messages require your consent where required by law and you can opt out. Carrier rates may apply. You can manage push notifications in device settings.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>9) Third-Party Services and Links{'\n\n'}</Text>
              The Service may include third-party content, SDKs, and links (e.g., sign-in, maps, analytics, storage, payments). We are not responsible for third-party terms or privacy practices. Your use of third parties is at your own risk.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>10) Virtual Items, Subscriptions, and Payments (if/when offered){'\n\n'}</Text>
              If we offer paid features, we will communicate pricing, billing cycles, auto-renewal terms, and refund policies in-app or in additional terms. Taxes and fees may apply. Apple App Store and Google Play in-app purchase rules may govern transactions and refunds.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>11) Intellectual Property; Our Rights{'\n\n'}</Text>
              The Service and all related trademarks, logos, code, and content are owned by SportsPal or our licensors and are protected by law. Except for the limited rights expressly granted, no license is granted to you. Do not use our marks without written permission.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>12) Copyright Policy (DMCA/Global Notice-and-Takedown){'\n\n'}</Text>
              We respect IP rights and will respond to notices of alleged infringement consistent with applicable law (including the U.S. DMCA).{'\n\n'}
              To submit a copyright notice, email sportspalapplication@gmail.com with:{'\n\n'}
              • your contact details;{'\n'}
              • identification of the copyrighted work;{'\n'}
              • the allegedly infringing material and its location;{'\n'}
              • a statement of good-faith belief;{'\n'}
              • a statement that your notice is accurate and, under penalty of perjury, you're authorized to act;{'\n'}
              • your physical or electronic signature.{'\n\n'}
              We may terminate accounts of repeat infringers.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>13) Moderation; Reporting; Appeals{'\n\n'}</Text>
              We may review, remove, or restrict content or accounts at our discretion and without obligation to you. You can report content or users in-app or via email. We may, but are not required to, offer an appeal process.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>14) Term; Termination; Account Deletion{'\n\n'}</Text>
              You may delete your account at any time (settings or by email). We may suspend or terminate access at any time for any or no reason, including violations, safety risks, or inactivity. Sections that by nature should survive (e.g., licenses for backup copies, safety releases, arbitration, IP rights, limitations of liability) survive termination.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>15) Changes to the Service and to these Terms{'\n\n'}</Text>
              We may modify the Service and these Terms. If changes are material, we'll provide reasonable notice (e.g., in-app). Continued use after changes effective means you accept them. If you do not agree, stop using the Service and delete your account.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>16) Warranty Disclaimer{'\n\n'}</Text>
              To the maximum extent permitted by law, the Service is provided "as is" and "as available." We disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant uninterrupted, secure, or error-free operation, or that content will be accurate or safe.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>17) Limitation of Liability{'\n\n'}</Text>
              To the maximum extent permitted by law, SportsPal and its affiliates, officers, employees, agents, and partners will not be liable for any indirect, incidental, special, consequential, exemplary, punitive, or enhanced damages, or for lost profits, data, goodwill, or other intangible losses, arising from or related to your use of or inability to use the Service, user conduct, or offline interactions.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Cap.</Text> Our aggregate liability to you for any claims will not exceed the greater of (a) USD $100 or (b) the amounts you paid to us (if any) in the 12 months before the claim. Some jurisdictions do not allow certain limitations; in those places, we limit liability to the maximum extent allowed by law.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>18) Indemnification{'\n\n'}</Text>
              To the maximum extent permitted by law, you agree to defend, indemnify, and hold harmless SportsPal and its affiliates from any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising from or related to: (a) your content; (b) your use of the Service; (c) your interactions on or off the Service; (d) your violation of these Terms or law; (e) your infringement of third-party rights.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>19) Dispute Resolution — Binding Arbitration; Class Action Waiver{'\n\n'}</Text>
              PLEASE READ — THIS SECTION LIMITS HOW DISPUTES ARE RESOLVED.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Informal resolution.</Text> Before filing a claim, you agree to email sportspalapplication@gmail.com with "Dispute Notice," your name, account email, a brief description, and relief sought. We'll try to resolve within 30 days.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Arbitration.</Text> If not resolved, any dispute, claim, or controversy arising out of or relating to these Terms or the Service ("Dispute") will be resolved by binding individual arbitration under the U.S. Federal Arbitration Act and JAMS or AAA rules (we'll agree on one). The arbitrator may award individual relief. No class arbitration. Seat of arbitration: Athens, Greece; language: English. We'll pay filing/administrative fees for non-frivolous claims up to a reasonable cap set by rules.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Class-action waiver.</Text> You and SportsPal waive any right to a jury trial or to participate in a class, consolidated, or representative action.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Opt-out.</Text> You may opt out of this arbitration clause within 30 days of first accepting these Terms by emailing sportspalapplication@gmail.com with subject "Arbitration Opt-Out," your full name, and account email.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Small claims & IP relief.</Text> Either party may seek individual relief in small-claims court within its jurisdiction or seek injunctive relief in court for IP or unauthorized use of the Service.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>EEA/UK/India/Other.</Text> If mandatory local law prohibits binding arbitration or class waivers for consumers, this Section does not deprive you of those non-waivable rights. You may bring claims in the courts of your habitual residence as required by law.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>20) Governing Law; Venue{'\n\n'}</Text>
              Except where prohibited by mandatory local law, these Terms are governed by the laws of Greece, without regard to its conflicts of laws rules. Subject to the arbitration clause, the exclusive venue for litigation (if any) shall be the courts located in Athens, Greece. Consumers in the EEA/UK may bring claims in their local courts where required by law.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>21) App Store Terms (Apple/Google) — Third-Party Beneficiary{'\n\n'}</Text>
              <Text style={{ fontWeight: '600' }}>Apple.</Text> You acknowledge these Terms are between you and SportsPal, not Apple Inc. Apple is not responsible for the Service or its content, has no obligation to furnish support, and is not liable for claims relating to the app (product liability, legal compliance, or IP). Apple is a third-party beneficiary of these Terms and may enforce them against you regarding your use of the iOS app. In the event of any failure to conform to any applicable warranty, you may notify Apple and Apple will refund the purchase price (if any).{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Google.</Text> Your use of the Android app may be subject to Google Play terms. Google is not responsible for support or for claims related to the app.{'\n\n'}
              <Text style={{ fontWeight: '600' }}>Device restrictions.</Text> You must use the app according to the usage rules set by the app store provider and your device OS.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>22) Export Controls; Sanctions; Anti-Corruption{'\n\n'}</Text>
              You represent you are not located in, under control of, or a national or resident of any country or person subject to sanctions. You agree to comply with export/import, sanctions, and anti-corruption laws.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>23) Privacy{'\n\n'}</Text>
              Our Privacy Policy explains how we collect, use, and share information. By using the Service, you consent to our data practices as described there.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>24) Force Majeure{'\n\n'}</Text>
              We are not liable for delays or failures due to events beyond our reasonable control (e.g., natural disasters, outages, strikes, war, government action, internet failures).{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>25) Assignment{'\n\n'}</Text>
              You may not assign or transfer these Terms without our consent. We may assign or transfer them (e.g., merger, acquisition) with notice where required by law.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>26) Severability; No Waiver; Entire Agreement{'\n\n'}</Text>
              If any provision is deemed unenforceable, it will be modified to the minimum extent necessary and the remainder remains in effect. No waiver is effective unless in writing. These Terms (plus incorporated policies) are the entire agreement between you and us regarding the Service.{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>27) Language; Consumer Rights{'\n\n'}</Text>
              These Terms are in English. Translations may be provided for convenience; the English version controls except where local law requires otherwise. Nothing here limits non-waivable consumer rights in your country of residence (e.g., EEA/UK).{'\n\n'}
              
              <Text style={{ fontWeight: 'bold' }}>28) Contact; Notices{'\n\n'}</Text>
              SportsPal — sportspalapplication@gmail.com{'\n\n'}
              Legal notices must be sent by email with subject "Legal Notice." We may deliver notices via in-app messages, email, or postings.
            </Text>
          </ScrollView>
          <TouchableOpacity 
            style={[styles.modalBtn, { backgroundColor: theme.primary, marginTop: 16, width: '100%', flex: 0 }]} 
            onPress={() => setTermsModalVisible(false)}
          >
            <Text style={[styles.modalBtnText, { color: '#fff' }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    {/* Community Guidelines Modal */}
    <Modal transparent visible={communityModalVisible} onRequestClose={() => setCommunityModalVisible(false)} animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { maxHeight: '80%', width: '90%' }]}>
          <Ionicons name="people-outline" size={26} color={theme.primary} style={{ marginBottom: 8 }} />
          <Text style={styles.modalTitle}>Community Guidelines</Text>
          <ScrollView style={{ width: '100%', marginTop: 16 }} showsVerticalScrollIndicator={true}>
            <Text style={styles.legalText}>
              <Text style={{ fontWeight: 'bold', fontSize: 14 }}>Last Updated: November 2025{'\n\n'}</Text>
              
              <Text style={{ fontWeight: 'bold' }}>Purpose.</Text> Keep SportsPal respectful, safe, and useful for finding people to play sports with.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>Applies to:</Text> Profiles, usernames, photos, activity listings, chats, messages, and any in-app behavior—on and off the platform when arranged through SportsPal.{'\n\n'}

              <Text style={{ fontWeight: 'bold' }}>A. Golden Rules{'\n'}</Text>
              <Text style={{ fontWeight: 'bold' }}>Be respectful.</Text> No harassment, threats, stalking, or intimidation.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>No hate or violence.</Text> Prohibitions include slurs, dehumanization, extremist praise, or incitement.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>No sexual content/nudity.</Text> No explicit or pornographic content; no fetish content; no sexualization of minors (zero tolerance).{'\n'}
              <Text style={{ fontWeight: 'bold' }}>No illegal or dangerous activity.</Text> Weapons trading, drugs, doping substances, fraud, hacking, or instructions to cause harm are banned.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>No doxxing/privacy invasions.</Text> Don't share private info (addresses, IDs, financials, medical data) without consent.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>No scams or spam.</Text> No pyramid schemes, fake giveaways, phishing, malware, mass unsolicited messages.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>No impersonation or misrepresentation.</Text> Don't claim to be someone you're not; parody must be clearly labeled.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>Accurate activities.</Text> Describe date, time, location, sport, skill level, participant limits, and any costs truthfully. Update or cancel if plans change.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>Respect IP.</Text> Only post photos and content you own or have rights to.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>Meet safely.</Text> Follow our Safety Guidelines. Leave if you feel unsafe—always.{'\n\n'}

              <Text style={{ fontWeight: 'bold' }}>B. Three-Strike Moderation Ladder (with immediate-removal override){'\n'}</Text>
              <Text style={{ fontWeight: 'bold' }}>Strike 1 (Warning):</Text> Content removal + feature limits (e.g., 24–72h chat/creation restriction).{'\n'}
              <Text style={{ fontWeight: 'bold' }}>Strike 2 (Probation):</Text> 7–30 days suspension of some or all features.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>Strike 3 (Removal):</Text> Permanent ban.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>Immediate Removal:</Text> We may skip steps for child safety, credible violence threats, severe harassment, doxxing, hate speech, or explicit sexual content.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>Strike decay:</Text> Strikes typically expire after 12 months if no further violations.{'\n\n'}

              <Text style={{ fontWeight: 'bold' }}>C. Appeals{'\n'}</Text>
              <Text style={{ fontWeight: 'bold' }}>Window:</Text> 14 days from enforcement notice.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>How:</Text> Email sportspalapplication@gmail.com from your account email with subject "Appeal."{'\n'}
              <Text style={{ fontWeight: 'bold' }}>What to include:</Text> Activity/Profile/Message screenshot or link, brief explanation, any relevant context.{'\n'}
              <Text style={{ fontWeight: 'bold' }}>Outcome:</Text> We confirm, modify, or reverse within a reasonable time. Decisions after appeal are final.{'\n\n'}

              <Text style={{ fontWeight: 'bold' }}>D. False Reporting & Abuse of Tools{'\n'}</Text>
              Deliberate false reports or brigading may result in strikes or suspension.
            </Text>
          </ScrollView>
          <TouchableOpacity 
            style={[styles.modalBtn, { backgroundColor: theme.primary, marginTop: 16, width: '100%', flex: 0 }]} 
            onPress={() => setCommunityModalVisible(false)}
          >
            <Text style={[styles.modalBtnText, { color: '#fff' }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    </Animated.View>
  );
};

const createStyles = (t: any) => StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: t.background,
  },
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: t.background,
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
    color: t.primary,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
    width: '100%',
  },
  photoButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderColor: t.primary,
    borderWidth: 2,
    backgroundColor: t.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: t.primary,
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
    color: t.primary,
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
    backgroundColor: t.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: t.background,
  },
  formContainer: {
    width: '100%',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    padding: 14,
    fontSize: 16,
    color: t.text,
    marginVertical: 8,
  },
  bioInput: {
    minHeight: 70,
    maxHeight: 70,
    paddingTop: 14,
  },
  characterCount: {
    fontSize: 12,
    color: t.muted,
    textAlign: 'right',
    marginTop: -4,
    marginBottom: 8,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  subtitle: {
    fontSize: 18,
    color: t.muted,
    marginVertical: 15,
    textAlign: 'center',
  },
  helperText: {
    fontSize: 14,
    color: t.muted,
    marginBottom: 12,
    textAlign: 'center',
  },
  socialInputContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    marginVertical: 6,
    paddingHorizontal: 10,
  },
  socialIcon: {
    marginRight: 12,
  },
  socialInput: {
    flex: 1,
    padding: 14,
    fontSize: 16,
    color: t.text,
  },
  sportsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 30,
    paddingHorizontal: 4,
  },
  sportButton: {
    width: '31%',
    marginBottom: 12,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: t.primary,
    backgroundColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  sportButtonSelected: {
    backgroundColor: t.primary,
  },
  sportButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'nowrap',
  },
  sportButtonText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: t.primary,
    textAlign: 'center',
    flexShrink: 1,
    lineHeight: 13,
  },
  sportButtonTextSelected: {
    color: '#fff',
  },
  continueButton: {
    backgroundColor: t.primary,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
    shadowColor: t.primary,
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
    backgroundColor: t.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignItems: 'center',
    width: '100%',
    marginTop: 4,
    marginBottom: 10,
    shadowColor: t.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  verifyButton: {
    backgroundColor: t.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
    marginBottom: 12,
    shadowColor: t.primary,
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
    backgroundColor: t.border,
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
    color: t.text,
  },
  requirementsBox: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 6,
  },
  requirementsTitle: {
    color: t.text,
    fontWeight: '700',
    marginBottom: 6,
  },
  requirementItem: {
    color: t.muted,
    fontSize: 13,
    marginVertical: 2,
  },
  // Email verification styles
  emailVerifyRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  verifyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  badgeVerified: {
    backgroundColor: '#2ecc71',
  },
  badgeUnverified: {
    backgroundColor: '#e67e22',
  },
  verifyBadgeText: {
    color: '#fff',
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  verifyActionButton: {
    backgroundColor: t.primary,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    shadowColor: t.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 3,
  },
  verifyActionButtonDisabled: {
    backgroundColor: t.primaryStrong,
    shadowOpacity: 0.15,
  },
  verifyActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  // Legal agreements styles
  legalButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 10,
  },
  legalButtonText: {
    flex: 1,
    color: t.text,
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 12,
  },
  checkboxRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: t.border,
    backgroundColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: t.primary,
    borderColor: t.primary,
  },
  checkboxLabel: {
    flex: 1,
    color: t.text,
    fontSize: 13,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: t.text,
    marginTop: 8,
    marginBottom: 4,
  },
  ageConfirmText: {
    color: '#2ecc71',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 8,
  },
  dobHelper: {
    fontSize: 12,
    color: t.muted,
    marginTop: 4,
    marginBottom: 4,
  },
  disclaimerText: {
    fontSize: 11,
    color: t.muted,
    marginTop: 6,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '94%',
    backgroundColor: t.card,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
  },
  modalTitle: {
    color: t.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  modalBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalBtnText: {
    fontWeight: '700',
    fontSize: 15,
  },
  legalText: {
    color: t.text,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  dobSubtitle: {
    fontSize: 14,
    color: t.text,
    textAlign: 'center',
    marginBottom: 15,
    opacity: 0.7,
  },
  dobRowContainer: {
    flexDirection: 'row',
    width: '100%',
    marginBottom: 10,
  },
  dobFieldContainer: {
    alignItems: 'center',
  },
  dobLabel: {
    fontSize: 13,
    color: t.muted,
    marginBottom: 6,
    fontWeight: '600',
  },
  dobFieldInput: {
    backgroundColor: t.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    paddingVertical: 12,
    paddingHorizontal: 10,
    fontSize: 16,
    color: t.text,
    textAlign: 'center',
    width: '100%',
  },
  formatIndicator: {
    fontSize: 12,
    color: t.primary,
    textAlign: 'center',
    marginTop: 5,
    fontWeight: '500',
  },
  dobInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.cardBackground,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 10,
  },
  dobIcon: {
    marginRight: 10,
  },
  dobInput: {
    flex: 1,
    fontSize: 16,
    color: t.text,
    fontFamily: 'System',
  },
  dobError: {
    color: '#FF6B6B',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 5,
  },
  dobSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
  },
  dobSuccessText: {
    color: '#4ECDC4',
    fontSize: 14,
    marginLeft: 5,
    fontWeight: '500',
  },
  inputContainer: {
    position: 'relative',
    width: '100%',
  },
  usernameStatus: {
    position: 'absolute',
    right: 15,
    top: '50%',
    transform: [{ translateY: -10 }],
    zIndex: 1,
  },
  successText: {
    color: '#4ECDC4',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 5,
  },
});

export default React.memo(CreateProfileScreen);