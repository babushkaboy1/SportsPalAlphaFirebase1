// screens/LegalDocumentScreen.tsx
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLegalDocumentById } from '../data/legalDocuments';

type LegalDocumentScreenRouteProp = RouteProp<RootStackParamList, 'LegalDocument'>;
type LegalDocumentScreenNavigationProp = StackNavigationProp<RootStackParamList, 'LegalDocument'>;

const LegalDocumentScreen: React.FC = () => {
  const navigation = useNavigation<LegalDocumentScreenNavigationProp>();
  const route = useRoute<LegalDocumentScreenRouteProp>();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const documentId = route.params?.documentId;
  const document = documentId ? getLegalDocumentById(documentId) : null;

  if (!document) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.headerContainer}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={26} color={theme.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Document Not Found</Text>
          <View style={{ width: 26 }} />
        </View>
      </View>
    );
  }

  // Parse markdown-style content for basic formatting
  const renderFormattedText = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, index) => {
      // Bold text between **
      if (line.includes('**')) {
        const parts = line.split('**');
        return (
          <Text key={index} style={styles.bodyText}>
            {parts.map((part, i) => 
              i % 2 === 1 ? (
                <Text key={i} style={{ fontWeight: 'bold' }}>{part}</Text>
              ) : (
                part
              )
            )}
            {'\n'}
          </Text>
        );
      }
      
      // Bullet points
      if (line.trim().startsWith('•')) {
        return (
          <Text key={index} style={[styles.bodyText, { marginLeft: 8 }]}>
            {line}{'\n'}
          </Text>
        );
      }
      
      // Regular text
      return (
        <Text key={index} style={styles.bodyText}>
          {line}{'\n'}
        </Text>
      );
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={26} color={theme.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{document.title}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView 
        contentContainerStyle={styles.content} 
        showsVerticalScrollIndicator={true}
      >
        {/* Icon and Title */}
        <View style={styles.titleSection}>
          <Ionicons name={document.icon as any} size={40} color={theme.primary} />
          <Text style={styles.title}>{document.title}</Text>
          <Text style={styles.lastUpdated}>Last Updated: {document.lastUpdated}</Text>
        </View>

        {/* Content */}
        <View style={styles.contentSection}>
          {renderFormattedText(document.content)}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

const createStyles = (t: ReturnType<typeof useTheme>['theme']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.background,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 18,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    color: t.primary,
    fontWeight: 'bold',
    textAlign: 'center',
    flex: 1,
    paddingHorizontal: 8,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: t.text,
    textAlign: 'center',
    marginTop: 12,
  },
  lastUpdated: {
    fontSize: 13,
    color: t.muted,
    marginTop: 6,
  },
  contentSection: {
    backgroundColor: t.card,
    borderRadius: 14,
    padding: 20,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 22,
    color: t.text,
  },
});

export default LegalDocumentScreen;
