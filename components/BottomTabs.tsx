import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type BottomTabItem = {
  key: string;
  label: string;
  icon: string;
  iconActive?: string;
  badge?: string;
};

type BottomTabsProps = {
  items: ReadonlyArray<BottomTabItem>;
  activeIndex: number;
  onTabPress: (index: number) => void;
  activeColor: string;
  inactiveColor: string;
  backgroundColor: string;
  borderColor?: string;
};

export const BottomTabs: React.FC<BottomTabsProps> = ({
  items,
  activeIndex,
  onTabPress,
  activeColor,
  inactiveColor,
  backgroundColor,
  borderColor,
}) => {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'android' ? 18 : 24);
  const containerHeight = 58 + bottomPadding;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor,
          borderTopColor: borderColor || 'transparent',
          paddingBottom: bottomPadding,
          minHeight: containerHeight,
        },
      ]}
    >
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        const iconName = isActive && item.iconActive ? item.iconActive : item.icon;
        const tintColor = isActive ? activeColor : inactiveColor;

        return (
          <TouchableOpacity
            key={item.key}
            style={styles.tab}
            onPress={() => onTabPress(index)}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <View style={styles.iconWrapper}>
              <Ionicons name={iconName as any} size={26} color={tintColor} />
              {item.badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>{item.badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, { color: tintColor }]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
  },
  iconWrapper: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '500',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -18,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#e74c3c',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
});
