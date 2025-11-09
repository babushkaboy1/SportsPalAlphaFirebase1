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
import { useTheme } from '../context/ThemeContext';
import { CommonActions } from '@react-navigation/native';
import { AntDesign, FontAwesome, Ionicons } from '@expo/vector-icons';
import { signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider, sendPasswordResetEmail, fetchSignInMethodsForEmail, FacebookAuthProvider, OAuthProvider, linkWithCredential, AuthCredential } from 'firebase/auth';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import * as Google from 'expo-auth-session/providers/google';
import * as Facebook from 'expo-auth-session/providers/facebook';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import Svg, { Path } from 'react-native-svg';
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, FACEBOOK_APP_ID } from '@env';

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
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || '690971568236-d4ijqaml0rt2dv98eve2bckmvtf13l1c.apps.googleusercontent.com',
    iosClientId: GOOGLE_IOS_CLIENT_ID || '690971568236-qnqatg8h63re13j433l1oj22aiqktvts.apps.googleusercontent.com',
    webClientId: GOOGLE_WEB_CLIENT_ID || '690971568236-1slb2hq568pk1cqnpo44aioi5549avl7.apps.googleusercontent.com',
  });
  const [fbRequest, fbResponse, fbPromptAsync] = Facebook.useAuthRequest({
    clientId: FACEBOOK_APP_ID || '',
    scopes: ['public_profile', 'email'],
  });

  // Track pending linking flow and credential
  const pendingCredentialRef = useRef<AuthCredential | null>(null);
  const linkEmailRef = useRef<string | null>(null);
  const flowRef = useRef<{ mode: 'google' | 'facebook' | 'apple' | null; forLink?: boolean }>({ mode: null, forLink: false });
  const isNavigatingRef = useRef(false);

  // Minimal password prompt for linking when original account uses Password provider
  const [linkPasswordVisible, setLinkPasswordVisible] = useState(false);
  const [linkPassword, setLinkPassword] = useState('');

  // Fade in on mount
  useEffect(() => {
    // Reset navigation flag when screen mounts
    isNavigatingRef.current = false;
    
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, []);

  // Handle Google auth response
  useEffect(() => {
    (async () => {
      if (response?.type === 'success') {
        const { id_token } = response.params as any;
        const googleCred = GoogleAuthProvider.credential(id_token);
        if (flowRef.current.forLink) {
          // Sign in with existing method (Google), then link pending
          try {
            await signInWithCredential(auth, googleCred);
            if (pendingCredentialRef.current) {
              await linkWithCredential(auth.currentUser!, pendingCredentialRef.current);
              pendingCredentialRef.current = null;
              linkEmailRef.current = null;
              Alert.alert('Success', 'Accounts linked successfully!');
            }
            
            // Add small delay for smoother transition
            await new Promise(resolve => setTimeout(resolve, 150));
            
            navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs' }] }));
          } catch (e: any) {
            console.error('Google link error:', e);
            Alert.alert('Google link failed', e?.message || 'Could not link accounts.');
          } finally {
            flowRef.current = { mode: null, forLink: false };
          }
          return;
        }
        // Normal sign-in attempt
        await handleCredentialSignIn(googleCred);
        flowRef.current = { mode: null, forLink: false };
      }
    })();
  }, [response]);

  // Handle Facebook auth response
  useEffect(() => {
    (async () => {
      if (fbResponse?.type === 'success') {
        const { access_token } = fbResponse.params as any;
        const fbCred = FacebookAuthProvider.credential(access_token);
        if (flowRef.current.forLink) {
          try {
            await signInWithCredential(auth, fbCred);
            if (pendingCredentialRef.current) {
              await linkWithCredential(auth.currentUser!, pendingCredentialRef.current);
              pendingCredentialRef.current = null;
              linkEmailRef.current = null;
              Alert.alert('Success', 'Accounts linked successfully!');
            }
            
            // Add small delay for smoother transition
            await new Promise(resolve => setTimeout(resolve, 150));
            
            navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs' }] }));
          } catch (e: any) {
            console.error('Facebook link error:', e);
            Alert.alert('Facebook link failed', e?.message || 'Could not link accounts.');
          } finally {
            flowRef.current = { mode: null, forLink: false };
          }
          return;
        }
        await handleCredentialSignIn(fbCred);
        flowRef.current = { mode: null, forLink: false };
      }
    })();
  }, [fbResponse]);

  // Helper function to check if user has a profile in Firestore
  const checkUserProfile = async (userId: string): Promise<boolean> => {
    try {
      const profileDoc = await getDoc(doc(db, 'profiles', userId));
      return profileDoc.exists();
    } catch (error) {
      console.error('Error checking profile:', error);
      return false;
    }
  };

  // Centralized credential sign-in with automatic linking fallback
  const handleCredentialSignIn = async (cred: AuthCredential) => {
    if (isNavigatingRef.current) return; // Prevent duplicate navigation
    
    try {
      // Just sign in - App.tsx will handle navigation automatically
      await signInWithCredential(auth, cred);
      // Mark navigation to prevent duplicate attempts
      isNavigatingRef.current = true;
    } catch (err: any) {
      if (err?.code === 'auth/account-exists-with-different-credential') {
        const emailForLink = (err as any)?.customData?.email || email || null;
        if (!emailForLink) {
          Alert.alert('Link account', 'This email exists with another sign-in method. Please enter your email/password to link.');
          return;
        }
        pendingCredentialRef.current = cred;
        linkEmailRef.current = emailForLink;
        try {
          const methods = await fetchSignInMethodsForEmail(auth, emailForLink);
          // Prefer existing social providers first, then password
          if (methods.includes('google.com')) {
            flowRef.current = { mode: 'google', forLink: true };
            await promptAsync();
            return;
          }
          if (methods.includes('facebook.com')) {
            flowRef.current = { mode: 'facebook', forLink: true };
            await fbPromptAsync();
            return;
          }
          if (methods.includes('apple.com')) {
            flowRef.current = { mode: 'apple', forLink: true };
            await handleAppleSignIn(true);
            return;
          }
          if (methods.includes('password')) {
            setLinkPassword('');
            setLinkPasswordVisible(true);
            return;
          }
          Alert.alert('Link required', 'Please sign in with your original method to link this provider.');
        } catch (e: any) {
          Alert.alert('Link failed', e?.message || 'Could not determine existing sign-in method.');
        }
      } else {
        Alert.alert('Sign-in failed', err?.message || 'Could not sign in.');
      }
    }
  };

  // Apple sign-in (native on iOS via expo-apple-authentication)
  const handleAppleSignIn = async (forLink = false) => {
    try {
      // Generate a cryptographically random nonce and hash it for the Apple request
      const rawNonce = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const res = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        // Apple expects the SHA256 of the raw nonce in the request
        nonce: hashedNonce,
      });
      if (!res.identityToken) {
        Alert.alert('Apple Sign-In', 'No identity token returned.');
        return;
      }
      const provider = new OAuthProvider('apple.com');
      // Firebase expects the original raw nonce; it will hash and compare to the token's nonce claim
      const appleCred = provider.credential({ idToken: res.identityToken, rawNonce });
      if (forLink) {
        try {
          await signInWithCredential(auth, appleCred);
          if (pendingCredentialRef.current) {
            await linkWithCredential(auth.currentUser!, pendingCredentialRef.current);
            pendingCredentialRef.current = null;
            linkEmailRef.current = null;
            Alert.alert('Success', 'Accounts linked successfully!');
          }
          
          // Add small delay for smoother transition
          await new Promise(resolve => setTimeout(resolve, 150));
          
          navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs' }] }));
        } catch (e: any) {
          console.error('Apple link error:', e);
          Alert.alert('Apple link failed', e?.message || 'Could not link accounts.');
        } finally {
          flowRef.current = { mode: null, forLink: false };
        }
        return;
      }
      await handleCredentialSignIn(appleCred);
    } catch (e: any) {
      if (e?.code === 'ERR_CANCELED') return;
      Alert.alert('Apple Sign-In error', e?.message || 'Could not sign in with Apple.');
    }
  };


  const handleLogin = async () => {
    if (isLoading || isNavigatingRef.current) return; // Prevent duplicate calls
    
    setIsLoading(true);
    try {
      // Just sign in - App.tsx will handle navigation automatically
      await signInWithEmailAndPassword(auth, email, password);
      // Mark navigation to prevent duplicate attempts
      isNavigatingRef.current = true;
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
      isNavigatingRef.current = false; // Reset on error
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
    if (provider === 'Apple') {
      flowRef.current = { mode: 'apple', forLink: false };
      handleAppleSignIn(false);
    } else if (provider === 'Facebook') {
      flowRef.current = { mode: 'facebook', forLink: false };
      fbPromptAsync();
    }
  };

  // Link via password flow submit
  const submitLinkPassword = async () => {
    const emailToUse = linkEmailRef.current || email;
    if (!emailToUse) { setLinkPasswordVisible(false); return; }
    try {
      await signInWithEmailAndPassword(auth, emailToUse, linkPassword);
      if (pendingCredentialRef.current) {
        await linkWithCredential(auth.currentUser!, pendingCredentialRef.current);
        pendingCredentialRef.current = null;
        linkEmailRef.current = null;
      }
      setLinkPasswordVisible(false);
      
      // Add small delay for smoother transition
      await new Promise(resolve => setTimeout(resolve, 150));
      
      navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs' }] }));
    } catch (e: any) {
      Alert.alert('Link with password failed', e?.message || 'Could not link accounts.');
    }
  };

  const handleSignUp = () => {
    navigation.navigate('CreateProfile', {
      mode: 'create',
      profileData: {
        email: email || '',
        emailLocked: false,
      },
    });
  };

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: theme.background }}>
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
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={theme.muted}
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
            onPress={() => { flowRef.current = { mode: 'google', forLink: false }; promptAsync(); }}
          >
            <View style={styles.socialIcon}>
              <GoogleLogo />
            </View>
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      {/* Password link modal (bottom sheet style) */}
      {linkPasswordVisible && (
        <View style={styles.linkModalContainer}>
          <Text style={styles.linkModalTitle}>Link with your password</Text>
          <TextInput
            placeholder="Enter your password"
            placeholderTextColor={theme.muted}
            secureTextEntry
            value={linkPassword}
            onChangeText={setLinkPassword}
            style={styles.linkPasswordInput}
          />
          <View style={styles.linkActions}>
            <TouchableOpacity style={[styles.linkBtn, styles.linkCancel]} onPress={() => setLinkPasswordVisible(false)}>
              <Text style={[styles.linkBtnText, { color: theme.text }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.linkBtn, styles.linkSubmit]} onPress={submitLinkPassword}>
              <Text style={[styles.linkBtnText, { color: '#fff' }]}>Link</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
    paddingTop: 0,
  },
  title: {
    fontSize: 28,
    color: t.primary,
    fontWeight: 'bold',
    marginVertical: 20,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 8,
    padding: 12,
    marginVertical: 10,
    fontSize: 16,
    color: t.text,
    borderWidth: 1,
    borderColor: t.border,
  },
  forgotPasswordBtn: {
    alignSelf: 'flex-end',
    marginTop: -6,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  forgotPasswordText: {
    color: t.primary,
    fontSize: 15,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  button: {
    width: '100%',
    backgroundColor: t.primary,
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
    color: t.primary,
    textDecorationLine: 'underline',
    marginTop: 10,
    fontSize: 16,
    textAlign: 'center',
  },
  dividerText: {
    color: t.muted,
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
  // Apple Sign In Button (Light Mode look)
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
  // Facebook Button (brand color)
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
  // Google Button
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
  linkModalContainer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.card, padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: t.border },
  linkModalTitle: { color: t.primary, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  linkPasswordInput: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border, color: t.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  linkActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  linkBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  linkCancel: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
  linkSubmit: { backgroundColor: t.primary },
  linkBtnText: { color: '#fff', fontWeight: '700' },
});

export default LoginScreen;