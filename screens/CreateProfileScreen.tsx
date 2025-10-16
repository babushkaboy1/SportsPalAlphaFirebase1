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
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db, storage } from '../firebaseConfig';
import { compressImage, uploadProfileImage } from '../utils/imageUtils';
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
  const [phone, setPhone] = useState(profileData?.phone || '');
  const [password, setPassword] = useState(profileData?.password || '');
  const [location, setLocation] = useState(profileData?.location || '');
  const [photo, setPhoto] = useState<string | null>(profileData?.photo || null);
  const [selectedSports, setSelectedSports] = useState<string[]>(profileData?.selectedSports || []);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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
          phone,
          location,
          photo: photoURL,
          sportsPreferences: selectedSports,
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
          phone,
          location,
          photo: photoURL,
          sportsPreferences: selectedSports,
        };
        
        await setDoc(doc(db, "profiles", userId), profileData);
        Alert.alert('Success', 'Your profile has been created!');
        navigation.navigate('MainTabs');
      }
    } catch (error: any) {
      console.error("❌ Error saving profile:", error);
      Alert.alert('Error', error.message || 'Failed to save profile. Please try again.');
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
      {/* Back button only in edit mode, absolutely positioned at the top left */}
      {isEdit && (
        <TouchableOpacity
          style={[styles.backButton, { top: insets.top + 10, left: 16, position: 'absolute', zIndex: 10 }]}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to Profile"
        >
          <Ionicons name="arrow-back" size={28} color="#1ae9ef" />
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
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#999"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!isGoogleUser}
        />
        <TextInput
          style={styles.input}
          placeholder="Phone Number"
          placeholderTextColor="#999"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />
        {/* Only show password field if NOT a Google user */}
        {!isGoogleUser ? (
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#999"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
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
  loadingIndicator: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -20,
    marginLeft: -20,
  },
});

export default React.memo(CreateProfileScreen);