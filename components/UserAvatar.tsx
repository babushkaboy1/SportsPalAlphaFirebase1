// components/UserAvatar.tsx
import React from 'react';
import { View, Text, StyleSheet, ImageStyle, ViewStyle, StyleProp } from 'react-native';
import { Image } from 'expo-image';

interface UserAvatarProps {
  photoUrl?: string | null;
  username?: string;
  size?: number;
  style?: StyleProp<ImageStyle>;
  borderColor?: string;
  borderWidth?: number;
}

const UserAvatar: React.FC<UserAvatarProps> = ({
  photoUrl,
  username,
  size = 100,
  style,
  borderColor,
  borderWidth,
}) => {
  const avatarStyle = [
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: borderWidth || 0,
      borderColor: borderColor || 'transparent',
    },
    style,
  ];

  if (photoUrl) {
    return (
      <Image 
        source={{ uri: photoUrl }} 
        style={avatarStyle}
        cachePolicy="memory-disk"
        contentFit="cover"
        transition={200}
      />
    );
  }

  // Placeholder with black background and cyan first letter
  const firstLetter = username ? username.charAt(0).toUpperCase() : '?';
  const fontSize = size * 0.4; // 40% of avatar size

  return (
    <View
      style={[
        avatarStyle,
        {
          backgroundColor: '#000',
          justifyContent: 'center',
          alignItems: 'center',
        },
      ]}
    >
      <Text
        style={{
          color: '#00CED1',
          fontSize: fontSize,
          fontWeight: 'bold',
        }}
      >
        {firstLetter}
      </Text>
    </View>
  );
};

export default UserAvatar;
