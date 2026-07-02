import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, shadow } from '@/constants/theme';
import { contrastTextColor } from '@/domain/colors';
import { STATUS_LABEL, memberCount } from '@/domain/format';
import type { Trip } from '@/domain/types';
import { useThemeScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  trip: Trip;
  currentUserId: string;
  onPress: () => void;
};

const STUB_WIDTH = 96;
const NOTCH = 18;

/** 月/日 表記（区間の両端ラベル用）。 */
const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

/** trip.id 由来の決定的な便名フレーバー（例: CL482）。ストーリー書き出しでも使う。 */
export function flightCode(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return `CL${String(h).padStart(3, '0')}`;
}

/** trip.id 由来の決定的なバーコード幅列（搭乗券の見た目用・1〜3px）。ストーリー書き出しでも使う。 */
export function barcodeWidths(id: string): number[] {
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 131 + id.charCodeAt(i)) >>> 0;
  return Array.from({ length: 20 }, () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return 1 + (seed % 3);
  });
}

/** 小見出し（キャプション）+ 値の縦積み（搭乗券のメタ欄）。 */
function Meta({ caption, value }: { caption: string; value: string }) {
  return (
    <View>
      <ThemedText style={styles.metaCaption} themeColor="textSecondary">
        {caption}
      </ThemedText>
      <ThemedText style={styles.metaValue}>{value}</ThemedText>
    </View>
  );
}

/** ホームのトリップ一覧カード。搭乗券（ボーディングパス）風レイアウト。 */
export function TripCard({ trip, currentUserId, onPress }: Props) {
  const theme = useTheme();
  const scheme = useThemeScheme();
  const myColor = trip.members[currentUserId]?.color;
  // 半券の地色＝自分の配布色。未配布はテーマのグレー。
  const accent = myColor?.hex ?? theme.backgroundSelected;
  const stubText = myColor ? contrastTextColor(myColor.hex) : theme.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        shadow(2, scheme),
        {
          backgroundColor: theme.backgroundElement,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}>
      {/* 主券（メイン） */}
      <View style={styles.main}>
        <View style={styles.headerRow}>
          <ThemedText style={styles.kicker} themeColor="textSecondary">
            BOARDING PASS
          </ThemedText>
          <View style={[styles.statusPill, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {STATUS_LABEL[trip.status]}
            </ThemedText>
          </View>
        </View>

        <ThemedText type="smallBold" style={styles.name} numberOfLines={1}>
          {trip.name}
        </ThemedText>

        {/* 区間（出発 ✈ 到着）。旅程の開始日/終了日を両端に見立てる。 */}
        <View style={styles.route}>
          <View style={styles.routeEnd}>
            <ThemedText style={styles.routeCode}>{md(trip.startDate)}</ThemedText>
            <ThemedText style={styles.routeCaption} themeColor="textSecondary">
              DEP
            </ThemedText>
          </View>
          <View style={styles.routeLine}>
            <View style={[styles.dash, { borderColor: theme.backgroundSelected }]} />
            <ThemedText style={[styles.plane, { color: accent }]}>✈</ThemedText>
            <View style={[styles.dash, { borderColor: theme.backgroundSelected }]} />
          </View>
          <View style={styles.routeEnd}>
            <ThemedText style={styles.routeCode}>{md(trip.endDate)}</ThemedText>
            <ThemedText style={styles.routeCaption} themeColor="textSecondary">
              ARR
            </ThemedText>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Meta caption="PAX" value={`${memberCount(trip)}`} />
          <Meta caption="FLIGHT" value={flightCode(trip.id)} />
        </View>
      </View>

      {/* ミシン目（破線）+ 上下のノッチ（半円の切り欠き） */}
      <View style={[styles.perforation, { borderColor: theme.backgroundSelected }]} />
      <View style={[styles.notch, styles.notchTop, { backgroundColor: theme.background }]} />
      <View style={[styles.notch, styles.notchBottom, { backgroundColor: theme.background }]} />

      {/* 半券（スタブ）＝自分の色 */}
      <View style={[styles.stub, { backgroundColor: accent }]}>
        <ThemedText style={[styles.stubCaption, { color: stubText }]}>COLOR</ThemedText>
        <ThemedText style={[styles.stubValue, { color: stubText }]} numberOfLines={1}>
          {myColor ? myColor.name : '未配布'}
        </ThemedText>
        <View style={styles.barcode}>
          {barcodeWidths(trip.id).map((w, i) => (
            <View key={i} style={{ width: w, height: 24, backgroundColor: stubText }} />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    minHeight: 132,
  },
  main: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  kicker: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  name: {
    fontSize: 16,
  },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  routeEnd: {
    alignItems: 'center',
    minWidth: 44,
  },
  routeCode: {
    fontFamily: Fonts.mono,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  routeCaption: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    marginTop: 1,
  },
  routeLine: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dash: {
    flex: 1,
    height: 0,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
  },
  plane: {
    fontSize: 14,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 2,
  },
  metaCaption: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
  },
  metaValue: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 1,
  },
  perforation: {
    width: 0,
    borderLeftWidth: 1.5,
    borderStyle: 'dashed',
    marginVertical: 12,
  },
  notch: {
    position: 'absolute',
    width: NOTCH,
    height: NOTCH,
    borderRadius: NOTCH / 2,
    right: STUB_WIDTH - NOTCH / 2,
  },
  notchTop: {
    top: -NOTCH / 2,
  },
  notchBottom: {
    bottom: -NOTCH / 2,
  },
  stub: {
    width: STUB_WIDTH,
    paddingHorizontal: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  stubCaption: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    opacity: 0.85,
  },
  stubValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  barcode: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 24,
    marginTop: 4,
  },
});
