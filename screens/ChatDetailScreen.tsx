// screens/ChatDetailScreen.tsx
import React, { useState, useEffect } from 'react';
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
  StatusBar,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Camera from 'expo-camera';
import { useNavigation } from '@react-navigation/native';

// Define the message type
type Message = {
  id: string;
  sender: string;
  text: string;
  type: 'text' | 'image' | 'audio';
  time: string;
};

// Dummy initial messages
const initialMessages: Message[] = [
  {
    id: '1',
    sender: 'Alex',
    text: "Hey! How's it going?",
    type: 'text',
    time: '7:45 PM',
  },
  {
    id: '2',
    sender: 'You',
    text: 'All good! Ready for the game?',
    type: 'text',
    time: '7:46 PM',
  },
];

const ChatDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [messageText, setMessageText] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<any>({});
  const [playbackInstance, setPlaybackInstance] = useState<Audio.Sound | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);

  // Set Android navigation bar to dark on mount (only on Android)
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync('#121212');
      NavigationBar.setButtonStyleAsync('light');
    }
  }, []);

  // Play an audio message with volume 1.0
  const handlePlayPauseAudio = async (uri: string, id: string) => {
    // Set audio mode for playback (speaker, not earpiece)
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      interruptionModeIOS: 1,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    });

    if (playingAudioId === id && playbackInstance) {
      const status = await playbackInstance.getStatusAsync();
      if (status.isLoaded && status.isPlaying) {
        await playbackInstance.pauseAsync();
      } else if (status.isLoaded) {
        await playbackInstance.playAsync();
      }
      return;
    }

    if (playbackInstance) {
      await playbackInstance.unloadAsync();
      setPlaybackInstance(null);
    }

    setPlayingAudioId(id);
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, rate: playbackRate, volume: 1.0 }
    );
    setPlaybackInstance(sound);

    sound.setOnPlaybackStatusUpdate((status: any) => {
      setAudioStatus(status);
      if (status.isLoaded && status.didJustFinish) {
        setPlayingAudioId(null);
        setPlaybackInstance(null);
        setPlaybackRate(1.0); // Reset speed to 1x after playback ends
      }
    });
    await sound.playAsync();
  };

  const handleSpeedChange = () => {
    let newRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(newRate);
    if (playbackInstance) {
      playbackInstance.setRateAsync(newRate, true);
    }
  };

  // Send a text message. ("You" messages show black text on a turquoise bubble)
  const handleSend = () => {
    if (selectedImages.length > 0) {
      selectedImages.forEach(uri => {
        const newMessage: Message = {
          id: Date.now().toString() + Math.random(),
          sender: 'You',
          text: uri,
          type: 'image',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages(prev => [...prev, newMessage]);
      });
      setSelectedImages([]);
    }
    if (messageText.trim()) {
      const newMessage: Message = {
        id: Date.now().toString(),
        sender: 'You',
        text: messageText,
        type: 'text',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages(prev => [...prev, newMessage]);
      setMessageText('');
    }
  };

  // Start recording audio with proper iOS settings.
  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Please enable audio recording permissions.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        interruptionModeIOS: 1,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      const newRecording = new Audio.Recording();
      const recordingOptions = {
        android: {
          extension: '.m4a',
          outputFormat: 2,
          audioEncoder: 3,
          sampleRate: 44100,
          bitRate: 128000,
        },
        ios: {
          extension: '.caf',
          audioQuality: 3,
          sampleRate: 44100,
          bitRate: 512000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
          format: 'lpcm',
        },
        web: {
          mimeType: 'audio/webm',
        },
      };
      await newRecording.prepareToRecordAsync(recordingOptions as any);
      await newRecording.startAsync();
      setRecording(newRecording);
      console.log('Recording started');
    } catch (error) {
      console.error('Error starting recording:', error);
      Alert.alert('Recording Error', 'Could not start recording. Please try again.');
    }
  };

  // Stop recording and save as an audio message.
  const stopRecording = async () => {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      const newMessage: Message = {
        id: Date.now().toString(),
        sender: 'You',
        text: uri || '',
        type: 'audio',
        time: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      setMessages([...messages, newMessage]);
      console.log('Recording stopped and saved at:', uri);
    } catch (error) {
      console.error('Error stopping recording:', error);
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
      allowsEditing: false, // <--- No cropping!
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      // Add to selectedImages for preview/removal, just like gallery
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#121212' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.flexContainer}>
          {/* Header with group name and navigation buttons */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack}>
              <Ionicons name="arrow-back" size={26} color="#1ae9ef" />
            </TouchableOpacity>
            <Image
              source={require('../assets/default-group.png')}
              style={styles.headerImage}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.headerTitle}>{'Group Name'}</Text>
            </View>
            <TouchableOpacity onPress={() => {/* open group info/settings */}} style={styles.headerInfo}>
              <Ionicons name="information-circle-outline" size={26} color="#1ae9ef" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.messageList}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.messageBubble,
                  item.sender === 'You' ? styles.yourMessage : styles.theirMessage,
                ]}
              >
                {item.type === 'text' && (
                  <Text
                    style={[
                      styles.messageText,
                      item.sender === 'You' && styles.userMessageText,
                    ]}
                  >
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
                      <MaterialIcons name={playingAudioId === item.id && audioStatus.isLoaded && audioStatus.isPlaying ? "pause" : "play-arrow"} size={18} color="#fff" />
                    </TouchableOpacity>
                    <View style={styles.audioWaveformBar}>
                      <View style={[styles.audioWaveformFill, {
                        width: (playingAudioId === item.id && audioStatus.positionMillis && audioStatus.durationMillis)
                          ? `${(audioStatus.positionMillis / audioStatus.durationMillis) * 100}%`
                          : '0%',
                      }]} />
                    </View>
                    <Text style={styles.audioDurationRight}>
                      {playingAudioId === item.id && audioStatus.durationMillis
                        ? `${(audioStatus.durationMillis / 1000).toFixed(2)}`
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
                  <Image source={{ uri: item.text }} style={styles.media} />
                ) : item.type === 'image' && !item.text ? (
                  <Text style={styles.placeholderText}>Image not available</Text>
                ) : null}
                <Text
                  style={[
                    styles.messageTime,
                    item.sender === 'You' && styles.userMessageTime,
                  ]}
                >
                  {item.time}
                </Text>
              </View>
            )}
          />
          {/* Input area wrapped in KeyboardAvoidingView */}
          <View
            style={[
              styles.inputContainer,
              { paddingBottom: insets.bottom } // This line is key!
            ]}
          >
            <TouchableOpacity style={styles.inputCircleButton} onPress={handleCameraPress}>
              <Ionicons name="camera" size={22} color="#007575" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputCircleButton} onPress={handleGalleryPress}>
              <Ionicons name="image" size={22} color="#007575" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputCircleButton} onPress={recording ? stopRecording : startRecording}>
              <Ionicons name={recording ? "stop" : "mic"} size={22} color="#007575" />
            </TouchableOpacity>
            <TextInput
              style={styles.inputText}
              placeholder="Message..."
              placeholderTextColor="#888"
              value={messageText}
              onChangeText={setMessageText}
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
              <Ionicons name="send" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          {selectedImages.length > 0 && (
            <View style={{ flexDirection: 'row', margin: 8 }}>
              {selectedImages.map((uri, idx) => (
                <View key={uri} style={{ marginRight: 6 }}>
                  <Image
                    source={{ uri }}
                    style={{ width: 60, height: 60, borderRadius: 10 }}
                  />
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
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
};

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