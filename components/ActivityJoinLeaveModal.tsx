// components/ActivityJoinLeaveModal.tsx
// Beautiful animated modals for joining and leaving activities
// Used across all screens: Discover, Calendar, Profile, UserProfile, ActivityDetails, Notifications

import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { ActivityIcon } from './ActivityIcons';

const { width } = Dimensions.get('window');

interface ActivityJoinLeaveModalProps {
  visible: boolean;
  mode: 'join' | 'leave';
  activityName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ActivityJoinLeaveModal: React.FC<ActivityJoinLeaveModalProps> = ({
  visible,
  mode,
  activityName,
  onConfirm,
  onCancel,
}) => {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // Animations
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const emojiScale = useRef(new Animated.Value(0)).current;
  const emojiRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Medium haptic for modal appearance
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Stagger animations for smooth entrance
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }),
      ]).start();

      // Delayed emoji pop animation
      setTimeout(() => {
        Animated.parallel([
          Animated.spring(emojiScale, {
            toValue: 1,
            friction: 6,
            tension: 100,
            useNativeDriver: true,
          }),
          Animated.timing(emojiRotate, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]).start();
      }, 200);
    } else {
      // Reset animations
      overlayOpacity.setValue(0);
      scaleAnim.setValue(0.7);
      slideAnim.setValue(50);
      emojiScale.setValue(0);
      emojiRotate.setValue(0);
    }
  }, [visible]);

  const handleConfirm = () => {
    // Success haptic
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirm();
  };

  const handleCancel = () => {
    // Light haptic for cancel
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCancel();
  };

  const emojiRotation = emojiRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', mode === 'join' ? '360deg' : '-15deg'],
  });

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleCancel}
    >
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Animated.View
          style={[
            styles.modalCard,
            {
              transform: [
                { scale: scaleAnim },
                { translateY: slideAnim },
              ],
            },
          ]}
        >
          {/* Animated Activity Icon */}
          <Animated.View
            style={[
              styles.emojiContainer,
              {
                transform: [
                  { scale: emojiScale },
                  { rotate: emojiRotation },
                ],
              },
            ]}
          >
            <ActivityIcon 
              activity={activityName} 
              size={64} 
              color={theme.primary}
            />
          </Animated.View>

          {/* Title */}
          <Text style={styles.title}>
            {mode === 'join' ? '🎉 Welcome!' : '👋 Leaving?'}
          </Text>

          {/* Activity Name */}
          <Text style={styles.activityName}>{activityName}</Text>

          {/* Message */}
          <View style={styles.messageContainer}>
            {mode === 'join' ? (
              <>
                <Text style={styles.message}>
                  You're all set! Here are a few friendly reminders:
                </Text>
                <View style={styles.bulletPoint}>
                  <Ionicons name="chatbubble-outline" size={16} color={theme.primary} />
                  <Text style={styles.bulletText}>
                    Say hi in the group chat and introduce yourself
                  </Text>
                </View>
                <View style={styles.bulletPoint}>
                  <Ionicons name="calendar-outline" size={16} color={theme.primary} />
                  <Text style={styles.bulletText}>
                    If plans change, let everyone know you can't make it
                  </Text>
                </View>
                <View style={styles.bulletPoint}>
                  <Ionicons name="exit-outline" size={16} color={theme.primary} />
                  <Text style={styles.bulletText}>
                    You can leave anytime if needed—no worries!
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.message}>
                  Before you go, just a quick heads-up:
                </Text>
                <View style={styles.bulletPoint}>
                  <Ionicons name="people-outline" size={16} color={theme.muted} />
                  <Text style={styles.bulletText}>
                    It's helpful to let others know if you won't make it
                  </Text>
                </View>
                <View style={styles.bulletPoint}>
                  <Ionicons name="heart-outline" size={16} color={theme.muted} />
                  <Text style={styles.bulletText}>
                    This helps everyone plan better
                  </Text>
                </View>
                <Text style={[styles.message, { marginTop: 12, fontSize: 13 }]}>
                  Are you sure you want to leave?
                </Text>
              </>
            )}
          </View>

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleCancel}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>
                {mode === 'join' ? 'Go Back' : 'Stay'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.confirmButton]}
              onPress={handleConfirm}
              activeOpacity={0.8}
            >
              <Ionicons
                name={mode === 'join' ? 'checkmark-circle' : 'exit-outline'}
                size={18}
                color="#fff"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.confirmButtonText}>
                {mode === 'join' ? 'Got It!' : 'Leave Activity'}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalCard: {
      width: Math.min(width - 40, 420),
      backgroundColor: theme.card,
      borderRadius: 20,
      padding: 24,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.3,
          shadowRadius: 16,
        },
        android: {
          elevation: 12,
        },
      }),
    },
    emojiContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
      borderWidth: 2,
      borderColor: theme.primary,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.primary,
      marginBottom: 8,
      textAlign: 'center',
    },
    activityName: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 16,
      textAlign: 'center',
    },
    messageContainer: {
      width: '100%',
      marginBottom: 20,
    },
    message: {
      fontSize: 14,
      color: theme.muted,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 12,
    },
    bulletPoint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginVertical: 6,
      paddingHorizontal: 8,
    },
    bulletText: {
      fontSize: 13,
      color: theme.text,
      marginLeft: 10,
      flex: 1,
      lineHeight: 18,
    },
    buttonContainer: {
      flexDirection: 'row',
      width: '100%',
      gap: 10,
    },
    button: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    },
    cancelButton: {
      backgroundColor: theme.background,
      borderWidth: 1,
      borderColor: theme.border,
    },
    cancelButtonText: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
    },
    confirmButton: {
      backgroundColor: theme.primary,
    },
    confirmButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '700',
    },
  });
