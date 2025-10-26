// screens/LoginScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import { 
  ScrollView, 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Alert,
} from 'react-native';
import Logo from '../components/Logo';
import { AntDesign, FontAwesome, Ionicons } from '@expo/vector-icons';
import { signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import * as Google from 'expo-auth-session/providers/google';

const LoginScreen = ({ navigation }: any) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: '690971568236-d4ijqaml0rt2dv98eve2bckmvtf13l1c.apps.googleusercontent.com',
    iosClientId: '690971568236-qnqatg8h63re13j433l1oj22aiqktvts.apps.googleusercontent.com',
    webClientId: '690971568236-1slb2hq568pk1cqnpo44aioi5549avl7.apps.googleusercontent.com',
  });

  // Fade in on mount
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, []);

  // Ensure no lingering session while on Login screen
  useEffect(() => {
    // Sign out immediately on mount if a user is cached
    if (auth.currentUser) {
      signOut(auth).catch(() => {});
    }
    // Also sign out whenever this screen gains focus (e.g., back navigation)
    const unsubscribe = navigation.addListener('focus', () => {
      if (auth.currentUser) {
        signOut(auth).catch(() => {});
      }
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential)
        .then(() => navigation.navigate('MainTabs'))
        .catch(async (err) => {
          if (err.code === 'auth/account-exists-with-different-credential') {
            alert('An account already exists with this email. Please log in with your password first, then link Google in your profile settings.');
          } else {
            alert('Google sign-in error: ' + err.message);
          }
        });
    }
  }, [response]);


  const handleLogin = async () => {
    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigation.navigate('MainTabs');
    } catch (error: any) {
      let message = 'Login error. Please try again.';
      let title = 'Login Failed';
      if (error.code === 'auth/user-not-found') {
        message = 'No account found with this email address.';
      } else if (error.code === 'auth/wrong-password') {
        message = 'Incorrect password. Please try again.';
      } else if (error.code === 'auth/too-many-requests') {
        message = 'Too many failed attempts. Your account is temporarily locked. Please try again later or reset your password.';
      } else if (error.code === 'auth/network-request-failed') {
        message = 'No internet connection or the connection is too weak. Please check your network and try again.';
      } else if (error.code === 'auth/user-disabled') {
        message = 'This account has been banned or disabled. If you believe this is a mistake, please contact support.';
        title = 'Account Disabled';
      } else if (error.code === 'auth/invalid-email') {
        message = 'The email address you entered is not valid.';
      } else if (error.code === 'auth/operation-not-allowed') {
        message = 'Email/password sign-in is currently disabled. Please contact support or try another method.';
      } else if (error.code === 'auth/internal-error') {
        message = 'An internal error occurred. Please try again.';
      } else if (error.code === 'auth/invalid-credential') {
        message = 'Invalid login credentials. Please check your email and password.';
      }
      Alert.alert(title, message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      Alert.alert('Forgot Password', 'Please enter your email address above first.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      Alert.alert('Password Reset', 'A password reset link has been sent to your email.');
    } catch (error: any) {
      let message = 'Could not send reset email.';
      if (error.code === 'auth/user-not-found') {
        message = 'No account found with this email.';
      } else if (error.code === 'auth/invalid-email') {
        message = 'Invalid email address.';
      } else if (error.code === 'auth/network-request-failed') {
        message = 'No internet connection. Please check your network and try again.';
      }
      Alert.alert('Reset Failed', message);
    }
  };

  const handleSocialLogin = (provider: string) => {
    Alert.alert('Coming soon', `${provider} sign-in isn't available yet. Please use Email or Google.`);
  };

  const handleSignUp = () => {
    navigation.navigate('CreateProfile');
  };

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: '#121212' }}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Centered Logo */}
        <Logo />

        {/* Welcome Title */}
        <Text style={styles.title}>Welcome to SportsPal</Text>

        {/* Input Fields */}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#ccc"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#ccc"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {/* Forgot Password Button */}
        <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotPasswordBtn}>
          <Text style={styles.forgotPasswordText}>Forgot password?</Text>
        </TouchableOpacity>

        {/* Login Button */}
        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>

        {/* Sign Up Link (directly under Login) */}
        <TouchableOpacity onPress={handleSignUp}>
          <Text style={styles.signUpText}>Don't have an account? Sign Up</Text>
        </TouchableOpacity>

        {/* Divider */}
        <Text style={styles.dividerText}>or</Text>

        {/* Social Login Buttons */}
        <View style={styles.socialContainer}>
          <TouchableOpacity
            style={styles.socialButton}
            onPress={() => handleSocialLogin('Apple')}
          >
            <AntDesign name="apple" size={22} color="white" style={styles.icon} />
            <Text style={styles.socialButtonText}>Continue with Apple</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.socialButton}
            onPress={() => handleSocialLogin('Facebook')}
          >
            <FontAwesome name="facebook" size={22} color="white" style={styles.icon} />
            <Text style={styles.socialButtonText}>Continue with Facebook</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.socialButton}
            onPress={() => promptAsync()}
          >
            <AntDesign name="google" size={22} color="white" style={styles.icon} />
            <Text style={styles.socialButtonText}>Continue with Google</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#121212', // Dark background to prevent white overscroll edges
  },
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 0,
  },
  title: {
    fontSize: 28,
    color: '#1ae9ef',
    fontWeight: 'bold',
    marginVertical: 20,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    padding: 12,
    marginVertical: 10,
    fontSize: 16,
    color: '#fff',
  },
  forgotPasswordBtn: {
    alignSelf: 'flex-end',
    marginTop: -6,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  forgotPasswordText: {
    color: '#1ae9ef',
    fontSize: 15,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  button: {
    width: '100%',
    backgroundColor: '#1ae9ef',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  signUpText: {
    color: '#1ae9ef',
    textDecorationLine: 'underline',
    marginTop: 10,
    fontSize: 16,
    textAlign: 'center',
  },
  dividerText: {
    color: '#ccc',
    fontSize: 14,
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  socialContainer: {
    width: '100%',
    alignItems: 'center',
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 12,
    borderRadius: 8,
    marginVertical: 5,
    backgroundColor: '#1ae9ef',
  },
  icon: {
    marginRight: 10,
  },
  socialButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default LoginScreen;