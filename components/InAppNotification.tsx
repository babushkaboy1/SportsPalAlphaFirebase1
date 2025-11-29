import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import UserAvatar from './UserAvatar';

interface InAppNotificationProps {
  visible: boolean;
  title: string;
  body: string;
  image?: string;
  type?: 'chat' | 'activity_invite' | 'friend_request' | 'friend_accept' | 'group_chat';
  onPress: () => void;
  onDismiss: () => void;
}

export const InAppNotification: React.FC<InAppNotificationProps> = ({
  visible,
  title,
  body,
  image,
  type = 'chat',
  onPress,
  onDismiss,
}) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-200)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const gestureTranslateY = useRef(new Animated.Value(0)).current;
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (visible) {
      // Reset gesture translation
      gestureTranslateY.setValue(0);
      
      // Slide down and fade in
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss after 4 seconds
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = setTimeout(() => {
        dismissNotification();
      }, 4000);

      return () => {
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      };
    } else {
      dismissNotification();
    }
  }, [visible]);

  const dismissNotification = () => {
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -200,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      gestureTranslateY.setValue(0);
      onDismiss();
    });
  };

  const handleGestureEvent = Animated.event(
    [{ nativeEvent: { translationY: gestureTranslateY } }],
    { useNativeDriver: true }
  );

  const handleGestureStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END) {
      const { translationY, velocityY } = event.nativeEvent;
      
      // If swiped up significantly or with high velocity, dismiss
      if (translationY < -50 || velocityY < -500) {
        // Swipe up to dismiss
        Animated.parallel([
          Animated.timing(gestureTranslateY, {
            toValue: -300,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => {
          gestureTranslateY.setValue(0);
          translateY.setValue(-200);
          onDismiss();
        });
      } else {
        // Spring back to original position
        Animated.spring(gestureTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }).start();
      }
    }
  };

  const handlePress = () => {
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    dismissNotification();
    setTimeout(() => onPress(), 300);
  };

  const renderIcon = () => {
    // For group chats, show group icon
    if (type === 'group_chat') {
      return (
        <View style={[styles.iconContainer, { backgroundColor: theme.primary + '20' }]}>
          <Ionicons name="people" size={24} color={theme.primary} />
        </View>
      );
    }
    
    // For activity invites, show activity icon
    if (type === 'activity_invite') {
      return (
        <View style={[styles.iconContainer, { backgroundColor: theme.primary + '20' }]}>
          <Ionicons name="calendar" size={24} color={theme.primary} />
        </View>
      );
    }
    
    // For friend requests/accepts, show person icon
    if (type === 'friend_request' || type === 'friend_accept') {
      return (
        <View style={[styles.iconContainer, { backgroundColor: theme.primary + '20' }]}>
          <Ionicons name="person-add" size={24} color={theme.primary} />
        </View>
      );
    }
    
    // For DMs with image, show profile picture
    if (image) {
      return (
        <UserAvatar
          photoUrl={image}
          username="User"
          size={44}
          style={styles.avatar}
        />
      );
    }
    
    // Default notification icon
    return (
      <View style={[styles.iconContainer, { backgroundColor: theme.primary + '20' }]}>
        <Ionicons name="notifications" size={24} color={theme.primary} />
      </View>
    );
  };

  if (!visible) return null;

  const combinedTranslateY = Animated.add(translateY, gestureTranslateY);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top + 8,
          transform: [{ translateY: combinedTranslateY }],
          opacity,
        },
      ]}
    >
      <PanGestureHandler
        onGestureEvent={handleGestureEvent}
        onHandlerStateChange={handleGestureStateChange}
      >
        <Animated.View>
          <TouchableOpacity
            style={[styles.notification, { backgroundColor: theme.card }]}
            onPress={handlePress}
            activeOpacity={0.9}
          >
            <View style={styles.content}>
              {renderIcon()}
              
              <View style={styles.textContainer}>
                <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={[styles.body, { color: theme.muted }]} numberOfLines={2}>
                  {body}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.closeButton}
                onPress={(e) => {
                  e.stopPropagation();
                  dismissNotification();
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>
            
            {/* Bottom indicator bar (iPhone-style) */}
            <View style={styles.bottomIndicator}>
              <View style={[styles.indicatorBar, { backgroundColor: theme.muted + '40' }]} />
            </View>
          </TouchableOpacity>
        </Animated.View>
      </PanGestureHandler>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  notification: {
    borderRadius: 16,
    padding: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  body: {
    fontSize: 14,
    lineHeight: 18,
  },
  closeButton: {
    padding: 4,
  },
  bottomIndicator: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  indicatorBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
});
