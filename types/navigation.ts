export type RootStackParamList = {
  Login: undefined; // Ensure this is defined
  CreateProfile: {
    mode?: 'edit' | 'create';
    profileData?: any;
  };
  Welcome: undefined;
  MainTabs: { 
    screen?: string; 
    params?: { 
      pickedCoords?: { latitude: number; longitude: number; address?: string };
      selectedDate?: string;
      formState?: {
        description: string;
        sport: string;
        date: string;
        time: string;
        maxParticipants: number;
      };
    }; 
  };
  ActivityDetails: { activityId: string };
  ChatDetail: { chatId: string };
  CreateGame: {
    formState?: {
      description: string;
      sport: string;
      date: string;
      time: string;
      maxParticipants: number;
    };
    pickedCoords?: { latitude: number; longitude: number; address?: string };
  };
  PickLocation: {
    initialCoords: { latitude: number; longitude: number } | null;
    darkMapStyle?: any;
    returnTo: 'CreateGame';
    formState?: {
      description: string;
      sport: string;
      date: string;
      time: string;
      maxParticipants: number;
    };
  };
  Calendar: {
    selectedDate?: string;
  };
  Profile: { userId?: string };
  UserProfile: { userId: string };
  Settings: undefined; // Ensure this is defined
};