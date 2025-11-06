// screens/SettingsScreen.tsx
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Modal,
  Pressable,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
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

type SettingsScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Settings'>;

// Colors now come from theme

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  const { theme, themeMode, setThemeMode } = useTheme();

  // State
  const [pushEnabled, setPushEnabled] = useState(true);
  const [discoveryRange, setDiscoveryRange] = useState(70); // km

  const [confirmSignOutVisible, setConfirmSignOutVisible] = useState(false);
  const [themeModalVisible, setThemeModalVisible] = useState(false);
  const [rangeModalVisible, setRangeModalVisible] = useState(false);
  const [termsModalVisible, setTermsModalVisible] = useState(false);
  const [privacyModalVisible, setPrivacyModalVisible] = useState(false);
  const [linkedAccountsVisible, setLinkedAccountsVisible] = useState(false);

  // Linked accounts state
  const [hasGoogle, setHasGoogle] = useState(false);
  const [hasFacebook, setHasFacebook] = useState(false);
  const [hasApple, setHasApple] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);

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
      ios: 'https://apps.apple.com/app/id123456789', // TODO: Replace with actual App Store ID
      android: 'https://play.google.com/store/apps/details?id=com.sportspal', // TODO: Replace with actual package name
    });

    if (storeUrl) {
      Linking.openURL(storeUrl).catch(() => {
        Alert.alert('Error', 'Could not open store. Please search for SportsPal in your app store.');
      });
    }
  };

  const handleLocationPermissions = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
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

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
            onPress={() => {
              Alert.alert('Coming Soon', 'Blocked users management will be available soon.');
            }}
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
          <Row icon="mail-open-outline" label="Contact support" onPress={handleContactSupport} />
          <Row icon="star-outline" label="Rate us" onPress={handleRateApp} />
        </Section>

        {/* ABOUT */}
        <Section title="About">
          <Row
            icon="information-circle-outline"
            label="Version"
            rightText={Constants.expoConfig?.version ?? '1.0.0'}
            disabled
          />
          <Row label="Terms of Service" icon="document-text-outline" onPress={() => setTermsModalVisible(true)} />
          <Row label="Privacy Policy" icon="shield-checkmark-outline" onPress={() => setPrivacyModalVisible(true)} />
          <View style={{ height: 24 }} />
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
                <Text style={{ fontWeight: 'bold' }}>Last Updated: November 2025{'\n\n'}</Text>
                
                <Text style={{ fontWeight: 'bold' }}>1. Acceptance of Terms{'\n'}</Text>
                By accessing or using SportsPal, you agree to be bound by these Terms of Service. If you do not agree, please discontinue use immediately.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>2. User Accounts{'\n'}</Text>
                You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>3. User Conduct{'\n'}</Text>
                You agree not to use SportsPal to:{'\n'}
                • Post offensive, harmful, or inappropriate content{'\n'}
                • Harass, bully, or threaten other users{'\n'}
                • Impersonate others or provide false information{'\n'}
                • Violate any applicable laws or regulations{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>4. Content{'\n'}</Text>
                You retain ownership of content you post, but grant SportsPal a license to use, display, and distribute your content within the app.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>5. Activity Participation{'\n'}</Text>
                SportsPal facilitates connections between users for sports activities. We are not responsible for the conduct of users or any injuries, damages, or losses resulting from participation in activities.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>6. Termination{'\n'}</Text>
                We reserve the right to suspend or terminate accounts that violate these Terms without prior notice.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>7. Disclaimer{'\n'}</Text>
                SportsPal is provided "as is" without warranties of any kind. We do not guarantee uninterrupted or error-free service.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>8. Limitation of Liability{'\n'}</Text>
                SportsPal and its affiliates shall not be liable for any indirect, incidental, or consequential damages arising from your use of the app.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>9. Changes to Terms{'\n'}</Text>
                We may modify these Terms at any time. Continued use constitutes acceptance of updated Terms.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>10. Contact{'\n'}</Text>
                For questions about these Terms, contact us at sportspalapplication@gmail.com
              </Text>
            </ScrollView>
            <TouchableOpacity 
              style={[
                styles.modalBtn, 
                { 
                  backgroundColor: theme.primary, 
                  marginTop: 16, 
                  width: '100%',
                  flex: 0,
                }
              ]} 
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setTermsModalVisible(false);
              }}
            >
              <Text style={[styles.modalBtnText, { color: theme.isDark ? '#111' : '#fff' }]}>I Understand</Text>
            </TouchableOpacity>
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
                <Text style={{ fontWeight: 'bold' }}>Last Updated: November 2025{'\n\n'}</Text>
                
                <Text style={{ fontWeight: 'bold' }}>1. Information We Collect{'\n'}</Text>
                We collect information you provide directly (name, email, profile photo, bio) and automatically (location, device information, usage data).{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>2. How We Use Your Information{'\n'}</Text>
                • To provide and improve SportsPal services{'\n'}
                • To connect you with other users for activities{'\n'}
                • To send notifications about activities and messages{'\n'}
                • To ensure safety and prevent fraud{'\n'}
                • To analyze app usage and performance{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>3. Location Data{'\n'}</Text>
                We use your location to show nearby activities and help you discover events. You can control location permissions in your device settings.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>4. Information Sharing{'\n'}</Text>
                We do not sell your personal information. We may share data with:{'\n'}
                • Other users (profile information, activity participation){'\n'}
                • Service providers who assist in app operations{'\n'}
                • Law enforcement when required by law{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>5. Data Security{'\n'}</Text>
                We implement security measures to protect your information, but no system is 100% secure. Use strong passwords and protect your account.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>6. Your Rights{'\n'}</Text>
                You can:{'\n'}
                • Access, update, or delete your information{'\n'}
                • Control notification and location settings{'\n'}
                • Request a copy of your data{'\n'}
                • Deactivate your account at any time{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>7. Children's Privacy{'\n'}</Text>
                SportsPal is not intended for users under 13. We do not knowingly collect data from children.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>8. Third-Party Services{'\n'}</Text>
                SportsPal may contain links to third-party services. We are not responsible for their privacy practices.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>9. Changes to Policy{'\n'}</Text>
                We may update this Privacy Policy. Continued use constitutes acceptance of changes.{'\n\n'}
                
                <Text style={{ fontWeight: 'bold' }}>10. Contact{'\n'}</Text>
                For privacy questions or requests, contact us at sportspalapplication@gmail.com
              </Text>
            </ScrollView>
            <TouchableOpacity 
              style={[
                styles.modalBtn, 
                { 
                  backgroundColor: theme.primary, 
                  marginTop: 16, 
                  width: '100%',
                  flex: 0,
                }
              ]} 
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setPrivacyModalVisible(false);
              }}
            >
              <Text style={[styles.modalBtnText, { color: theme.isDark ? '#111' : '#fff' }]}>I Understand</Text>
            </TouchableOpacity>
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
                {hasGoogle && (
                  <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
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
                {hasFacebook && (
                  <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
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
                  {hasApple && (
                    <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
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
                {hasPassword && (
                  <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
                )}
              </View>
            </View>

            <View style={{ width: '100%', marginTop: 20, paddingHorizontal: 12 }}>
              <Text style={[styles.modalText, { fontSize: 12, marginBottom: 0 }]}>
                To link additional accounts, sign in with your email and password, then use the social login buttons on the login screen.
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
  onPress?: () => void;
}> = ({ icon, label, sub, rightText, rightIcon = 'chevron-forward', disabled, onPress }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
  <TouchableOpacity
    activeOpacity={disabled ? 1 : 0.85}
    style={[styles.row, disabled && { opacity: 0.6 }]}
    onPress={disabled ? undefined : onPress}
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
      <Ionicons name={rightIcon} size={18} color={theme.muted} />
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
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
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
