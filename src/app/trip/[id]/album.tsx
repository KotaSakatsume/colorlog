import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BestNineMini } from '@/components/best-nine-grid';
import { ColorChip } from '@/components/color-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTrip, useTripPosts } from '@/hooks/use-trips';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { trip } = useTrip(id);
  const { posts } = useTripPosts(id);

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
                  <ThemedText key={post.id} type="small" themeColor="textSecondary">
                    {post.caption}
                  </ThemedText>
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
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
