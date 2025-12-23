// screens/SettingsScreen.tsx
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Modal,
  Pressable,
  Platform,
  Linking,
  Alert,
  TextInput,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Slider from '@react-native-community/slider';
import { auth, db, functions } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { 
  linkWithCredential,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  EmailAuthProvider,
} from 'firebase/auth';
import * as Google from 'expo-auth-session/providers/google';
import * as Facebook from 'expo-auth-session/providers/facebook';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, FACEBOOK_APP_ID } from '@env';
import { removeSavedTokenAndUnregister } from '../utils/notifications';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import type { ThemeMode } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';

type SettingsScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Settings'>;

// Colors now come from theme

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  const { theme, themeMode, setThemeMode } = useTheme();

  // State
  const [pushEnabled, setPushEnabled] = useState(true);
  const [discoveryRange, setDiscoveryRange] = useState(70); // km
  
  // Update checker state
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);

  const [confirmSignOutVisible, setConfirmSignOutVisible] = useState(false);
  const [themeModalVisible, setThemeModalVisible] = useState(false);
  const [rangeModalVisible, setRangeModalVisible] = useState(false);
  const [termsModalVisible, setTermsModalVisible] = useState(false);
  const [privacyModalVisible, setPrivacyModalVisible] = useState(false);
  const [communityModalVisible, setCommunityModalVisible] = useState(false);
  const [linkedAccountsVisible, setLinkedAccountsVisible] = useState(false);
  const [legalPoliciesExpanded, setLegalPoliciesExpanded] = useState(false);
  
  // Account deletion state
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Linking UI state
  const [linking, setLinking] = useState<{ google: boolean; facebook: boolean; apple: boolean; password: boolean }>({ google: false, facebook: false, apple: false, password: false });
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Linked accounts state
  const [hasGoogle, setHasGoogle] = useState(false);
  const [hasFacebook, setHasFacebook] = useState(false);
  const [hasApple, setHasApple] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);

  // AuthSession hooks for Google/Facebook
  const [gRequest, gResponse, gPromptAsync] = Google.useAuthRequest({
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || '',
    iosClientId: GOOGLE_IOS_CLIENT_ID || '',
    webClientId: GOOGLE_WEB_CLIENT_ID || '',
  });
  const [fbRequest, fbResponse, fbPromptAsync] = Facebook.useAuthRequest({
    clientId: FACEBOOK_APP_ID || '',
    scopes: ['public_profile', 'email'],
  });

  const styles = useMemo(() => createStyles(theme), [theme]);
  const themeModeLabel = themeMode === 'dark' ? 'Dark' : 'Light';
  const themeModeIcon = themeMode === 'dark' ? 'moon' : 'sunny';

  // Load discovery range from storage
  useEffect(() => {
    const loadDiscoveryRange = async () => {
      try {
        const saved = await AsyncStorage.getItem('discoveryRange');
        if (saved) {
          setDiscoveryRange(parseInt(saved, 10));
        }
      } catch (error) {
        console.error('Failed to load discovery range:', error);
      }
    };
    loadDiscoveryRange();
  }, []);

  // Check linked accounts
  useEffect(() => {
    const checkLinkedAccounts = () => {
      const user = auth.currentUser;
      if (!user) return;
      
      const providers = user.providerData.map(p => p.providerId);
      setHasGoogle(providers.includes('google.com'));
      setHasFacebook(providers.includes('facebook.com'));
      setHasApple(providers.includes('apple.com'));
      setHasPassword(providers.includes('password'));
    };
    
    checkLinkedAccounts();
  }, []);

  // Handle Google link response
  useEffect(() => {
    (async () => {
      if (gResponse?.type === 'success') {
        try {
          setLinking(l => ({ ...l, google: true }));
          const { id_token } = gResponse.params as any;
          const cred = GoogleAuthProvider.credential(id_token);
          if (!auth.currentUser) throw new Error('No user is signed in.');
          await linkWithCredential(auth.currentUser, cred);
          await auth.currentUser.reload();
          const providers = auth.currentUser.providerData.map(p => p.providerId);
          setHasGoogle(providers.includes('google.com'));
          Alert.alert('Linked', 'Google account linked to your profile.');
        } catch (e: any) {
          const msg = e?.code === 'auth/credential-already-in-use' ? 'This Google account is already linked to another user.' : (e?.message || 'Could not link Google.');
          Alert.alert('Link failed', msg);
        } finally {
          setLinking(l => ({ ...l, google: false }));
        }
      }
    })();
  }, [gResponse]);

  // Handle Facebook link response
  useEffect(() => {
    (async () => {
      if (fbResponse?.type === 'success') {
        try {
          setLinking(l => ({ ...l, facebook: true }));
          const { access_token } = fbResponse.params as any;
          const cred = FacebookAuthProvider.credential(access_token);
          if (!auth.currentUser) throw new Error('No user is signed in.');
          await linkWithCredential(auth.currentUser, cred);
          await auth.currentUser.reload();
          const providers = auth.currentUser.providerData.map(p => p.providerId);
          setHasFacebook(providers.includes('facebook.com'));
          Alert.alert('Linked', 'Facebook account linked to your profile.');
        } catch (e: any) {
          const msg = e?.code === 'auth/credential-already-in-use' ? 'This Facebook account is already linked to another user.' : (e?.message || 'Could not link Facebook.');
          Alert.alert('Link failed', msg);
        } finally {
          setLinking(l => ({ ...l, facebook: false }));
        }
      }
    })();
  }, [fbResponse]);

  const startLinkGoogle = async () => {
    try {
      if (!auth.currentUser) return Alert.alert('Not signed in', 'Sign in first.');
      await gPromptAsync();
    } catch (e: any) {
      Alert.alert('Google link failed', e?.message || 'Could not start Google linking.');
    }
  };

  const startLinkFacebook = async () => {
    try {
      if (!auth.currentUser) return Alert.alert('Not signed in', 'Sign in first.');
      await fbPromptAsync();
    } catch (e: any) {
      Alert.alert('Facebook link failed', e?.message || 'Could not start Facebook linking.');
    }
  };

  const startLinkApple = async () => {
    try {
      if (Platform.OS !== 'ios') return;
      if (!auth.currentUser) return Alert.alert('Not signed in', 'Sign in first.');
      setLinking(l => ({ ...l, apple: true }));
      const rawNonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const res = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!res.identityToken) throw new Error('No identity token from Apple.');
      const provider = new OAuthProvider('apple.com');
      const cred = provider.credential({ idToken: res.identityToken, rawNonce });
      await linkWithCredential(auth.currentUser, cred);
      await auth.currentUser.reload();
      const providers = auth.currentUser.providerData.map(p => p.providerId);
      setHasApple(providers.includes('apple.com'));
      Alert.alert('Linked', 'Apple ID linked to your profile.');
    } catch (e: any) {
      if (e?.code === 'ERR_CANCELED') return;
      const msg = e?.code === 'auth/credential-already-in-use' ? 'This Apple ID is already linked to another user.' : (e?.message || 'Could not link Apple ID.');
      Alert.alert('Link failed', msg);
    } finally {
      setLinking(l => ({ ...l, apple: false }));
    }
  };

  const openPasswordLinkModal = () => {
    if (!auth.currentUser?.email) {
      Alert.alert('No email on account', 'We need an email to set up an email/password login.');
      return;
    }
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordModalVisible(true);
  };

  const submitPasswordLink = async () => {
    try {
      if (!auth.currentUser?.email) return;
      if (newPassword.length < 8) {
        Alert.alert('Weak password', 'Use at least 8 characters.');
        return;
      }
      if (newPassword !== confirmNewPassword) {
        Alert.alert('Password mismatch', 'Passwords do not match.');
        return;
      }
      setLinking(l => ({ ...l, password: true }));
      const cred = EmailAuthProvider.credential(auth.currentUser.email, newPassword);
      await linkWithCredential(auth.currentUser, cred);
      await auth.currentUser.reload();
      const providers = auth.currentUser.providerData.map(p => p.providerId);
      setHasPassword(providers.includes('password'));
      setPasswordModalVisible(false);
      Alert.alert('Linked', 'Email & password sign-in has been set.');
    } catch (e: any) {
      const msg = e?.message || 'Could not link email/password.';
      Alert.alert('Link failed', msg);
    } finally {
      setLinking(l => ({ ...l, password: false }));
    }
  };

  // Save discovery range to storage
  const saveDiscoveryRange = async (range: number) => {
    try {
      await AsyncStorage.setItem('discoveryRange', range.toString());
      setDiscoveryRange(range);
    } catch (error) {
      console.error('Failed to save discovery range:', error);
    }
  };

  const handleSignOut = async () => {
    try {
      await removeSavedTokenAndUnregister().catch(() => {});
      await auth.signOut();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      setConfirmSignOutVisible(false);
    }
  };

  const handleEditProfile = async () => {
    // Fetch current user profile data from profiles collection (same as ProfileScreen)
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) return;
      
      const profileDoc = await getDoc(doc(db, 'profiles', userId));
      const profileData = profileDoc.exists() ? { ...profileDoc.data(), uid: userId } : null;
      
      navigation.navigate('CreateProfile', { mode: 'edit', profileData } as any);
    } catch (error) {
      console.error('Failed to fetch profile:', error);
      // Navigate anyway to let CreateProfile handle it
      navigation.navigate('CreateProfile', { mode: 'edit', profileData: null } as any);
    }
  };

  const handleContactSupport = () => {
    const email = 'sportspalapplication@gmail.com';
    const subject = 'SportsPal Support Request';
    const body = `Hi SportsPal Team,\n\n[Please describe your issue or question here]\n\n---\nApp Version: ${Constants.expoConfig?.version ?? 'Unknown'}\nPlatform: ${Platform.OS}`;
    
    const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open email client. Please email us at sportspalapplication@gmail.com');
    });
  };

  const handleRateApp = () => {
    const storeUrl = Platform.select({
      ios: 'https://apps.apple.com/app/id6747342752?action=write-review', // Opens directly to write review
      android: 'https://play.google.com/store/apps/details?id=com.sportspal.app', // Android package name
    });

    if (storeUrl) {
      Linking.openURL(storeUrl).catch(() => {
        Alert.alert('Error', 'Could not open store. Please search for SportsPal in your app store.');
      });
    }
  };

  const handleCheckForUpdates = async () => {
    // Only works in production builds, not in development
    if (__DEV__) {
      Alert.alert('Development Mode', 'Update checks only work in production builds from EAS.');
      return;
    }

    try {
      setIsCheckingUpdate(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        setUpdateAvailable(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Update Available! 🎉',
          'A new version of SportsPal is ready to download.',
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Download Now',
              onPress: handleDownloadUpdate,
            },
          ]
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('You\'re Up to Date! ✅', 'You\'re using the latest version of SportsPal.');
        setUpdateAvailable(false);
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      Alert.alert('Error', 'Could not check for updates. Please try again later.');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      setIsDownloadingUpdate(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      await Updates.fetchUpdateAsync();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Update Downloaded! 🚀',
        'The update has been downloaded. The app will restart to apply the changes.',
        [
          {
            text: 'Restart Now',
            onPress: async () => {
              await Updates.reloadAsync();
            },
          },
        ]
      );
    } catch (error) {
      console.error('Error downloading update:', error);
      Alert.alert('Error', 'Could not download the update. Please try again later.');
    } finally {
      setIsDownloadingUpdate(false);
    }
  };

  const handleLocationPermissions = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  const handleDeleteAccount = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    
    Alert.alert(
      '😢 Delete Account?',
      'We\'re sorry to see you go!\n\nDeleting your account will:\n\n• Permanently remove your profile\n• Delete all your activities\n• Remove you from all chats\n• Erase all your data\n\nThis action CANNOT be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
        },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setDeleteModalVisible(true);
          },
        },
      ]
    );
  };

  const confirmDeleteAccount = async () => {
    if (deleteConfirmText.toLowerCase() !== 'delete') {
      Alert.alert('Incorrect Confirmation', 'Please type DELETE to confirm.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setIsDeleting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      const deleteAccountFunction = httpsCallable(functions, 'deleteAccount');
      await deleteAccountFunction();
      
      // Success - account deleted
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Account Deleted',
        'Your account and all data have been permanently deleted. Thank you for using SportsPal.',
        [
          {
            text: 'OK',
            onPress: () => {
              setDeleteModalVisible(false);
              // User is now signed out automatically by Firebase
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            },
          },
        ],
        { cancelable: false }
      );
    } catch (error: any) {
      console.error('Delete account error:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Deletion Failed',
        error.message || 'Failed to delete account. Please try again or contact support.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsDeleting(false);
      setDeleteConfirmText('');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header with back button */}
      <View style={styles.headerContainer}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={26} color={theme.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {/* ACCOUNT */}
        <Section title="Account">
          <Row
            icon="person-circle-outline"
            label="Edit Profile"
            sub="Name, photo, bio"
            onPress={handleEditProfile}
          />
          <Row
            icon="link-outline"
            label="Linked Accounts"
            sub="Manage your sign-in methods"
            rightIcon="chevron-forward"
            onPress={() => setLinkedAccountsVisible(true)}
          />
          <RowDanger
            icon="trash-outline"
            label="Delete Account"
            onPress={handleDeleteAccount}
          />
          <RowDanger
            icon="exit-outline"
            label="Sign out of SportsPal"
            onPress={() => setConfirmSignOutVisible(true)}
          />
        </Section>

        {/* DISCOVERY */}
        <Section title="Discovery">
          <Row
            icon="compass-outline"
            label="Discovery Range"
            sub={`Find activities within ${discoveryRange} km`}
            rightText={`${discoveryRange} km`}
            onPress={() => setRangeModalVisible(true)}
          />
          <Row
            icon="location-outline"
            label="Location Permissions"
            sub="Manage in system settings"
            rightIcon="chevron-forward"
            onPress={handleLocationPermissions}
          />
        </Section>

        {/* NOTIFICATIONS */}
        <Section title="Notifications">
          <RowSwitch
            icon="notifications-outline"
            label="Push notifications"
            sub="Enable/disable all notifications"
            value={pushEnabled}
            onValueChange={setPushEnabled}
          />
        </Section>

        {/* PRIVACY */}
        <Section title="Privacy & Safety">
          <Row
            icon="ban-outline"
            label="Blocked users"
            sub="Manage your block list"
            rightIcon="chevron-forward"
            onPress={() => navigation.navigate('BlockedUsers' as any)}
          />
        </Section>

        {/* APPEARANCE */}
        <Section title="Appearance">
          <Row
            icon={themeModeIcon as any}
            label="Theme"
            sub="Choose Light or Dark"
            rightText={themeModeLabel}
            onPress={() => setThemeModalVisible(true)}
          />
        </Section>

        {/* SUPPORT */}
        <Section title="Support">
          <Row
            icon="card-outline"
            label="Apple Wallet Pass"
            sub="Add or update your SportsPal pass"
            rightIcon="chevron-forward"
            onPress={() => navigation.navigate('SportsPalPass')}
          />
          <Row icon="mail-open-outline" label="Contact support" onPress={handleContactSupport} />
          <Row icon="star-outline" label="Rate us" onPress={handleRateApp} />
          <Row 
            icon={updateAvailable ? "download-outline" : "refresh-outline"} 
            label={isCheckingUpdate ? "Checking for updates..." : updateAvailable ? "Update Available" : "Check for updates"}
            sub={updateAvailable ? "Tap to download and install" : "See if there's a new version"}
            onPress={updateAvailable ? handleDownloadUpdate : handleCheckForUpdates}
            loading={isCheckingUpdate || isDownloadingUpdate}
          />
        </Section>

        {/* ABOUT */}
        <Section title="About">
          <Row
            icon="information-circle-outline"
            label="Version"
            rightText={Constants.expoConfig?.version ?? '1.0.0'}
            disabled
          />
          <Row 
            label="Terms of Service" 
            icon="document-text-outline" 
            onPress={() => setTermsModalVisible(true)} 
          />
          <Row 
            label="Privacy Policy" 
            icon="shield-checkmark-outline" 
            onPress={() => setPrivacyModalVisible(true)} 
          />
          <Row 
            label="Community Guidelines" 
            icon="people-outline" 
            onPress={() => setCommunityModalVisible(true)} 
          />
        </Section>

        {/* LEGAL & POLICIES */}
        <Section title="Legal & Policies">
          <Row 
            label="Legal & Policies" 
            icon="document-text-outline" 
            sub="View all legal documents"
            rightIcon={legalPoliciesExpanded ? "chevron-up" : "chevron-down"}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setLegalPoliciesExpanded(!legalPoliciesExpanded);
            }}
          />
          {legalPoliciesExpanded && (
            <>
              <Row 
                label="Community Guidelines" 
                icon="people-outline" 
                sub="Rules and moderation"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'community-guidelines' })} 
              />
              <Row 
                label="Safety Guidelines" 
                icon="shield-checkmark-outline" 
                sub="Meetup and sports safety"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'safety-guidelines' })} 
              />
              <Row 
                label="Intellectual Property" 
                icon="document-lock-outline" 
                sub="Copyright & DMCA"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'ip-policy' })} 
              />
              <Row 
                label="Tracking & SDKs" 
                icon="analytics-outline" 
                sub="Data collection notice"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'tracking-notice' })} 
              />
              <Row 
                label="Reports & Appeals" 
                icon="flag-outline" 
                sub="How to report and appeal"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'reports-appeals' })} 
              />
              <Row 
                label="Open-Source Licenses" 
                icon="code-slash-outline" 
                sub="Third-party software"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'open-source' })} 
              />
              <Row 
                label="Law Enforcement Guidelines" 
                icon="shield-outline" 
                sub="Data request policy"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'law-enforcement' })} 
              />
              <Row 
                label="Accessibility" 
                icon="accessibility-outline" 
                sub="WCAG 2.1 AA commitment"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'accessibility' })} 
              />
              <Row 
                label="Security & Vulnerabilities" 
                icon="lock-closed-outline" 
                sub="Responsible disclosure"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'security' })} 
              />
              <Row 
                label="Event Host Rules" 
                icon="calendar-outline" 
                sub="Guidelines for organizers"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'event-host-rules' })} 
              />
              <Row 
                label="No-Show & Cancellation" 
                icon="close-circle-outline" 
                sub="Attendance policy"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'no-show-policy' })} 
              />
              <Row 
                label="Age & Minor Safety" 
                icon="warning-outline" 
                sub="Child protection policy"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'age-safety' })} 
              />
              <Row 
                label="AI & Moderation" 
                icon="hardware-chip-outline" 
                sub="Automated systems"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'ai-moderation' })} 
              />
              <Row 
                label="Subscriptions & Refunds" 
                icon="card-outline" 
                sub="Billing and payments"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'subscriptions' })} 
              />
              <Row 
                label="Advertising Policy" 
                icon="megaphone-outline" 
                sub="Branded content rules"
                onPress={() => navigation.navigate('LegalDocument', { documentId: 'advertising' })} 
              />
            </>
          )}
        </Section>
      </ScrollView>

      {/* Confirm Sign Out Modal */}
      <Modal
        transparent
        visible={confirmSignOutVisible}
        onRequestClose={() => setConfirmSignOutVisible(false)}
        animationType="fade"
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setConfirmSignOutVisible(false)}>
          <Pressable style={styles.modalCard}>
            <Ionicons name="exit-outline" size={28} color={theme.danger} style={{ marginBottom: 6 }} />
            <Text style={styles.modalTitle}>Sign out?</Text>
            <Text style={styles.modalText}>You can sign back in anytime.</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setConfirmSignOutVisible(false)}>
                <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalDanger]} onPress={handleSignOut}>
                <Text style={[styles.modalBtnText, { color: '#111' }]}>Sign out</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete Account Confirmation Modal */}
      <Modal
        transparent
        visible={deleteModalVisible}
        onRequestClose={() => {
          if (!isDeleting) {
            setDeleteModalVisible(false);
            setDeleteConfirmText('');
          }
        }}
        animationType="fade"
      >
        <Pressable 
          style={styles.modalBackdrop} 
          onPress={() => {
            if (!isDeleting) {
              setDeleteModalVisible(false);
              setDeleteConfirmText('');
            }
          }}
        >
          <Pressable style={[styles.modalCard, { minWidth: 320, paddingHorizontal: 24 }]}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>😢</Text>
            <Text style={[styles.modalTitle, { color: theme.danger }]}>Final Confirmation</Text>
            <Text style={[styles.modalText, { marginBottom: 20, textAlign: 'center' }]}>
              Type <Text style={{ fontWeight: '700', color: theme.danger }}>DELETE</Text> below to permanently delete your account.
            </Text>
            
            <TextInput
              style={{
                backgroundColor: theme.card,
                color: theme.text,
                borderColor: theme.border,
                borderWidth: 1,
                borderRadius: 12,
                padding: 12,
                fontSize: 16,
                marginBottom: 20,
                textAlign: 'center',
                fontWeight: '600',
              }}
              placeholder="Type DELETE"
              placeholderTextColor={theme.muted}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!isDeleting}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalCancel, { opacity: isDeleting ? 0.5 : 1 }]} 
                onPress={() => {
                  if (!isDeleting) {
                    setDeleteModalVisible(false);
                    setDeleteConfirmText('');
                  }
                }}
                disabled={isDeleting}
              >
                <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[
                  styles.modalBtn, 
                  styles.modalDanger,
                  { opacity: (isDeleting || deleteConfirmText.toLowerCase() !== 'delete') ? 0.5 : 1 }
                ]} 
                onPress={confirmDeleteAccount}
                disabled={isDeleting || deleteConfirmText.toLowerCase() !== 'delete'}
              >
                {isDeleting ? (
                  <Text style={[styles.modalBtnText, { color: '#fff' }]}>Deleting...</Text>
                ) : (
                  <Text style={[styles.modalBtnText, { color: '#fff' }]}>Delete Forever</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Theme Picker Modal */}
      <Modal transparent visible={themeModalVisible} onRequestClose={() => setThemeModalVisible(false)} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setThemeModalVisible(false)}>
          <Pressable style={styles.modalCard}>
            <Ionicons name="color-palette-outline" size={26} color={theme.primary} style={{ marginBottom: 8 }} />
            <Text style={styles.modalTitle}>Theme</Text>
            <Text style={styles.modalText}>Choose how SportsPal looks</Text>
            <View style={{ width: '100%', gap: 10 }}>
              <ThemeOption 
                icon="sunny" 
                label="Light" 
                selected={themeMode === 'light'} 
                onPress={() => { 
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setThemeMode('light'); 
                  setThemeModalVisible(false); 
                }} 
              />
              <ThemeOption 
                icon="moon" 
                label="Dark" 
                selected={themeMode === 'dark'} 
                onPress={() => { 
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setThemeMode('dark'); 
                  setThemeModalVisible(false); 
                }} 
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Discovery Range Modal */}
      <Modal transparent visible={rangeModalVisible} onRequestClose={() => setRangeModalVisible(false)} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setRangeModalVisible(false)}>
          <Pressable style={[styles.modalCard, { paddingVertical: 24, width: '90%' }]}>
            <Ionicons name="compass-outline" size={26} color={theme.primary} style={{ marginBottom: 8 }} />
            <Text style={styles.modalTitle}>Discovery Range</Text>
            <Text style={styles.modalText}>How far to search for activities</Text>
            
            <View style={{ width: '100%', paddingHorizontal: 20, marginTop: 20, marginBottom: 20 }}>
              <Text style={[styles.rangeValue, { color: theme.primary, textAlign: 'center', marginBottom: 24 }]}>
                {discoveryRange} km
              </Text>
              
              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={5}
                maximumValue={150}
                step={5}
                value={discoveryRange}
                onValueChange={(value) => {
                  setDiscoveryRange(Math.round(value));
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                minimumTrackTintColor={theme.primary}
                maximumTrackTintColor={theme.border}
                thumbTintColor={theme.primary}
              />
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ color: theme.muted, fontSize: 12 }}>5 km</Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>150 km</Text>
              </View>
            </View>

            <View style={{ width: '100%', flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity 
                style={[
                  styles.modalBtn, 
                  { 
                    backgroundColor: theme.border, 
                    flex: 1,
                  }
                ]} 
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDiscoveryRange(70);
                }}
              >
                <Text style={[styles.modalBtnText, { color: theme.text }]}>Reset to Default</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[
                  styles.modalBtn, 
                  { 
                    backgroundColor: theme.primary, 
                    flex: 1,
                  }
                ]} 
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  saveDiscoveryRange(discoveryRange);
                  setRangeModalVisible(false);
                }}
              >
                <Text style={[styles.modalBtnText, { color: theme.isDark ? '#111' : '#fff' }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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
            <View style={{ width: '100%', flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity 
                style={[
                  styles.modalBtn, 
                  { 
                    backgroundColor: theme.border,
                    flex: 1,
                  }
                ]} 
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  Linking.openURL('https://sportspal-1b468.web.app/terms.html').catch(() => {
                    Alert.alert('Error', 'Could not open browser');
                  });
                }}
              >
                <Ionicons name="open-outline" size={16} color={theme.text} style={{ marginRight: 6 }} />
                <Text style={[styles.modalBtnText, { color: theme.text }]}>View in Browser</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[
                  styles.modalBtn, 
                  { 
                    backgroundColor: theme.primary, 
                    flex: 1,
                  }
                ]} 
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setTermsModalVisible(false);
                }}
              >
                <Text style={[styles.modalBtnText, { color: theme.isDark ? '#111' : '#fff' }]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Privacy Policy Modal */}
      <Modal transparent visible={privacyModalVisible} onRequestClose={() => setPrivacyModalVisible(false)} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '80%', width: '90%' }]}>
            <Ionicons name="shield-checkmark-outline" size={26} color={theme.primary} style={{ marginBottom: 8 }} />
            <Text style={styles.modalTitle}>Privacy Policy</Text>
            <ScrollView style={{ width: '100%', marginTop: 16 }} showsVerticalScrollIndicator={true}>
              <Text style={styles.legalText}>
                <Text style={{ fontWeight: 'bold', fontSize: 14 }}>Last Updated: November 2025{'\n\n'}</Text>
                
                <Text style={{ fontWeight: '600' }}>Who we are.</Text> SportsPal ("SportsPal," "we," "us," "our") provides a platform to discover, join, and organize sports activities and chat with other users. Contact: sportspalapplication@gmail.com{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>Important:</Text> This Privacy Policy explains how we collect, use, disclose, and protect your information. Some countries give you non-waivable rights. Nothing here limits those.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>Quick Summary (plain language){'\n\n'}</Text>
                We collect: the info you provide (profile, messages, photos), device/usage data, optional location, and data from sign-in providers.{'\n\n'}
                We use data to run SportsPal (profiles, discovery, activities, messaging), keep users safe (moderation, anti-abuse), and improve performance/analytics.{'\n\n'}
                Profiles and activity participation are visible to others; your exact real-time location is not publicly posted without your action (we use approximate distances for discovery).{'\n\n'}
                We do not sell your data and do not share it for cross-context behavioral advertising under California law.{'\n\n'}
                You control permissions (location, camera, notifications), and you can access, export, correct, or delete your data.{'\n\n'}
                Messages are not end-to-end encrypted; we may review content for safety and to enforce rules.{'\n\n'}
                Data may be processed outside your country with lawful transfer safeguards.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>1) Scope and Definitions{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Service:</Text> SportsPal mobile apps, sites, APIs, and related features.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Personal data / personal information:</Text> Information that identifies or can reasonably identify you.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Sensitive data:</Text> Categories defined by law (e.g., precise location, government IDs, financial data, health info, sexual life). We do not require you to provide sensitive data; do not include it in your profile or chats.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Controller:</Text> SportsPal acts as controller for your data when you use the Service.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>2) Information We Collect{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>A. Information you provide{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Account & Profile:</Text> name/username, email, password (hashed), bio, interests, favorite sports, profile photo/video, pronouns (optional).{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Content:</Text> messages, photos/videos, activity titles/descriptions, comments, reactions, reports, and any attachments you upload.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Preferences:</Text> discovery radius, visibility, notifications, language, theme.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Support & Verification:</Text> inquiries, appeals, safety reports; if we request, limited ID info to verify identity for safety workflows (optional, where lawful).{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>B. Information collected automatically{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Location (optional):</Text> approximate or precise location if you grant permission (to power discovery, distance, and safety/anti-abuse).{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Device & diagnostics:</Text> device model, OS, app version, language, performance metrics, crash logs.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Identifiers:</Text> device/app identifiers, push token, IP address (security, geofencing, anti-abuse).{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Usage data:</Text> feature use, screens viewed, timestamps, referrers/UTM.{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>C. Information from others{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Sign-in providers:</Text> Apple, Google, or others you choose (e.g., name, email, auth token).{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Payments (if/when offered):</Text> limited billing metadata from processors (we do not store full card numbers).{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Safety/anti-abuse services:</Text> results from spam/fraud detection, block lists.{'\n\n'}
                We do not intentionally collect special category/sensitive data. Do not post it.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>3) How We Use Information (Purposes & Legal Bases){'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Service delivery & core features</Text> (accounts, profiles, discovery, activities, chat, notifications).{'\n'}
                Legal bases: Contract; Legitimate interests (smooth, safe service).{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>Safety, integrity, and moderation</Text> (detecting fraud/spam/abuse; processing reports; enforcing rules; protecting users).{'\n'}
                Legal bases: Legitimate interests; Legal obligation; Vital interests (in emergencies).{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>Location features</Text> (showing nearby activities/people; distance estimates; combating spam via geosignals).{'\n'}
                Legal bases: Contract; Consent (where required); Legitimate interests.{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>Analytics & performance</Text> (improve reliability, speed, UX; troubleshoot).{'\n'}
                Legal bases: Legitimate interests; Consent where required (e.g., in the EEA for certain analytics SDKs).{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>Communications</Text> (transactional and safety notifications; optional marketing with consent or as permitted by law).{'\n'}
                Legal bases: Contract; Legitimate interests; Consent (marketing where required).{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>Compliance & defense</Text> (legal obligations, tax/accounting, responding to lawful requests, defending legal claims).{'\n'}
                Legal bases: Legal obligation; Legitimate interests.{'\n\n'}
                
                We do not use automated decision-making that produces legal or similarly significant effects without human involvement. We use ranking/matching signals and safety heuristics to prioritize relevant results and detect abuse.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>4) Location Data{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Choice:</Text> You can grant/deny location permission in system settings at any time.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Use:</Text> discovery, distance, safety/anti-abuse, basic analytics.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Display:</Text> We generally show approximate distance, not your exact coordinates.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Accuracy:</Text> GPS and network signals can be inaccurate; do not rely on the app for safety-critical navigation.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>5) Messaging, Media, and Moderation{'\n\n'}</Text>
                Messages are not end-to-end encrypted.{'\n\n'}
                We may scan, review, or analyze content (including messages and metadata) using automated tools and/or human review to:{'\n\n'}
                • enforce our Community Rules and Terms;{'\n'}
                • detect spam/fraud/malware;{'\n'}
                • respond to user reports and legal requests.{'\n\n'}
                Do not share information you consider highly confidential.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>6) Sharing and Disclosures{'\n\n'}</Text>
                We do not sell personal information and do not share it for cross-context behavioral advertising under California law.{'\n\n'}
                We share the minimum necessary with:{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Other users:</Text> your public profile and content (e.g., activity participation, profile photo, username, sports). Messages are visible to chat participants.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Service providers (processors):</Text> hosting, databases, storage/CDN, push notifications, analytics/crash reporting, moderation/anti-abuse, email, build/OTA update services—each bound by contracts to process data only for us.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Change of control:</Text> in a merger, acquisition, or asset transfer, your data may transfer under this policy's protections.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Legal/safety:</Text> to comply with law or protect the rights, property, or safety of SportsPal, our users, or the public (e.g., valid court orders, emergency threats).{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>7) International Data Transfers{'\n\n'}</Text>
                Your information may be processed in countries other than your own. Where we transfer personal data from the EEA/UK, we rely on lawful transfer mechanisms (e.g., EU Standard Contractual Clauses and UK addendum) and apply appropriate safeguards.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>8) Retention{'\n\n'}</Text>
                We keep data only as long as necessary for the purposes above, including security/fraud prevention and legal compliance, then delete or anonymize it.{'\n\n'}
                Typical periods (subject to change for safety/legal holds):{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Account & profile:</Text> while your account is active and up to 24 months after deletion (to allow recovery and defend against abuse/fraud).{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Messages & activities:</Text> while your account is active; selected records may persist longer for safety/legal reasons.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Logs/diagnostics:</Text> 12–24 months.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Reports & enforcement:</Text> retained as long as necessary to protect users and comply with law.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>9) Your Choices & Controls{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Permissions:</Text> manage location, camera, photos, microphone, and notifications in device settings.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Discovery & visibility:</Text> adjust profile visibility and discovery radius.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Marketing:</Text> opt out in-app or via "unsubscribe."{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Blocking & reports:</Text> block users and report content anytime.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Data requests:</Text> access/export, correct, or delete your data by emailing sportspalapplication@gmail.com from your account email. We may verify identity before acting.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>10) Your Rights by Region{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>EEA & UK (GDPR/UK-GDPR){'\n\n'}</Text>
                You have the right to access, correct, delete, restrict, object, and data portability; to withdraw consent (doesn't affect prior processing); and to lodge a complaint with your data protection authority (e.g., Hellenic DPA in Greece, ICO in the UK).{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>U.S. States (e.g., CA/CPRA, CO, CT, VA, UT){'\n\n'}</Text>
                You may have rights to know/access, correct, delete, and port personal information, and to opt out of targeted advertising, sale, and certain profiling. We do not "sell" personal information and do not "share" it for cross-context behavioral advertising. You may authorize an agent to make requests. We will verify requests.{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>Brazil (LGPD){'\n\n'}</Text>
                You may request confirmation of processing, access, correction, anonymization, portability, deletion, and information about sharing; and to revoke consent.{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>India (DPDP Act, 2023){'\n\n'}</Text>
                You have rights to access/correct, erase, grievance redressal, and to nominate another individual in case of incapacity. We provide notices in clear language and honor lawful requests.{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>How to exercise rights (all regions):</Text> Email sportspalapplication@gmail.com. We'll respond within the timelines required by law and may request verification.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>11) Children's Privacy{'\n\n'}</Text>
                SportsPal is not intended for users under 16 in the EEA/UK (or the age required by your country) and under 13 elsewhere. We do not knowingly collect data from children. If you believe a child is using SportsPal, contact us; we will take appropriate action.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>12) Security{'\n\n'}</Text>
                We use administrative, technical, and organizational safeguards (encryption in transit, access controls, least-privilege, monitoring). No system is 100% secure. Protect your account with a strong, unique password and secure your devices.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Incident response:</Text> We assess and respond to suspected breaches and will notify you and/or regulators as required by law.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>13) Cookies, SDKs, and Similar Technologies{'\n\n'}</Text>
                We do not use traditional browser cookies inside the mobile app, but we use SDKs and similar technologies for authentication, analytics/crash reporting, performance metrics, push notifications, moderation/anti-abuse, and build/OTA updates. Where required (e.g., EEA), we request consent or offer opt-outs.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>14) Third-Party Services and Links{'\n\n'}</Text>
                The Service may link to or integrate third-party services (e.g., sign-in providers, maps, app stores). Their privacy practices are governed by their own policies. Use them at your discretion.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>15) Law Enforcement and Legal Requests{'\n\n'}</Text>
                We review legal requests to ensure they are valid and appropriately scoped. We may preserve or disclose information if we believe it's necessary to comply with law, court orders, or to protect users, our rights, or the public. We may notify affected users where lawful and feasible.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>16) Do Not Track; Global Privacy Controls{'\n\n'}</Text>
                Some browsers send "Do Not Track" or GPC signals. We do not respond to DNT signals at this time. We honor legally recognized opt-out signals where required by law.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>17) Changes to This Policy{'\n\n'}</Text>
                We may update this Policy as our practices evolve. We will post the updated version with a new "Last Updated" date and, where appropriate, provide additional notice. Continued use of the Service means you accept the updated Policy.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>18) Contact Us{'\n\n'}</Text>
                Questions or requests about privacy?{'\n'}
                Email: sportspalapplication@gmail.com{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>19) Regional Annexes{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>A) California "Notice at Collection"{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Categories collected:</Text> identifiers (account, device, IP), geolocation (if permitted), internet activity/usage, profile and UGC (photos, messages, activities), inferences for discovery/safety, diagnostics.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Purposes:</Text> provide and secure the Service; discovery/matching; communications; analytics/performance; compliance.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Sources:</Text> you, your devices, sign-in providers, anti-abuse partners.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Retention:</Text> see Section 8.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Sale/Share:</Text> We do not sell personal information and do not share it for cross-context behavioral advertising.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Rights & how to exercise:</Text> see Section 10.{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>B) EEA/UK Controller; Transfers{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Controller:</Text> SportsPal (contact above).{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Transfers:</Text> EU SCCs/UK addendum and safeguards as per Section 7.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Complaints:</Text> contact your local DPA (e.g., Hellenic DPA, ICO).{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Representative/DPO (if appointed):</Text> We will update this Policy with representative or DPO details when designated.{'\n\n'}
                
                <Text style={{ fontWeight: '600' }}>C) India{'\n\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Data fiduciary:</Text> SportsPal (contact above).{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Grievance redressal:</Text> same contact.{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Nominated person:</Text> You can nominate an individual to exercise your rights on your behalf under the DPDP Act.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>20) Processors & SDKs (Categories, not exhaustive){'\n\n'}</Text>
                For transparency, we use service providers for:{'\n\n'}
                • Hosting & databases/CDN (store profiles, activities, media).{'\n'}
                • Authentication & sign-in (Apple/Google sign-in you select).{'\n'}
                • Push notifications (deliver activity/chat updates).{'\n'}
                • Crash reporting & performance analytics (app stability).{'\n'}
                • Build and over-the-air updates (app delivery and updates).{'\n'}
                • Moderation/anti-abuse (spam/fraud detection, content safety).{'\n\n'}
                We bind processors to confidentiality and data-protection obligations. A detailed vendor list is available upon request and will be updated as our stack evolves.
              </Text>
            </ScrollView>
            <View style={{ width: '100%', flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity 
                style={[
                  styles.modalBtn, 
                  { 
                    backgroundColor: theme.border,
                    flex: 1,
                  }
                ]} 
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  Linking.openURL('https://sportspal-1b468.web.app/privacy.html').catch(() => {
                    Alert.alert('Error', 'Could not open browser');
                  });
                }}
              >
                <Ionicons name="open-outline" size={16} color={theme.text} style={{ marginRight: 6 }} />
                <Text style={[styles.modalBtnText, { color: theme.text }]}>View in Browser</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[
                  styles.modalBtn, 
                  { 
                    backgroundColor: theme.primary, 
                    flex: 1,
                  }
                ]} 
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setPrivacyModalVisible(false);
                }}
              >
                <Text style={[styles.modalBtnText, { color: theme.isDark ? '#111' : '#fff' }]}>Close</Text>
              </TouchableOpacity>
            </View>
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
            <View style={{ width: '100%', flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity 
                style={[
                  styles.modalBtn, 
                  { 
                    backgroundColor: theme.border,
                    flex: 1,
                  }
                ]} 
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  Linking.openURL('https://sportspal-1b468.web.app/community-guidelines.html').catch(() => {
                    Alert.alert('Error', 'Could not open browser');
                  });
                }}
              >
                <Ionicons name="open-outline" size={16} color={theme.text} style={{ marginRight: 6 }} />
                <Text style={[styles.modalBtnText, { color: theme.text }]}>View in Browser</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[
                  styles.modalBtn, 
                  { 
                    backgroundColor: theme.primary, 
                    flex: 1,
                  }
                ]} 
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setCommunityModalVisible(false);
                }}
              >
                <Text style={[styles.modalBtnText, { color: theme.isDark ? '#111' : '#fff' }]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Linked Accounts Modal */}
      <Modal transparent visible={linkedAccountsVisible} onRequestClose={() => setLinkedAccountsVisible(false)} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setLinkedAccountsVisible(false)}>
          <Pressable style={[styles.modalCard, { width: '90%', paddingVertical: 24 }]}>
            <Ionicons name="link-outline" size={26} color={theme.primary} style={{ marginBottom: 8 }} />
            <Text style={styles.modalTitle}>Linked Accounts</Text>
            <Text style={styles.modalText}>Manage your sign-in methods</Text>
            
            <View style={{ width: '100%', marginTop: 16, gap: 12 }}>
              {/* Google */}
              <View style={styles.linkedAccountRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Ionicons name="logo-google" size={24} color={hasGoogle ? theme.primary : theme.muted} style={{ marginRight: 12 }} />
                  <View>
                    <Text style={[styles.linkedAccountLabel, { color: hasGoogle ? theme.text : theme.muted }]}>Google</Text>
                    <Text style={styles.linkedAccountStatus}>{hasGoogle ? 'Connected' : 'Not connected'}</Text>
                  </View>
                </View>
                {hasGoogle ? (
                  <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
                ) : (
                  <TouchableOpacity onPress={startLinkGoogle} disabled={linking.google} style={[styles.rangeButton, { borderColor: theme.primary }]}>
                    <Text style={[styles.rangeButtonText, { color: theme.primary }]}>{linking.google ? 'Linking…' : 'Link'}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Facebook */}
              <View style={styles.linkedAccountRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Ionicons name="logo-facebook" size={24} color={hasFacebook ? theme.primary : theme.muted} style={{ marginRight: 12 }} />
                  <View>
                    <Text style={[styles.linkedAccountLabel, { color: hasFacebook ? theme.text : theme.muted }]}>Facebook</Text>
                    <Text style={styles.linkedAccountStatus}>{hasFacebook ? 'Connected' : 'Not connected'}</Text>
                  </View>
                </View>
                {hasFacebook ? (
                  <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
                ) : (
                  <TouchableOpacity onPress={startLinkFacebook} disabled={linking.facebook} style={[styles.rangeButton, { borderColor: theme.primary }]}>
                    <Text style={[styles.rangeButtonText, { color: theme.primary }]}>{linking.facebook ? 'Linking…' : 'Link'}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Apple */}
              {Platform.OS === 'ios' && (
                <View style={styles.linkedAccountRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <Ionicons name="logo-apple" size={24} color={hasApple ? theme.primary : theme.muted} style={{ marginRight: 12 }} />
                    <View>
                      <Text style={[styles.linkedAccountLabel, { color: hasApple ? theme.text : theme.muted }]}>Apple</Text>
                      <Text style={styles.linkedAccountStatus}>{hasApple ? 'Connected' : 'Not connected'}</Text>
                    </View>
                  </View>
                  {hasApple ? (
                    <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
                  ) : (
                    <TouchableOpacity onPress={startLinkApple} disabled={linking.apple} style={[styles.rangeButton, { borderColor: theme.primary }]}>
                      <Text style={[styles.rangeButtonText, { color: theme.primary }]}>{linking.apple ? 'Linking…' : 'Link'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Password */}
              <View style={styles.linkedAccountRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Ionicons name="key-outline" size={24} color={hasPassword ? theme.primary : theme.muted} style={{ marginRight: 12 }} />
                  <View>
                    <Text style={[styles.linkedAccountLabel, { color: hasPassword ? theme.text : theme.muted }]}>Email & Password</Text>
                    <Text style={styles.linkedAccountStatus}>{hasPassword ? 'Set up' : 'Not set up'}</Text>
                  </View>
                </View>
                {hasPassword ? (
                  <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
                ) : (
                  <TouchableOpacity onPress={openPasswordLinkModal} disabled={linking.password} style={[styles.rangeButton, { borderColor: theme.primary }]}>
                    <Text style={[styles.rangeButtonText, { color: theme.primary }]}>{linking.password ? 'Linking…' : 'Set password'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={{ width: '100%', marginTop: 20, paddingHorizontal: 12 }}>
              <Text style={[styles.modalText, { fontSize: 12, marginBottom: 0 }]}>
                Link any account above to your current login so you can sign in with any of them. For Email & Password, set a password to enable sign-in with your email. If you see a message about an account already existing, use that method to sign in first and then link here.
              </Text>
            </View>

            <TouchableOpacity 
              style={[
                styles.modalBtn, 
                { 
                  backgroundColor: theme.primary, 
                  marginTop: 20, 
                  width: '100%',
                  flex: 0,
                }
              ]} 
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setLinkedAccountsVisible(false);
              }}
            >
              <Text style={[styles.modalBtnText, { color: theme.isDark ? '#111' : '#fff' }]}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Password Link Modal */}
      <Modal transparent visible={passwordModalVisible} onRequestClose={() => setPasswordModalVisible(false)} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setPasswordModalVisible(false)}>
          <Pressable style={[styles.modalCard, { width: '90%' }]}
            onStartShouldSetResponder={() => true}
          >
            <Ionicons name="key-outline" size={26} color={theme.primary} style={{ marginBottom: 8 }} />
            <Text style={styles.modalTitle}>Set a password</Text>
            <Text style={styles.modalText}>Create a password to enable email sign-in for your account.</Text>
            <View style={{ width: '100%', gap: 10 }}>
              <Text style={[styles.rowSub, { marginTop: 0 }]}>Password (min 8 characters)</Text>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder="New password"
                placeholderTextColor={theme.muted}
                style={{
                  width: '100%',
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.background,
                }}
              />
              <TextInput
                value={confirmNewPassword}
                onChangeText={setConfirmNewPassword}
                secureTextEntry
                placeholder="Confirm password"
                placeholderTextColor={theme.muted}
                style={{
                  width: '100%',
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.background,
                }}
              />
            </View>
            {/* Simplified actionable buttons */}
            <View style={{ width: '100%', flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setPasswordModalVisible(false)}>
                <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.primary }]} onPress={submitPasswordLink} disabled={linking.password}>
                <Text style={[styles.modalBtnText, { color: theme.isDark ? '#111' : '#fff' }]}>{linking.password ? 'Linking…' : 'Save & Link'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

/* -------------------- Reusable UI -------------------- */

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.card}>{children}</View>
  </View>
);} 

const Row: React.FC<{
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  rightText?: string;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  onPress?: () => void;
}> = ({ icon, label, sub, rightText, rightIcon = 'chevron-forward', disabled, loading, onPress }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
  <TouchableOpacity
    activeOpacity={disabled || loading ? 1 : 0.85}
    style={[styles.row, (disabled || loading) && { opacity: 0.6 }]}
    onPress={disabled || loading ? undefined : onPress}
  >
    <View style={styles.rowLeft}>
      {icon && <Ionicons name={icon} size={22} color={theme.primary} style={{ marginRight: 12 }} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
    </View>
    <View style={styles.rowRight}>
      {rightText ? <Text style={styles.rowRightText}>{rightText}</Text> : null}
      {loading ? (
        <Text style={[styles.rowRightText, { color: theme.primary }]}>...</Text>
      ) : (
        <Ionicons name={rightIcon} size={18} color={theme.muted} />
      )}
    </View>
  </TouchableOpacity>
)};

const RowSwitch: React.FC<{
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}> = ({ icon, label, sub, value, onValueChange }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
  <View style={styles.row}>
    <View style={styles.rowLeft}>
      {icon && <Ionicons name={icon} size={22} color={theme.primary} style={{ marginRight: 12 }} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: theme.border, true: theme.primaryStrong }}
      thumbColor={value ? theme.primary : '#888'}
      ios_backgroundColor={theme.border}
    />
  </View>
)};

const RowDanger: React.FC<{
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
}> = ({ icon = 'alert-circle-outline', label, onPress }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
  <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
    <View style={styles.rowLeft}>
      <Ionicons name={icon} size={22} color={theme.danger} style={{ marginRight: 12 }} />
      <Text style={[styles.rowLabel, { color: theme.danger }]}>{label}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={theme.danger} />
  </TouchableOpacity>
)};

/* -------------------- Styles -------------------- */

const createStyles = (t: ReturnType<typeof useTheme>['theme']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.background,
  },
  headerContainer: {
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
  headerTitle: {
    fontSize: 28,
    color: t.primary,
    fontWeight: 'bold',
    textAlign: 'center',
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    color: t.primary,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 8,
    opacity: 0.96,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: t.card,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: t.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  rowLabel: { color: t.text, fontSize: 16, fontWeight: '600' },
  rowSub: { color: t.muted, fontSize: 12, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowRightText: { color: t.muted, fontSize: 13, marginRight: 4 },

  // Modal
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
  modalTitle: { color: t.text, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  modalText: { color: t.muted, fontSize: 13, textAlign: 'center', marginBottom: 14 },
  modalActions: { flexDirection: 'row', width: '100%', gap: 10 },
  modalBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancel: { backgroundColor: t.border },
  modalDanger: { backgroundColor: t.danger },
  modalBtnText: { fontWeight: '700', fontSize: 15 },

  // Range selector
  rangeValue: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  rangeButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Legal text
  legalText: {
    color: t.text,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 8,
  },

  // Linked Accounts
  linkedAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: t.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
  },
  linkedAccountLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  linkedAccountStatus: {
    fontSize: 12,
    color: t.muted,
    marginTop: 2,
  },
});

const ThemeOption: React.FC<{ 
  icon: keyof typeof Ionicons.glyphMap;
  label: string; 
  selected: boolean; 
  onPress: () => void;
}> = ({ icon, label, selected, onPress }) => {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: selected ? theme.primary : theme.card,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? theme.primaryStrong : theme.border,
      }}
      activeOpacity={0.9}
    >
      <Ionicons 
        name={icon} 
        size={22} 
        color={selected ? (theme.isDark ? '#111' : '#fff') : theme.primary} 
        style={{ marginRight: 12 }}
      />
      <Text style={{ 
        color: selected ? (theme.isDark ? '#111' : '#fff') : theme.text, 
        fontWeight: '700',
        fontSize: 16,
      }}>{label}</Text>
    </TouchableOpacity>
  );
};

export default SettingsScreen;
