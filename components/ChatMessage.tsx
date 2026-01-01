// components/ChatMessage.tsx
// ✅ OPTIMIZED MESSAGE ROW COMPONENT - Instagram-level performance
// Memoized to prevent unnecessary re-renders in VirtualizedList

import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, Pressable, Animated, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { PanGestureHandler, State as GHState } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { auth } from '../firebaseConfig';
import UserAvatar from './UserAvatar';

type Message = {
  id: string;
  senderId: string;
  text: string;
  type: 'text' | 'image' | 'audio' | 'system';
  timestamp?: any;
  replyToId?: string;
};

type ChatMessageProps = {
  item: Message;
  index: number;
  messages: Message[];
  profiles: any;
  isOwn: boolean;
  isFirst: boolean;
  isLast: boolean;
  dmPeer: any;
  chatReads: any;
  participantIds: string[];
  participants: any[];
  reactionsMap: any;
  reactionPickerForId: string | null;
  myReactions: any;
  playingAudioId: string | null;
  audioPlayerPlaying: boolean;
  audioPlayerDuration: number;
  audioPlayerCurrentTime: number;
  playbackRate: number;
  reactionAnim: Animated.Value;
  onLongPress: (item: Message) => void;
  onSwipeReply: (item: Message) => void;
  onReaction: (item: Message, emoji: string) => void;
  onCopy: (text: string) => void;
  onPlayAudio: (uri: string, id: string) => void;
  onSpeedChange: () => void;
  onImagePress: (uri: string) => void;
  onUserPress: (uid: string) => void;
  theme: any;
  styles: any;
};

const bubbleCorners = (isOwn: boolean, isFirst: boolean, isLast: boolean) => {
  if (isOwn) {
    return {
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderBottomRightRadius: isLast ? 18 : 6,
      borderBottomLeftRadius: 18,
    };
  }
  return {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: isLast ? 18 : 6,
    borderBottomRightRadius: 18,
  };
};

const ChatMessage = React.memo<ChatMessageProps>(
  ({
    item,
    messages,
    profiles,
    isOwn,
    isFirst,
    isLast,
    dmPeer,
    chatReads,
    participantIds,
    participants,
    reactionsMap,
    reactionPickerForId,
    myReactions,
    playingAudioId,
    audioPlayerPlaying,
    audioPlayerDuration,
    audioPlayerCurrentTime,
    playbackRate,
    reactionAnim,
    onLongPress,
    onSwipeReply,
    onReaction,
    onCopy,
    onPlayAudio,
    onSpeedChange,
    onImagePress,
    onUserPress,
    theme,
    styles,
  }) => {
    const sender = profiles[item.senderId] || {};
    const senderPhoto = sender.photo || sender.photoURL || null;
    const senderUsername = sender.username || 'User';

    // System message
    if (item.type === 'system') {
      return (
        <View style={{ alignItems: 'center', marginVertical: 8 }}>
          <Text style={{ color: '#aaa', fontStyle: 'italic', fontSize: 13, textAlign: 'center', paddingHorizontal: 10 }}>
            {item.text}
          </Text>
          {!!item.timestamp && (
            <Text style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
              {new Date(item.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
      );
    }

    // Find reply target
    const replied = item.replyToId ? messages.find((m) => m.id === item.replyToId) : undefined;
    const repliedSender = replied ? (profiles[replied.senderId] || {}) : null;

    // Per-message swipe state
    const swipeXRef = useRef(new Animated.Value(0));
    const swipeArmedRef = useRef(false);
    const longPressTriggeredRef = useRef(false);
    const touchStartXRef = useRef<number | null>(null);

    return (
      <View style={[styles.rowLine, isOwn ? styles.rowRight : styles.rowLeft]}>
        {/* Avatar column for others, only for the LAST bubble in cluster */}
        {!isOwn && (
          <View style={styles.avatarSlot}>
            {isLast ? (
              <TouchableOpacity onPress={() => onUserPress(item.senderId)} activeOpacity={0.7}>
                <UserAvatar
                  photoUrl={senderPhoto}
                  username={senderUsername}
                  style={styles.bubbleAvatar}
                />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 28 }} />
            )}
          </View>
        )}

        {/* Message column */}
        <View style={[styles.bubbleCol, isOwn && { alignItems: 'flex-end' }]}>
          {/* Username above FIRST bubble of cluster for others */}
          {!isOwn && isFirst && (
            <TouchableOpacity onPress={() => onUserPress(item.senderId)} activeOpacity={0.7}>
              <Text style={styles.nameAbove}>{senderUsername}</Text>
            </TouchableOpacity>
          )}

          {/* Bubble + swipe-to-reply */}
          <View style={{ position: 'relative', alignSelf: isOwn ? 'flex-end' : 'flex-start' }}>
            <PanGestureHandler
              onGestureEvent={Animated.event([{ nativeEvent: { translationX: swipeXRef.current } }], { useNativeDriver: true })}
              onHandlerStateChange={(e) => {
                const state: any = e.nativeEvent.state;
                const thresholdPx = 72;

                if (state === GHState.ACTIVE) {
                  swipeArmedRef.current = false;
                }
                if (state === GHState.END || state === GHState.CANCELLED || state === GHState.FAILED) {
                  try {
                    (swipeXRef.current as any).stopAnimation?.();
                  } catch {}
                  swipeXRef.current.setValue(0);
                  Animated.spring(swipeXRef.current, { toValue: 0, useNativeDriver: true }).start();
                  if (swipeArmedRef.current) {
                    onSwipeReply(item);
                    swipeArmedRef.current = false;
                  }
                } else {
                  const dx = (e.nativeEvent as any).translationX || 0;
                  if (dx > thresholdPx && !swipeArmedRef.current) {
                    swipeArmedRef.current = true;
                    Haptics.selectionAsync().catch(() => {});
                  }
                }
              }}
              activeOffsetX={[-5, 5]}
            >
              <Animated.View style={{ transform: [{ translateX: swipeXRef.current }] }}>
                <Pressable
                  style={[
                    styles.messageBubble,
                    isOwn ? styles.yourMessage : styles.theirMessage,
                    bubbleCorners(isOwn, isFirst, isLast),
                    item.type === 'image' && styles.imageBubblePad,
                  ]}
                  onLongPress={() => {
                    longPressTriggeredRef.current = true;
                    onLongPress(item);
                  }}
                  onPressIn={(e) => {
                    touchStartXRef.current = e.nativeEvent.pageX;
                  }}
                  onPressOut={(e) => {
                    const start = touchStartXRef.current;
                    touchStartXRef.current = null;
                    if (longPressTriggeredRef.current) {
                      longPressTriggeredRef.current = false;
                      return;
                    }
                    if (typeof start === 'number') {
                      const dx = e.nativeEvent.pageX - start;
                      if (dx > 40) {
                        Haptics.selectionAsync().catch(() => {});
                        onSwipeReply(item);
                      }
                    }
                  }}
                >
                  {/* Reply header */}
                  {replied && (
                    <View style={[styles.replyHeader, isOwn ? styles.replyHeaderOwn : styles.replyHeaderOther]}>
                      <Text style={styles.replyHeaderName} numberOfLines={1}>
                        {repliedSender?.username || 'User'}
                      </Text>
                      <Text style={styles.replyHeaderSnippet} numberOfLines={1}>
                        {replied.type === 'text'
                          ? replied.text
                          : replied.type === 'image'
                          ? 'Photo'
                          : replied.type === 'audio'
                          ? 'Voice message'
                          : replied.text}
                      </Text>
                    </View>
                  )}

                  {item.type === 'text' && (
                    <Text style={[styles.messageText, isOwn && styles.userMessageText]}>{item.text}</Text>
                  )}

                  {item.type === 'audio' && (
                    <View style={styles.audioBubbleRow}>
                      <TouchableOpacity
                        onPress={() => onPlayAudio(item.text, item.id)}
                        style={styles.audioPlayButton}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons
                          name={playingAudioId === item.id && audioPlayerPlaying ? 'pause' : 'play-arrow'}
                          size={18}
                          color="#fff"
                        />
                      </TouchableOpacity>
                      <View style={styles.audioWaveformBar}>
                        <View
                          style={[
                            styles.audioWaveformFill,
                            {
                              width:
                                playingAudioId === item.id && audioPlayerDuration > 0
                                  ? `${(audioPlayerCurrentTime / audioPlayerDuration) * 100}%`
                                  : '0%',
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.audioDurationRight}>
                        {playingAudioId === item.id && audioPlayerDuration > 0
                          ? `${audioPlayerDuration.toFixed(2)}`
                          : '0.00'}
                      </Text>
                      <TouchableOpacity onPress={onSpeedChange} style={styles.audioSpeedButton} activeOpacity={0.7}>
                        <Text style={styles.audioSpeedText}>{playbackRate}x</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {item.type === 'image' && (
                    (() => {
                      const imageUri =
                        typeof item.text === 'string' && item.text
                          ? item.text
                          : senderPhoto;
                      if (!imageUri) {
                        return null;
                      }
                      return (
                        <TouchableOpacity activeOpacity={0.9} onPress={() => onImagePress(imageUri)}>
                          <Image
                            source={{ uri: imageUri }}
                            style={[styles.media, bubbleCorners(isOwn, isFirst, isLast)]}
                            cachePolicy="memory-disk"
                          />
                        </TouchableOpacity>
                      );
                    })()
                  )}

                  {!!item.timestamp && (
                    <Text style={[styles.messageTime, isOwn && styles.userMessageTime]}>
                      {new Date(item.timestamp.seconds * 1000).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  )}
                </Pressable>
              </Animated.View>
            </PanGestureHandler>

            {/* Reactions aggregate chips */}
            {!!reactionsMap[item.id]?.length && (
              <View style={[styles.reactionChipsWrap, { right: 6 }]}>
                {Object.entries(
                  reactionsMap[item.id].reduce((acc: Record<string, number>, r: any) => {
                    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                    return acc;
                  }, {})
                ).map(([emo, count]) => (
                  <View key={emo} style={styles.reactionChip}>
                    <Text style={styles.reactionChipText}>
                      {emo}
                      {Number(count) > 1 ? ` ${count}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Reaction picker */}
            {reactionPickerForId === item.id && (
              <Animated.View
                style={[
                  styles.reactionPickerRow,
                  {
                    position: 'absolute',
                    top: -8,
                    left: isOwn ? undefined : '100%',
                    right: isOwn ? '100%' : undefined,
                    transform: [{ scale: reactionAnim }],
                    opacity: reactionAnim,
                  },
                ]}
              >
                {['❤️', '👍', '🔥', '😂', '👏', '😮'].map((emo) => (
                  <TouchableOpacity key={emo} onPress={() => onReaction(item, emo)} style={styles.reactionBtn}>
                    <Text style={styles.reactionEmoji}>{emo}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    onSwipeReply(item);
                  }}
                  style={[styles.reactionBtn, { paddingHorizontal: 8 }]}
                >
                  <Ionicons name="return-down-back" size={18} color={theme.text} />
                </TouchableOpacity>
                {item.type === 'text' && typeof item.text === 'string' && (
                  <TouchableOpacity
                    onPress={() => onCopy(item.text)}
                    style={[styles.reactionBtn, { paddingHorizontal: 8 }]}
                  >
                    <Ionicons name="copy-outline" size={18} color={theme.text} />
                  </TouchableOpacity>
                )}
              </Animated.View>
            )}
          </View>

          {/* My reaction display */}
          {myReactions[item.id] && (
            <View style={[styles.myReactionTag, isOwn ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
              <Text style={{ fontSize: 12 }}>{myReactions[item.id]}</Text>
            </View>
          )}

          {/* Read receipts */}
          {(() => {
            const ts = (t: any) =>
              t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : typeof t === 'number' ? t : 0;
            const msgMs = ts(item.timestamp);

            // DM read
            if (dmPeer && isOwn && msgMs) {
              const peerTs = ts(chatReads?.[dmPeer.uid]);
              if (peerTs && peerTs >= msgMs) {
                return (
                  <View style={[styles.readAvatarsRow, { alignSelf: 'flex-end' }]}>
                    <Ionicons name="checkmark-done" size={14} color={theme.primary} />
                    <Text style={styles.readText}>Read</Text>
                  </View>
                );
              }
              return null;
            }

            // Group/activity read avatars
            if (!dmPeer && isOwn && msgMs && participantIds?.length) {
              const readers = participants
                .filter((p) => p.uid !== auth.currentUser?.uid)
                .filter((p) => {
                  const r = chatReads?.[p.uid];
                  const rMs = ts(r);
                  return rMs && rMs >= msgMs;
                });
              if (readers.length) {
                const shown = readers.slice(0, 5);
                const extra = readers.length - shown.length;
                return (
                  <View style={[styles.readAvatarsRow, { alignSelf: 'flex-end' }]}>
                    {shown.map((p) => (
                      <UserAvatar
                        key={p.uid}
                        photoUrl={p.photo || p.photoURL}
                        username={p.username || 'User'}
                        style={styles.readAvatar}
                      />
                    ))}
                    {extra > 0 ? <Text style={styles.readText}>+{extra}</Text> : null}
                  </View>
                );
              }
            }
            return null;
          })()}
        </View>
      </View>
    );
  },
  (prevProps, nextProps) => {
    // ✅ Custom comparison for optimal performance
    return (
      prevProps.item.id === nextProps.item.id &&
      prevProps.item.text === nextProps.item.text &&
      prevProps.isOwn === nextProps.isOwn &&
      prevProps.isFirst === nextProps.isFirst &&
      prevProps.isLast === nextProps.isLast &&
      prevProps.reactionPickerForId === nextProps.reactionPickerForId &&
      prevProps.playingAudioId === nextProps.playingAudioId &&
      prevProps.audioPlayerPlaying === nextProps.audioPlayerPlaying &&
      JSON.stringify(prevProps.reactionsMap[prevProps.item.id]) ===
        JSON.stringify(nextProps.reactionsMap[nextProps.item.id]) &&
      JSON.stringify(prevProps.myReactions[prevProps.item.id]) ===
        JSON.stringify(nextProps.myReactions[nextProps.item.id])
    );
  }
);

ChatMessage.displayName = 'ChatMessage';

export default ChatMessage;
