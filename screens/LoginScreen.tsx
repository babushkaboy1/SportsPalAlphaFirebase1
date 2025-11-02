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
import { CommonActions } from '@react-navigation/native';
import { AntDesign, FontAwesome, Ionicons } from '@expo/vector-icons';
import { signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import * as Google from 'expo-auth-session/providers/google';
import Svg, { Path } from 'react-native-svg';

// Google Logo Component (multicolor)
const GoogleLogo = () => (
  <Svg width="20" height="20" viewBox="0 0 24 24">
    <Path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <Path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <Path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <Path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </Svg>
);

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

  // If already signed in, redirect to MainTabs when this screen appears
  useEffect(() => {
    const checkAndRedirect = () => {
      if (auth.currentUser) {
        navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs' }] }));
      }
    };
    // Check immediately
    checkAndRedirect();
    // And on focus
    const unsubscribe = navigation.addListener('focus', checkAndRedirect);
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential)
        .then(() => navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs' }] })))
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
  navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs' }] }));
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
          {/* Apple Sign In - Light Mode */}
          <TouchableOpacity
            style={styles.appleButton}
            onPress={() => handleSocialLogin('Apple')}
          >
            <AntDesign name="apple" size={20} color="#000" style={styles.socialIcon} />
            <Text style={styles.appleButtonText}>Sign in with Apple</Text>
          </TouchableOpacity>

          {/* Facebook Login */}
          <TouchableOpacity
            style={styles.facebookButton}
            onPress={() => handleSocialLogin('Facebook')}
          >
            <FontAwesome name="facebook" size={20} color="#fff" style={styles.socialIcon} />
            <Text style={styles.facebookButtonText}>Continue with Facebook</Text>
          </TouchableOpacity>

          {/* Google Login */}
          <TouchableOpacity
            style={styles.googleButton}
            onPress={() => promptAsync()}
          >
            <View style={styles.socialIcon}>
              <GoogleLogo />
            </View>
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#121212',
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
    marginTop: 5,
  },
  socialIcon: {
    marginRight: 12,
  },

  // Apple Sign In Button (Light Mode - following Apple HIG)
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 13,
    borderRadius: 8,
    marginVertical: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#000000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  appleButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.3,
  },

  // Facebook Button (Official Facebook Blue)
  facebookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 13,
    borderRadius: 8,
    marginVertical: 6,
    backgroundColor: '#1877F2',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  facebookButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.3,
  },

  // Google Button (Following Google Brand Guidelines)
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 13,
    borderRadius: 8,
    marginVertical: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dadce0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  googleButtonText: {
    color: '#3c4043',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  
});

export default LoginScreen;