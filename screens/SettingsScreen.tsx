// screens/SettingsScreen.tsx
import React, { useState } from 'react';
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
} from 'react-native';
import { auth } from '../firebaseConfig';
import { removeSavedTokenAndUnregister } from '../utils/notifications';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

type SettingsScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Settings'>;

const ACCENT = '#1ae9ef';
const BG = '#121212';
const CARD = '#1e1e1e';
const TEXT = '#ffffff';
const MUTED = '#bdbdbd';
const DANGER = '#ff5a5f';

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const insets = useSafeAreaInsets();

  // Local UI state only (hook up later)
  const [pushEnabled, setPushEnabled] = useState(true);
  const [msgEnabled, setMsgEnabled] = useState(true);
  const [activityReminders, setActivityReminders] = useState(true);
  const [marketingEnabled, setMarketingEnabled] = useState(false);

  const [privateProfile, setPrivateProfile] = useState(false);
  const [hideExactLocation, setHideExactLocation] = useState(true);
  const [useAutoRange, setUseAutoRange] = useState(true); // default: 45 min (~70km)

  const [confirmSignOutVisible, setConfirmSignOutVisible] = useState(false);

  const handleSignOut = async () => {
    try {
      // Best-effort: remove this device's Expo push token from my profile
      await removeSavedTokenAndUnregister().catch(() => {});
      await auth.signOut();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      setConfirmSignOutVisible(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityLabel="Go Back">
          <Ionicons name="arrow-back" size={26} color={ACCENT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 26 }} />{/* spacer for symmetry */}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ACCOUNT */}
        <Section title="Account">
          <Row
            icon="person-circle-outline"
            label="Edit Profile"
            sub="Name, photo, bio"
            onPress={() => {/* TODO: navigation.navigate('EditProfile') */}}
          />
          <Row
            icon="key-outline"
            label="Password & Security"
            sub="Change password, 2-step verification"
            onPress={() => {/* TODO */}}
          />
          <Row
            icon="link-outline"
            label="Linked Accounts"
            sub="Apple, Google"
            rightText="Connected"
            onPress={() => {/* TODO */}}
          />
          <RowDanger
            icon="exit-outline"
            label="Sign out of SportsPal"
            onPress={() => setConfirmSignOutVisible(true)}
          />
        </Section>

        {/* DISCOVERY & LOCATION */}
        <Section title="Discovery & Location">
          <RowSwitch
            icon="navigate-circle-outline"
            label="Auto-range by drive time"
            sub="45 min ≈ 70 km radius by default"
            value={useAutoRange}
            onValueChange={setUseAutoRange}
          />
          <Row
            icon="compass-outline"
            label="Default Discovery Range"
            sub="45 min (≈ 70 km) • tap to change"
            rightText="45 min"
            onPress={() => {/* TODO: open Discovery settings */}}
          />
          <Row
            icon="location-outline"
            label="Location Permissions"
            sub="Manage in system settings"
            rightIcon="chevron-forward"
            onPress={() => {/* TODO: Linking.openSettings() */}}
          />
          <RowSwitch
            icon="map-outline"
            label="Hide exact location"
            sub="Show approximate area on my profile"
            value={hideExactLocation}
            onValueChange={setHideExactLocation}
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
          <RowSwitch
            icon="chatbubble-ellipses-outline"
            label="Messages"
            sub="New messages & mentions"
            value={msgEnabled}
            onValueChange={setMsgEnabled}
          />
          <RowSwitch
            icon="calendar-outline"
            label="Activity reminders"
            sub="Remind me before games"
            value={activityReminders}
            onValueChange={setActivityReminders}
          />
          <RowSwitch
            icon="megaphone-outline"
            label="Tips & updates"
            sub="Product news, offers"
            value={marketingEnabled}
            onValueChange={setMarketingEnabled}
          />
        </Section>

        {/* PRIVACY & SAFETY */}
        <Section title="Privacy & Safety">
          <RowSwitch
            icon="lock-closed-outline"
            label="Private profile"
            sub="Approve followers to see activity"
            value={privateProfile}
            onValueChange={setPrivateProfile}
          />
          <Row
            icon="ban-outline"
            label="Blocked users"
            sub="Manage your block list"
            rightIcon="chevron-forward"
            onPress={() => {/* TODO */}}
          />
          <Row
            icon="download-outline"
            label="Download your data"
            sub="Get a copy of your SportsPal data"
            onPress={() => {/* TODO */}}
          />
        </Section>

        {/* APPEARANCE */}
        <Section title="Appearance">
          <Row
            icon="moon-outline"
            label="Theme"
            sub="Dark (System coming soon)"
            rightText="Dark"
            onPress={() => {/* TODO */}}
          />
          <Row
            icon="color-palette-outline"
            label="Accent color"
            sub="Turquoise"
            rightText="Turquoise"
            onPress={() => {/* TODO: future color picker */}}
          />
        </Section>

        {/* SUPPORT */}
        <Section title="Support">
          <Row icon="help-circle-outline" label="Help Center" onPress={() => {/* TODO */}} />
          <Row icon="bug-outline" label="Report a problem" onPress={() => {/* TODO */}} />
          <Row icon="mail-open-outline" label="Contact support" onPress={() => {/* TODO */}} />
          <Row icon="star-outline" label="Rate us" onPress={() => {/* TODO: Store link */}} />
        </Section>

        {/* ABOUT */}
        <Section title="About">
          <Row
            icon="information-circle-outline"
            label="Version"
            rightText={Constants.expoConfig?.version ?? '—'}
            disabled
          />
          <Row label="Terms of Service" icon="document-text-outline" onPress={() => {/* TODO */}} />
          <Row label="Privacy Policy" icon="shield-checkmark-outline" onPress={() => {/* TODO */}} />
          <View style={{ height: 24 }} />
        </Section>
      </ScrollView>

      {/* Confirm Sign Out */}
      <Modal
        transparent
        visible={confirmSignOutVisible}
        onRequestClose={() => setConfirmSignOutVisible(false)}
        animationType="fade"
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setConfirmSignOutVisible(false)}>
          <Pressable style={styles.modalCard}>
            <Ionicons name="exit-outline" size={28} color={DANGER} style={{ marginBottom: 6 }} />
            <Text style={styles.modalTitle}>Sign out?</Text>
            <Text style={styles.modalText}>You can sign back in anytime.</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setConfirmSignOutVisible(false)}>
                <Text style={[styles.modalBtnText, { color: TEXT }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalDanger]} onPress={handleSignOut}>
                <Text style={[styles.modalBtnText, { color: '#111' }]}>Sign out</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

/* -------------------- Reusable UI -------------------- */

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.card}>{children}</View>
  </View>
);

const Row: React.FC<{
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  rightText?: string;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  onPress?: () => void;
}> = ({ icon, label, sub, rightText, rightIcon = 'chevron-forward', disabled, onPress }) => (
  <TouchableOpacity
    activeOpacity={disabled ? 1 : 0.85}
    style={[styles.row, disabled && { opacity: 0.6 }]}
    onPress={disabled ? undefined : onPress}
  >
    <View style={styles.rowLeft}>
      {icon && <Ionicons name={icon} size={22} color={ACCENT} style={{ marginRight: 12 }} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
    </View>
    <View style={styles.rowRight}>
      {rightText ? <Text style={styles.rowRightText}>{rightText}</Text> : null}
      <Ionicons name={rightIcon} size={18} color={MUTED} />
    </View>
  </TouchableOpacity>
);

const RowSwitch: React.FC<{
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}> = ({ icon, label, sub, value, onValueChange }) => (
  <View style={styles.row}>
    <View style={styles.rowLeft}>
      {icon && <Ionicons name={icon} size={22} color={ACCENT} style={{ marginRight: 12 }} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: '#3a3a3a', true: '#1f6d70' }}
      thumbColor={value ? ACCENT : '#888'}
      ios_backgroundColor="#3a3a3a"
    />
  </View>
);

const RowDanger: React.FC<{
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
}> = ({ icon = 'alert-circle-outline', label, onPress }) => (
  <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
    <View style={styles.rowLeft}>
      <Ionicons name={icon} size={22} color={DANGER} style={{ marginRight: 12 }} />
      <Text style={[styles.rowLabel, { color: DANGER }]}>{label}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={DANGER} />
  </TouchableOpacity>
);

/* -------------------- Styles -------------------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    color: ACCENT,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    color: ACCENT,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 8,
    opacity: 0.96,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: '#2a2a2a',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  rowLabel: { color: TEXT, fontSize: 16, fontWeight: '600' },
  rowSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowRightText: { color: MUTED, fontSize: 13, marginRight: 4 },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  modalCard: {
    width: '94%',
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 18,
    marginBottom: Platform.OS === 'ios' ? 28 : 18,
    alignItems: 'center',
  },
  modalTitle: { color: TEXT, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  modalText: { color: MUTED, fontSize: 13, textAlign: 'center', marginBottom: 14 },
  modalActions: { flexDirection: 'row', width: '100%', gap: 10 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCancel: { backgroundColor: '#2a2a2a' },
  modalDanger: { backgroundColor: DANGER },
  modalBtnText: { fontWeight: '700', fontSize: 15 },
});

export default SettingsScreen;
