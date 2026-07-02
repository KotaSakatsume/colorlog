import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BestNineGrid } from '@/components/best-nine-grid';
import { ColorChip } from '@/components/color-chip';
import { MemberAvatar } from '@/components/member-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useCurrentUser } from '@/repositories/context';
import { useTrip, useTripPosts } from '@/hooks/use-trips';

export default function AlbumScreen() {
  // userId 指定時は単一メンバーのアルバム（メンバー一覧からの遷移）。
  const { id, userId } = useLocalSearchParams<{ id: string; userId?: string }>();
  const me = useCurrentUser();
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

  // 色を持つメンバーだけを並べる（配布済み前提のパレット表示）。userId 指定時はその1人に絞る。
  const rows = trip.memberIds
    .filter((uid) => (userId ? uid === userId : true))
    .map((uid) => ({ uid, member: trip.members[uid] }))
    .filter((r) => r.member?.color);

  const single = userId ? trip.members[userId] : undefined;
  // 横断ナビ: 表示中以外の色持ちメンバー。
  const others = userId
    ? trip.memberIds
        .filter((uid) => uid !== userId)
        .map((uid) => ({ uid, member: trip.members[uid] }))
        .filter((r) => r.member?.color)
    : [];

  return (
    <ThemedView style={styles.container}>
      {single && <Stack.Screen options={{ title: `${single.displayName}のアルバム` }} />}
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          {single
            ? `${trip.name} での ${single.displayName} のベスト9。`
            : `${trip.name} のベスト9を色ごとに。`}
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
                <BestNineGrid posts={memberPosts} color={member.color!} />
              </View>
            );
          })
        )}

        {/* ほかのメンバーへの横断ナビ（個人アルバムのみ）。戻らずに切り替えられる。 */}
        {others.length > 0 && (
          <View style={styles.othersSection}>
            <ThemedText type="smallBold">ほかのメンバーのアルバム</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.othersRow}>
                {others.map(({ uid, member }) => (
                  <Pressable
                    key={uid}
                    onPress={() => router.setParams({ userId: uid })}
                    accessibilityRole="button"
                    accessibilityLabel={`${member.displayName}のアルバム`}
                    style={({ pressed }) => [styles.other, { opacity: pressed ? 0.7 : 1 }]}>
                    <MemberAvatar
                      userId={uid}
                      color={member.color}
                      size={48}
                      fallbackName={member.displayName}
                      config={uid === me.uid ? me.avatarConfig : undefined}
                    />
                    <ThemedText type="small" numberOfLines={1} style={styles.otherName}>
                      {member.displayName}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
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
  othersSection: { gap: Spacing.two },
  othersRow: { flexDirection: 'row', gap: Spacing.three },
  other: { alignItems: 'center', gap: 4, width: 64 },
  otherName: { textAlign: 'center' },
});
