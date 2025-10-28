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
import { createUserWithEmailAndPassword, reauthenticateWithCredential, EmailAuthProvider, updatePassword, sendEmailVerification, reload, signOut, getIdToken, signInWithEmailAndPassword, getIdTokenResult } from 'firebase/auth';
import { doc, setDoc, query, where, getDocs, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db, storage } from '../firebaseConfig';
import { compressImage, uploadProfileImage, testStorageConnection } from '../utils/imageUtils';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import * as ImageManipulator from 'expo-image-manipulator';

// Sports Options for the grid (alphabetical order; grid renders 3 per row)
const sportsOptions = [
  'American Football',
  'Badminton',
  'Basketball',
  'Boxing',
  'Calisthenics',
  'Cycling',
  'Gym',
  'Hiking',
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
  // Email verification state (edit mode)
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(!!auth.currentUser?.emailVerified);
  const [isSendingVerify, setIsSendingVerify] = useState(false);
  const [isCheckingVerify, setIsCheckingVerify] = useState(false);
  const [sendCooldown, setSendCooldown] = useState<number>(0);
  const cooldownRef = useRef<NodeJS.Timeout | null>(null);
  const currentAuthEmail = auth.currentUser?.email || null;
  // Track whether the user has pressed "Send verification" at least once
  const [sentVerification, setSentVerification] = useState(false);
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

  // Only show username error after submit attempt in create mode
  const [showUsernameError, setShowUsernameError] = useState(false);

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

  // Keep isEmailVerified in sync when auth state changes
  useEffect(() => {
    setIsEmailVerified(!!auth.currentUser?.emailVerified);
  }, [auth.currentUser]);

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

  const handleSendVerificationEmail = async () => {
    try {
      // If cooldown active, ignore taps
      if (sendCooldown > 0 || isSendingVerify) return;
      setIsSendingVerify(true);
      let user = auth.currentUser;
      // If logged in with a different email, seamlessly sign out and proceed with creating the new account
      if (user && user.email && user.email !== email) {
        try {
          await signOut(auth);
        } catch (e) {
          console.warn('Auto sign-out failed before creating new account', e);
          // Even if signOut fails, we can't create a new user while logged in
          Alert.alert('Please sign out', 'You are currently signed in with a different account. Please sign out and try again.');
          setIsSendingVerify(false);
          return;
        }
        user = auth.currentUser; // refresh
      }

      if (user) {
        // Already authenticated (and either matching email or no email set) — just send verification
        await sendEmailVerification(user);
        setAwaitingEmailVerification(true);
        setSentVerification(true);
        startSendCooldown(30);
        Alert.alert(
          'Verification sent',
          'We sent a verification link to your email. Open it to verify.\n\nTip: If you don\'t see it, check your Spam/Junk or Deleted/Trash folder.'
        );
      } else {
        // Not authenticated yet: create the account now (requires valid password)
        const checks = getPasswordChecks(password);
        if (!(checks.len && checks.upper && checks.number && checks.symbol)) {
          Alert.alert('Set a password first', 'Please enter a strong password before sending verification.');
          setIsSendingVerify(false);
          return;
        }
        if (password !== confirmPassword) {
          Alert.alert('Password mismatch', 'Please confirm your password.');
          setIsSendingVerify(false);
          return;
        }
        // Try to create user for this email to be able to send verification
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          await sendEmailVerification(cred.user);
          setAwaitingEmailVerification(true);
          setSentVerification(true);
          startSendCooldown(30);
          Alert.alert(
            'Verification sent',
            'We sent a verification link. Open it to verify, then tap "I verified — Refresh".\n\nTip: If you don\'t see it, check your Spam/Junk or Deleted/Trash folder.'
          );
        } catch (e: any) {
          console.error('create+send verification failed', e);
          if (e?.code === 'auth/email-already-in-use') {
            Alert.alert('Email in use', 'An account with this email already exists. Try signing in instead.');
          } else if (e?.code === 'auth/invalid-email') {
            Alert.alert('Invalid email', 'Please enter a valid email address.');
          } else {
            Alert.alert('Error', e?.message || 'Could not send verification.');
          }
        }
      }
    } catch (e: any) {
      console.error('sendEmailVerification failed', e);
      Alert.alert('Error', e?.message || 'Could not send verification email.');
    } finally {
      setIsSendingVerify(false);
    }
  };

  const startSendCooldown = (seconds: number) => {
    setSendCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setSendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRefreshVerifyButton = async () => {
    try {
      setIsCheckingVerify(true);
      await handleRefreshEmailVerified();
    } finally {
      setIsCheckingVerify(false);
    }
  };

  const handleRefreshEmailVerified = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      await reload(user);
      // Force refresh the ID token so Firestore rules see updated email_verified claim
      await getIdToken(user, true);
      setIsEmailVerified(!!user.emailVerified);
      if (user.emailVerified) {
        setAwaitingEmailVerification(false);
        Alert.alert('Email verified', 'Your email is now verified.');
      } else {
        Alert.alert('Not verified yet', 'Please open the verification link we sent to your email.');
      }
    } catch (e) {
      console.warn('reload failed', e);
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
  const [awaitingEmailVerification, setAwaitingEmailVerification] = useState(false);
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
      setShowUsernameError(true);
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
          uid: userId,
          emailVerified: !!auth.currentUser?.emailVerified,
          updatedAt: serverTimestamp(),
        };
        
        await setDoc(doc(db, "profiles", userId), profileData, { merge: true });
        Alert.alert('Success', 'Your profile has been updated!');
        navigation.goBack();
      } else {
        // CREATE MODE
        // If logged in to a different email, auto sign out to proceed with creating the new account
        if (auth.currentUser && auth.currentUser.email && auth.currentUser.email !== email) {
          try {
            await signOut(auth);
          } catch (e) {
            console.warn('Auto sign-out failed before creating new account', e);
            Alert.alert('Please sign out', 'You are currently signed in with a different account. Please sign out and try again.');
            setIsLoading(false);
            return;
          }
        }
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
        
        // If there's already a user, force reload + token refresh and proceed if verified
        if (auth.currentUser) {
          await reload(auth.currentUser);
          await getIdToken(auth.currentUser, true);
          // Double-check token claims reflect verified state
          try {
            const claims = await getIdTokenResult(auth.currentUser, true);
            console.log('🔐 Token claims before create write', {
              email: auth.currentUser.email,
              uid: auth.currentUser.uid,
              emailVerifiedLocal: auth.currentUser.emailVerified,
              email_verified_claim: (claims as any)?.claims?.email_verified,
              sign_in_provider: (claims as any)?.signInProvider || (claims as any)?.claims?.firebase?.sign_in_provider,
            });
          } catch (e) {
            console.warn('getIdTokenResult failed (pre-write)', e);
          }
          if (!auth.currentUser.emailVerified) {
            // As a fallback, allow the user to tap Refresh button, but don't block the UI state here
            setAwaitingEmailVerification(true);
            Alert.alert('Verify your email', 'Please verify your email, then tap "I verified — Refresh" to continue.');
            setIsLoading(false);
            return;
          }
        }

        // If no current user, create auth user first, send verification, and block until verified
        if (!auth.currentUser) {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          userId = userCredential.user.uid;
          try {
            await sendEmailVerification(userCredential.user);
            setAwaitingEmailVerification(true);
            Alert.alert('Verify your email', 'We sent a verification link. Please verify, then tap "I verified — Refresh".');
          } catch (e) {
            console.warn('Could not send verification email on signup', e);
          }
          setIsLoading(false);
          return; // Do not create profile until verified
        }

  // Reached here means current user exists and is verified -> ensure we are authenticated as the typed email
  // If for any reason current user email differs, sign in with provided credentials again
  if (!auth.currentUser?.email || auth.currentUser.email.toLowerCase() !== email.toLowerCase()) {
    await signInWithEmailAndPassword(auth, email, password);
  }
  // Ensure token reflects email_verified before writing
  await reload(auth.currentUser!);
  await getIdToken(auth.currentUser!, true);
  try {
    const claims = await getIdTokenResult(auth.currentUser!, true);
    console.log('🔐 Token claims at write time', {
      email: auth.currentUser!.email,
      uid: auth.currentUser!.uid,
      emailVerifiedLocal: auth.currentUser!.emailVerified,
      email_verified_claim: (claims as any)?.claims?.email_verified,
      sign_in_provider: (claims as any)?.signInProvider || (claims as any)?.claims?.firebase?.sign_in_provider,
    });
    if (!(claims as any)?.claims?.email_verified) {
      Alert.alert('Verify your email', 'Your email is not verified yet. Tap "I verified — Refresh" and try again.');
      setIsLoading(false);
      return;
    }
  } catch (e) {
    console.warn('getIdTokenResult failed (write-time)', e);
  }
  userId = auth.currentUser!.uid;
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
          uid: userId,
          emailVerified: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        try {
          await setDoc(doc(db, "profiles", userId), profileData);
        } catch (err: any) {
          // One-time retry after forced token refresh to avoid stale claims
          if (err?.code === 'permission-denied') {
            try {
              await getIdToken(auth.currentUser!, true);
              await reload(auth.currentUser!);
              if (auth.currentUser?.emailVerified) {
                await setDoc(doc(db, "profiles", userId), profileData);
              } else {
                throw err;
              }
            } catch (retryErr) {
              throw err;
            }
          } else {
            throw err;
          }
        }
        Alert.alert('Success', 'Your profile has been created!');
        navigation.navigate('MainTabs');
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
  const isPasswordUser = !!auth.currentUser?.providerData.find(
    (p) => p.providerId === 'password'
  );

  const mainCtaLabel = isEdit ? 'Save' : 'Continue';

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
        {!isEdit && showUsernameError && usernameError ? (
          <Text style={styles.errorText}>{usernameError}</Text>
        ) : null}
        {/* Move City / Neighborhood directly under Username */}
        <TextInput
          style={styles.input}
          placeholder="City / Neighborhood"
          placeholderTextColor="#999"
          value={location}
          onChangeText={setLocation}
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
        {/* Email verification controls */}
        {!isEdit ? (
          // Create mode: show actions until verified; show green badge after
          <View style={styles.emailVerifyRow}>
            {!isEmailVerified ? (
              <>
                <TouchableOpacity
                  style={[
                    styles.verifyActionButton,
                    (sendCooldown > 0 || isSendingVerify) ? styles.verifyActionButtonDisabled : null,
                    { marginLeft: 0 },
                  ]}
                  onPress={handleSendVerificationEmail}
                  disabled={sendCooldown > 0 || isSendingVerify}
                >
                  {isSendingVerify ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.verifyActionText}>
                      {sendCooldown > 0 ? `Send again in ${sendCooldown}s` : 'Send verification'}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.verifyActionButton,
                    { marginLeft: 8 },
                    (isCheckingVerify || !sentVerification) ? styles.verifyActionButtonDisabled : null,
                  ]}
                  onPress={handleRefreshVerifyButton}
                  disabled={isCheckingVerify || !sentVerification}
                >
                  {isCheckingVerify ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.verifyActionText}>I verified — Refresh</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <View style={[styles.verifyBadge, styles.badgeVerified]}>
                <Ionicons name="checkmark-circle" size={16} color="#fff" />
                <Text style={styles.verifyBadgeText}>Verified</Text>
              </View>
            )}
          </View>
        ) : (
          // Edit mode: keep existing password-user flow; show actions when needed
          (auth.currentUser && (isPasswordUser || isEdit)) || awaitingEmailVerification ? (
            <View style={styles.emailVerifyRow}>
              {!isEmailVerified && (
                <>
                  <TouchableOpacity
                    style={[
                      styles.verifyActionButton,
                      (sendCooldown > 0 || isSendingVerify) ? styles.verifyActionButtonDisabled : null,
                      { marginLeft: 0 },
                    ]}
                    onPress={handleSendVerificationEmail}
                    disabled={sendCooldown > 0 || isSendingVerify}
                  >
                    {isSendingVerify ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.verifyActionText}>
                        {sendCooldown > 0 ? `Send again in ${sendCooldown}s` : 'Send verification'}
                      </Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.verifyActionButton,
                      { marginLeft: 8 },
                      (isCheckingVerify || !sentVerification) ? styles.verifyActionButtonDisabled : null,
                    ]}
                    onPress={handleRefreshVerifyButton}
                    disabled={isCheckingVerify || !sentVerification}
                  >
                    {isCheckingVerify ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.verifyActionText}>I verified — Refresh</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : null
        )}
        {!isEdit && awaitingEmailVerification ? (
          <View style={[styles.requirementsBox, { marginTop: 6 }]}> 
            <Text style={styles.requirementsTitle}>Verify your email to continue</Text>
            <Text style={styles.requirementItem}>We sent a verification link to {email}. Open it, then tap "I verified — Refresh" above.</Text>
          </View>
        ) : null}
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

      <TouchableOpacity
        style={[
          styles.continueButton,
          (!isEdit && auth.currentUser && !isEmailVerified) ? { opacity: 0.6 } : null,
        ]}
        onPress={handleContinue}
        disabled={!isEdit && auth.currentUser != null && !isEmailVerified}
      >
        <Text style={styles.continueButtonText}>{mainCtaLabel}</Text>
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
    backgroundColor: '#1ae9ef',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    shadowColor: '#1ae9ef',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 3,
  },
  verifyActionButtonDisabled: {
    backgroundColor: '#007b7b', // match Discover's dark turquoise
    shadowOpacity: 0.15,
  },
  verifyActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default React.memo(CreateProfileScreen);