import React from 'react';
import { TouchableOpacity, ActivityIndicator, StyleSheet, View, ViewStyle, Image } from 'react-native';

interface AddToAppleWalletButtonProps {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

/**
 * "Add to Apple Wallet" button following Apple's official guidelines.
 * 
 * NOTE: Apple's guidelines state that for apps, PKAddPassButton should be used.
 * In React Native, the most reliable approach is to display the official Apple-provided
 * badge artwork as an image.
 *
 * This component expects the official badge SVG (from Apple's download) to be converted
 * into a PNG at: assets/add-to-apple-wallet.png
 * 
 * @see https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/
 */
const AddToAppleWalletButton: React.FC<AddToAppleWalletButtonProps> = ({
  onPress,
  disabled = false,
  loading = false,
  style,
}) => {
  // Official Apple badge aspect ratio ~3.16:1
  const badgeWidth = 160;
  const badgeHeight = 50;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[styles.button, style]}
      accessibilityLabel="Add to Apple Wallet"
      accessibilityRole="button"
    >
      <View style={[styles.badge, { width: badgeWidth, height: badgeHeight }]}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Image
            source={require('../assets/add-to-apple-wallet.png')}
            style={{ width: badgeWidth, height: badgeHeight }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    margin: 6,
  },
  badge: {
    backgroundColor: '#000000',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: '#333333',
  },
});

export default AddToAppleWalletButton;
