import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import DiscoverGamesScreen from '../screens/DiscoverGamesScreen';
import ActivityDetailsScreen from '../screens/ActivityDetailsScreen';
import UserProfileScreen from '../screens/UserProfileScreen';

const Stack = createStackNavigator();

export default function DiscoverStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
      }}
    >
      <Stack.Screen name="DiscoverGames" component={DiscoverGamesScreen} />
      <Stack.Screen name="ActivityDetails" component={ActivityDetailsScreen} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} />
    </Stack.Navigator>
  );
}