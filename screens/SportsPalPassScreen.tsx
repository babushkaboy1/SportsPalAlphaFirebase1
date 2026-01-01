import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Platform,
  ScrollView,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { ActivityIcon } from '../components/ActivityIcons';
import AddToAppleWalletButton from '../components/AddToAppleWalletButton';
import QRCode from 'react-native-qrcode-svg';

// Functions base URL
const FUNCTIONS_BASE_URL = 'https://us-central1-sportspal-1b468.cloudfunctions.net';

const SportsPalPassScreen: React.FC = () => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [username, setUsername] = useState<string>('');
  const [sports, setSports] = useState<string[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [birthday, setBirthday] = useState<string>('');
  const [memberSince, setMemberSince] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [opening, setOpening] = useState<boolean>(false);
  const [openingGoogle, setOpeningGoogle] = useState<boolean>(false);

  useEffect(() => {
    const loadProfile = async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        Alert.alert('Not signed in', 'Please sign in to view your pass.');
        return;
      }
      try {
        const ref = doc(db, 'profiles', user.uid);
        const snap = await getDoc(ref);
        const data = snap.data() as any;
        setUsername(data?.username || user.email || 'Member');
        setPhotoUrl(data?.photo || data?.photoURL || null);
        
        const sportsArray: string[] = Array.isArray(data?.sportsPreferences)
          ? data?.sportsPreferences
          : Array.isArray(data?.selectedSports)
          ? data?.selectedSports
          : Array.isArray(data?.sports)
          ? data?.sports
          : [];
        setSports(sportsArray);

        // Parse birthday
        if (data?.birthday) {
          try {
            const bday = data.birthday?.toDate ? data.birthday.toDate() : new Date(data.birthday);
            setBirthday(bday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
          } catch { /* ignore */ }
        }

        // Parse member since with full month name
        const createdAt = data?.createdAt?.toDate ? data.createdAt.toDate() : 
          (data?.createdAt?._seconds ? new Date(data.createdAt._seconds * 1000) : null);
        if (createdAt) {
          setMemberSince(createdAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
        }
      } catch (error) {
        Alert.alert('Error', 'Could not load profile info.');
      } finally {
        setLoading(false);
      }
    };
    loadProfile();
  }, []);

  const handleOpenPass = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in to add your pass.');
      return;
    }
    const url = `${FUNCTIONS_BASE_URL}/getAppleWalletPass?userId=${user.uid}`;
    try {
      setOpening(true);
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Error', 'Could not open Apple Wallet pass URL.');
    } finally {
      setOpening(false);
    }
  };

  const handleOpenGoogleWallet = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in to add your pass.');
      return;
    }
    try {
      setOpeningGoogle(true);
      // Fetch the save URL from our Cloud Function
      const response = await fetch(
        `${FUNCTIONS_BASE_URL}/getGoogleWalletPassUrl?userId=${user.uid}`
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to generate pass');
      }
      const data = await response.json();
      if (data.saveUrl) {
        await Linking.openURL(data.saveUrl);
      } else {
        throw new Error('No save URL returned');
      }
    } catch (error: any) {
      console.error('Google Wallet error:', error);
      Alert.alert('Error', error.message || 'Could not open Google Wallet pass.');
    } finally {
      setOpeningGoogle(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()} 
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color={theme.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.primary }]}>SportsPal Pass</Text>
        <TouchableOpacity 
          onPress={async () => {
            const user = auth.currentUser;
            if (!user) return;
            const profileUrl = `https://sportspal-1b468.web.app/profile/${user.uid}`;
            try {
              await Share.share({
                message: `Check out my SportsPal profile: ${profileUrl}`,
                url: profileUrl,
              });
            } catch (e) {
              console.error('Share error:', e);
            }
          }}
          style={styles.shareButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="share-outline" size={24} color={theme.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.loadingText, { color: theme.muted }]}>Loading your pass...</Text>
          </View>
        ) : (
          <>
            {/* Pass Preview Card */}
            <View style={[styles.passCard, { backgroundColor: '#121212' }]}>
              {/* Pass Header */}
              <View style={styles.passHeader}>
                <View style={styles.logoContainer}>
                  <Image 
                    source={require('../assets/logo.png')} 
                    style={styles.logo}
                    resizeMode="contain"
                  />
                  <Text style={styles.logoText}>SportsPal</Text>
                </View>
              </View>

              {/* Pass Content */}
              <View style={styles.passContent}>
                {/* Profile Picture */}
                <View style={styles.profileSection}>
                  {photoUrl ? (
                    <Image source={{ uri: photoUrl }} style={styles.profilePic} cachePolicy="memory-disk" />
                  ) : (
                    <View style={[styles.profilePic, styles.profilePlaceholder]}>
                      <Text style={{ color: '#00CED1', fontSize: 40, fontWeight: 'bold' }}>
                        {username ? username.charAt(0).toUpperCase() : '?'}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Username */}
                <Text style={styles.passUsername}>{username}</Text>

                {/* Member Since */}
                {memberSince ? (
                  <Text style={styles.memberSinceText}>Member since {memberSince}</Text>
                ) : null}

                {/* Favorite Sports Section */}
                {sports.length > 0 && (
                  <View style={styles.sportsSection}>
                    <Text style={styles.sportsSectionLabel}>FAVORITE SPORTS</Text>
                    <View style={styles.sportsIconsRow}>
                      {sports.slice(0, 8).map((sport, index) => (
                        <View key={index} style={styles.sportIconWrapper}>
                          <ActivityIcon activity={sport} size={26} color="#1ae9ef" />
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Info Row */}
                <View style={styles.infoRow}>
                  {birthday ? (
                    <View style={styles.infoItem}>
                      <Text style={styles.infoLabel}>BIRTHDAY</Text>
                      <Text style={styles.infoValue}>{birthday}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.infoItem, { flex: 1 }]}>
                    <Text style={styles.infoLabel}>MEMBER ID</Text>
                    <Text style={styles.memberIdValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                      {auth.currentUser?.uid || 'N/A'}
                    </Text>
                  </View>
                </View>

                {/* QR Code */}
                <View style={styles.qrSection}>
                  <View style={styles.qrContainer}>
                    {auth.currentUser?.uid ? (
                      <QRCode
                        value={`https://sportspal-1b468.web.app/profile/${auth.currentUser.uid}`}
                        size={140}
                        color="#000000"
                        backgroundColor="#ffffff"
                      />
                    ) : (
                      <MaterialCommunityIcons name="qrcode" size={120} color="#888" />
                    )}
                  </View>
                  <Text style={styles.qrLabel}>Scan to view profile</Text>
                  <Text style={styles.qrUsername}>@{username}</Text>
                </View>
              </View>
            </View>

            {/* Add to Apple Wallet Button - Uses official Apple badge per guidelines */}
            {/* @see https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/ */}
            {Platform.OS === 'ios' && (
              <View style={styles.walletButtonContainer}>
                <AddToAppleWalletButton
                  onPress={handleOpenPass}
                  disabled={opening}
                  loading={opening}
                />
              </View>
            )}

            {Platform.OS === 'android' && (
              <TouchableOpacity
                style={styles.walletButtonContainer}
                onPress={handleOpenGoogleWallet}
                disabled={openingGoogle}
                activeOpacity={0.85}
              >
                {openingGoogle ? (
                  <View style={styles.googleWalletLoading}>
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : (
                  <Image
                    source={require('../assets/Add_to_Google_Wallet_badge.png')}
                    style={styles.googleWalletBadge}
                    resizeMode="contain"
                  />
                )}
              </TouchableOpacity>
            )}

            <Text style={[styles.footerText, { color: theme.muted }]}>
              Your SportsPal Pass. Show it off, scan to connect!
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 18,
  },
  backButton: {
    padding: 4,
  },
  shareButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    flexGrow: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  passCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  passHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  logoText: {
    color: '#1ae9ef',
    fontSize: 22,
    fontWeight: '800',
    marginLeft: 10,
    letterSpacing: 0.5,
  },
  memberBadge: {
    backgroundColor: 'rgba(26, 233, 239, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  memberBadgeText: {
    color: '#1ae9ef',
    fontSize: 12,
    fontWeight: '700',
  },
  passContent: {
    padding: 20,
    alignItems: 'center',
  },
  profileSection: {
    marginBottom: 12,
  },
  profilePic: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: '#1ae9ef',
  },
  profilePlaceholder: {
    backgroundColor: 'rgba(26, 233, 239, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  passUsername: {
    color: '#1ae9ef',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 4,
  },
  memberSinceText: {
    color: '#a0a0a0',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 16,
  },
  sportsSection: {
    width: '100%',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  sportsSectionLabel: {
    color: '#666',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 12,
  },
  sportsIconsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  sportIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(26, 233, 239, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(26, 233, 239, 0.2)',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    marginBottom: 16,
  },
  infoItem: {
    alignItems: 'center',
  },
  infoLabel: {
    color: '#666',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoValue: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  qrSection: {
    alignItems: 'center',
    marginTop: 12,
  },
  qrContainer: {
    width: 160,
    height: 160,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  qrPlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrLabel: {
    color: '#888',
    fontSize: 11,
    marginTop: 10,
    fontWeight: '500',
  },
  qrUsername: {
    color: '#1ae9ef',
    fontSize: 14,
    marginTop: 4,
    fontWeight: '700',
  },
  memberIdValue: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  memberSinceLabel: {
    color: '#bdbdbd',
    fontSize: 10,
    fontWeight: '500',
  },
  walletButtonContainer: {
    marginTop: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletButton: {
    backgroundColor: '#000',
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  googleWalletBadge: {
    width: 180,
    height: 54,
  },
  googleWalletLoading: {
    width: 180,
    height: 54,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  walletIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: 8,
  },
  walletButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  helperText: {
    marginTop: 12,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  footerText: {
    marginTop: 16,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default SportsPalPassScreen;
