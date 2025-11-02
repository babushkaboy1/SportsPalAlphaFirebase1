import React, { useState, useEffect } from 'react';
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { enableScreens } from 'react-native-screens';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './firebaseConfig';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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

// Import the ActivityProvider
import { ActivityProvider } from './context/ActivityContext';
import { InboxBadgeProvider, useInboxBadge } from './context/InboxBadgeContext';
import { RootStackParamList } from './types/navigation';
import DiscoverStack from './navigation/DiscoverStack';
import CalendarStack from './navigation/CalendarStack';
import ProfileStack from './navigation/ProfileStack';
import { decode as atob } from 'base-64';

enableScreens(true);

const MyTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#121212',
  },
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const navRef = createNavigationContainerRef();

const styles = StyleSheet.create({
  tabBarStyle: {
    backgroundColor: '#121212',
    borderTopWidth: 0,
  }
});

const MainTabs = () => {
  const { totalUnread } = useInboxBadge();
  return (
  <Tab.Navigator
    detachInactiveScreens={false}
    screenOptions={({ route }) => ({
      headerShown: false,
      tabBarActiveTintColor: '#1ae9ef',
      tabBarInactiveTintColor: '#ccc',
      tabBarStyle: styles.tabBarStyle,
      tabBarPressColor: 'transparent',
      tabBarButton: (props) => {
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
      tabBarIcon: ({ color, size, focused }) => {
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
      listeners={({ navigation, route }) => ({
        tabPress: e => {
          const state = navigation.getState();
          // Find the currently focused tab
          const focusedTab = state.index !== undefined ? state.routes[state.index] : null;
          // Only reset if Discover is already focused
          if (
            focusedTab &&
            focusedTab.name === 'Discover'
          ) {
            const tab = state.routes.find(r => r.name === 'Discover');
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
      listeners={({ navigation, route }) => ({
        tabPress: e => {
          const state = navigation.getState();
          // Find the currently focused tab
          const focusedTab = state.index !== undefined ? state.routes[state.index] : null;
          // Only reset if Calendar is already focused
          if (
            focusedTab &&
            focusedTab.name === 'Calendar'
          ) {
            const tab = state.routes.find(r => r.name === 'Calendar');
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
      listeners={({ navigation, route }) => ({
        tabPress: e => {
          const state = navigation.getState();
          const focusedTab = state.index !== undefined ? state.routes[state.index] : null;
          if (
            focusedTab &&
            focusedTab.name === 'Profile'
          ) {
            const tab = state.routes.find(r => r.name === 'Profile');
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return unsubscribe;
  }, []);

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

  useEffect(() => {
    if (user) {
      const requestLocation = async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        console.log("Location permission:", status);
      };
      requestLocation();
    }
  }, [user]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#121212' }}>
      <SafeAreaProvider>
        <ActivityProvider>
          <InboxBadgeProvider>
          <NavigationContainer ref={navRef} theme={MyTheme}>
          <StatusBar style="light" backgroundColor="#121212" />
          <Stack.Navigator
          initialRouteName={user ? "MainTabs" : "Login"}
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            animationTypeForReplace: 'push',
            cardStyle: { backgroundColor: '#121212' },
          }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="CreateProfile" component={CreateProfileScreen} />
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="ActivityDetails" component={ActivityDetailsScreen} />
          <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
          <Stack.Screen name="PickLocation" component={PickLocationScreen} />
          <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ headerShown: false }} />
          </Stack.Navigator>
          </NavigationContainer>
          </InboxBadgeProvider>
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
