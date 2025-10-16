// screens/ChatDetailScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Keyboard,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useAudioRecorder, useAudioPlayer, AudioModule, RecordingPresets } from 'expo-audio';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { listenToMessages, sendMessage } from '../utils/firestoreChats';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { ActivityIcon } from '../components/ActivityIcons'; // Make sure this is imported
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { compressImage, uploadChatImage } from '../utils/imageUtils';

// Firestore message type
type Message = {
  id: string;
  senderId: string;
  text: string;
  type: 'text' | 'image' | 'audio';
  timestamp?: any;
};

const ChatDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<any>();
  const { chatId } = route.params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<{ [userId: string]: any }>({});
  const [messageText, setMessageText] = useState('');
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<any>({});
  const audioPlayer = useAudioPlayer();
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [activityInfo, setActivityInfo] = useState<{ name: string, type: string, date: string, time: string } | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const progressRef = useRef(0);
  const isInitialLoad = useRef(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isMessagesReady, setIsMessagesReady] = useState(false);

  // Set Android navigation bar to dark on mount (only on Android)
  useEffect(() => {
    if (isMessagesReady) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }
  }, [isMessagesReady]);
  useEffect(() => {
    if (Platform.OS === 'android') {
      // NavigationBar.setBackgroundColorAsync is not supported with edge-to-edge enabled
      NavigationBar.setButtonStyleAsync('light');
    }
  }, []);

  // Keyboard listeners - scroll to bottom when keyboard opens
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });

    return () => {
      keyboardDidShowListener.remove();
    };
  }, []);

  // Listen to Firestore messages
  useEffect(() => {
    const unsubscribe = listenToMessages(chatId, (msgs: any[]) => {
      // Sort by timestamp
      const sorted = msgs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      const prevLength = messages.length;
      setMessages(sorted);
      
      // Only auto-scroll if it's not the initial load or if new messages were added
      if (!isInitialLoad.current && sorted.length > prevLength) {
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
      
      // Mark initial load as complete and trigger fade-in
      if (isInitialLoad.current) {
        isInitialLoad.current = false;
        setIsMessagesReady(true);
      }
    });
    return unsubscribe;
  }, [chatId, messages.length]);

  // Fetch sender profiles
  useEffect(() => {
    const fetchProfiles = async () => {
      const uniqueSenderIds = Array.from(new Set(messages.map(m => m.senderId)));
      const newProfiles: { [userId: string]: any } = { ...profiles };
      for (const userId of uniqueSenderIds) {
        if (!newProfiles[userId]) {
          const docSnap = await getDoc(doc(db, 'profiles', userId));
          if (docSnap.exists()) {
            newProfiles[userId] = docSnap.data();
          }
        }
      }
      setProfiles(newProfiles);
    };
    if (messages.length) fetchProfiles();
    // eslint-disable-next-line
  }, [messages]);

  // Fetch activity info
  useEffect(() => {
    const fetchActivity = async () => {
      const chatDoc = await getDoc(doc(db, 'chats', chatId));
      const chatData = chatDoc.data();
      if (chatData?.activityId) {
        const activityDoc = await getDoc(doc(db, 'activities', chatData.activityId));
        if (activityDoc.exists()) {
          const data = activityDoc.data();
          setActivityInfo({
            name: data.activity || data.name || 'Activity',
            type: data.activity || '',
            date: data.date || '',
            time: data.time || '',
          });
        }
      }
    };
    fetchActivity();
  }, [chatId]);

  // Play an audio message
  const handlePlayPauseAudio = async (uri: string, id: string) => {
    if (playingAudioId === id) {
      if (audioPlayer.playing) {
        audioPlayer.pause();
      } else {
        audioPlayer.play();
      }
      return;
    }

    setPlayingAudioId(id);
    audioPlayer.replace(uri);
    audioPlayer.play();
  };

  const handleSpeedChange = () => {
    let newRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(newRate);
    audioPlayer.playbackRate = newRate;
  };

  // Send a message (text, image, audio)
  const handleSend = async () => {
    if (!auth.currentUser) return;
    
    // Send images
    for (const uri of selectedImages) {
      const compressedUri = await compressImage(uri);
      const imageId = Date.now().toString();
      const downloadUrl = await uploadChatImage(compressedUri, auth.currentUser.uid, imageId);
      await sendMessage(chatId, auth.currentUser.uid, downloadUrl, 'image');
    }
    setSelectedImages([]);
    
    // Send text
    if (messageText.trim()) {
      await sendMessage(chatId, auth.currentUser.uid, messageText.trim(), 'text');
      setMessageText('');
      
      // Scroll to bottom immediately after sending
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  };

  // Start recording audio
  const startRecording = async () => {
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Denied', 'Please enable audio recording permissions.');
        return;
      }
      await audioRecorder.record();
    } catch (error) {
      Alert.alert('Recording Error', 'Could not start recording. Please try again.');
    }
  };

  // Stop recording and send as audio message
  const stopRecording = async () => {
    if (!audioRecorder.isRecording || !auth.currentUser) return;
    try {
      const uri = await audioRecorder.stop();
      if (uri != null) {
        await sendMessage(chatId, auth.currentUser.uid, uri, 'audio');
      }
    } catch (error) {
      Alert.alert('Recording Error', 'Could not save the recording.');
    }
  };

  const handleCameraPress = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable camera permissions.');
      return;
    }
    let result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setSelectedImages(prev => [...prev, result.assets[0].uri]);
    }
  };

  const handleGalleryPress = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable gallery permissions.');
      return;
    }
    let result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setSelectedImages(result.assets.map(asset => asset.uri));
    }
  };

  const handleRemoveImage = (uriToRemove: string) => {
    setSelectedImages(prev => prev.filter(uri => uri !== uriToRemove));
  };

  // Grouping logic: show avatar/username only at the start of a group
  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const prev = messages[index - 1];
    const next = messages[index + 1];
    const isFirstOfGroup = !prev || prev.senderId !== item.senderId;
    const isLastOfGroup = !next || next.senderId !== item.senderId;
    const sender = profiles[item.senderId] || {};
    const isOwn = item.senderId === auth.currentUser?.uid;

    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        {/* Avatar column for others, only on last message of group */}
        {!isOwn && (
          <View style={{
            width: 36,
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}>
            {isLastOfGroup ? (
              <TouchableOpacity
                onPress={() => navigation.navigate('UserProfile', { userId: item.senderId })}
                activeOpacity={0.7}
              >
                {typeof sender.photo === 'string' && sender.photo ? (
                  <Image
                    source={{ uri: sender.photo }}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: '#1ae9ef',
                      marginBottom: 2,
                      marginTop: -14,
                    }}
                  />
                ) : (
                  <Image
                    source={require('../assets/default-group.png')}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: '#1ae9ef',
                      marginBottom: 2,
                      marginTop: -14,
                    }}
                  />
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        {/* Message column */}
        <View style={{ flex: 1 }}>
          {isFirstOfGroup && !isOwn && (
            <Text style={{ color: '#1ae9ef', fontWeight: 'bold', fontSize: 14, marginBottom: 2 }}>
              {sender.username || 'User'}
            </Text>
          )}
          <View style={[
            styles.messageBubble,
            isOwn ? styles.yourMessage : styles.theirMessage,
          ]}>
            {item.type === 'text' && (
              <Text style={[
                styles.messageText,
                isOwn && styles.userMessageText,
              ]}>
                {item.text}
              </Text>
            )}
            {item.type === 'audio' && (
              <View style={styles.audioBubbleRow}>
                <TouchableOpacity
                  onPress={() => handlePlayPauseAudio(item.text, item.id)}
                  style={styles.audioPlayButton}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name={playingAudioId === item.id && audioPlayer.playing ? "pause" : "play-arrow"} size={18} color="#fff" />
                </TouchableOpacity>
                <View style={styles.audioWaveformBar}>
                  <View style={[styles.audioWaveformFill, {
                    width: (playingAudioId === item.id && audioPlayer.duration > 0)
                      ? `${(audioPlayer.currentTime / audioPlayer.duration) * 100}%`
                      : '0%',
                  }]} />
                </View>
                <Text style={styles.audioDurationRight}>
                  {playingAudioId === item.id && audioPlayer.duration > 0
                    ? `${audioPlayer.duration.toFixed(2)}`
                    : '0.00'}
                </Text>
                <TouchableOpacity
                  onPress={handleSpeedChange}
                  style={styles.audioSpeedButton}
                  activeOpacity={0.7}
                >
                  <Text style={styles.audioSpeedText}>{playbackRate}x</Text>
                </TouchableOpacity>
              </View>
            )}
            {item.type === 'image' && item.text ? (
              (() => {
                if (typeof item.text === 'string' && item.text) {
                  return <Image source={{ uri: item.text }} style={styles.media} />;
                } else {
                  return <Image source={require('../assets/default-group.png')} style={styles.media} />;
                }
              })()
            ) : item.type === 'image' && !item.text ? (
              <Text style={styles.placeholderText}>Image not available</Text>
            ) : null}
            <Text style={[
              styles.messageTime,
              isOwn && styles.userMessageTime,
            ]}>
              {item.timestamp
                ? new Date(item.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''}
            </Text>
          </View>
        </View>
        {/* No spacer for own messages */}
      </View>
    );
  };

  useEffect(() => {
    const checkAccess = async () => {
      const chatDoc = await getDoc(doc(db, 'chats', chatId));
      const chatData = chatDoc.data();
      if (!chatData?.participants?.includes(auth.currentUser?.uid)) {
        Alert.alert(
          "Access Denied",
          "You are no longer a participant in this group chat.",
          [{ text: "OK", onPress: () => navigation.goBack() }]
        );
      }
    };
    checkAccess();
  }, [chatId]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#121212' }} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.flexContainer}>
          {/* Header with group name and navigation buttons */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack}>
              <Ionicons name="arrow-back" size={26} color="#1ae9ef" />
            </TouchableOpacity>
            {/* Group icon */}
            <Ionicons name="people" size={28} color="#1ae9ef" style={{ marginLeft: 6, marginRight: 4 }} />
            {/* Sport icon */}
            {activityInfo?.type ? (
              <ActivityIcon activity={activityInfo.type} size={24} color="#1ae9ef" />
            ) : null}
            {/* Activity name and schedule */}
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: '#1ae9ef', fontWeight: 'bold', fontSize: 17 }}>
                {activityInfo?.name || 'Group Chat'}
              </Text>
              {activityInfo?.date && activityInfo?.time && (
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '500' }}>
                  Scheduled for {formatDate(activityInfo.date)} at {activityInfo.time}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => {/* open group info/settings */}} style={styles.headerInfo}>
              <Ionicons name="information-circle-outline" size={26} color="#1ae9ef" />
            </TouchableOpacity>
          </View>
          
          {/* Messages area with loading state */}
          {!isMessagesReady ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
              <ActivityIndicator size="large" color="#1ae9ef" />
            </View>
          ) : (
            <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.messageList}
                renderItem={renderItem}
                onLayout={() => {
                  // Instantly scroll to bottom on initial layout (no animation)
                  if (messages.length > 0) {
                    flatListRef.current?.scrollToEnd({ animated: false });
                  }
                }}
                initialNumToRender={20}
              />
            </Animated.View>
          )}
          {/* Input area wrapped in KeyboardAvoidingView */}
          <View
            style={[
              styles.inputContainer,
              { paddingBottom: insets.bottom }
            ]}
          >
            <TouchableOpacity style={styles.inputCircleButton} onPress={handleCameraPress}>
              <Ionicons name="camera" size={22} color="#007575" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputCircleButton} onPress={handleGalleryPress}>
              <Ionicons name="image" size={22} color="#007575" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputCircleButton} onPress={audioRecorder.isRecording ? stopRecording : startRecording}>
              <Ionicons name={audioRecorder.isRecording ? "stop" : "mic"} size={22} color="#007575" />
            </TouchableOpacity>
            <TextInput
              style={styles.inputText}
              placeholder="Message..."
              placeholderTextColor="#888"
              value={messageText}
              onChangeText={setMessageText}
              autoCapitalize="sentences"
              autoCorrect={true}
              textContentType="none"
              autoComplete="off"
              keyboardType="default"
              returnKeyType="send"
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
              <Ionicons name="send" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          {selectedImages.length > 0 && (
            <View style={{ flexDirection: 'row', margin: 8 }}>
              {selectedImages.map((uri, idx) => (
                <View key={uri} style={{ marginRight: 6 }}>
                  {typeof uri === 'string' && uri ? (
                    <Image source={{ uri }} style={{ width: 60, height: 60, borderRadius: 10 }} />
                  ) : (
                    <Image source={require('../assets/default-group.png')} style={{ width: 60, height: 60, borderRadius: 10 }} />
                  )}
                  <TouchableOpacity
                    onPress={() => handleRemoveImage(uri)}
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: 'red',
                      justifyContent: 'center',
                      alignItems: 'center',
                      borderWidth: 2,
                      borderColor: '#fff',
                      zIndex: 1,
                      elevation: 2,
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18, lineHeight: 20 }}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// Helper to format date as dd-mm-yyyy
function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const [yyyy, mm, dd] = dateStr.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

const styles = StyleSheet.create({
  flexContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18191a',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerBack: { padding: 4 },
  headerImage: { width: 38, height: 38, borderRadius: 19, marginLeft: 6 },
  headerTitle: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 17,
    letterSpacing: 0.2,
  },
  headerInfo: { padding: 4, marginLeft: 8 },
  messageList: {
    padding: 10,
    paddingBottom: 0, // was 80, set to 0
  },
  messageBubble: {
    marginVertical: 8,
    marginHorizontal: 10,
    padding: 4,
    borderRadius: 15,
    maxWidth: '75%',
    backgroundColor: 'transparent', // No background for images
  },
  yourMessage: {
    backgroundColor: '#1ae9ef',
    alignSelf: 'flex-end',
  },
  theirMessage: {
    backgroundColor: '#1e1e1e',
    alignSelf: 'flex-start',
  },
  messageText: {
    fontSize: 16,
    color: '#fff',
  },
  userMessageText: {
    color: '#000',
  },
  messageTime: {
    fontSize: 12,
    color: '#ccc',
    alignSelf: 'flex-end',
    marginTop: 5,
  },
  userMessageTime: {
    color: '#007575',
  },
  media: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginVertical: 2,
  },
  placeholderText: {
    color: '#888',
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#1e1e1e',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18191a',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  inputText: {
    flex: 1,
    backgroundColor: '#232323',
    color: '#fff',
    borderRadius: 18,
    paddingHorizontal: 14,
    marginHorizontal: 8,
    fontSize: 16,
    height: 36,
  },
  sendButton: {
    backgroundColor: '#1ae9ef',
    borderRadius: 18,
    padding: 8,
    marginLeft: 4,
  },
  audioContainer: {
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#1e1e1e',
  },
  audioButton: {
    backgroundColor: '#1ae9ef',
    padding: 10,
    borderRadius: 30,
  },
  audioMessageButton: {
    width: 60,
    height: 60,
    backgroundColor: '#1ae9ef',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 0,
    marginVertical: 5,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingVertical: 2,
    paddingHorizontal: 2,
    width: 180,
    gap: 6,
  },
  audioCircleButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e0f7fa',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    borderWidth: 2,
    borderColor: '#007575',
  },
  audioBubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1ae9ef',
    borderRadius: 14,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginVertical: 4,
    minWidth: 120,
    height: 36,
  },
  audioPlayButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#007575',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  audioWaveformBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#b2f5f5',
    borderRadius: 2,
    overflow: 'hidden',
    marginRight: 6,
  },
  audioWaveformFill: {
    height: 4,
    backgroundColor: '#007575',
    borderRadius: 2,
  },
  audioDuration: {
    color: '#fff',
    fontSize: 10,
    marginTop: 1,
    alignSelf: 'flex-end',
  },
  audioDurationRight: {
    color: '#007575',
    fontWeight: 'bold',
    fontSize: 12,
    minWidth: 38,
    textAlign: 'right',
  },
  audioSpeedButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#007575',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  audioSpeedText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  inputCircleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e1e1e', // or '#1ae9ef' for theme
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    borderWidth: 2,
    borderColor: '#007575',
  },
});

export default React.memo(ChatDetailScreen);