import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { barcodeWidths, flightCode } from '@/components/trip-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UIButton } from '@/components/ui-button';
import { Fonts, Spacing } from '@/constants/theme';
import { contrastTextColor } from '@/domain/colors';
import { BEST_NINE_SLOTS } from '@/domain/types';
import { useCurrentUser } from '@/repositories/context';
import { useTrip, useTripPosts } from '@/hooks/use-trips';

/**
 * ストーリー画像はテーマに依存しない固定ポスター（共有先でも見た目が揺れない）。
 * デザインは 9:16。書き出しは captureRef の width/height 指定で 1080×1920 に拡大される。
 */
const CARD_W = 320;
const CARD_H = (CARD_W * 16) / 9;
const POSTER_BG = '#111114';
const POSTER_CARD = '#1D1E22';
const POSTER_TEXT = '#FFFFFF';
const POSTER_MUTED = '#9BA1AA';
const GRID_GAP = 5;
const GRID_W = CARD_W - 32 * 2;
const TILE = (GRID_W - GRID_GAP * 2) / 3;

const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

export default function ShareStoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useCurrentUser();
  const { trip } = useTrip(id);
  const { posts } = useTripPosts(id);
  const posterRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  if (!trip) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ThemedText type="small" themeColor="textSecondary">
          読み込み中...
        </ThemedText>
      </ThemedView>
    );
  }

  const myColor = trip.members[user.uid]?.color;
  const accent = myColor?.hex ?? '#3C9FFE';
  const accentText = contrastTextColor(accent);
  const myPosts = new Map(posts.filter((p) => p.userId === user.uid).map((p) => [p.slotIndex, p]));

  async function handleShare() {
    setSharing(true);
    try {
      // 9:16 のポスターをストーリー標準解像度（1080×1920）へ拡大して書き出す。
      const uri = await captureRef(posterRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: 1080,
        height: 1920,
      });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('共有できません', 'この端末では共有機能を使用できません。');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'ストーリーに共有' });
    } catch (e) {
      Alert.alert('共有に失敗しました', String(e instanceof Error ? e.message : e));
    } finally {
      setSharing(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* ここから下が書き出し対象のポスター */}
        <View ref={posterRef} collapsable={false} style={styles.poster}>
          <View style={styles.posterInner}>
            {/* ヘッダー: 便名と BOARDING PASS */}
            <View style={styles.headerRow}>
              <ThemedText style={styles.kicker}>BOARDING PASS</ThemedText>
              <ThemedText style={styles.kicker}>{flightCode(trip.id)}</ThemedText>
            </View>
            <ThemedText style={styles.tripName} numberOfLines={2}>
              {trip.name}
            </ThemedText>

            {/* 区間 */}
            <View style={styles.route}>
              <View style={styles.routeEnd}>
                <ThemedText style={styles.routeCode}>{md(trip.startDate)}</ThemedText>
                <ThemedText style={styles.routeCaption}>DEP</ThemedText>
              </View>
              <View style={styles.routeLine}>
                <View style={styles.dash} />
                <ThemedText style={[styles.plane, { color: accent }]}>✈</ThemedText>
                <View style={styles.dash} />
              </View>
              <View style={styles.routeEnd}>
                <ThemedText style={styles.routeCode}>{md(trip.endDate)}</ThemedText>
                <ThemedText style={styles.routeCaption}>ARR</ThemedText>
              </View>
            </View>

            {/* ベスト9（自分の分。空きスロットは自分の色の淡い下地） */}
            <View style={styles.grid}>
              {Array.from({ length: BEST_NINE_SLOTS }, (_, slot) => {
                const post = myPosts.get(slot);
                return (
                  <View key={slot} style={[styles.tile, { backgroundColor: `${accent}26` }]}>
                    {post && (
                      <Image
                        source={{ uri: post.thumbURL }}
                        style={styles.tileImg}
                        contentFit="cover"
                      />
                    )}
                  </View>
                );
              })}
            </View>

            {/* 半券: 自分の色 */}
            <View style={[styles.stub, { backgroundColor: accent }]}>
              <View>
                <ThemedText style={[styles.stubCaption, { color: accentText }]}>COLOR</ThemedText>
                <ThemedText style={[styles.stubValue, { color: accentText }]}>
                  {myColor ? myColor.name : '未配布'}
                </ThemedText>
              </View>
              <View style={styles.barcode}>
                {barcodeWidths(trip.id).map((w, i) => (
                  <View key={i} style={{ width: w, height: 26, backgroundColor: accentText }} />
                ))}
              </View>
            </View>

            {/* ブランド */}
            <View style={styles.brandRow}>
              <ThemedText style={styles.brand}>Colorlog</ThemedText>
              <ThemedText style={styles.brandSub}>旅の色を、みんなで撮る。</ThemedText>
            </View>
          </View>
        </View>
        {/* 書き出し対象ここまで */}

        <UIButton
          title="ストーリーに共有"
          color={myColor?.hex}
          onPress={handleShare}
          loading={sharing}
          style={styles.shareBtn}
        />
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          画像として書き出して、インスタのストーリーやLINEに貼れます。
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, alignItems: 'center', gap: Spacing.three },
  poster: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: POSTER_BG,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterInner: {
    width: CARD_W - 24 * 2,
    backgroundColor: POSTER_CARD,
    borderRadius: 20,
    paddingHorizontal: 32 - 24,
    paddingVertical: 22,
    gap: 12,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  kicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: POSTER_MUTED },
  tripName: { fontSize: 22, lineHeight: 28, fontWeight: '800', color: POSTER_TEXT },
  route: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeEnd: { alignItems: 'center', minWidth: 44 },
  routeCode: {
    fontFamily: Fonts.mono,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: POSTER_TEXT,
  },
  routeCaption: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 1.5, color: POSTER_MUTED },
  routeLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  dash: { flex: 1, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: '#3A3C42' },
  plane: { fontSize: 13 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    width: GRID_W,
    alignSelf: 'center',
  },
  tile: { width: TILE, height: TILE, borderRadius: 8, overflow: 'hidden' },
  tileImg: { width: '100%', height: '100%' },
  stub: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  stubCaption: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 2, opacity: 0.85 },
  stubValue: { fontSize: 18, fontWeight: '800' },
  barcode: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 26 },
  brandRow: { alignItems: 'center', gap: 2, marginTop: 4 },
  brand: { fontFamily: Fonts.rounded, fontSize: 16, fontWeight: '800', color: POSTER_TEXT },
  brandSub: { fontSize: 10, color: POSTER_MUTED },
  shareBtn: { alignSelf: 'stretch' },
  hint: { textAlign: 'center' },
});
