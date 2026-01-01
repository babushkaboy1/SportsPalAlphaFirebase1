// components/ActivityJoinLeaveModal.tsx
// Beautiful animated modals for joining and leaving activities
// Used across all screens: Discover, Calendar, Profile, UserProfile, ActivityDetails, Notifications

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions,
  Platform,
  Linking,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { ActivityIcon } from './ActivityIcons';

const { width, height } = Dimensions.get('window');

const COMMUNITY_GUIDELINES_URL = 'https://sportspal-1b468.web.app/community-guidelines.html';

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
  
  // Checkbox state for community guidelines (join mode only)
  const [guidelinesAccepted, setGuidelinesAccepted] = useState(false);

  // Animations
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const emojiScale = useRef(new Animated.Value(0)).current;
  const emojiRotate = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const bulletAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  const checkboxScale = useRef(new Animated.Value(1)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Reset checkbox when modal opens
      setGuidelinesAccepted(false);
      
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

      // Delayed emoji pop animation with continuous pulse
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
        ]).start(() => {
          // Start subtle pulse animation
          Animated.loop(
            Animated.sequence([
              Animated.timing(pulseAnim, {
                toValue: 1.05,
                duration: 1000,
                useNativeDriver: true,
              }),
              Animated.timing(pulseAnim, {
                toValue: 1,
                duration: 1000,
                useNativeDriver: true,
              }),
            ])
          ).start();
        });
      }, 200);

      // Stagger bullet point animations
      bulletAnims.forEach((anim, index) => {
        setTimeout(() => {
          Animated.spring(anim, {
            toValue: 1,
            friction: 8,
            tension: 60,
            useNativeDriver: true,
          }).start();
        }, 400 + index * 100);
      });

      // Shimmer animation for guidelines link
      Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      // Reset animations
      overlayOpacity.setValue(0);
      scaleAnim.setValue(0.7);
      slideAnim.setValue(50);
      emojiScale.setValue(0);
      emojiRotate.setValue(0);
      pulseAnim.setValue(1);
      bulletAnims.forEach(anim => anim.setValue(0));
      shimmerAnim.setValue(0);
    }
  }, [visible]);

  const handleCheckboxPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setGuidelinesAccepted(!guidelinesAccepted);
    
    // Bounce animation on checkbox
    Animated.sequence([
      Animated.timing(checkboxScale, {
        toValue: 0.8,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(checkboxScale, {
        toValue: 1,
        friction: 4,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleGuidelinesPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Open community guidelines in browser
    Linking.openURL(COMMUNITY_GUIDELINES_URL).catch((err) => {
      console.warn('Failed to open community guidelines:', err);
    });
  };

  const handleConfirm = () => {
    if (mode === 'join' && !guidelinesAccepted) {
      // Shake animation to indicate checkbox required
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Animated.sequence([
        Animated.timing(checkboxScale, { toValue: 1.1, duration: 50, useNativeDriver: true }),
        Animated.timing(checkboxScale, { toValue: 0.9, duration: 50, useNativeDriver: true }),
        Animated.timing(checkboxScale, { toValue: 1.1, duration: 50, useNativeDriver: true }),
        Animated.timing(checkboxScale, { toValue: 1, duration: 50, useNativeDriver: true }),
      ]).start();
      return;
    }
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
          <ScrollView 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            bounces={false}
          >
            {/* Animated Activity Icon */}
            <Animated.View
              style={[
                styles.emojiContainer,
                mode === 'join' ? styles.emojiContainerJoin : styles.emojiContainerLeave,
                {
                  transform: [
                    { scale: Animated.multiply(emojiScale, pulseAnim) },
                    { rotate: emojiRotation },
                  ],
                },
              ]}
            >
              <ActivityIcon 
                activity={activityName} 
                size={64} 
                color={mode === 'join' ? theme.primary : theme.muted}
              />
            </Animated.View>

            {/* Title */}
            <Text style={[styles.title, mode === 'leave' && styles.titleLeave]}>
              {mode === 'join' ? '🎉 Ready to Play!' : '👋 Leaving Already?'}
            </Text>

            {/* Activity Name */}
            <Text style={styles.activityName}>{activityName}</Text>

            {/* Message */}
            <View style={styles.messageContainer}>
              {mode === 'join' ? (
                <>
                  <Text style={styles.message}>
                    Awesome! Here's what to expect:
                  </Text>
                  <Animated.View 
                    style={[
                      styles.bulletPoint,
                      {
                        opacity: bulletAnims[0],
                        transform: [{ translateX: bulletAnims[0].interpolate({
                          inputRange: [0, 1],
                          outputRange: [-20, 0],
                        })}],
                      }
                    ]}
                  >
                    <View style={styles.bulletIconContainer}>
                      <Ionicons name="chatbubble" size={16} color="#fff" />
                    </View>
                    <Text style={styles.bulletText}>
                      Say hi in the group chat—everyone loves a friendly intro!
                    </Text>
                  </Animated.View>
                  <Animated.View 
                    style={[
                      styles.bulletPoint,
                      {
                        opacity: bulletAnims[1],
                        transform: [{ translateX: bulletAnims[1].interpolate({
                          inputRange: [0, 1],
                          outputRange: [-20, 0],
                        })}],
                      }
                    ]}
                  >
                    <View style={[styles.bulletIconContainer, { backgroundColor: '#10B981' }]}>
                      <Ionicons name="location" size={16} color="#fff" />
                    </View>
                    <Text style={styles.bulletText}>
                      Arrive on time at the meeting spot—check the details!
                    </Text>
                  </Animated.View>
                  <Animated.View 
                    style={[
                      styles.bulletPoint,
                      {
                        opacity: bulletAnims[2],
                        transform: [{ translateX: bulletAnims[2].interpolate({
                          inputRange: [0, 1],
                          outputRange: [-20, 0],
                        })}],
                      }
                    ]}
                  >
                    <View style={[styles.bulletIconContainer, { backgroundColor: '#F59E0B' }]}>
                      <Ionicons name="notifications" size={16} color="#fff" />
                    </View>
                    <Text style={styles.bulletText}>
                      Plans change? Let the group know—it happens!
                    </Text>
                  </Animated.View>
                  <Animated.View 
                    style={[
                      styles.bulletPoint,
                      {
                        opacity: bulletAnims[3],
                        transform: [{ translateX: bulletAnims[3].interpolate({
                          inputRange: [0, 1],
                          outputRange: [-20, 0],
                        })}],
                      }
                    ]}
                  >
                    <View style={[styles.bulletIconContainer, { backgroundColor: '#8B5CF6' }]}>
                      <Ionicons name="shield-checkmark" size={16} color="#fff" />
                    </View>
                    <Text style={styles.bulletText}>
                      Meet in public, stay safe, have fun!
                    </Text>
                  </Animated.View>

                  {/* Community Guidelines Checkbox */}
                  <View style={styles.guidelinesSection}>
                    <TouchableOpacity 
                      style={styles.checkboxRow}
                      onPress={handleCheckboxPress}
                      activeOpacity={0.7}
                    >
                      <Animated.View 
                        style={[
                          styles.checkbox,
                          guidelinesAccepted && styles.checkboxChecked,
                          { transform: [{ scale: checkboxScale }] }
                        ]}
                      >
                        {guidelinesAccepted && (
                          <Ionicons name="checkmark" size={16} color="#fff" />
                        )}
                      </Animated.View>
                      <Text style={styles.checkboxLabel}>
                        I agree to follow the{' '}
                        <Text 
                          style={styles.guidelinesLink}
                          onPress={handleGuidelinesPress}
                        >
                          Community Guidelines
                        </Text>
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.guidelinesHint}>
                      Be respectful, play fair, and keep it fun for everyone 💪
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.message}>
                    We'll miss you! Before you go:
                  </Text>
                  <Animated.View 
                    style={[
                      styles.bulletPoint,
                      {
                        opacity: bulletAnims[0],
                        transform: [{ translateX: bulletAnims[0].interpolate({
                          inputRange: [0, 1],
                          outputRange: [-20, 0],
                        })}],
                      }
                    ]}
                  >
                    <View style={[styles.bulletIconContainer, { backgroundColor: theme.muted }]}>
                      <Ionicons name="chatbubble-ellipses" size={16} color="#fff" />
                    </View>
                    <Text style={styles.bulletText}>
                      Let the group know—a quick message goes a long way
                    </Text>
                  </Animated.View>
                  <Animated.View 
                    style={[
                      styles.bulletPoint,
                      {
                        opacity: bulletAnims[1],
                        transform: [{ translateX: bulletAnims[1].interpolate({
                          inputRange: [0, 1],
                          outputRange: [-20, 0],
                        })}],
                      }
                    ]}
                  >
                    <View style={[styles.bulletIconContainer, { backgroundColor: '#EF4444' }]}>
                      <Ionicons name="heart" size={16} color="#fff" />
                    </View>
                    <Text style={styles.bulletText}>
                      The group is counting on you—plans may change for everyone
                    </Text>
                  </Animated.View>
                  <Animated.View 
                    style={[
                      styles.bulletPoint,
                      {
                        opacity: bulletAnims[2],
                        transform: [{ translateX: bulletAnims[2].interpolate({
                          inputRange: [0, 1],
                          outputRange: [-20, 0],
                        })}],
                      }
                    ]}
                  >
                    <View style={[styles.bulletIconContainer, { backgroundColor: '#3B82F6' }]}>
                      <Ionicons name="refresh" size={16} color="#fff" />
                    </View>
                    <Text style={styles.bulletText}>
                      You can always rejoin later if things change!
                    </Text>
                  </Animated.View>

                  {/* Recommendation Box for Leave */}
                  <View style={styles.recommendationBox}>
                    <Ionicons name="bulb" size={20} color="#F59E0B" />
                    <Text style={styles.recommendationText}>
                      Pro tip: Send a quick message to the group before leaving—it's the sporty thing to do! 🤝
                    </Text>
                  </View>

                  <Text style={[styles.message, { marginTop: 16, fontSize: 14, fontWeight: '600' }]}>
                    Are you sure you want to leave this activity?
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
                  {mode === 'join' ? 'Go Back' : 'Stay In'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.button, 
                  styles.confirmButton,
                  mode === 'join' && !guidelinesAccepted && styles.confirmButtonDisabled,
                ]}
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
                  {mode === 'join' ? "Let's Go!" : 'Leave Activity'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalCard: {
      width: Math.min(width - 40, 420),
      maxHeight: height * 0.85,
      backgroundColor: theme.card,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: theme.border,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.35,
          shadowRadius: 20,
        },
        android: {
          elevation: 16,
        },
      }),
    },
    scrollContent: {
      padding: 24,
      alignItems: 'center',
    },
    emojiContainer: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
      borderWidth: 3,
    },
    emojiContainerJoin: {
      borderColor: theme.primary,
      shadowColor: theme.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    emojiContainerLeave: {
      borderColor: theme.muted,
    },
    title: {
      fontSize: 26,
      fontWeight: 'bold',
      color: theme.primary,
      marginBottom: 8,
      textAlign: 'center',
    },
    titleLeave: {
      color: theme.text,
    },
    activityName: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 16,
      textAlign: 'center',
      backgroundColor: theme.background,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 12,
      overflow: 'hidden',
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
      marginBottom: 16,
    },
    bulletPoint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginVertical: 8,
      paddingHorizontal: 4,
    },
    bulletIconContainer: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    bulletText: {
      fontSize: 14,
      color: theme.text,
      flex: 1,
      lineHeight: 20,
      paddingTop: 3,
    },
    guidelinesSection: {
      width: '100%',
      marginTop: 16,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    checkboxRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: theme.border,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    checkboxChecked: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    checkboxLabel: {
      flex: 1,
      fontSize: 14,
      color: theme.text,
      lineHeight: 20,
    },
    guidelinesLink: {
      color: theme.primary,
      fontWeight: '700',
      textDecorationLine: 'underline',
    },
    guidelinesHint: {
      fontSize: 12,
      color: theme.muted,
      marginLeft: 36,
      fontStyle: 'italic',
    },
    recommendationBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: theme.background,
      borderRadius: 12,
      padding: 12,
      marginTop: 16,
      borderWidth: 1,
      borderColor: '#F59E0B33',
    },
    recommendationText: {
      flex: 1,
      fontSize: 13,
      color: theme.text,
      marginLeft: 10,
      lineHeight: 18,
    },
    buttonContainer: {
      flexDirection: 'row',
      width: '100%',
      gap: 12,
    },
    button: {
      flex: 1,
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    },
    cancelButton: {
      backgroundColor: theme.background,
      borderWidth: 1.5,
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
    confirmButtonDisabled: {
      backgroundColor: theme.muted,
      opacity: 0.6,
    },
    confirmButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '700',
    },
  });
