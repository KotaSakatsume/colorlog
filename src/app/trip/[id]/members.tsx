import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ColorChip } from '@/components/color-chip';
import { MemberAvatar } from '@/components/member-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useCurrentUser } from '@/repositories/context';
import { useTheme } from '@/hooks/use-theme';
import { useTrip } from '@/hooks/use-trips';

export default function MembersScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useCurrentUser();
  const { trip } = useTrip(id);

  if (!trip) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ThemedText type="small" themeColor="textSecondary">
          読み込み中...
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {trip.memberIds.map((uid) => {
          const member = trip.members[uid];
          const isHost = trip.hostUserId === uid;
          const isMe = me.uid === uid;
          return (
            <View
              key={uid}
              style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
              <MemberAvatar
                userId={uid}
                color={member.color}
                size={36}
                fallbackName={member.displayName}
                config={isMe ? me.avatarConfig : undefined}
              />
              <View style={styles.info}>
                <ThemedText type="smallBold">
                  {member.displayName}
                  {isMe ? '（あなた）' : ''}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {isHost ? '主催者' : 'メンバー'} ・ 公開 {member.postCount ?? 0}/9
                </ThemedText>
              </View>
              {member.color ? (
                <ColorChip color={member.color} size="sm" />
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  未配布
                </ThemedText>
              )}
            </View>
          );
        })}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: 12,
    borderRadius: 14,
  },
  info: { flex: 1, gap: 2 },
});
