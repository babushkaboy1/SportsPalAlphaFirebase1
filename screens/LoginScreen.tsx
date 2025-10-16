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
  Animated
} from 'react-native';
import Logo from '../components/Logo';
import { AntDesign, FontAwesome, Ionicons } from '@expo/vector-icons';
import { signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
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
    } catch (error) {
      alert("Login error: " + (error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = (provider: string) => {
    console.log(`Login with ${provider}`);
    navigation.navigate('MainTabs');
  };

  const handleSignUp = () => {
    navigation.navigate('CreateProfile');
  };

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <ScrollView
      style={styles.scrollView} // Ensures the overscroll area remains dark.
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