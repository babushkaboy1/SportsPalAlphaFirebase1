import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Share, FlatList, Animated } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActivityContext } from '../context/ActivityContext';
import { ActivityIcon } from '../components/ActivityIcons';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';

const UserProfileScreen = () => {
  const route = useRoute();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { userId } = route.params as { userId: string };
  const [profile, setProfile] = useState<any>(null);
  const { allActivities } = useActivityContext();
  const [activeTab, setActiveTab] = useState<'games' | 'history'>('games');
  const [userJoinedActivities, setUserJoinedActivities] = useState<any[]>([]);
  const [isReady, setIsReady] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const fetchProfile = async () => {
      const docRef = doc(db, "profiles", userId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setProfile({ ...docSnap.data(), uid: userId });
      }
    };
    fetchProfile();
  }, [userId]);

  useEffect(() => {
    if (profile && profile.uid && allActivities) {
      setUserJoinedActivities(
        allActivities.filter(a => a.joinedUserIds?.includes(profile.uid))
      );
    }
  }, [allActivities, profile]);

  useEffect(() => {
    if (profile) {
      setIsReady(true);
    }
  }, [profile]);

  useEffect(() => {
    if (isReady) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  }, [isReady]);

  const handleShareProfile = async () => {
    try {
      await Share.share({
        message: `Check out ${profile?.username}'s SportsPal profile!`,
      });
    } catch (error) {
      console.error(error);
    }
  };

  const renderActivity = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.activityCard}
      onPress={() => navigation.navigate('ActivityDetails', { activityId: item.id })}
    >
      <View style={styles.cardHeader}>
        <ActivityIcon activity={item.activity} size={32} />
        <Text style={styles.cardTitle}>{item.activity}</Text>
      </View>
      <Text style={styles.cardInfo}>Host: {item.creator}</Text>
      <Text style={styles.cardInfo}>Location: {item.location}</Text>
      <Text style={styles.cardInfo}>Date: {item.date} at {item.time}</Text>
      <Text style={styles.cardInfo}>Participants: {item.joinedUserIds ? item.joinedUserIds.length : item.joinedCount} / {item.maxParticipants}</Text>
    </TouchableOpacity>
  );

  if (!isReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#121212' }} edges={['top']} />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={28} color="#1ae9ef" />
        </TouchableOpacity>
        <Text style={styles.profileNameHeader}>{profile?.username || 'Username'}</Text>
        <TouchableOpacity style={styles.shareButton} onPress={handleShareProfile}>
          <Ionicons name="share-social-outline" size={28} color="#1ae9ef" />
        </TouchableOpacity>
      </View>
      <View style={styles.profileInfo}>
        <View style={styles.profileLeftColumn}>
          <Image source={{ uri: profile?.photo || 'https://via.placeholder.com/100' }} style={styles.profileImage} />
        </View>
      </View>
      <View style={styles.profileActionsRow}>
        <TouchableOpacity style={styles.profileActionButton} onPress={() => {/* Add friend logic */}}>
          <Ionicons name="person-add-outline" size={18} color="#1ae9ef" style={{ marginRight: 6 }} />
          <Text style={styles.profileActionText}>Add Friend</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.profileActionButton} onPress={() => {/* Message logic */}}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color="#1ae9ef" style={{ marginRight: 6 }} />
          <Text style={styles.profileActionText}>Message</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'games' && styles.activeTab, { flex: 1 }]}
          onPress={() => setActiveTab('games')}
        >
          <Ionicons name="list" size={28} color={activeTab === 'games' ? '#1ae9ef' : '#fff'} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && styles.activeTab, { flex: 1 }]}
          onPress={() => setActiveTab('history')}
        >
          <Ionicons name="time" size={28} color={activeTab === 'history' ? '#1ae9ef' : '#fff'} />
        </TouchableOpacity>
      </View>
      <View style={styles.contentContainer}>
        {activeTab === 'games' ? (
          <FlatList
            data={userJoinedActivities}
            renderItem={renderActivity}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
          />
        ) : (
          <Text style={styles.tabContent}>Match History</Text>
        )}
      </View>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    paddingLeft: 10,
    paddingRight: 10,
    gap: 8,
  },
  shareButton: {
    position: 'absolute',
    right: 10,
    top: 0,
    padding: 5,
  },
  backButton: { padding: 5 },
  profileNameHeader: {
    fontSize: 24,
    color: '#1ae9ef',
    fontWeight: 'bold',
    textAlign: 'left',
  },
  settingsButton: { padding: 5 },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
  },
  profileLeftColumn: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: '#1ae9ef',
  },
  profileActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 10,
  },
  profileActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#1ae9ef',
  },
  profileActionText: {
    color: '#1ae9ef',
    fontWeight: 'bold',
    fontSize: 16,
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: '#121212',
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#1ae9ef',
  },
  contentContainer: {
    paddingHorizontal: 20,
    flex: 1,
  },
  tabContent: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '500',
  },
  activityCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1ae9ef',
    marginLeft: 10,
  },
  cardInfo: {
    fontSize: 16,
    color: '#ccc',
    marginVertical: 2,
    fontWeight: '500',
  },
  listContainer: {
    paddingBottom: 0,
  },
});

export default UserProfileScreen;