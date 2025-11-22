import React, { useState, useEffect } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, TouchableOpacity, Alert, Platform, ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { enableScreens } from 'react-native-screens';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useActivityContext } from './context/ActivityContext';
import * as Location from 'expo-location';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from './firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { registerPushNotificationsForCurrentUser, subscribeNotificationResponses, getLastNotificationResponseData, setInAppNotificationHandler } from './utils/notifications';
import * as Linking from 'expo-linking';
import { parseDeepLink } from './utils/deepLinking';
import * as Updates from 'expo-updates';

// Import your screens
import DiscoverGamesScreen from './screens/DiscoverGamesScreen';
import ChatsScreen from './screens/ChatsScreen';
import CreateGameScreen from './screens/CreateGameScreen';
import CalendarScreen from './screens/CalendarScreen';
import ProfileScreen from './screens/ProfileScreen';
import LoginScreen from './screens/LoginScreen';
import CreateProfileScreen from './screens/CreateProfileScreen';
import ActivityDetailsScreen from './screens/ActivityDetailsScreen';
import ChatDetailScreen from './screens/ChatDetailScreen';
import PickLocationScreen from './screens/PickLocationScreen';
import UserProfileScreen from './screens/UserProfileScreen';
import BlockedUsersScreen from './screens/BlockedUsersScreen';

// Import the ActivityProvider
import { ActivityProvider } from './context/ActivityContext';
import { InboxBadgeProvider, useInboxBadge } from './context/InboxBadgeContext';
import { InAppNotificationProvider, useInAppNotification } from './context/InAppNotificationContext';
import { InAppNotification } from './components/InAppNotification';
import { RootStackParamList } from './types/navigation';
import DiscoverStack from './navigation/DiscoverStack';
import CalendarStack from './navigation/CalendarStack';
import ProfileStack from './navigation/ProfileStack';
import { decode as atob } from 'base-64';

enableScreens(true);
import { ThemeProvider, useTheme } from './context/ThemeContext';

// Keep the native splash screen visible while we initialize
try { SplashScreen.preventAutoHideAsync(); } catch {}

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const navRef = createNavigationContainerRef();

const styles = StyleSheet.create({
  tabBarStyle: {
    borderTopWidth: 0,
  }
});

const MainTabs = () => {
  const { theme, navTheme } = useTheme();
  const { totalUnread } = useInboxBadge();
  return (
  <Tab.Navigator
    detachInactiveScreens={false}
    screenOptions={({ route }: { route: any }) => ({
      headerShown: false,
      tabBarActiveTintColor: theme.tabIconActive,
      tabBarInactiveTintColor: theme.tabIconInactive,
      tabBarStyle: [styles.tabBarStyle, { backgroundColor: theme.tabBarBg }],
      tabBarPressColor: 'transparent',
      tabBarButton: (props: any) => {
        const cleanedProps = Object.fromEntries(
          Object.entries(props).filter(([_, v]) => v !== null)
        );
        return (
          <TouchableOpacity
            activeOpacity={0.7}
            {...cleanedProps}
          />
        );
      },
      tabBarIcon: ({ color, size, focused }: { color: string; size: number; focused: boolean }) => {
        let iconName = 'alert-circle-outline';
        switch (route.name) {
          case 'Discover':
            iconName = 'search-outline';
            break;
          case 'Calendar':
            iconName = 'calendar-outline';
            break;
          case 'CreateGame':
            iconName = 'add-circle-outline';
            break;
          case 'Profile':
            iconName = 'person-outline';
            break;
          case 'Inbox':
            iconName = focused ? 'mail-open-outline' : 'mail-outline';
            break;
        }
        return <Ionicons name={iconName as any} size={size} color={color} />;
      },
    })}
  >
    <Tab.Screen
      name="Discover"
      component={DiscoverStack}
      listeners={({ navigation, route }: { navigation: any; route: any }) => ({
        tabPress: (e: any) => {
          const state = navigation.getState();
          // Find the currently focused tab
          const focusedTab = state.index !== undefined ? state.routes[state.index] : null;
          // Only reset if Discover is already focused
          if (
            focusedTab &&
            focusedTab.name === 'Discover'
          ) {
            const tab = state.routes.find((r: any) => r.name === 'Discover');
            const stackState = tab?.state;
            if (stackState && typeof stackState.index === 'number' && stackState.index > 0) {
              e.preventDefault();
              navigation.reset({
                index: 0,
                routes: [{ name: 'Discover' }],
              });
            }
          }
          // If Discover is not focused, do nothing (default behavior: return to last screen in stack)
        }
      })}
    />
    <Tab.Screen
      name="Calendar"
      component={CalendarStack}
      listeners={({ navigation, route }: { navigation: any; route: any }) => ({
        tabPress: (e: any) => {
          const state = navigation.getState();
          // Find the currently focused tab
          const focusedTab = state.index !== undefined ? state.routes[state.index] : null;
          // Only reset if Calendar is already focused
          if (
            focusedTab &&
            focusedTab.name === 'Calendar'
          ) {
            const tab = state.routes.find((r: any) => r.name === 'Calendar');
            const stackState = tab?.state;
            if (stackState && typeof stackState.index === 'number' && stackState.index > 0) {
              e.preventDefault();
              navigation.reset({
                index: 0,
                routes: [{ name: 'Calendar' }],
              });
            }
          }
          // If Calendar is not focused, do nothing (default behavior: return to last screen in stack)
        }
      })}
    />
    <Tab.Screen
      name="CreateGame"
      component={CreateGameScreen}
      options={{ tabBarLabel: 'Create Event' }} // or 'Create'
    />
  <Tab.Screen name="Inbox" component={ChatsScreen} options={{
    tabBarBadge: totalUnread > 0 ? (totalUnread > 99 ? '99+' : totalUnread) : undefined,
    tabBarBadgeStyle: { backgroundColor: '#e74c3c', color: '#fff' },
  }} />
    <Tab.Screen
      name="Profile"
      component={ProfileStack} // Ensure ProfileStack is passed correctly
      options={{ headerShown: false }}
      listeners={({ navigation, route }: { navigation: any; route: any }) => ({
        tabPress: (e: any) => {
          const state = navigation.getState();
          const focusedTab = state.index !== undefined ? state.routes[state.index] : null;
          if (
            focusedTab &&
            focusedTab.name === 'Profile'
          ) {
            const tab = state.routes.find((r: any) => r.name === 'Profile');
            const stackState = tab?.state;
            if (stackState && typeof stackState.index === 'number' && stackState.index > 0) {
              e.preventDefault();
              navigation.reset({
                index: 0,
                routes: [{ name: 'Profile' }],
              });
            }
          }
        }
      })}
    />
  </Tab.Navigator>
);
}

function AppInner() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  // Track whether the signed-in user has a profile document
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [navReady, setNavReady] = useState(false);
  const splashHiddenRef = React.useRef(false);
  // Store a deep link encountered before navigation is ready / auth resolved
  const pendingDeepLinkRef = React.useRef<string | null>(null);
  const { theme, navTheme } = useTheme();
  const { currentNotification, dismissNotification, showNotification } = useInAppNotification();
  const [updateChecked, setUpdateChecked] = useState(false);

  // Check for OTA updates on app launch (only in production)
  useEffect(() => {
    const checkForUpdates = async () => {
      // Skip in development mode
      if (__DEV__) {
        console.log('[Updates] Skipping update check in development mode');
        setUpdateChecked(true);
        return;
      }

      try {
        console.log('[Updates] Checking for updates...');
        const update = await Updates.checkForUpdateAsync();

        if (update.isAvailable) {
          console.log('[Updates] Update available! Downloading...');
          await Updates.fetchUpdateAsync();
          console.log('[Updates] Update downloaded! Reloading app...');
          // Reload immediately to apply the update
          await Updates.reloadAsync();
        } else {
          console.log('[Updates] App is up to date');
          setUpdateChecked(true);
        }
      } catch (error) {
        console.error('[Updates] Error checking for updates:', error);
        // Continue anyway - don't block app launch
        setUpdateChecked(true);
      }
    };

    checkForUpdates();
  }, []);

  // Connect in-app notification handler
  useEffect(() => {
    setInAppNotificationHandler((notification) => {
      showNotification(notification);
    });
  }, [showNotification]);

  const handleNotificationPress = () => {
    if (!currentNotification || !navRef.isReady()) return;

    if (currentNotification.type === 'chat' && currentNotification.chatId) {
      try { (navRef as any).navigate('ChatDetail', { chatId: currentNotification.chatId }); } catch {}
    } else if (currentNotification.type === 'activity_invite' && currentNotification.activityId) {
      try { (navRef as any).navigate('ActivityDetails', { activityId: currentNotification.activityId }); } catch {}
    } else if (currentNotification.type === 'friend_request' || currentNotification.type === 'friend_accept') {
      try { (navRef as any).navigate('MainTabs', { screen: 'Inbox' }); } catch {}
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      // Mark initialization complete after first auth state resolution
      setInitializing(false);
    });
    return unsubscribe;
  }, []);

  // On auth changes, check for a profile doc to gate initial navigation
  useEffect(() => {
    let cancelled = false;
    const checkProfile = async () => {
      if (!user) {
        if (!cancelled) setHasProfile(null);
        return;
      }
      // Small delay to ensure auth state is fully settled
      await new Promise(resolve => setTimeout(resolve, 50));
      if (cancelled) return;
      
      try {
        const snap = await getDoc(doc(db, 'profiles', user.uid));
        if (!cancelled) setHasProfile(snap.exists());
      } catch (e) {
        // If we can't determine, default to allowing app but log
        console.warn('Profile check failed', e);
        if (!cancelled) setHasProfile(true);
      }
    };
    checkProfile();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (user) {
      const preloadScreens = () => {
        if (navRef.isReady()) {
          
        }
      };
      const timeout = setTimeout(preloadScreens, 1500);
      return () => clearTimeout(timeout);
    }
  }, [user]);

  // (splash hiding logic is handled by SplashHider component mounted below)

  // Register push notifications and handle taps to navigate
  useEffect(() => {
    let unsubscribeResponses: (() => void) | undefined;
    if (user) {
      // Best-effort registration (no blocking)
      registerPushNotificationsForCurrentUser().catch(() => {});
      // Handle cold-start from a tapped notification
      getLastNotificationResponseData()
        .then((data) => {
          if (!data || !navRef.isReady()) return;
          if (data.type === 'chat' && data.chatId) {
            try { (navRef as any).navigate('ChatDetail', { chatId: data.chatId }); } catch {}
            return;
          }
          if (data.type === 'activity_invite' && data.activityId) {
            try { (navRef as any).navigate('ActivityDetails', { activityId: data.activityId }); } catch {}
            return;
          }
          try { (navRef as any).navigate('MainTabs', { screen: 'Inbox' }); } catch {}
        })
        .catch(() => {});
      unsubscribeResponses = subscribeNotificationResponses((data) => {
        if (!navRef.isReady() || !data) return;
        if (data.type === 'chat' && data.chatId) {
          // Open specific chat thread
          try { (navRef as any).navigate('ChatDetail', { chatId: data.chatId }); } catch {}
          return;
        }
        if (data.type === 'activity_invite' && data.activityId) {
          try { (navRef as any).navigate('ActivityDetails', { activityId: data.activityId }); } catch {}
          return;
        }
        // For friend requests/accepts or anything else, bring user to Inbox
        try { (navRef as any).navigate('MainTabs', { screen: 'Inbox' }); } catch {}
      });
    }
    return () => {
      if (unsubscribeResponses) unsubscribeResponses();
    };
  }, [user]);

  useEffect(() => {
    if (user) {
      const requestLocation = async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        console.log("Location permission:", status);
      };
      requestLocation();
    }
  }, [user]);

  // Deep linking handler
  useEffect(() => {
    // Always fetch the initial URL once; store if we cannot navigate yet
    Linking.getInitialURL().then((url) => {
      if (url) {
        console.log('📱 Initial deep link URL:', url);
        if (user && navRef.isReady() && hasProfile !== null && hasProfile !== false) {
          handleDeepLinkNavigation(url);
        } else {
          pendingDeepLinkRef.current = url;
        }
      }
    }).catch(() => {});

    // Listener for subsequent URLs while app is alive
    const subscription = Linking.addEventListener('url', ({ url }) => {
      console.log('📱 Deep link received:', url);
      if (user && navRef.isReady() && hasProfile !== null && hasProfile !== false) {
        // Small delay to ensure navigation state is settled
        setTimeout(() => handleDeepLinkNavigation(url), 100);
      } else {
        pendingDeepLinkRef.current = url; // overwrite with most recent
      }
    });
    return () => subscription.remove();
  }, [user, hasProfile]);

  // When auth + nav are ready AND user has/creates profile, consume pending deep link
  useEffect(() => {
    if (!pendingDeepLinkRef.current) return;
    if (!user) return;
    if (!navRef.isReady()) return;
    if (hasProfile === null) return; // still checking profile
    if (hasProfile === false) return; // user needs to create profile first
    
    // Navigate now with a small delay to ensure navigation is fully ready
    const url = pendingDeepLinkRef.current;
    pendingDeepLinkRef.current = null;
    console.log('📱 Processing pending deep link:', url);
    setTimeout(() => handleDeepLinkNavigation(url), 300);
  }, [user, navReady, hasProfile]);

  const handleDeepLinkNavigation = (url: string) => {
    const { type, id } = parseDeepLink(url);
    
    console.log('🔗 Deep link parsed:', { type, id, url });
    
    if (!id || !navRef.isReady()) {
      console.log('❌ Deep link navigation blocked: missing id or nav not ready');
      return;
    }

    try {
      switch (type) {
        case 'activity':
          console.log('✅ Navigating to ActivityDetails:', id);
          // Navigate to MainTabs first to ensure proper stack, then to activity
          if ((navRef as any).getCurrentRoute()?.name !== 'MainTabs') {
            (navRef as any).navigate('MainTabs', { screen: 'Discover' });
          }
          setTimeout(() => {
            (navRef as any).navigate('ActivityDetails', { activityId: id });
          }, 100);
          break;
        case 'profile':
          console.log('✅ Navigating to UserProfile:', id);
          // Navigate to MainTabs first to ensure proper stack
          if ((navRef as any).getCurrentRoute()?.name !== 'MainTabs') {
            (navRef as any).navigate('MainTabs', { screen: 'Profile' });
          }
          setTimeout(() => {
            (navRef as any).navigate('UserProfile', { userId: id });
          }, 100);
          break;
        case 'chat':
          console.log('✅ Navigating to ChatDetail:', id);
          // Navigate to MainTabs first to ensure proper stack
          if ((navRef as any).getCurrentRoute()?.name !== 'MainTabs') {
            (navRef as any).navigate('MainTabs', { screen: 'Inbox' });
          }
          setTimeout(() => {
            (navRef as any).navigate('ChatDetail', { chatId: id });
          }, 100);
          break;
        default:
          console.log('❌ Unknown deep link type:', type);
      }
    } catch (error) {
      console.error('❌ Error navigating to deep link:', error);
    }
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#121212' }}>
      <SafeAreaProvider>
        <ActivityProvider>
          <InboxBadgeProvider>
          <NavigationContainer ref={navRef} theme={navTheme} onReady={() => setNavReady(true)}>
          <StatusBar style={theme.isDark ? 'light' : 'dark'} backgroundColor={theme.background} />
          {initializing || (user && hasProfile === null) || !updateChecked ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#121212' }}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : (
          <Stack.Navigator
          // Key forces navigator to remount when auth/profile state changes, ensuring correct initial route
          key={user ? `app-${hasProfile === false ? 'noprof' : 'hasprof'}` : 'auth'}
          initialRouteName={!user ? 'Login' : (hasProfile === false ? 'CreateProfile' : 'MainTabs')}
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            cardStyle: { backgroundColor: theme.background },
            transitionSpec: {
              open: {
                animation: 'timing',
                config: {
                  duration: 200,
                },
              },
              close: {
                animation: 'timing',
                config: {
                  duration: 200,
                },
              },
            },
            cardStyleInterpolator: ({ current }) => ({
              cardStyle: {
                opacity: current.progress,
              },
            }),
          }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="CreateProfile" component={CreateProfileScreen} />
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="ActivityDetails" component={ActivityDetailsScreen} />
          <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
          <Stack.Screen name="PickLocation" component={PickLocationScreen} />
          <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ headerShown: false }} />
          <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} options={{ headerShown: false }} />
          </Stack.Navigator>
          )}
          {/* In-App Notification Banner */}
          <InAppNotification
            visible={!!currentNotification}
            title={currentNotification?.title || ''}
            body={currentNotification?.body || ''}
            image={currentNotification?.image}
            onPress={handleNotificationPress}
            onDismiss={dismissNotification}
          />
          </NavigationContainer>
          </InboxBadgeProvider>
          {/* Splash hiding logic mounted within providers to access context */}
          <SplashHider
            navReady={navReady}
            initializing={initializing}
            user={user}
            hasProfile={hasProfile}
            splashHiddenRef={splashHiddenRef}
            updateChecked={updateChecked}
          />
        </ActivityProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Define your tab param list
type TabParamList = {
  Discover: undefined;
  Calendar: undefined;
  CreateGame: undefined;
  Inbox: undefined;
  Profile: undefined;
};

if (typeof global.atob === 'undefined') {
  global.atob = atob;
}

// Configure Android system UI once on module load/mount
if (Platform.OS === 'android') {
  // Avoid calling setBackgroundColorAsync on devices using edge-to-edge (Android 10 / API 29+)
  // because it isn't supported and will produce a warning like:
  // "setBackgroundColorAsync is not supported with edge-to-edge enabled.".
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10) || 0;
  if (apiLevel < 29) {
    // Older devices: safe to set the nav + system background
  SystemUI.setBackgroundColorAsync('#121212').catch(() => {});
  // NavigationBar.setBackgroundColorAsync('#121212').catch(() => {});
  } else {
    // For Android 10+ we skip setting the background color to avoid the warning.
    // We still set the button style/visibility below.
  }
  // Make buttons light for contrast and keep bars visible; these calls are safe
  // NavigationBar.setButtonStyleAsync('light').catch(() => {});
  NavigationBar.setVisibilityAsync('visible').catch(() => {});
}

export default function App() {
  return (
    <ThemeProvider>
      <InAppNotificationProvider>
        <AppInner />
      </InAppNotificationProvider>
    </ThemeProvider>
  );
}

// Helper mounted inside providers to consume ActivityContext
const SplashHider: React.FC<{ navReady: boolean; initializing: boolean; user: User | null; hasProfile: boolean | null; splashHiddenRef: React.MutableRefObject<boolean>; updateChecked: boolean; }> = ({ navReady, initializing, user, hasProfile, splashHiddenRef, updateChecked }) => {
  const { initialActivitiesLoaded } = useActivityContext();

  useEffect(() => {
    if (splashHiddenRef.current) return;
    const shouldHide = () => {
      if (!navReady || initializing || !updateChecked) return false;
      if (!user) return true; // login screen is ready
      if (hasProfile === false) return true; // create profile flow
      // user has profile -> wait for activities initial load
      return initialActivitiesLoaded;
    };

    if (shouldHide()) {
      SplashScreen.hideAsync().catch(() => {});
      splashHiddenRef.current = true;
    }
  }, [navReady, initializing, user, hasProfile, initialActivitiesLoaded, updateChecked]);

  // Fallback: hide after 8s max
  useEffect(() => {
    if (splashHiddenRef.current) return;
    const t = setTimeout(() => {
      if (!splashHiddenRef.current) {
        SplashScreen.hideAsync().catch(() => {});
        splashHiddenRef.current = true;
      }
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  return null;
};
