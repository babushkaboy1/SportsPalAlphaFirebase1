import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NavigationContainer, createNavigationContainerRef, StackActions, NavigationState } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { Platform, Dimensions, Modal, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { createMaterialTopTabNavigator, MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { enableScreens } from 'react-native-screens';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useActivityContext } from './context/ActivityContext';
import * as Location from 'expo-location';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from './firebaseConfig';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { registerPushNotificationsForCurrentUser, subscribeNotificationResponses, getLastNotificationResponseData, setInAppNotificationHandler } from './utils/notifications';
import * as Linking from 'expo-linking';
import { parseDeepLink } from './utils/deepLinking';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  const lastProfileCompleteRef = useRef(false);
  const pendingNavigationTargetRef = useRef<ExternalNavigationTarget | null>(null);
  const navigationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { theme, navTheme } = useTheme();
  const { currentNotification, dismissNotification, showNotification } = useInAppNotification();
  const [updateChecked, setUpdateChecked] = useState(false);
  const [otaDownloading, setOtaDownloading] = useState(false);
  const [otaReady, setOtaReady] = useState(false);
  const [otaPromptVisible, setOtaPromptVisible] = useState(false);
  const [otaRestarting, setOtaRestarting] = useState(false);

  const profileCompleteKey = useCallback((uid: string) => `profileComplete:${uid}`, []);

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

  // Check for OTA updates on app launch (production builds).
  // Premium flow: download in the background, then prompt user to restart.
  useEffect(() => {
    const checkForUpdates = async () => {
      // Skip in development mode
      if (__DEV__) {
        console.log('[Updates] Skipping update check in development mode');
        setUpdateChecked(true);
        return;
      }

      // Some environments (e.g., certain dev clients) may not have Updates enabled
      if (!Updates.isEnabled) {
        console.log('[Updates] Updates are not enabled in this build');
        setUpdateChecked(true);
        return;
      }

      try {
        console.log('[Updates] Checking for updates...');
        const update = await Updates.checkForUpdateAsync();

        // Do not block app start on the download step
        setUpdateChecked(true);

        if (update.isAvailable) {
          console.log('[Updates] Update available! Downloading in background...');
          setOtaDownloading(true);
          await Updates.fetchUpdateAsync();
          console.log('[Updates] Update downloaded. Prompting user to restart.');
          setOtaReady(true);
          setOtaPromptVisible(true);
        } else {
          console.log('[Updates] App is up to date');
        }
      } catch (error) {
        console.error('[Updates] Error checking for updates:', error);
        // Continue anyway - don't block app launch
        setUpdateChecked(true);
      } finally {
        setOtaDownloading(false);
      }
    };

    checkForUpdates();
  }, []);

  const restartForUpdate = useCallback(async () => {
    if (!otaReady) return;
    try {
      setOtaRestarting(true);
      // Allow the overlay to render for a smoother transition
      await new Promise((r) => setTimeout(r, 250));
      await Updates.reloadAsync();
    } catch (e) {
      console.error('[Updates] Failed to reload:', e);
      setOtaRestarting(false);
    }
  }, [otaReady]);

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
        lastProfileCompleteRef.current = false;
        if (!cancelled) setHasProfile(null);
        return;
      }

      let cachedComplete = false;
      try {
        const cached = await AsyncStorage.getItem(profileCompleteKey(user.uid));
        cachedComplete = cached === '1';
        if (!cancelled && cachedComplete) {
          setHasProfile(true);
          lastProfileCompleteRef.current = true;
        }
      } catch {}

      await new Promise(resolve => setTimeout(resolve, 50));
      if (cancelled) return;
      
      try {
        const snap = await getDoc(doc(db, 'profiles', user.uid));
        if (!cancelled) {
          if (!snap.exists()) {
            lastProfileCompleteRef.current = false;
            setHasProfile(false);
            AsyncStorage.removeItem(profileCompleteKey(user.uid)).catch(() => {});
          } else {
            const data = snap.data() || {};
            const birth = data.birthDate || data.birthdate || data.birth_date;
            const termsAccepted = data.acceptedTerms ?? data.termsAccepted ?? data.accepted_terms ?? false;
            const communityAccepted = data.acceptedCommunityGuidelines ?? data.acceptedCommunity ?? data.accepted_community ?? false;
            const adulthoodAccepted = data.acceptedAdulthood ?? data.confirmedAdult ?? true;

            const inferredComplete = !!data.username && !!birth && !!termsAccepted && !!communityAccepted && !!adulthoodAccepted;
            const complete = data.profileComplete === true || inferredComplete;

            // Once we have a positive signal, keep it unless the profile doc truly disappears
            if (complete || lastProfileCompleteRef.current || cachedComplete) {
              lastProfileCompleteRef.current = true;
              setHasProfile(true);
              AsyncStorage.setItem(profileCompleteKey(user.uid), '1').catch(() => {});
              if (complete && data.profileComplete !== true) {
                setDoc(doc(db, 'profiles', user.uid), { profileComplete: true, profileCompletedAt: data.profileCompletedAt || new Date() }, { merge: true }).catch(() => {});
              }
            } else {
              lastProfileCompleteRef.current = false;
              setHasProfile(false);
              AsyncStorage.removeItem(profileCompleteKey(user.uid)).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.warn('Profile check failed', e);
        if (!cancelled) {
          if (lastProfileCompleteRef.current || cachedComplete) {
            setHasProfile(true);
          } else {
            setHasProfile(null);
          }
        }
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

          {/* OTA Update Prompt */}
          <Modal
            visible={otaPromptVisible}
            transparent
            animationType="fade"
            onRequestClose={() => {
              if (!otaRestarting) setOtaPromptVisible(false);
            }}
          >
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
              <View style={{ width: '100%', maxWidth: 520, backgroundColor: theme.card, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: theme.border }}>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 6 }}>Update ready</Text>
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>
                  A new version is downloaded and ready. Restart SportsPal to apply it.
                </Text>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity
                    onPress={() => setOtaPromptVisible(false)}
                    disabled={otaRestarting}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center', opacity: otaRestarting ? 0.6 : 1 }}
                  >
                    <Text style={{ color: theme.text, fontWeight: '700' }}>Later</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={restartForUpdate}
                    disabled={otaRestarting}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: theme.primary, alignItems: 'center', opacity: otaRestarting ? 0.8 : 1 }}
                  >
                    <Text style={{ color: theme.isDark ? '#000' : '#fff', fontWeight: '900' }}>Restart</Text>
                  </TouchableOpacity>
                </View>

                {otaDownloading ? (
                  <Text style={{ marginTop: 12, color: theme.muted, fontSize: 12 }}>Downloading update…</Text>
                ) : null}
              </View>
            </View>
          </Modal>

          {/* Smooth restart overlay */}
          <Modal visible={otaRestarting} transparent animationType="fade">
            <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={{ marginTop: 14, color: theme.text, fontWeight: '800' }}>Applying update…</Text>
              <Text style={{ marginTop: 6, color: theme.muted }}>This will only take a moment.</Text>
            </View>
          </Modal>
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
  const { initialActivitiesLoaded, initialLocationLoaded } = useActivityContext();

  useEffect(() => {
    if (splashHiddenRef.current) return;
    const shouldHide = () => {
      if (!navReady || initializing || !updateChecked) return false;
      if (!user) return true; // login screen is ready
      if (hasProfile === false) return true; // create profile flow
      // user has profile -> wait for activities AND location to load
      // This ensures the discover screen shows properly filtered activities immediately
      return initialActivitiesLoaded && initialLocationLoaded;
    };

    if (shouldHide()) {
      SplashScreen.hideAsync().catch(() => {});
      splashHiddenRef.current = true;
    }
  }, [navReady, initializing, user, hasProfile, initialActivitiesLoaded, initialLocationLoaded, updateChecked]);

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
