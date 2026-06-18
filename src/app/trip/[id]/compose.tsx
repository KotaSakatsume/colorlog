import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UIButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { isTripOver } from '@/domain/format';
import { BEST_NINE_SLOTS } from '@/domain/types';
import { useCurrentUser, useRepositories } from '@/repositories/context';
import { useTheme } from '@/hooks/use-theme';
import { useTrip, useTripPosts } from '@/hooks/use-trips';

const CAPTION_MAX = 200;

/** 端末内の「撮り放題」候補をシミュレートする（クラウド外）。実機ではここが expo-camera になる。 */
function useCandidates(seedKey: string): string[] {
  return useMemo(
    () => Array.from({ length: 12 }, (_, i) => `https://picsum.photos/seed/${seedKey}-cand-${i}/300/300`),
    [seedKey],
  );
}

export default function ComposeScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; slot?: string }>();
  const tripId = params.id;
  const user = useCurrentUser();
  const { posts: postRepo } = useRepositories();
  const { trip } = useTrip(tripId);
  const { posts } = useTripPosts(tripId);

  const myPosts = posts.filter((p) => p.userId === user.uid);
  const filledSlots = new Set(myPosts.map((p) => p.slotIndex));
  const myColor = trip?.members[user.uid]?.color;

  const candidates = useCandidates(`${tripId}-${user.uid}`);

  const firstEmpty = Array.from({ length: BEST_NINE_SLOTS }, (_, i) => i).find(
    (i) => !filledSlots.has(i),
  );
  const initialSlot = params.slot !== undefined ? Number(params.slot) : firstEmpty;

  const [selected, setSelected] = useState<string | null>(null);
  const [targetSlot, setTargetSlot] = useState<number | undefined>(initialSlot);
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!trip || !myColor) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ThemedText type="small" themeColor="textSecondary">
          色が未配布のため公開できません
        </ThemedText>
      </ThemedView>
    );
  }

  if (isTripOver(trip)) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ThemedText type="small" themeColor="textSecondary">
          旅行期間が終了したため、追加できません
        </ThemedText>
      </ThemedView>
    );
  }

  const isReplacing = targetSlot !== undefined && filledSlots.has(targetSlot);

  async function publish() {
    if (!selected) {
      Alert.alert('公開する写真を選んでください');
      return;
    }
    if (targetSlot === undefined) {
      Alert.alert('追加先のスロットを選んでください');
      return;
    }

    const run = async () => {
      setSubmitting(true);
      try {
        await postRepo.promotePhoto({
          tripId,
          user,
          slotIndex: targetSlot,
          localImage: { uri: selected },
          caption,
        });
        router.back();
      } catch (e) {
        Alert.alert('公開に失敗しました', String(e instanceof Error ? e.message : e));
        setSubmitting(false);
      }
    };

    if (isReplacing) {
      // 差し替え対象はユーザーが明示選択。削除を確認してから実行（SPEC 5-7）。
      Alert.alert(
        'この写真は削除されます',
        `スロット ${targetSlot + 1} の現在の写真を新しい写真に差し替えます。元の写真は削除されます。`,
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: '差し替える', style: 'destructive', onPress: run },
        ],
      );
    } else {
      await run();
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 候補一覧 */}
        <ThemedText type="smallBold">端末内の候補（撮り放題・クラウド外）</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          公開したい1枚を選びます。ベスト9に昇格した写真だけがクラウドに保存されます。
        </ThemedText>
        <View style={styles.candidateGrid}>
          {candidates.map((uri) => {
            const isSel = selected === uri;
            return (
              <Pressable key={uri} onPress={() => setSelected(uri)} style={styles.candidate}>
                <Image source={{ uri }} style={styles.candidateImg} contentFit="cover" transition={120} />
                {isSel && (
                  <View style={[styles.selOverlay, { borderColor: myColor.hex }]}>
                    <View style={[styles.selBadge, { backgroundColor: myColor.hex }]}>
                      <ThemedText type="small" style={{ color: '#fff' }}>
                        ✓
                      </ThemedText>
                    </View>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* 公開先スロット選択 */}
        <ThemedText type="smallBold" style={styles.sectionTop}>
          公開先（ベスト9）
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {myPosts.length >= BEST_NINE_SLOTS
            ? '9枠が埋まっています。差し替える1枚をタップしてください。'
            : '空き枠をタップ、または埋まった枠をタップして差し替えできます。'}
        </ThemedText>
        <View style={styles.slotGrid}>
          {Array.from({ length: BEST_NINE_SLOTS }, (_, slot) => {
            const post = myPosts.find((p) => p.slotIndex === slot) ?? null;
            const isTarget = targetSlot === slot;
            return (
              <Pressable
                key={slot}
                onPress={() => setTargetSlot(slot)}
                style={[
                  styles.slot,
                  { backgroundColor: `${myColor.hex}22`, borderColor: isTarget ? myColor.hex : 'transparent' },
                ]}>
                {post ? (
                  <Image source={{ uri: post.thumbURL }} style={styles.slotImg} contentFit="cover" />
                ) : (
                  <ThemedText style={[styles.plus, { color: myColor.hex }]}>＋</ThemedText>
                )}
                {isTarget && post && (
                  <View style={styles.replaceTag}>
                    <ThemedText type="small" style={{ color: '#fff' }}>
                      差し替え
                    </ThemedText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* キャプション */}
        <ThemedText type="smallBold" style={styles.sectionTop}>
          キャプション
        </ThemedText>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder="ひとこと（任意・200字まで）"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          maxLength={CAPTION_MAX}
          multiline
        />

        <UIButton
          title={isReplacing ? '差し替えて公開' : 'ベスト9に公開'}
          color={myColor.hex}
          onPress={publish}
          loading={submitting}
          disabled={!selected}
          style={styles.publish}
        />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.two },
  candidateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  candidate: { flexBasis: '23%', flexGrow: 1, aspectRatio: 1, borderRadius: 8, overflow: 'hidden' },
  candidateImg: { width: '100%', height: '100%' },
  selOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderRadius: 8,
    alignItems: 'flex-end',
  },
  selBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    margin: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTop: { marginTop: Spacing.three },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  slot: {
    flexBasis: '31%',
    flexGrow: 1,
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 3,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotImg: { width: '100%', height: '100%' },
  plus: { fontSize: 26, fontWeight: '300' },
  replaceTag: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    paddingVertical: 2,
  },
  input: {
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  publish: { marginTop: Spacing.three },
});
