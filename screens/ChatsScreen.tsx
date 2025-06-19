// screens/ChatsScreen.tsx
import React, { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  StatusBar,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Dummy Data for Chats
const chatList = [
  {
    id: '1',
    name: 'Basketball Group',
    message: 'Game tomorrow at 6!',
    image: require('../assets/default-group.png'),
    isGroup: true,
    isPinned: true,
  },
  {
    id: '2',
    name: 'Alex',
    message: "Let's hit the gym",
    image: require('../assets/default-profile.png'),
    isGroup: false,
    isPinned: false,
  },
  {
    id: '3',
    name: 'Soccer Friends',
    message: 'Training on Friday',
    image: require('../assets/default-group.png'),
    isGroup: true,
    isPinned: false,
  },
  {
    id: '4',
    name: 'John',
    message: 'See you at the court',
    image: require('../assets/default-profile.png'),
    isGroup: false,
    isPinned: false,
  },
];

const ChatsScreen = ({ navigation }: any) => {
  const [searchQuery, setSearchQuery] = useState('');
  const insets = useSafeAreaInsets();

  const filteredChats = chatList.filter((chat) =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderChatItem = ({ item }: any) => (
    <TouchableOpacity
      style={styles.chatItem}
      onPress={() =>
        navigation.navigate('ChatDetail', { chatId: item.id })
      }
    >
      <Image source={item.image} style={styles.avatar} />
      <View style={styles.chatInfo}>
        <Text style={styles.chatName}>{item.name}</Text>
        <Text style={styles.lastMessage}>{item.message}</Text>
      </View>
      {item.isPinned && (
        <Ionicons
          name="pin"
          size={20}
          color="#1ae9ef"
          style={styles.pinIcon}
        />
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.headerTitle}>Chats</Text>
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
      <FlatList
        data={filteredChats}
        keyExtractor={(item) => item.id}
        renderItem={renderChatItem}
        contentContainerStyle={styles.chatList}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // For Android, we add some extra top padding using StatusBar.currentHeight to position the content naturally.
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 10,
    paddingTop:
      Platform.OS === 'android'
        ? (StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 25)
        : 10,
  },
  headerTitle: {
    fontSize: 28,
    color: '#1ae9ef',
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 18,
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
    fontWeight: '500', // Make search text a little bold
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
    fontWeight: '500', // Slightly bold for consistency
  },
  lastMessage: {
    fontSize: 14,
    color: '#ccc',
    fontWeight: '500', // Slightly bold for consistency
  },
  pinIcon: {
    marginLeft: 10,
  },
});

export default React.memo(ChatsScreen);