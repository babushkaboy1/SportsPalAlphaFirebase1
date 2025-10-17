// screens/ChatsScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  StatusBar,
  Platform,
  Animated,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchUserChats } from '../utils/firestoreChats';
import { doc, getDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { useFocusEffect } from '@react-navigation/native';
import { useActivityContext } from '../context/ActivityContext';
import { ActivityIcon } from '../components/ActivityIcons'; // <-- Add this import

type Chat = {
  id: string;
  activityId?: string;
  [key: string]: any; // for other fields
};

const sportIconMap: Record<string, React.ReactNode> = {
  football: <MaterialCommunityIcons name="soccer" size={28} color="#1ae9ef" />,
  basketball: <MaterialCommunityIcons name="basketball" size={28} color="#1ae9ef" />,
  tennis: <MaterialCommunityIcons name="tennis" size={28} color="#1ae9ef" />,
  // Add more mappings as needed
};

const TURQUOISE = '#1ae9ef';

const ChatsScreen = ({ navigation }: any) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLocked, setRefreshLocked] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { joinedActivities } = useActivityContext();

  const loadChats = async () => {
    if (auth.currentUser) {
      const userChats = await fetchUserChats(auth.currentUser.uid);

      // For each chat, fetch activity info and last message
      const chatsWithDetails = await Promise.all(
        userChats.map(async (chat: Chat) => {
          let activityName = 'Group Chat';
          let activityImage = 'https://via.placeholder.com/50';
          let activityType = '';
          let activityDate = '';
          let activityTime = '';
          if (chat.activityId) {
            const activityDoc = await getDoc(doc(db, 'activities', chat.activityId));
            if (activityDoc.exists()) {
              const activityData = activityDoc.data();
              activityName = activityData.activity || activityData.name || 'Group Chat';
              activityImage = activityData.image || 'https://via.placeholder.com/50';
              activityType = activityData.activity || '';
              activityDate = activityData.date || '';
              activityTime = activityData.time || '';
            }
          }
          // Get last message and sender username
          let lastMessage = '';
          let lastSender = '';
          const messagesRef = collection(db, 'chats', chat.id, 'messages');
          const lastMsgQuery = query(messagesRef, orderBy('timestamp', 'desc'), limit(1));
          const lastMsgSnap = await getDocs(lastMsgQuery);
          if (!lastMsgSnap.empty) {
            const msg = lastMsgSnap.docs[0].data();
            if (msg.type === 'image') {
              lastMessage = 'Sent a photo';
            } else if (msg.type === 'audio') {
              lastMessage = '🎤 Voice message';
            } else if (msg.text) {
              lastMessage = msg.text;
            } else {
              lastMessage = 'New message';
            }
            // Fetch sender username
            if (msg.senderId) {
              const senderDoc = await getDoc(doc(db, 'profiles', msg.senderId));
              lastSender = senderDoc.exists() ? senderDoc.data().username || '' : '';
            }
          } else {
            lastMessage = 'No messages yet';
          }
          return {
            ...chat,
            name: activityName,
            image: activityImage,
            activityType,
            lastMessage,
            lastSender,
            date: activityDate,
            time: activityTime,
          };
        })
      );
      setChats(chatsWithDetails);
    }
    setIsReady(true);
  };

  useFocusEffect(
    React.useCallback(() => {
      if (!chats.length) {
        loadChats(); // Only fetch if chats are empty
      }
    }, [chats])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await loadChats();
    setTimeout(() => {
      setRefreshing(false);
      setRefreshLocked(false);
    }, 1500);
  };

  const filteredChats = chats.filter((chat) =>
    chat.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderChatItem = ({ item }: any) => (
    <TouchableOpacity
      style={styles.chatItem}
      onPress={() => navigation.navigate('ChatDetail', { chatId: item.id })}
    >
      {/* Group chat icon */}
      <View style={{ marginRight: 10 }}>
        <Ionicons name="people" size={32} color={TURQUOISE} />
      </View>
      {/* Sport/activity icon */}
      <View style={{ marginRight: 10 }}>
        <ActivityIcon activity={item.activityType} size={28} color={TURQUOISE} />
      </View>
      {/* Chat info and date/time */}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={styles.chatInfo}>
          <Text style={styles.chatName}>
            <Text style={{ color: TURQUOISE, fontWeight: 'bold', fontSize: 18 }}>
              {item.name}
            </Text>
          </Text>
          <Text style={styles.lastMessage}>
            {item.lastSender ? (
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>{item.lastSender}: </Text>
            ) : null}
            <Text style={{ color: '#ccc', fontWeight: 'normal' }}>{item.lastMessage}</Text>
          </Text>
        </View>
        {/* Activity scheduled date/time */}
        {item.activityId && item.date && item.time && (
          <View style={{ alignItems: 'flex-end', marginLeft: 8, maxWidth: 120 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '500', textAlign: 'right' }}>
              Activity scheduled for
            </Text>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '500', textAlign: 'right' }}>
              {formatDate(item.date)} at {item.time}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  // Helper to format date as dd-mm-yyyy
  function formatDate(dateStr: string) {
    if (!dateStr) return '';
    const [yyyy, mm, dd] = dateStr.split('-');
    return `${dd}-${mm}-${yyyy}`;
  }

  useEffect(() => {
    if (isReady) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  }, [isReady]);

  if (!isReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <ActivityIndicator size="large" color="#1ae9ef" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Chats</Text>
        </View>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#ccc" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            placeholderTextColor="#bbb"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        {filteredChats.length === 0 ? (
          <Text style={{ color: '#bbb', textAlign: 'center', marginTop: 40 }}>No group chats yet.</Text>
        ) : (
          <FlatList
            data={filteredChats}
            keyExtractor={(item) => item.id}
            renderItem={renderChatItem}
            contentContainerStyle={styles.chatList}
            refreshControl={
              <RefreshControl
                refreshing={refreshing || refreshLocked}
                onRefresh={onRefresh}
                colors={["#009fa3"]}
                tintColor="#009fa3"
                progressBackgroundColor="transparent"
              />
            }
          />
        )}
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingHorizontal: 10,
  },
  header: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  headerTitle: {
    fontSize: 28,
    color: '#1ae9ef',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  chatList: {
    paddingBottom: 20,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginVertical: 5,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
  },
  chatInfo: {
    flex: 1,
  },
  chatName: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '500',
  },
  lastMessage: {
    fontSize: 14,
    color: '#ccc',
    fontWeight: '500',
  },
});

export default React.memo(ChatsScreen);