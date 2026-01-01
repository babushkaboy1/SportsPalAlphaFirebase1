// components/ActivityRatingModal.tsx
// Beautiful rating modal for past activities
// Sport-specific venue labels, no-show participant selection, and more

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
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import UserAvatar from './UserAvatar';
import { ActivityIcon } from './ActivityIcons';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { fetchUsersByIds } from '../utils/firestoreActivities';

const { height } = Dimensions.get('window');

// Sport-specific venue labels
const SPORT_VENUE_CONFIG: Record<string, string> = {
  // Court sports
  'basketball': 'Rate the Court',
  'tennis': 'Rate the Court',
  'volleyball': 'Rate the Court',
  'badminton': 'Rate the Court',
  'squash': 'Rate the Court',
  'table tennis': 'Rate the Table',
  'ping pong': 'Rate the Table',
  'padel': 'Rate the Court',
  'pickleball': 'Rate the Court',
  
  // Field sports
  'football': 'Rate the Pitch',
  'american football': 'Rate the Field',
  'soccer': 'Rate the Pitch',
  'rugby': 'Rate the Pitch',
  'cricket': 'Rate the Pitch',
  'baseball': 'Rate the Field',
  'softball': 'Rate the Field',
  'lacrosse': 'Rate the Field',
  'field hockey': 'Rate the Field',
  
  // Ice/Indoor
  'ice hockey': 'Rate the Rink',
  'hockey': 'Rate the Rink',
  'ice skating': 'Rate the Rink',
  'figure skating': 'Rate the Rink',
  'curling': 'Rate the Rink',
  
  // Pool/Water
  'swimming': 'Rate the Pool',
  'water polo': 'Rate the Pool',
  'diving': 'Rate the Pool',
  
  // Indoor venues
  'bowling': 'Rate the Alley',
  'gym': 'Rate the Gym',
  'fitness': 'Rate the Gym',
  'crossfit': 'Rate the Box',
  'yoga': 'Rate the Studio',
  'pilates': 'Rate the Studio',
  'dance': 'Rate the Studio',
  'boxing': 'Rate the Gym',
  'mma': 'Rate the Gym',
  'martial arts': 'Rate the Dojo',
  'climbing': 'Rate the Wall',
  'bouldering': 'Rate the Wall',
  
  // Outdoor venues
  'golf': 'Rate the Course',
  'mini golf': 'Rate the Course',
  'archery': 'Rate the Range',
  'shooting': 'Rate the Range',
  
  // Track
  'athletics': 'Rate the Track',
  'track': 'Rate the Track',
  
  // Futsal
  'futsal': 'Rate the Court',
  
  // Beach
  'beach volleyball': 'Rate the Beach',
  'beach soccer': 'Rate the Beach',
};

// Sports that have routes (outdoor activities)
const ROUTE_SPORTS = [
  'hiking', 'running', 'cycling', 'walking', 'trail running',
  'mountain biking', 'skating', 'skateboarding', 'rollerblading',
  'jogging', 'biking', 'trekking', 'backpacking',
];

// Route-specific labels
const ROUTE_CONFIG: Record<string, string> = {
  'hiking': 'Rate the Trail',
  'trekking': 'Rate the Trail',
  'backpacking': 'Rate the Trail',
  'running': 'Rate the Route',
  'jogging': 'Rate the Route',
  'trail running': 'Rate the Trail',
  'cycling': 'Rate the Route',
  'biking': 'Rate the Route',
  'mountain biking': 'Rate the Trail',
  'walking': 'Rate the Path',
  'skating': 'Rate the Route',
  'skateboarding': 'Rate the Spot',
  'rollerblading': 'Rate the Route',
};

interface Participant {
  oderId?: string;
  uid?: string;
  username?: string;
  photoURL?: string;
  profilePicture?: string;
}

interface Activity {
  id: string;
  activity: string; // sport name
  hasRoute?: boolean;
  joinedUserIds?: string[];
  participants?: Participant[];
  joinedParticipants?: Participant[];
}

interface ActivityRatingModalProps {
  visible: boolean;
  activity: Activity | null;
  onClose: () => void;
  onRatingSubmitted?: (activityId: string, rating: number) => void;
}

// Star Rating Component
const StarRating: React.FC<{
  rating: number;
  onRatingChange?: (rating: number) => void;
  size?: number;
  label?: string;
  locked?: boolean;
}> = ({ rating, onRatingChange, size = 32, label, locked = false }) => {
  const { theme } = useTheme();
  
  return (
    <View style={{ alignItems: 'center' }}>
      {label && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
            {label}
          </Text>
          {locked && (
            <Ionicons name="lock-closed" size={14} color={theme.muted} />
          )}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, opacity: locked ? 0.7 : 1 }}>
        {[1, 2, 3, 4, 5].map((star) => (
          locked ? (
            <View key={star}>
              <Ionicons
                name={star <= rating ? 'star' : 'star-outline'}
                size={size}
                color={star <= rating ? '#FFD700' : theme.border}
              />
            </View>
          ) : (
            <TouchableOpacity
              key={star}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onRatingChange?.(star);
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={star <= rating ? 'star' : 'star-outline'}
                size={size}
                color={star <= rating ? '#FFD700' : theme.border}
              />
            </TouchableOpacity>
          )
        ))}
      </View>
    </View>
  );
};

export const ActivityRatingModal: React.FC<ActivityRatingModalProps> = ({
  visible,
  activity,
  onClose,
  onRatingSubmitted,
}) => {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // Extract activity properties
  const activityId = activity?.id || '';
  const sport = activity?.activity || '';
  const hasRoute = activity?.hasRoute || false;
  const participants = activity?.joinedParticipants || activity?.participants || [];

  // Rating states
  const [overallRating, setOverallRating] = useState(0);
  const [venueRating, setVenueRating] = useState(0);
  const [routeRating, setRouteRating] = useState(0);
  const [everyoneShowedUp, setEveryoneShowedUp] = useState<boolean | null>(null);
  const [noShowIds, setNoShowIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [activityParticipants, setActivityParticipants] = useState<any[]>([]);

  // Determine sport config
  const sportLower = sport.toLowerCase();
  
  // Get venue config for this sport
  const venueConfig = Object.entries(SPORT_VENUE_CONFIG).find(([key]) => 
    sportLower.includes(key)
  )?.[1];
  
  // Get route config for this sport
  const routeConfig = Object.entries(ROUTE_CONFIG).find(([key]) => 
    sportLower.includes(key)
  )?.[1];
  
  const showVenueRating = !!venueConfig;
  const showRouteRating = hasRoute || ROUTE_SPORTS.some(s => sportLower.includes(s));

  // Animations
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(height)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const noShowAnim = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;

  // Dismiss threshold (drag distance needed to dismiss)
  const DISMISS_THRESHOLD = 120;

  // Pan responder for drag-to-dismiss
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to downward gestures
        return gestureState.dy > 5;
      },
      onPanResponderGrant: () => {
        // Reset pan value when starting
        panY.setValue(0);
      },
      onPanResponderMove: (_, gestureState) => {
        // Only allow downward drag (positive dy)
        if (gestureState.dy > 0) {
          panY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > DISMISS_THRESHOLD || gestureState.vy > 0.5) {
          // Dismiss - animate out smoothly
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Animated.parallel([
            Animated.timing(panY, {
              toValue: height,
              duration: 250,
              useNativeDriver: true,
            }),
            Animated.timing(overlayOpacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start(() => {
            panY.setValue(0);
            onClose();
          });
        } else {
          // Snap back
          Animated.spring(panY, {
            toValue: 0,
            tension: 100,
            friction: 10,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      checkIfAlreadyRated();
      loadParticipants();
      panY.setValue(0);
      
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: height,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
      
      setTimeout(() => {
        setOverallRating(0);
        setVenueRating(0);
        setRouteRating(0);
        setEveryoneShowedUp(null);
        setNoShowIds([]);
        setFeedback('');
        setSubmitted(false);
        setAlreadyRated(false);
      }, 300);
    }
  }, [visible]);

  // Animate no-show section
  useEffect(() => {
    Animated.spring(noShowAnim, {
      toValue: everyoneShowedUp === false ? 1 : 0,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [everyoneShowedUp]);

  const loadParticipants = async () => {
    if (participants.length > 0) {
      setActivityParticipants(participants);
      return;
    }
    
    try {
      const activityRef = doc(db, 'activities', activityId);
      const activitySnap = await getDoc(activityRef);
      
      if (activitySnap.exists()) {
        const data = activitySnap.data();
        const joinedUserIds: string[] = data.joinedUserIds || [];
        
        if (joinedUserIds.length > 0) {
          const users = await fetchUsersByIds(joinedUserIds);
          setActivityParticipants(users);
        }
      }
    } catch (error) {
      console.warn('Error loading participants:', error);
    }
  };

  const checkIfAlreadyRated = async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      
      const activityRef = doc(db, 'activities', activityId);
      const activitySnap = await getDoc(activityRef);
      
      if (activitySnap.exists()) {
        const data = activitySnap.data();
        const ratings = data.ratings || [];
        const userRating = ratings.find((r: any) => r.raterId === uid);
        if (userRating) {
          setAlreadyRated(true);
          setOverallRating(userRating.overall || 0);
          setVenueRating(userRating.venue || 0);
          setRouteRating(userRating.route || 0);
          setEveryoneShowedUp(userRating.everyoneShowedUp ?? null);
          setNoShowIds(userRating.noShowIds || []);
          setFeedback(userRating.feedback || '');
        }
      }
    } catch (error) {
      console.warn('Error checking rating:', error);
    }
  };

  const toggleNoShow = (oderId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNoShowIds(prev => 
      prev.includes(oderId) 
        ? prev.filter(id => id !== oderId)
        : [...prev, oderId]
    );
  };

  const handleSubmit = async () => {
    if (overallRating === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('Not authenticated');

      const ratingData: any = {
        raterId: uid,
        ratedAt: new Date().toISOString(),
        overall: overallRating,
      };
      
      if (showVenueRating && venueRating > 0) {
        ratingData.venue = venueRating;
        ratingData.venueType = venueConfig?.replace('Rate the ', '').toLowerCase();
      }
      
      if (showRouteRating && routeRating > 0) {
        ratingData.route = routeRating;
      }
      
      if (everyoneShowedUp !== null) {
        ratingData.everyoneShowedUp = everyoneShowedUp;
        if (!everyoneShowedUp && noShowIds.length > 0) {
          ratingData.noShowIds = noShowIds;
        }
      }
      
      if (feedback.trim()) {
        ratingData.feedback = feedback.trim();
      }

      const activityRef = doc(db, 'activities', activityId);
      
      const activitySnap = await getDoc(activityRef);
      if (activitySnap.exists()) {
        const data = activitySnap.data();
        const existingRatings = (data.ratings || []).filter((r: any) => r.raterId !== uid);
        
        await updateDoc(activityRef, {
          ratings: [...existingRatings, ratingData],
        });
      }

      setSubmitted(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      Animated.spring(successScale, {
        toValue: 1,
        tension: 100,
        friction: 6,
        useNativeDriver: true,
      }).start();

      setTimeout(() => {
        onRatingSubmitted?.(activityId, overallRating);
        onClose();
      }, 1500);

    } catch (error) {
      console.error('Error submitting rating:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  // Filter out current user from participants for no-show selection
  const otherParticipants = activityParticipants.filter(
    p => p.uid !== auth.currentUser?.uid
  );

  if (!visible || !activity) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <Animated.View 
          style={[styles.overlay, { opacity: overlayOpacity }]}
        >
          <TouchableOpacity 
            style={StyleSheet.absoluteFill} 
            onPress={handleClose}
            activeOpacity={1}
          />
          
          <Animated.View
            style={[
              styles.modalCard,
              { 
                transform: [
                  { translateY: Animated.add(slideAnim, panY) },
                ],
              },
            ]}
          >
            {/* Draggable handle area */}
            <Animated.View 
              {...panResponder.panHandlers}
              style={styles.handleArea}
            >
              <View style={styles.handleBar} />
            </Animated.View>

            {submitted ? (
              <Animated.View 
                style={[
                  styles.successContainer,
                  { transform: [{ scale: successScale }] }
                ]}
              >
                <View style={styles.successIcon}>
                  <Ionicons name="checkmark-circle" size={64} color="#10B981" />
                </View>
                <Text style={styles.successTitle}>Thanks for rating!</Text>
                <Text style={styles.successSubtitle}>
                  Your feedback helps the community
                </Text>
              </Animated.View>
            ) : (
              <ScrollView 
                showsVerticalScrollIndicator={false}
                bounces={false}
                contentContainerStyle={styles.scrollContent}
              >
                {/* Header */}
                <View style={styles.header}>
                  <View style={styles.iconContainer}>
                    <ActivityIcon activity={sport} size={40} color={theme.primary} />
                  </View>
                  <Text style={styles.title}>{alreadyRated ? 'Your Rating' : 'How was it?'}</Text>
                  <Text style={styles.subtitle}>{sport}</Text>
                </View>

                {alreadyRated && (
                  <View style={styles.alreadyRatedBadge}>
                    <Ionicons name="lock-closed" size={16} color={theme.primary} />
                    <Text style={styles.alreadyRatedText}>Rating submitted • Cannot be changed</Text>
                  </View>
                )}

                {/* Overall Rating */}
                <View style={styles.ratingSection}>
                  <Text style={styles.sectionTitle}>Overall Experience</Text>
                  <StarRating
                    rating={overallRating}
                    onRatingChange={alreadyRated ? undefined : setOverallRating}
                    size={40}
                    locked={alreadyRated}
                  />
                  {!alreadyRated && (
                    <Text style={styles.ratingHint}>
                      {overallRating === 0 && 'Tap to rate'}
                      {overallRating === 1 && 'Not great'}
                      {overallRating === 2 && 'Could be better'}
                      {overallRating === 3 && 'It was okay'}
                      {overallRating === 4 && 'Really good!'}
                      {overallRating === 5 && 'Amazing!'}
                    </Text>
                  )}
                </View>

                {/* Venue Rating (sport-specific) */}
                {showVenueRating && venueConfig && (venueRating > 0 || !alreadyRated) && (
                  <View style={styles.ratingSection}>
                    <StarRating
                      rating={venueRating}
                      onRatingChange={alreadyRated ? undefined : setVenueRating}
                      size={32}
                      label={venueConfig}
                      locked={alreadyRated}
                    />
                    {!alreadyRated && (
                      <Text style={styles.ratingHintSmall}>
                        {venueRating === 0 && 'Optional'}
                        {venueRating === 1 && 'Poor condition'}
                        {venueRating === 2 && 'Needs improvement'}
                        {venueRating === 3 && 'Decent'}
                        {venueRating === 4 && 'Good quality'}
                        {venueRating === 5 && 'Excellent!'}
                      </Text>
                    )}
                  </View>
                )}

                {/* Route Rating (conditional) */}
                {showRouteRating && (routeRating > 0 || !alreadyRated) && (
                  <View style={styles.ratingSection}>
                    <StarRating
                      rating={routeRating}
                      onRatingChange={alreadyRated ? undefined : setRouteRating}
                      size={32}
                      label={routeConfig || 'Rate the Route'}
                      locked={alreadyRated}
                    />
                    {!alreadyRated && (
                      <Text style={styles.ratingHintSmall}>
                        {routeRating === 0 && 'Optional'}
                        {routeRating === 1 && 'Difficult/Poor'}
                        {routeRating === 2 && 'Below average'}
                        {routeRating === 3 && 'Average'}
                        {routeRating === 4 && 'Good'}
                        {routeRating === 5 && 'Perfect!'}
                      </Text>
                    )}
                  </View>
                )}

                {/* Attendance Check - only show if answered or not locked */}
                {(everyoneShowedUp !== null || !alreadyRated) && (
                  <View style={styles.ratingSection}>
                    <Text style={styles.sectionTitle}>
                      Did everyone show up?
                      {alreadyRated && <Text style={{ color: theme.muted }}> </Text>}
                      {alreadyRated && <Ionicons name="lock-closed" size={14} color={theme.muted} />}
                    </Text>
                    <View style={[styles.attendanceButtons, alreadyRated && { opacity: 0.7 }]}>
                      <TouchableOpacity
                        style={[
                          styles.attendanceButton,
                          everyoneShowedUp === true && styles.attendanceButtonActive,
                        ]}
                        onPress={() => {
                          if (alreadyRated) return;
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setEveryoneShowedUp(true);
                          setNoShowIds([]);
                        }}
                        activeOpacity={alreadyRated ? 1 : 0.7}
                      >
                        <Ionicons 
                          name="checkmark-circle" 
                          size={24} 
                          color={everyoneShowedUp === true ? '#10B981' : theme.muted} 
                        />
                        <Text style={[
                          styles.attendanceText,
                          everyoneShowedUp === true && styles.attendanceTextActive,
                        ]}>
                          Yes, all good!
                        </Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity
                        style={[
                          styles.attendanceButton,
                          everyoneShowedUp === false && styles.attendanceButtonActiveNo,
                        ]}
                        onPress={() => {
                          if (alreadyRated) return;
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setEveryoneShowedUp(false);
                        }}
                        activeOpacity={alreadyRated ? 1 : 0.7}
                      >
                        <Ionicons 
                          name="close-circle" 
                          size={24} 
                          color={everyoneShowedUp === false ? '#EF4444' : theme.muted} 
                        />
                        <Text style={[
                          styles.attendanceText,
                          everyoneShowedUp === false && styles.attendanceTextActiveNo,
                        ]}>
                          Some didn't
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* No-Show Selection - only if not locked or has data */}
                {everyoneShowedUp === false && otherParticipants.length > 0 && !alreadyRated && (
                  <Animated.View 
                    style={[
                      styles.noShowSection,
                      {
                        opacity: noShowAnim,
                        transform: [{
                          translateY: noShowAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-10, 0],
                          }),
                        }],
                      },
                    ]}
                  >
                    <Text style={styles.noShowTitle}>
                      Who didn't show up?
                    </Text>
                    <Text style={styles.noShowSubtitle}>
                      Select the participants who were absent
                    </Text>
                    <View style={styles.noShowList}>
                      {otherParticipants.map((participant) => {
                        const oderId = participant.uid || '';
                        const isSelected = noShowIds.includes(oderId);
                        return (
                          <TouchableOpacity
                            key={oderId}
                            style={[
                              styles.noShowItem,
                              isSelected && styles.noShowItemSelected,
                            ]}
                            onPress={() => toggleNoShow(oderId)}
                            activeOpacity={0.7}
                          >
                            <UserAvatar
                              photoUrl={participant.photoURL || participant.profilePicture}
                              username={participant.username}
                              size={36}
                            />
                            <Text style={[
                              styles.noShowName,
                              isSelected && styles.noShowNameSelected,
                            ]}>
                              {participant.username || 'User'}
                            </Text>
                            <View style={[
                              styles.noShowCheckbox,
                              isSelected && styles.noShowCheckboxSelected,
                            ]}>
                              {isSelected && (
                                <Ionicons name="close" size={14} color="#fff" />
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {noShowIds.length > 0 && (
                      <Text style={styles.noShowCount}>
                        {noShowIds.length} participant{noShowIds.length !== 1 ? 's' : ''} marked as no-show
                      </Text>
                    )}
                  </Animated.View>
                )}

                {/* Locked No-Show Display */}
                {alreadyRated && everyoneShowedUp === false && noShowIds.length > 0 && (
                  <View style={[styles.noShowSection, { opacity: 0.7 }]}>
                    <Text style={styles.noShowTitle}>
                      No-shows reported
                    </Text>
                    <Text style={styles.noShowCount}>
                      {noShowIds.length} participant{noShowIds.length !== 1 ? 's' : ''} marked as absent
                    </Text>
                  </View>
                )}

                {/* Optional Feedback - show readonly if locked with content */}
                {(!alreadyRated || feedback.length > 0) && (
                  <View style={styles.ratingSection}>
                    <Text style={styles.sectionTitle}>
                      {alreadyRated ? 'Your feedback' : 'Any thoughts?'} {!alreadyRated && <Text style={styles.optional}>(optional)</Text>}
                      {alreadyRated && feedback.length > 0 && (
                        <Text style={{ color: theme.muted }}> <Ionicons name="lock-closed" size={14} color={theme.muted} /></Text>
                      )}
                    </Text>
                    {alreadyRated ? (
                      feedback.length > 0 && (
                        <View style={[styles.feedbackInput, { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }]}>
                          <Text style={{ color: theme.text, fontSize: 14 }}>{feedback}</Text>
                        </View>
                      )
                    ) : (
                      <>
                        <TextInput
                          style={styles.feedbackInput}
                          placeholder="Share your experience..."
                          placeholderTextColor={theme.muted}
                          value={feedback}
                          onChangeText={setFeedback}
                          multiline
                          maxLength={200}
                          textAlignVertical="top"
                        />
                        <Text style={styles.charCount}>{feedback.length}/200</Text>
                      </>
                    )}
                  </View>
                )}

                {/* Anonymous Rating Notice */}
                <View style={styles.anonymousNotice}>
                  <Ionicons name="shield-checkmark" size={16} color={theme.muted} />
                  <Text style={styles.anonymousText}>
                    Ratings are anonymous. Only SportsPal uses this data to improve recommendations and services.
                  </Text>
                </View>

                {/* Submit Button or Close Button */}
                {alreadyRated ? (
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={handleClose}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={styles.submitButtonText}>Done</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.submitButton,
                        overallRating === 0 && styles.submitButtonDisabled,
                      ]}
                      onPress={handleSubmit}
                      disabled={overallRating === 0 || submitting}
                      activeOpacity={0.8}
                    >
                      {submitting ? (
                        <Text style={styles.submitButtonText}>Submitting...</Text>
                      ) : (
                        <>
                          <Ionicons name="paper-plane" size={18} color="#fff" />
                          <Text style={styles.submitButtonText}>Submit Rating</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.skipButton}
                      onPress={handleClose}
                    >
                      <Text style={styles.skipButtonText}>Maybe later</Text>
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>
            )}
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'flex-end',
    },
    modalCard: {
      backgroundColor: theme.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      maxHeight: height * 0.9,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: theme.border,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
        },
        android: {
          elevation: 16,
        },
      }),
    },
    handleArea: {
      width: '100%',
      alignItems: 'center',
      paddingVertical: 8,
      paddingBottom: 4,
    },
    handleBar: {
      width: 40,
      height: 4,
      backgroundColor: theme.border,
      borderRadius: 2,
    },
    scrollContent: {
      padding: 24,
      paddingTop: 8,
    },
    header: {
      alignItems: 'center',
      marginBottom: 24,
    },
    iconContainer: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 12,
      borderWidth: 2,
      borderColor: theme.primary,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 15,
      color: theme.muted,
    },
    alreadyRatedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#10B98120',
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 20,
      alignSelf: 'center',
      marginBottom: 16,
      gap: 6,
    },
    alreadyRatedText: {
      fontSize: 13,
      fontWeight: '600',
      color: '#10B981',
    },
    ratingSection: {
      marginBottom: 24,
      alignItems: 'center',
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 12,
      textAlign: 'center',
    },
    optional: {
      fontWeight: '400',
      color: theme.muted,
    },
    ratingHint: {
      fontSize: 14,
      color: theme.muted,
      marginTop: 8,
    },
    ratingHintSmall: {
      fontSize: 12,
      color: theme.muted,
      marginTop: 6,
    },
    attendanceButtons: {
      flexDirection: 'row',
      gap: 12,
    },
    attendanceButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 12,
      backgroundColor: theme.background,
      borderWidth: 2,
      borderColor: 'transparent',
      gap: 8,
    },
    attendanceButtonActive: {
      borderColor: '#10B981',
      backgroundColor: '#10B98115',
    },
    attendanceButtonActiveNo: {
      borderColor: '#EF4444',
      backgroundColor: '#EF444415',
    },
    attendanceText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.muted,
    },
    attendanceTextActive: {
      color: '#10B981',
    },
    attendanceTextActiveNo: {
      color: '#EF4444',
    },
    noShowSection: {
      backgroundColor: theme.background,
      borderRadius: 16,
      padding: 16,
      marginBottom: 24,
      borderWidth: 1,
      borderColor: '#EF444440',
    },
    noShowTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginBottom: 4,
    },
    noShowSubtitle: {
      fontSize: 13,
      color: theme.muted,
      textAlign: 'center',
      marginBottom: 16,
    },
    noShowList: {
      gap: 8,
    },
    noShowItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 10,
      borderRadius: 12,
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 12,
    },
    noShowItemSelected: {
      borderColor: '#EF4444',
      backgroundColor: '#EF444410',
    },
    noShowName: {
      flex: 1,
      fontSize: 14,
      fontWeight: '600',
      color: theme.text,
    },
    noShowNameSelected: {
      color: '#EF4444',
    },
    noShowCheckbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noShowCheckboxSelected: {
      backgroundColor: '#EF4444',
      borderColor: '#EF4444',
    },
    noShowCount: {
      fontSize: 12,
      color: '#EF4444',
      textAlign: 'center',
      marginTop: 12,
      fontWeight: '600',
    },
    feedbackInput: {
      width: '100%',
      minHeight: 80,
      backgroundColor: theme.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      color: theme.text,
      borderWidth: 1,
      borderColor: theme.border,
    },
    charCount: {
      fontSize: 12,
      color: theme.muted,
      alignSelf: 'flex-end',
      marginTop: 4,
    },
    submitButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: 16,
      borderRadius: 14,
      gap: 8,
      marginTop: 8,
    },
    submitButtonDisabled: {
      backgroundColor: theme.muted,
      opacity: 0.5,
    },
    submitButtonText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#fff',
    },
    skipButton: {
      alignItems: 'center',
      paddingVertical: 16,
    },
    skipButtonText: {
      fontSize: 14,
      color: theme.muted,
    },
    closeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#10B981',
      paddingVertical: 16,
      borderRadius: 14,
      gap: 8,
      marginTop: 8,
    },
    anonymousNotice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      gap: 10,
      marginTop: 8,
      marginBottom: 8,
    },
    anonymousText: {
      flex: 1,
      fontSize: 12,
      color: theme.muted,
      lineHeight: 17,
    },
    successContainer: {
      alignItems: 'center',
      padding: 40,
    },
    successIcon: {
      marginBottom: 16,
    },
    successTitle: {
      fontSize: 22,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 8,
    },
    successSubtitle: {
      fontSize: 15,
      color: theme.muted,
    },
  });
