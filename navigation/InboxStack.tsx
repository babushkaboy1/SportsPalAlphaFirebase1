import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import ChatsScreen from '../screens/ChatsScreen';

type InboxStackParamList = {
  Inbox: undefined;
};

const Stack = createStackNavigator<InboxStackParamList>();

const InboxStack: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
      }}
    >
      <Stack.Screen name="Inbox" component={ChatsScreen} />
    </Stack.Navigator>
  );
};

export default InboxStack;
