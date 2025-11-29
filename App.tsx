import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NavigationContainer, createNavigationContainerRef, StackActions, NavigationState } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { Platform, Dimensions } from 'react-native';
import { createMaterialTopTabNavigator, MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
import LoginScreen from './screens/LoginScreen';
import RegisterEmailScreen from './screens/RegisterEmailScreen';
import EmailVerificationGateScreen from './screens/EmailVerificationGateScreen';
import CreateProfileScreen from './screens/CreateProfileScreen';
import ActivityDetailsScreen from './screens/ActivityDetailsScreen';
import ChatDetailScreen from './screens/ChatDetailScreen';
import PickLocationScreen from './screens/PickLocationScreen';
import UserProfileScreen from './screens/UserProfileScreen';
import BlockedUsersScreen from './screens/BlockedUsersScreen';
import CreateGameScreen from './screens/CreateGameScreen';
import ChatsScreen from './screens/ChatsScreen';

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
import { BottomTabs } from './components/BottomTabs';

// Keep the native splash screen visible while we initialize
try { SplashScreen.preventAutoHideAsync(); } catch {}

const Stack = createStackNavigator<RootStackParamList>();
const navRef = createNavigationContainerRef();

type MainTabsParamList = {
  Discover: undefined;
  Calendar: undefined;
  CreateGame: RootStackParamList['CreateGame'] | undefined;
  Inbox: undefined;
  Profile: undefined;
};

type TabKey = keyof MainTabsParamList;

type TabDescriptor = {
  key: TabKey;
  label: string;
  icon: string;
  iconActive?: string;
  resettable?: boolean;
};

type ExternalNavigationTarget =
  | { kind: 'activity'; id: string }
  | { kind: 'profile'; id: string }
  | { kind: 'chat'; id: string }
  | { kind: 'notifications'; reason?: 'activity_invite' | 'friend' | 'generic' };

const TAB_DESCRIPTORS: ReadonlyArray<TabDescriptor> = [
  { key: 'Discover', label: 'Discover', icon: 'search-outline', iconActive: 'search', resettable: true },
  { key: 'Calendar', label: 'Calendar', icon: 'calendar-outline', iconActive: 'calendar', resettable: true },
  { key: 'CreateGame', label: 'Create', icon: 'add-circle-outline', iconActive: 'add-circle' },
  { key: 'Inbox', label: 'Inbox', icon: 'mail-outline', iconActive: 'mail-open-outline' },
  { key: 'Profile', label: 'Profile', icon: 'person-outline', iconActive: 'person', resettable: true },
];

const Tab = createMaterialTopTabNavigator<MainTabsParamList>();

const MainTabs: React.FC = () => {
  const { theme } = useTheme();
  const { totalUnread } = useInboxBadge();
  const jumpRafRef = React.useRef<number | null>(null);
  const restoreAnimTimeout = React.useRef<NodeJS.Timeout | null>(null);
  const [animationEnabled, setAnimationEnabled] = React.useState(true);

  React.useEffect(() => {
    return () => {
      if (jumpRafRef.current !== null) {
        cancelAnimationFrame(jumpRafRef.current);
        jumpRafRef.current = null;
      }
      if (restoreAnimTimeout.current) {
        clearTimeout(restoreAnimTimeout.current);
        restoreAnimTimeout.current = null;
      }
    };
  }, []);

  const renderTabBar = (props: MaterialTopTabBarProps) => {
    const { state, navigation } = props;

    const items = state.routes.map((route: typeof state.routes[number]) => {
      const descriptor = TAB_DESCRIPTORS.find((tab) => tab.key === (route.name as TabKey));
      const badge =
        route.name === 'Inbox' && totalUnread > 0
          ? totalUnread > 99
            ? '99+'
            : String(totalUnread)
          : undefined;

      return {
        key: route.key,
        label: descriptor?.label ?? route.name,
        icon: descriptor?.icon ?? 'ellipse-outline',
        iconActive: descriptor?.iconActive,
        badge,
      };
    });

    const handlePress = (index: number) => {
      const route = state.routes[index];
      if (!route) return;
      const isFocused = state.index === index;

      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });

      if (event.defaultPrevented) {
        return;
      }

      if (isFocused) {
        const descriptor = TAB_DESCRIPTORS.find((tab) => tab.key === (route.name as TabKey));
        if (descriptor?.resettable) {
          const childState = route.state as NavigationState | undefined;
          if (childState && childState.index > 0) {
            navigation.dispatch({
              ...StackActions.popToTop(),
              target: childState.key,
            });
          }
        }
      } else {
        if (jumpRafRef.current !== null) {
          cancelAnimationFrame(jumpRafRef.current);
          jumpRafRef.current = null;
        }

        if (restoreAnimTimeout.current) {
          clearTimeout(restoreAnimTimeout.current);
          restoreAnimTimeout.current = null;
        }

        setAnimationEnabled(false);

        jumpRafRef.current = requestAnimationFrame(() => {
          (navigation as any).jumpTo(route.name, route.params);
          restoreAnimTimeout.current = setTimeout(() => {
            setAnimationEnabled(true);
            restoreAnimTimeout.current = null;
          }, 180);
          jumpRafRef.current = null;
        });
      }
    };

    return (
      <BottomTabs
        items={items}
        activeIndex={state.index}
        onTabPress={handlePress}
        activeColor={theme.tabIconActive}
        inactiveColor={theme.tabIconInactive}
        backgroundColor={theme.tabBarBg}
        borderColor={theme.border}
      />
    );
  };

  return (
    <Tab.Navigator
      id="MainTabsPager"
      initialRouteName="Discover"
      tabBarPosition="bottom"
      backBehavior="none"
      screenOptions={{
        swipeEnabled: true,
        animationEnabled,
        lazy: false,
        lazyPreloadDistance: TAB_DESCRIPTORS.length,
        tabBarStyle: { height: 0 },
        tabBarIndicatorStyle: { backgroundColor: 'transparent' },
        tabBarShowLabel: false,
        sceneStyle: { backgroundColor: theme.background },
      }}
      tabBar={renderTabBar}
    >
      <Tab.Screen name="Discover" component={DiscoverStack} />
      <Tab.Screen name="Calendar" component={CalendarStack} />
      <Tab.Screen name="CreateGame" component={CreateGameScreen} />
      <Tab.Screen name="Inbox" component={ChatsScreen} />
      <Tab.Screen name="Profile" component={ProfileStack} />
    </Tab.Navigator>
  );
};

function AppInner() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  // Track whether the signed-in user has a profile document
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  // Track email verification status
  const [isEmailVerified, setIsEmailVerified] = useState<boolean | null>(null);
  const [navReady, setNavReady] = useState(false);
  const splashHiddenRef = useRef(false);
  const pendingNavigationTargetRef = useRef<ExternalNavigationTarget | null>(null);
  const navigationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { theme, navTheme } = useTheme();
  const { currentNotification, dismissNotification, showNotification } = useInAppNotification();
  const [updateChecked, setUpdateChecked] = useState(false);

  const clearNavigationTimeout = useCallback(() => {
    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
      navigationTimeoutRef.current = null;
    }
  }, []);

  const executeNavigationTarget = useCallback(
    (target: ExternalNavigationTarget) => {
      if (!navRef.isReady()) return false;

      const nav = navRef as any;

      const navigateToMainTabs = (screen: keyof MainTabsParamList, params?: Record<string, any>) => {
        try {
          nav.navigate('MainTabs', params ? { screen, params: { ...params } } : { screen });
        } catch (error) {
          console.warn('MainTabs navigation failed', error);
        }
      };

      const schedule = (fn: () => void, delay = 120) => {
        clearNavigationTimeout();
        navigationTimeoutRef.current = setTimeout(() => {
          try {
            fn();
          } catch (error) {
            console.error('Deferred navigation failed', error);
          } finally {
            navigationTimeoutRef.current = null;
          }
        }, delay);
      };

      try {
        switch (target.kind) {
          case 'activity':
            navigateToMainTabs('Discover', { _deeplinkTs: Date.now() });
            schedule(() => {
              nav.navigate('ActivityDetails', { activityId: target.id });
            });
            return true;
          case 'profile':
            navigateToMainTabs('Profile', { _deeplinkTs: Date.now() });
            schedule(() => {
              nav.navigate('UserProfile', { userId: target.id });
            });
            return true;
          case 'chat':
            navigateToMainTabs('Inbox', { inboxView: 'chats', _deeplinkTs: Date.now() });
            schedule(() => {
              nav.navigate('ChatDetail', { chatId: target.id });
            }, 80);
            return true;
          case 'notifications':
            navigateToMainTabs('Inbox', {
              inboxView: 'notifications',
              notificationReason: target.reason,
              _deeplinkTs: Date.now(),
            });
            return true;
          default:
            return false;
        }
      } catch (error) {
        console.error('❌ Error executing external navigation:', error);
        return false;
      }
    },
    [clearNavigationTimeout]
  );

  const canNavigateNow = useCallback(() => {
    if (!navReady || !navRef.isReady()) return false;
    if (!user) return false;
    if (hasProfile === null || isEmailVerified === null) return false;
    if (!hasProfile || !isEmailVerified) return false;
    return true;
  }, [navReady, user, hasProfile, isEmailVerified]);

  const requestNavigationTarget = useCallback(
    (target: ExternalNavigationTarget | null) => {
      if (!target) return;
      if (!canNavigateNow()) {
        pendingNavigationTargetRef.current = target;
        return;
      }
      const handled = executeNavigationTarget(target);
      if (!handled) {
        pendingNavigationTargetRef.current = target;
      }
    },
    [canNavigateNow, executeNavigationTarget]
  );

  const parseUrlToTarget = useCallback((url: string): ExternalNavigationTarget | null => {
    const { type, id } = parseDeepLink(url);
    if (!id) return null;
    switch (type) {
      case 'activity':
        return { kind: 'activity', id };
      case 'profile':
        return { kind: 'profile', id };
      case 'chat':
        return { kind: 'chat', id };
      default:
        return null;
    }
  }, []);

  const mapNotificationPayloadToTarget = useCallback((payload: any): ExternalNavigationTarget | null => {
    if (!payload) return null;
    const type = payload.type;
    if (type === 'chat' && payload.chatId) {
      return { kind: 'chat', id: String(payload.chatId) };
    }
    if (type === 'activity_invite') {
      return { kind: 'notifications', reason: 'activity_invite' };
    }
    if (type === 'friend_request' || type === 'friend_accept') {
      return { kind: 'notifications', reason: 'friend' };
    }
    if (payload.activityId) {
      return { kind: 'activity', id: String(payload.activityId) };
    }
    if (payload.userId) {
      return { kind: 'profile', id: String(payload.userId) };
    }
    if (payload.profileId) {
      return { kind: 'profile', id: String(payload.profileId) };
    }
    return null;
  }, []);

  useEffect(() => {
    if (!pendingNavigationTargetRef.current) return;
    if (!canNavigateNow()) return;
    const target = pendingNavigationTargetRef.current;
    pendingNavigationTargetRef.current = null;
    const handled = target ? executeNavigationTarget(target) : true;
    if (!handled && target) {
      pendingNavigationTargetRef.current = target;
    }
  }, [canNavigateNow, executeNavigationTarget, navReady, user, hasProfile, isEmailVerified]);

  useEffect(() => () => {
    clearNavigationTimeout();
  }, [clearNavigationTimeout]);

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
          // Keep splash visible and reload immediately to apply the update
          // The splash will remain visible during reload, preventing white flash
          await SplashScreen.preventAutoHideAsync().catch(() => {});
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
    if (!currentNotification) return;
    const target = mapNotificationPayloadToTarget(currentNotification);
    if (target) {
      requestNavigationTarget(target);
    }
    dismissNotification();
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsEmailVerified(u ? u.emailVerified : null);
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
        if (!cancelled) {
          if (!snap.exists()) {
            setHasProfile(false); // no profile doc at all
          } else {
            const data = snap.data() || {};
            // Treat profile as complete ONLY if required fields present
            const complete = !!data.username && !!data.birthDate;
            setHasProfile(complete);
          }
        }
      } catch (e) {
        // If we can't determine, default to allowing app but log
        console.warn('Profile check failed', e);
        // Fail safe: force profile creation again rather than skipping straight in
        if (!cancelled) setHasProfile(false);
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
      registerPushNotificationsForCurrentUser().catch(() => {});
      getLastNotificationResponseData()
        .then((data) => {
          const target = mapNotificationPayloadToTarget(data);
          if (target) {
            requestNavigationTarget(target);
          }
        })
        .catch(() => {});
      unsubscribeResponses = subscribeNotificationResponses((data) => {
        const target = mapNotificationPayloadToTarget(data);
        if (target) {
          requestNavigationTarget(target);
        }
      });
    }
    return () => {
      if (unsubscribeResponses) unsubscribeResponses();
    };
  }, [user, mapNotificationPayloadToTarget, requestNavigationTarget]);

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
    const processUrl = (url: string | null, source: 'initial' | 'event') => {
      if (!url) return;
      console.log(source === 'initial' ? '📱 Initial deep link URL:' : '📱 Deep link received:', url);
      const target = parseUrlToTarget(url);
      if (!target) {
        console.log('❌ Deep link navigation blocked: unsupported target', url);
        return;
      }
      requestNavigationTarget(target);
    };

    Linking.getInitialURL()
      .then((url) => processUrl(url, 'initial'))
      .catch(() => {});

    const subscription = Linking.addEventListener('url', ({ url }) => {
      processUrl(url, 'event');
    });

    return () => subscription.remove();
  }, [parseUrlToTarget, requestNavigationTarget]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#121212' }}>
      <SafeAreaProvider>
        <ActivityProvider>
          <InboxBadgeProvider>
          <NavigationContainer ref={navRef} theme={navTheme} onReady={() => setNavReady(true)}>
          <StatusBar style={theme.isDark ? 'light' : 'dark'} backgroundColor={theme.background} />
          {initializing || (user && (hasProfile === null || isEmailVerified === null)) || !updateChecked ? (
            // Keep splash screen visible, no spinner shown
            null
          ) : (
          <Stack.Navigator
          // Key forces navigator to remount when auth/profile/verification state changes, ensuring correct initial route
          key={user ? `app-${hasProfile === false ? 'noprof' : (isEmailVerified === false ? 'unverified' : 'verified')}` : 'auth'}
          initialRouteName={!user ? 'Login' : (hasProfile === false ? 'CreateProfile' : (isEmailVerified === false ? 'EmailVerificationGate' : 'MainTabs'))}
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            cardStyle: { backgroundColor: theme.background },
            gestureEnabled: Platform.OS === 'ios',
            gestureDirection: 'horizontal',
            gestureResponseDistance:
              Platform.OS === 'ios' ? Dimensions.get('window').width : undefined,
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
          <Stack.Screen name="RegisterEmail" component={RegisterEmailScreen} />
          <Stack.Screen name="EmailVerificationGate" component={EmailVerificationGateScreen} />
          <Stack.Screen name="CreateProfile" component={CreateProfileScreen} />
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="ActivityDetails" component={ActivityDetailsScreen} />
          <Stack.Screen
            name="ChatDetail"
            component={ChatDetailScreen}
            options={{
              cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
            }}
          />
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
            type={currentNotification?.type}
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
