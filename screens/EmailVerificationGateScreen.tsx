// screens/EmailVerificationGateScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import Ionicons from '@expo/vector-icons/Ionicons';
import { auth } from '../firebaseConfig';
import { sendEmailVerification } from 'firebase/auth';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import Logo from '../components/Logo';
import { db } from '../firebaseConfig';
import { doc, updateDoc } from 'firebase/firestore';

const EmailVerificationGateScreen = () => {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [isChecking, setIsChecking] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [email, setEmail] = useState(auth.currentUser?.email || '');

  // Check if user is already verified on mount and redirect immediately
  useEffect(() => {
    const checkInitialVerification = async () => {
      const user = auth.currentUser;
      if (!user) return;

      await user.reload();
      
      if (user.emailVerified) {
        // Update Firestore profile with emailVerified: true
        try {
          await updateDoc(doc(db, 'profiles', user.uid), {
            emailVerified: true
          });
          console.log('✅ Profile updated with emailVerified: true');
        } catch (error) {
          console.error('Error updating profile with emailVerified:', error);
        }

        // User is already verified! Navigate to main app immediately
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'MainTabs' }],
          })
        );
      }
    };
    
    checkInitialVerification();
  }, []);

  // Auto-check verification every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      checkVerification(true); // silent check
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const checkVerification = async (silent = false) => {
    if (!silent) setIsChecking(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        Alert.alert('Error', 'No user logged in');
        return;
      }

      await user.reload();
      
      if (user.emailVerified) {
        // Update Firestore profile with emailVerified: true
        try {
          await updateDoc(doc(db, 'profiles', user.uid), {
            emailVerified: true
          });
          console.log('✅ Profile updated with emailVerified: true');
        } catch (error) {
          console.error('Error updating profile with emailVerified:', error);
        }

        // User is verified! Navigate to main app
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'MainTabs' }],
          })
        );
      } else if (!silent) {
        Alert.alert('Not Yet', 'Email not verified yet. Please check your inbox and click the verification link.');
      }
    } catch (error: any) {
      console.error('Check verification error:', error);
      if (!silent) {
        Alert.alert('Error', 'Could not check verification status.');
      }
    } finally {
      if (!silent) setIsChecking(false);
    }
  };

  const handleResend = async () => {
    try {
      setIsResending(true);
      const user = auth.currentUser;
      if (!user) {
        Alert.alert('Error', 'No user logged in');
        return;
      }

      await sendEmailVerification(user);
      Alert.alert('Sent!', 'Verification email sent. Check your inbox (and spam folder).');
      setCooldown(60); // 60 second cooldown
    } catch (error: any) {
      console.error('Resend error:', error);
      if (error.code === 'auth/too-many-requests') {
        Alert.alert('Too Many Requests', 'Please wait a bit before requesting another email.');
      } else {
        Alert.alert('Error', 'Could not resend email.');
      }
    } finally {
      setIsResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Logo />

        <View style={styles.iconCircle}>
          <Ionicons name="mail-outline" size={60} color={theme.primary} />
        </View>

        <Text style={styles.title}>Verify Your Email</Text>
        
        <Text style={styles.description}>
          We sent a verification email to:
        </Text>
        
        <Text style={styles.email}>{email}</Text>

        <Text style={styles.instructions}>
          Click the link in the email to verify your account and access SportsPal.
        </Text>

        <Text style={styles.tip}>
          💡 <Text style={styles.tipBold}>Tip:</Text> Check your spam/junk folder if you don't see it.
        </Text>

        {/* Check Verification Button */}
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => checkVerification(false)}
          disabled={isChecking}
        >
          {isChecking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={22} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.primaryButtonText}>I verified — Check now</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Resend Button */}
        <TouchableOpacity
          style={[styles.secondaryButton, (cooldown > 0 || isResending) && styles.buttonDisabled]}
          onPress={handleResend}
          disabled={cooldown > 0 || isResending}
        >
          {isResending ? (
            <ActivityIndicator color={theme.primary} />
          ) : (
            <>
              <Ionicons name="refresh-outline" size={20} color={cooldown > 0 ? theme.muted : theme.primary} style={{ marginRight: 8 }} />
              <Text style={[styles.secondaryButtonText, cooldown > 0 && { color: theme.muted }]}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.autoCheckNote}>
          ⏱ Auto-checking every 5 seconds...
        </Text>
      </View>
    </SafeAreaView>
  );
};

const createStyles = (t: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: t.card,
    borderWidth: 3,
    borderColor: t.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: t.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: t.muted,
    textAlign: 'center',
    marginBottom: 8,
  },
  email: {
    fontSize: 17,
    fontWeight: '700',
    color: t.primary,
    marginBottom: 20,
    textAlign: 'center',
  },
  instructions: {
    fontSize: 15,
    color: t.text,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  tip: {
    fontSize: 14,
    color: t.muted,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
  },
  tipBold: {
    fontWeight: '700',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: t.primary,
    paddingVertical: 16,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: t.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    width: '100%',
    backgroundColor: 'transparent',
    paddingVertical: 14,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: t.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  secondaryButtonText: {
    color: t.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  autoCheckNote: {
    fontSize: 13,
    color: t.muted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});

export default EmailVerificationGateScreen;
