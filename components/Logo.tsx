// components/Logo.tsx
import React from 'react';
import { Image, StyleSheet } from 'react-native';

const Logo = () => {
  return (
    <Image source={require('../assets/logo.png')} style={styles.logo} />
  );
};

const styles = StyleSheet.create({
  logo: {
    width: 120,        // Adjust size as needed
    height: 120,
    resizeMode: 'contain',
  },
});

export default Logo;