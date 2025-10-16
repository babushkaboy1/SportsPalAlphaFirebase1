import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import CalendarScreen from '../screens/CalendarScreen';
import ActivityDetailsScreen from '../screens/ActivityDetailsScreen';
import UserProfileScreen from '../screens/UserProfileScreen';

const Stack = createStackNavigator();

export default function CalendarStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
      }}
    >
      <Stack.Screen name="CalendarMain" component={CalendarScreen} />
      <Stack.Screen name="ActivityDetails" component={ActivityDetailsScreen} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} />
    </Stack.Navigator>
  );
}