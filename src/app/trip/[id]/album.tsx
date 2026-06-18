import { useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { BestNineMini } from '@/components/best-nine-grid';
import { ColorChip } from '@/components/color-chip';
import { ReactionBar } from '@/components/reaction-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { ReactionEmoji } from '@/domain/types';
import { useCurrentUser, useRepositories } from '@/repositories/context';
import { useTripReactions } from '@/hooks/use-reactions';
import { useTrip, useTripPosts } from '@/hooks/use-trips';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useCurrentUser();
  const { posts: postRepo } = useRepositories();
  const { trip } = useTrip(id);
  const { posts } = useTripPosts(id);
  const reactions = useTripReactions(id);

  async function handleToggle(postId: string, emoji: ReactionEmoji) {
    if (!trip) return;
    // メンバー検証は Firebase ルール側で担保する想定。UI は楽観的に弾くだけ。
    if (!trip.memberIds.includes(user.uid)) return;
    try {
      await postRepo.toggleReaction({ tripId: trip.id, postId, user, emoji });
    } catch (e) {
      Alert.alert('リアクションできませんでした', String(e instanceof Error ? e.message : e));
    }
  }

  if (!trip) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ThemedText type="small" themeColor="textSecondary">
          読み込み中...
        </ThemedText>
      </ThemedView>
    );
  }

  // 色を持つメンバーだけを並べる（配布済み前提のパレット表示）。
  const rows = trip.memberIds
    .map((uid) => ({ uid, member: trip.members[uid] }))
    .filter((r) => r.member?.color);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          {trip.name} のベスト9を色ごとに。
        </ThemedText>
        {rows.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            まだ色が配布されていません。
          </ThemedText>
        ) : (
          rows.map(({ uid, member }) => {
            const memberPosts = posts.filter((p) => p.userId === uid);
            return (
              <View key={uid} style={styles.row}>
                <View style={styles.rowHeader}>
                  <ThemedText type="smallBold">{member.displayName}</ThemedText>
                  <ColorChip color={member.color!} size="sm" />
                  <ThemedText type="small" themeColor="textSecondary">
                    {memberPosts.length}/9
                  </ThemedText>
                </View>
                <BestNineMini posts={memberPosts} color={member.color!} />
                {memberPosts.map((post) => (
                  <View key={post.id} style={styles.reactionRow}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {post.caption}
                    </ThemedText>
                    <ReactionBar
                      summary={reactions.get(post.id)}
                      onToggle={(emoji) => handleToggle(post.id, emoji)}
                    />
                  </View>
                ))}
              </View>
            );
          })
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.four },
  row: { gap: Spacing.two },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  reactionRow: { gap: Spacing.one },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
