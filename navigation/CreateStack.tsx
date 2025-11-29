import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import CreateGameScreen from '../screens/CreateGameScreen';
import { RootStackParamList } from '../types/navigation';

type CreateStackParamList = {
  CreateGame: RootStackParamList['CreateGame'];
};

const Stack = createStackNavigator<CreateStackParamList>();

type CreateStackProps = {
  initialParams?: RootStackParamList['CreateGame'];
};

const CreateStack: React.FC<CreateStackProps> = ({ initialParams }) => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
      }}
    >
      <Stack.Screen
        name="CreateGame"
        component={CreateGameScreen}
        initialParams={initialParams}
      />
    </Stack.Navigator>
  );
};

export default CreateStack;
