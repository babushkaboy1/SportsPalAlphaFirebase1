// components/ActivitySuccessModal.tsx
// Beautiful animated success modal for newly created activities
// Features confetti, engaging animations, tips, and friend invites

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
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { ActivityIcon } from './ActivityIcons';
import UserAvatar from './UserAvatar';

const { width, height } = Dimensions.get('window');

// Confetti particle component
const ConfettiParticle: React.FC<{
  delay: number;
  color: string;
  startX: number;
  size: number;
}> = ({ delay, color, startX, size }) => {
  const translateY = useRef(new Animated.Value(-50)).current;
  const translateX = useRef(new Animated.Value(startX)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: height * 0.7,
          duration: 2500 + Math.random() * 1000,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: startX + (Math.random() - 0.5) * 150,
          duration: 2500,
          useNativeDriver: true,
        }),
        Animated.timing(rotate, {
          toValue: 360 * (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random()),
          duration: 2500,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 2500,
          delay: 1000,
          useNativeDriver: true,
        }),
      ]).start();
    }, delay);

    return () => clearTimeout(timeout);
  }, []);

  const rotation = rotate.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        width: size,
        height: size * 1.5,
        backgroundColor: color,
        borderRadius: size / 4,
        transform: [
          { translateX },
          { translateY },
          { rotate: rotation },
        ],
        opacity,
      }}
    />
  );
};

// Confetti container
const Confetti: React.FC<{ visible: boolean }> = ({ visible }) => {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#FFD93D', '#6C5CE7', '#A8E6CF'];
  
  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999 }]} pointerEvents="none">
      {Array.from({ length: 50 }).map((_, i) => (
        <ConfettiParticle
          key={i}
          delay={i * 30}
          color={colors[i % colors.length]}
          startX={Math.random() * width}
          size={8 + Math.random() * 6}
        />
      ))}
    </View>
  );
};

interface FriendProfile {
  uid: string;
  username?: string;
  photo?: string;
  photoURL?: string;
  bio?: string;
}

interface ActivitySuccessModalProps {
  visible: boolean;
  sport: string;
  activityTitle?: string;
  friendProfiles: FriendProfile[];
  selectedFriendIds: Record<string, boolean>;
  invitedFriendIds: string[];
  onSelectFriend: (friendId: string) => void;
  onInviteFriends: () => void;
  onClose: () => void;
}

export const ActivitySuccessModal: React.FC<ActivitySuccessModalProps> = ({
  visible,
  sport,
  activityTitle,
  friendProfiles,
  selectedFriendIds,
  invitedFriendIds,
  onSelectFriend,
  onInviteFriends,
  onClose,
}) => {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  
  const [showConfetti, setShowConfetti] = useState(false);

  // Animations
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.5)).current;
  const slideAnim = useRef(new Animated.Value(80)).current;
  const iconScale = useRef(new Animated.Value(0)).current;
  const iconRotate = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(0)).current;
  const checkmarkAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  const buttonSlide = useRef(new Animated.Value(50)).current;
  const friendsSlide = useRef(new Animated.Value(30)).current;
  const friendsOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Show confetti
      setShowConfetti(true);
      
      // Double success haptic for celebration
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }, 200);

      // Entrance animations
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 65,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 50,
          friction: 10,
          useNativeDriver: true,
        }),
      ]).start();

      // Delayed icon animation with bounce
      setTimeout(() => {
        Animated.parallel([
          Animated.spring(iconScale, {
            toValue: 1,
            tension: 120,
            friction: 4,
            useNativeDriver: true,
          }),
          Animated.timing(iconRotate, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Start subtle pulse and glow
          Animated.loop(
            Animated.parallel([
              Animated.sequence([
                Animated.timing(pulseAnim, {
                  toValue: 1.08,
                  duration: 1200,
                  useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                  toValue: 1,
                  duration: 1200,
                  useNativeDriver: true,
                }),
              ]),
              Animated.sequence([
                Animated.timing(glowAnim, {
                  toValue: 1,
                  duration: 1200,
                  useNativeDriver: true,
                }),
                Animated.timing(glowAnim, {
                  toValue: 0,
                  duration: 1200,
                  useNativeDriver: true,
                }),
              ]),
            ])
          ).start();
        });
      }, 250);

      // Title pop animation
      setTimeout(() => {
        Animated.spring(titleScale, {
          toValue: 1,
          tension: 100,
          friction: 6,
          useNativeDriver: true,
        }).start();
      }, 400);

      // Stagger checkmark animations
      checkmarkAnims.forEach((anim, index) => {
        setTimeout(() => {
          Animated.spring(anim, {
            toValue: 1,
            tension: 80,
            friction: 6,
            useNativeDriver: true,
          }).start();
        }, 600 + index * 150);
      });

      // Friends section slide in
      setTimeout(() => {
        Animated.parallel([
          Animated.spring(friendsSlide, {
            toValue: 0,
            tension: 50,
            friction: 10,
            useNativeDriver: true,
          }),
          Animated.timing(friendsOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      }, 800);

      // Button slide in
      setTimeout(() => {
        Animated.spring(buttonSlide, {
          toValue: 0,
          tension: 60,
          friction: 8,
          useNativeDriver: true,
        }).start();
      }, 1000);

    } else {
      // Reset all animations
      setShowConfetti(false);
      overlayOpacity.setValue(0);
      scaleAnim.setValue(0.5);
      slideAnim.setValue(80);
      iconScale.setValue(0);
      iconRotate.setValue(0);
      pulseAnim.setValue(1);
      glowAnim.setValue(0);
      titleScale.setValue(0);
      checkmarkAnims.forEach(anim => anim.setValue(0));
      buttonSlide.setValue(50);
      friendsSlide.setValue(30);
      friendsOpacity.setValue(0);
    }
  }, [visible]);

  const handleSelectFriend = (friendId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelectFriend(friendId);
  };

  const handleInvite = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onInviteFriends();
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const iconRotation = iconRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.6],
  });

  const hasSelectedFriends = Object.keys(selectedFriendIds).some(
    id => selectedFriendIds[id] && !invitedFriendIds.includes(id)
  );

  const selectedCount = Object.values(selectedFriendIds).filter(v => v).length;

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
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
            {/* Animated Activity Icon with Glow */}
            <View style={styles.iconWrapper}>
              <Animated.View
                style={[
                  styles.iconGlow,
                  {
                    opacity: glowOpacity,
                    transform: [{ scale: pulseAnim }],
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.iconContainer,
                  {
                    transform: [
                      { scale: Animated.multiply(iconScale, pulseAnim) },
                      { rotate: iconRotation },
                    ],
                  },
                ]}
              >
                <Animated.View
                  style={{
                    transform: [
                      { rotate: iconRotate.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '-360deg'],
                      }) },
                    ],
                  }}
                >
                  <ActivityIcon activity={sport} size={60} color={theme.primary} />
                </Animated.View>
              </Animated.View>
            </View>

            {/* Celebration Title */}
            <Animated.View style={{ transform: [{ scale: titleScale }] }}>
              <Text style={styles.celebrationEmoji}>🎉🏆🎊</Text>
              <Text style={styles.title}>Activity Created!</Text>
              {activityTitle && (
                <View style={styles.activityBadge}>
                  <Text style={styles.activityBadgeText}>{activityTitle}</Text>
                </View>
              )}
            </Animated.View>

            {/* Success Checklist */}
            <View style={styles.checklistContainer}>
              <Animated.View 
                style={[
                  styles.checklistItem,
                  {
                    opacity: checkmarkAnims[0],
                    transform: [{ translateX: checkmarkAnims[0].interpolate({
                      inputRange: [0, 1],
                      outputRange: [-30, 0],
                    })}],
                  }
                ]}
              >
                <View style={styles.checkCircle}>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                </View>
                <Text style={styles.checklistText}>Your {sport} activity is now live!</Text>
              </Animated.View>
              <Animated.View 
                style={[
                  styles.checklistItem,
                  {
                    opacity: checkmarkAnims[1],
                    transform: [{ translateX: checkmarkAnims[1].interpolate({
                      inputRange: [0, 1],
                      outputRange: [-30, 0],
                    })}],
                  }
                ]}
              >
                <View style={[styles.checkCircle, { backgroundColor: '#10B981' }]}>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                </View>
                <Text style={styles.checklistText}>Visible in Discover for nearby players</Text>
              </Animated.View>
              <Animated.View 
                style={[
                  styles.checklistItem,
                  {
                    opacity: checkmarkAnims[2],
                    transform: [{ translateX: checkmarkAnims[2].interpolate({
                      inputRange: [0, 1],
                      outputRange: [-30, 0],
                    })}],
                  }
                ]}
              >
                <View style={[styles.checkCircle, { backgroundColor: '#8B5CF6' }]}>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                </View>
                <Text style={styles.checklistText}>Group chat ready for coordination</Text>
              </Animated.View>
            </View>

            {/* Tips Section */}
            <View style={styles.tipsContainer}>
              <View style={styles.tipHeader}>
                <Ionicons name="bulb" size={18} color="#F59E0B" />
                <Text style={styles.tipHeaderText}>Pro Tips</Text>
              </View>
              <Text style={styles.tipText}>
                • Share the activity link to attract more players{'\n'}
                • Check the group chat for messages{'\n'}
                • Update the activity if plans change
              </Text>
            </View>

            {/* Friends Invite Section */}
            <Animated.View 
              style={[
                styles.friendsSection,
                {
                  opacity: friendsOpacity,
                  transform: [{ translateY: friendsSlide }],
                }
              ]}
            >
              {friendProfiles.length > 0 ? (
                <>
                  <View style={styles.friendsHeader}>
                    <Ionicons name="people" size={20} color={theme.primary} />
                    <Text style={styles.friendsTitle}>Invite Friends</Text>
                  </View>
                  <Text style={styles.friendsSubtitle}>
                    Give your friends a heads up!
                  </Text>
                  <ScrollView 
                    style={styles.friendsList} 
                    showsVerticalScrollIndicator={false}
                    nestedScrollEnabled
                  >
                    {friendProfiles.map((friend) => {
                      const isInvited = invitedFriendIds.includes(friend.uid);
                      const isSelected = selectedFriendIds[friend.uid];
                      return (
                        <TouchableOpacity
                          key={friend.uid}
                          style={[
                            styles.friendRow,
                            isInvited && styles.friendRowInvited,
                            isSelected && !isInvited && styles.friendRowSelected,
                          ]}
                          onPress={() => !isInvited && handleSelectFriend(friend.uid)}
                          activeOpacity={isInvited ? 1 : 0.7}
                          disabled={isInvited}
                        >
                          <UserAvatar
                            photoUrl={friend.photo || friend.photoURL}
                            username={friend.username || 'User'}
                            size={44}
                            borderColor={isSelected ? theme.primary : theme.border}
                            borderWidth={2}
                          />
                          <View style={styles.friendInfo}>
                            <Text style={styles.friendName}>
                              {friend.username || 'User'}
                            </Text>
                            {friend.bio && (
                              <Text style={styles.friendBio} numberOfLines={1}>
                                {friend.bio}
                              </Text>
                            )}
                          </View>
                          {isInvited ? (
                            <View style={styles.invitedBadge}>
                              <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                              <Text style={styles.invitedText}>Invited</Text>
                            </View>
                          ) : (
                            <View
                              style={[
                                styles.checkbox,
                                isSelected && styles.checkboxSelected,
                              ]}
                            >
                              {isSelected && (
                                <Ionicons name="checkmark" size={16} color="#fff" />
                              )}
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* Invite Button */}
                  <TouchableOpacity
                    style={[
                      styles.inviteButton,
                      !hasSelectedFriends && styles.inviteButtonDisabled,
                    ]}
                    onPress={handleInvite}
                    disabled={!hasSelectedFriends}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="paper-plane" size={18} color="#fff" />
                    <Text style={styles.inviteButtonText}>
                      {selectedCount > 0
                        ? `Send ${selectedCount} Invite${selectedCount === 1 ? '' : 's'}`
                        : 'Select Friends to Invite'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.noFriendsContainer}>
                  <Ionicons name="people-outline" size={32} color={theme.muted} />
                  <Text style={styles.noFriendsText}>
                    Add friends to invite them to activities!
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* Done Button */}
            <Animated.View style={{ transform: [{ translateY: buttonSlide }], width: '100%' }}>
              <TouchableOpacity
                style={styles.doneButton}
                onPress={handleClose}
                activeOpacity={0.8}
              >
                <Text style={styles.doneButtonText}>Let's Go!</Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
      {/* Confetti renders LAST to appear on top */}
      <Confetti visible={showConfetti} />
    </Modal>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    modalCard: {
      width: Math.min(width - 32, 440),
      maxHeight: height * 0.88,
      backgroundColor: theme.card,
      borderRadius: 28,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
      ...Platform.select({
        ios: {
          shadowColor: theme.primary,
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.25,
          shadowRadius: 24,
        },
        android: {
          elevation: 20,
        },
      }),
    },
    scrollContent: {
      padding: 24,
      alignItems: 'center',
    },
    iconWrapper: {
      position: 'relative',
      marginBottom: 16,
    },
    iconGlow: {
      position: 'absolute',
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: theme.primary,
      top: -10,
      left: -10,
    },
    iconContainer: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 4,
      borderColor: theme.primary,
    },
    celebrationEmoji: {
      fontSize: 32,
      textAlign: 'center',
      marginBottom: 8,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: theme.primary,
      textAlign: 'center',
      marginBottom: 8,
    },
    activityBadge: {
      backgroundColor: theme.background,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      alignSelf: 'center',
      marginBottom: 16,
    },
    activityBadgeText: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.text,
    },
    checklistContainer: {
      width: '100%',
      marginBottom: 16,
    },
    checklistItem: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 6,
    },
    checkCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: theme.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    checklistText: {
      fontSize: 14,
      color: theme.text,
      flex: 1,
    },
    tipsContainer: {
      width: '100%',
      backgroundColor: theme.background,
      borderRadius: 16,
      padding: 14,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: '#F59E0B33',
    },
    tipHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    tipHeaderText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#F59E0B',
      marginLeft: 8,
    },
    tipText: {
      fontSize: 13,
      color: theme.muted,
      lineHeight: 20,
    },
    friendsSection: {
      width: '100%',
      marginBottom: 16,
    },
    friendsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    friendsTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: theme.text,
      marginLeft: 8,
    },
    friendsSubtitle: {
      fontSize: 13,
      color: theme.muted,
      marginBottom: 12,
    },
    friendsList: {
      maxHeight: 180,
      marginBottom: 12,
    },
    friendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      marginBottom: 8,
      backgroundColor: theme.background,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    friendRowSelected: {
      borderColor: theme.primary,
      backgroundColor: `${theme.primary}10`,
    },
    friendRowInvited: {
      opacity: 0.6,
    },
    friendInfo: {
      flex: 1,
      marginLeft: 12,
    },
    friendName: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.text,
    },
    friendBio: {
      fontSize: 12,
      color: theme.muted,
      marginTop: 2,
    },
    invitedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#10B98120',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    invitedText: {
      fontSize: 12,
      fontWeight: '600',
      color: '#10B981',
      marginLeft: 4,
    },
    checkbox: {
      width: 26,
      height: 26,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: theme.border,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxSelected: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    inviteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: 14,
      borderRadius: 14,
      gap: 8,
    },
    inviteButtonDisabled: {
      backgroundColor: theme.muted,
      opacity: 0.5,
    },
    inviteButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: '#fff',
    },
    noFriendsContainer: {
      alignItems: 'center',
      paddingVertical: 24,
    },
    noFriendsText: {
      fontSize: 14,
      color: theme.muted,
      marginTop: 8,
      textAlign: 'center',
    },
    doneButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: 18,
      borderRadius: 16,
      gap: 8,
      marginTop: 4,
    },
    doneButtonText: {
      fontSize: 18,
      fontWeight: '800',
      color: '#fff',
    },
  });
