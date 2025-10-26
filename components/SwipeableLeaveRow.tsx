import React, { useRef } from 'react';
import { Animated, PanResponder, View, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

interface SwipeableLeaveRowProps {
  children: React.ReactNode;
  onSwipeLeave: () => void;
  enabled?: boolean;
}

// Swipe threshold in px
const SWIPE_THRESHOLD = 100;

export const SwipeableLeaveRow: React.FC<SwipeableLeaveRowProps> = ({ children, onSwipeLeave, enabled = true }) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const triggeredRef = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => enabled && Math.abs(gestureState.dx) > 10,
      onPanResponderMove: (_, gestureState) => {
        if (!enabled) return;
        translateX.setValue(gestureState.dx);
        if (!triggeredRef.current && Math.abs(gestureState.dx) > SWIPE_THRESHOLD) {
          triggeredRef.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (!enabled) return;
        if (Math.abs(gestureState.dx) > SWIPE_THRESHOLD) {
          onSwipeLeave();
        }
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start(() => {
          triggeredRef.current = false;
        });
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start(() => {
          triggeredRef.current = false;
        });
      },
    })
  ).current;

  return (
    <Animated.View
      style={{ transform: [{ translateX }] }}
      {...(enabled ? panResponder.panHandlers : {})}
    >
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({});
