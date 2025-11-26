// screens/RegisterEmailScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Animated,
  Keyboard,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import Logo from '../components/Logo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { auth } from '../firebaseConfig';

const RegisterEmailScreen = () => {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordStrength, setPasswordStrength] = useState<{score: number; color: string; label: string; percent: number}>({ score: 0, color: '#cc3030', label: 'Very weak', percent: 0 });
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, []);

  const getPasswordChecks = (pwd: string) => ({
    len: pwd.length >= 8,
    upper: /[A-Z]/.test(pwd),
    number: /\d/.test(pwd),
    symbol: /[^A-Za-z0-9]/.test(pwd),
  });

  const computeStrength = (pwd: string) => {
    const c = getPasswordChecks(pwd);
    const score = [c.len, c.upper, c.number, c.symbol].filter(Boolean).length;
    const percent = (score / 4) * 100;
    const color = score <= 1 ? '#cc3030' : score === 2 ? '#e67e22' : score === 3 ? '#f1c40f' : '#2ecc71';
    const label = score <= 1 ? 'Very weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Great';
    return { score, color, label, percent };
  };

  useEffect(() => {
    setPasswordStrength(computeStrength(password));
    setPasswordError(null);
  }, [password]);

  const handleContinue = async () => {
    if (!email || !password || !confirmPassword) {
      Alert.alert('Missing Info', 'Please fill in all fields.');
      return;
    }

    const checks = getPasswordChecks(password);
    if (!(checks.len && checks.upper && checks.number && checks.symbol)) {
      setPasswordError('Password must meet all requirements.');
      Alert.alert('Weak Password', 'Please meet all password requirements.');
      return;
    }

    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(userCredential.user);
      
      // Navigate directly to CreateProfile - verification gate will handle email verification
      navigation.navigate('CreateProfile', { mode: 'create' });
    } catch (error: any) {
      console.error('Registration error:', error);
      if (error?.code === 'auth/email-already-in-use') {
        Alert.alert('Email In Use', 'An account with this email already exists. Try signing in instead.');
      } else if (error?.code === 'auth/invalid-email') {
        Alert.alert('Invalid Email', 'Please enter a valid email address.');
      } else {
        Alert.alert('Error', error.message || 'Failed to create account. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.container, { paddingBottom: 20 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go Back"
        >
          <Ionicons name="arrow-back" size={28} color={theme.primary} />
        </TouchableOpacity>

        <Logo />

        <Text style={styles.title}>Create Your Account</Text>
        <Text style={styles.subtitle}>Enter your email and create a password</Text>

        <View style={styles.formContainer}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#999"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#999"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TextInput
            style={styles.input}
            placeholder="Confirm Password"
            placeholderTextColor="#999"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

          <View style={styles.strengthBarContainer}>
            <View style={styles.strengthBarBg}>
              <View style={[styles.strengthBarFill, { width: `${passwordStrength.percent}%`, backgroundColor: passwordStrength.color }]} />
            </View>
            <Text style={[styles.strengthLabel, { color: passwordStrength.color }]}>{passwordStrength.label}</Text>
          </View>

          <View style={styles.requirementsBox}>
            <Text style={styles.requirementsTitle}>Your password must include:</Text>
            {(() => { const c = getPasswordChecks(password); return (
              <>
                <Text style={[styles.requirementItem, { color: c.len ? '#2ecc71' : '#bbb' }]}>• At least 8 characters</Text>
                <Text style={[styles.requirementItem, { color: c.upper ? '#2ecc71' : '#bbb' }]}>• One uppercase letter</Text>
                <Text style={[styles.requirementItem, { color: c.number ? '#2ecc71' : '#bbb' }]}>• One number</Text>
                <Text style={[styles.requirementItem, { color: c.symbol ? '#2ecc71' : '#bbb' }]}>• One symbol</Text>
              </>
            ); })()}
          </View>
        </View>

        <TouchableOpacity
          style={styles.continueButton}
          onPress={handleContinue}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.continueButtonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </Animated.View>
  );
};

const createStyles = (t: any) => StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: t.background,
  },
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: t.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    padding: 4,
    zIndex: 10,
  },
  title: {
    fontSize: 28,
    color: t.primary,
    fontWeight: '700',
    marginVertical: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: t.muted,
    marginBottom: 30,
    textAlign: 'center',
  },
  formContainer: {
    width: '100%',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    padding: 14,
    fontSize: 16,
    color: t.text,
    marginVertical: 8,
  },
  errorText: {
    color: '#ff6b6b',
    marginBottom: 6,
  },
  strengthBarContainer: {
    width: '100%',
    marginTop: 6,
    marginBottom: 8,
  },
  strengthBarBg: {
    width: '100%',
    height: 8,
    borderRadius: 8,
    backgroundColor: t.border,
    overflow: 'hidden',
  },
  strengthBarFill: {
    height: 8,
    borderRadius: 8,
  },
  strengthLabel: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  requirementsBox: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: t.border,
    marginTop: 6,
  },
  requirementsTitle: {
    color: t.text,
    fontWeight: '700',
    marginBottom: 6,
  },
  requirementItem: {
    fontSize: 13,
    marginVertical: 2,
  },
  continueButton: {
    backgroundColor: t.primary,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    alignItems: 'center',
    width: '100%',
    marginTop: 10,
    shadowColor: t.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
});

export default RegisterEmailScreen;
