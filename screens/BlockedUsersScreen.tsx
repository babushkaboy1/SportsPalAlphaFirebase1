// screens/BlockedUsersScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import UserAvatar from '../components/UserAvatar';
import { getBlockedUsers, unblockUser } from '../utils/firestoreBlocks';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import * as Haptics from 'expo-haptics';

interface BlockedUserProfile {
  uid: string;
  username: string;
  photo?: string;
}

const BlockedUsersScreen: React.FC = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBlockedUsers();
  }, []);

  const loadBlockedUsers = async () => {
    try {
      setLoading(true);
      const blockedIds = await getBlockedUsers();
      
      // Fetch profiles for blocked users
      const profiles: BlockedUserProfile[] = [];
      for (const uid of blockedIds) {
        try {
          const profileDoc = await getDoc(doc(db, 'profiles', uid));
          if (profileDoc.exists()) {
            const data = profileDoc.data();
            profiles.push({
              uid,
              username: data.username || 'User',
              photo: data.photo || data.photoURL,
            });
          } else {
            // User profile doesn't exist, but keep in list
            profiles.push({
              uid,
              username: 'Deleted User',
              photo: undefined,
            });
          }
        } catch (error) {
          console.error('Error fetching blocked user profile:', error);
          profiles.push({
            uid,
            username: 'Unknown User',
            photo: undefined,
          });
        }
      }
      
      setBlockedUsers(profiles);
    } catch (error) {
      console.error('Error loading blocked users:', error);
      Alert.alert('Error', 'Failed to load blocked users');
    } finally {
      setLoading(false);
    }
  };

  const handleUnblock = (user: BlockedUserProfile) => {
    Alert.alert(
      'Unblock User',
      `Are you sure you want to unblock ${user.username}? They will be able to see your profile and send you messages again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            try {
              await unblockUser(user.uid);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setBlockedUsers(prev => prev.filter(u => u.uid !== user.uid));
            } catch (error) {
              console.error('Error unblocking user:', error);
              Alert.alert('Error', 'Failed to unblock user');
            }
          },
        },
      ]
    );
  };

  const renderBlockedUser = ({ item }: { item: BlockedUserProfile }) => (
    <View style={styles.userCard}>
      <View style={styles.userInfo}>
        <UserAvatar
          photoUrl={item.photo}
          username={item.username}
          size={50}
          style={styles.userAvatar}
        />
        <View style={styles.userDetails}>
          <Text style={styles.username}>{item.username}</Text>
          <Text style={styles.blockedLabel}>Blocked</Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.unblockButton}
        onPress={() => handleUnblock(item)}
      >
        <Text style={styles.unblockButtonText}>Unblock</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={26} color={theme.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blocked Users</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : blockedUsers.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="ban-outline" size={64} color={theme.muted} />
          <Text style={styles.emptyTitle}>No Blocked Users</Text>
          <Text style={styles.emptyText}>
            When you block someone, they won't be able to see your profile or send you messages.
          </Text>
        </View>
      ) : (
        <FlatList
          data={blockedUsers}
          renderItem={renderBlockedUser}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
};

const createStyles = (t: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: t.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: t.text,
    marginTop: 20,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: t.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  listContent: {
    padding: 16,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.border,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: t.danger,
  },
  userDetails: {
    marginLeft: 12,
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: t.text,
    marginBottom: 4,
  },
  blockedLabel: {
    fontSize: 12,
    color: t.danger,
    fontWeight: '500',
  },
  unblockButton: {
    backgroundColor: t.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  unblockButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});

export default BlockedUsersScreen;
