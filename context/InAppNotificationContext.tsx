import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

interface NotificationData {
  id: string;
  title: string;
  body: string;
  image?: string;
  type: 'chat' | 'activity_invite' | 'friend_request' | 'friend_accept' | 'group_chat';
  chatId?: string;
  activityId?: string;
  userId?: string;
}

interface InAppNotificationContextType {
  showNotification: (notification: NotificationData) => void;
  currentNotification: NotificationData | null;
  dismissNotification: () => void;
  setCurrentChatId: (chatId: string | null) => void;
  isAppInForeground: boolean;
}

const InAppNotificationContext = createContext<InAppNotificationContextType | undefined>(undefined);

export const InAppNotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentNotification, setCurrentNotification] = useState<NotificationData | null>(null);
  const [isAppInForeground, setIsAppInForeground] = useState(true);
  const currentChatIdRef = useRef<string | null>(null);
  const appState = useRef(AppState.currentState);

  // Track app state
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        setIsAppInForeground(true);
      } else if (nextAppState.match(/inactive|background/)) {
        setIsAppInForeground(false);
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const setCurrentChatId = useCallback((chatId: string | null) => {
    currentChatIdRef.current = chatId;
  }, []);

  const showNotification = useCallback((notification: NotificationData) => {
    // Don't show if app is in background
    if (!isAppInForeground) {
      return;
    }

    // Don't show chat notifications if user is viewing that specific chat
    if (notification.type === 'chat' && notification.chatId) {
      if (currentChatIdRef.current === notification.chatId) {
        return;
      }
    }

    // Dismiss any existing notification
    setCurrentNotification(null);
    
    // Show new notification after a brief delay
    setTimeout(() => {
      setCurrentNotification(notification);
    }, 100);
  }, [isAppInForeground]);

  const dismissNotification = useCallback(() => {
    setCurrentNotification(null);
  }, []);

  return (
    <InAppNotificationContext.Provider
      value={{
        showNotification,
        currentNotification,
        dismissNotification,
        setCurrentChatId,
        isAppInForeground,
      }}
    >
      {children}
    </InAppNotificationContext.Provider>
  );
};

export const useInAppNotification = () => {
  const context = useContext(InAppNotificationContext);
  if (!context) {
    throw new Error('useInAppNotification must be used within InAppNotificationProvider');
  }
  return context;
};
