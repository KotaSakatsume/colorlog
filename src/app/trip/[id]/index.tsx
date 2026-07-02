import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BestNineGrid } from '@/components/best-nine-grid';
import { QrInvite } from '@/components/qr-invite';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UIButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { contrastTextColor } from '@/domain/colors';
import { STATUS_LABEL, formatDateRange, isTripOver } from '@/domain/format';
import { countOccupiedSlots, mergeBestNine } from '@/domain/merge-best-nine';
import { BEST_NINE_SLOTS } from '@/domain/types';
import { useCurrentUser, useRepositories } from '@/repositories/context';
import { useTheme } from '@/hooks/use-theme';
import { useTrip, useTripInviteCode, useTripPosts } from '@/hooks/use-trips';
import { useTripUploadJobs } from '@/hooks/use-upload-jobs';

/** 破壊的操作（削除）を示す赤。 */
const DESTRUCTIVE = '#E5484D';

export default function TripDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useCurrentUser();
  const { trips: tripRepo, uploadQueue } = useRepositories();
  const { trip, loading } = useTrip(id);
  const { posts } = useTripPosts(id);
  const jobs = useTripUploadJobs(id);
  const inviteCode = useTripInviteCode(id);
  const [deleting, setDeleting] = useState(false);

  if (loading) {
    return <Centered text="読み込み中..." />;
  }
  if (!trip) {
    // 削除直後は購読が即時に null を流すため、誤って「見つかりません」を出さない。
    return <Centered text={deleting ? '削除しました' : 'トリップが見つかりません'} />;
  }

  const me = trip.members[user.uid];
  const myColor = me?.color;
  const isHost = trip.hostUserId === user.uid;
  // 確定 Post と送信中ジョブを slotIndex でマージ。枚数表示・グリッドはマージ後を真実にする。
  const cells = mergeBestNine(posts, jobs, user.uid);
  const filled = countOccupiedSlots(cells);
  const over = isTripOver(trip);

  function goCompose(slot?: number) {
    router.push({
      pathname: '/trip/[id]/compose',
      params: { id: trip!.id, ...(slot !== undefined ? { slot: String(slot) } : {}) },
    });
  }

  // スロットタップの導線（表示と挙動を一致させる）。failed セル（「再送」バッジ）は
  // その場で uploadQueue.retry(job.id) を呼ぶ。それ以外は compose へ遷移（should-4）。
  function handlePressSlot(slot: number) {
    const cell = cells.find((c) => c.slotIndex === slot);
    if (cell?.state === 'failed' && cell.job) {
      void uploadQueue.retry(cell.job.id);
      return;
    }
    goCompose(slot);
  }

  async function handleAssign() {
    try {
      await tripRepo.assignColors(trip!.id);
    } catch (e) {
      Alert.alert('配布できませんでした', String(e instanceof Error ? e.message : e));
    }
  }

  function handleDelete() {
    Alert.alert(
      'トリップを削除しますか？',
      'この操作は取り消せません。投稿やアルバムもすべて削除されます。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await tripRepo.deleteTrip(trip!.id);
              router.replace('/');
            } catch (e) {
              setDeleting(false);
              Alert.alert('削除できませんでした', String(e instanceof Error ? e.message : e));
            }
          },
        },
      ],
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: trip.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDateRange(trip.startDate, trip.endDate)} ・ {trip.memberIds.length}人 ・{' '}
          {STATUS_LABEL[trip.status]}
        </ThemedText>

        {/* 招待コードを常時表示（メンバー招待用） */}
        {inviteCode && (
          <View style={[styles.inviteCard, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">
              招待コード
            </ThemedText>
            <ThemedText type="title" style={styles.inviteCode}>
              {inviteCode.code}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              このコードを共有してメンバーを招待できます
            </ThemedText>
            <QrInvite code={inviteCode.code} />
          </View>
        )}

        {/* 自分の色を大きく表示 */}
        {myColor ? (
          <View style={[styles.colorHero, { backgroundColor: myColor.hex }]}>
            <ThemedText type="small" style={{ color: contrastTextColor(myColor.hex), opacity: 0.85 }}>
              あなたの色
            </ThemedText>
            <ThemedText type="title" style={{ color: contrastTextColor(myColor.hex) }}>
              {myColor.name}
            </ThemedText>
          </View>
        ) : (
          <View style={[styles.colorHero, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">まだ色が配布されていません</ThemedText>
            {isHost ? (
              <UIButton title="色を配布する" onPress={handleAssign} style={styles.assignBtn} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                主催者の配布を待っています
              </ThemedText>
            )}
          </View>
        )}

        {/* ベスト9 */}
        {myColor && (
          <>
            <View style={styles.sectionHeader}>
              <ThemedText type="smallBold">あなたのベスト9</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {filled} / {BEST_NINE_SLOTS}
              </ThemedText>
            </View>
            <BestNineGrid
              posts={posts}
              cells={cells}
              color={myColor}
              editable={!over}
              onPressSlot={over ? undefined : (slot) => handlePressSlot(slot)}
            />
            {over ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.cameraBtn}>
                旅行期間が終了したため、ベスト9への追加・差し替えはできません。
              </ThemedText>
            ) : (
              <UIButton
                title="📷 撮る・ベスト9に追加"
                color={myColor.hex}
                onPress={() => goCompose()}
                style={styles.cameraBtn}
              />
            )}
          </>
        )}

        {/* 他画面への導線 */}
        <View style={styles.links}>
          {/* 共有は色があり自分の写真が1枚以上あるときだけ出す（空のベスト9は共有価値がない） */}
          {myColor && posts.some((p) => p.userId === user.uid) && (
            <LinkRow label="ストーリーに共有" onPress={() => router.push({ pathname: '/trip/[id]/share', params: { id: trip.id } })} theme={theme} />
          )}
          <LinkRow label="アルバムを見る" onPress={() => router.push({ pathname: '/trip/[id]/album', params: { id: trip.id } })} theme={theme} />
          <LinkRow label="メンバー一覧" onPress={() => router.push({ pathname: '/trip/[id]/members', params: { id: trip.id } })} theme={theme} />
        </View>

        {/* 主催者だけがトリップを削除できる */}
        {isHost && (
          <Pressable
            onPress={handleDelete}
            style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: DESTRUCTIVE }}>
              トリップを削除
            </ThemedText>
          </Pressable>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function LinkRow({
  label,
  onPress,
  theme,
}: {
  label: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.linkRow,
        { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 },
      ]}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <ThemedText type="smallBold" themeColor="textSecondary">
        ›
      </ThemedText>
    </Pressable>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <ThemedView style={[styles.container, styles.centered]}>
      <ThemedText type="small" themeColor="textSecondary">
        {text}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three },
  colorHero: {
    borderRadius: 20,
    padding: Spacing.four,
    alignItems: 'center',
    gap: 6,
    minHeight: 140,
    justifyContent: 'center',
  },
  assignBtn: { marginTop: Spacing.two, alignSelf: 'stretch' },
  inviteCard: {
    borderRadius: 14,
    padding: Spacing.three,
    alignItems: 'center',
    gap: 4,
  },
  inviteCode: { letterSpacing: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cameraBtn: { marginTop: Spacing.one },
  links: { gap: Spacing.two, marginTop: Spacing.two },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
  },
  deleteBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: Spacing.two,
  },
});
