import React, { useState, useEffect } from 'react';
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { enableScreens } from 'react-native-screens';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './firebaseConfig';

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

const MainTabs = () => (
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
      tabBarIcon: ({ color, size }) => {
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
          case 'Chats':
            iconName = 'chatbubbles-outline';
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
    <Tab.Screen name="Chats" component={ChatsScreen} />
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
    <ActivityProvider>
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
    </ActivityProvider>
  );
}

// Define your tab param list
type TabParamList = {
  Discover: undefined;
  Calendar: undefined;
  CreateGame: undefined;
  Chats: undefined;
  Profile: undefined;
};

if (typeof global.atob === 'undefined') {
  global.atob = atob;
}
