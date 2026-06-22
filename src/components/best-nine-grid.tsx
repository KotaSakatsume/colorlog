import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AssignedColor } from '@/domain/colors';
import type { BestNineCell } from '@/domain/merge-best-nine';
import { mergeBestNine } from '@/domain/merge-best-nine';
import { BEST_NINE_SLOTS, type Post } from '@/domain/types';
import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  /** この所有者の投稿（任意の順序でよい。slotIndex で配置する）。 */
  posts: Post[];
  /**
   * 送信中ジョブとマージ済みの表示セル（任意）。渡すと送信中バッジ/失敗表示を出す。
   * 未指定なら従来通り posts のみで描画する（既存呼び出しを壊さない）。
   */
  cells?: BestNineCell[];
  /** 空きスロットの淡い下地に使う色。 */
  color?: AssignedColor;
  /** スロットをタップしたとき。null は空きスロット。 */
  onPressSlot?: (slotIndex: number, post: Post | null) => void;
  /** 空きスロットに「＋」を出すか。 */
  editable?: boolean;
};

/** 3×3 のベスト9グリッド。空きスロットは「＋」（editable 時）。送信中ジョブはバッジで重ねる。 */
export function BestNineGrid({ posts, cells, color, onPressSlot, editable = false }: Props) {
  const theme = useTheme();
  // cells 未指定なら posts のみでセル列を導出する（送信中ジョブ無し＝従来描画）。
  // 前提: posts は単一所有者分（同一 userId）。userId は先頭 post から採る（nit-1）。
  const resolved = cells ?? mergeBestNine(posts, [], posts[0]?.userId ?? '');

  return (
    <View style={styles.grid}>
      {resolved.map((cell) => {
        const { slotIndex: slot, post, job } = cell;
        const tint = color ? `${color.hex}22` : theme.backgroundElement;
        // 送信中 Job のプレースホルダ画像は localImage、無ければ確定 Post のサムネ。
        const uri = job ? job.localImage.uri : post?.thumbURL;
        const recyclingKey = job ? job.id : post?.id;
        // 埋まりセルは所有者色の細フレームでアイデンティティを縁取る。
        const filled = !!uri;
        return (
          <Pressable
            key={slot}
            disabled={!onPressSlot}
            onPress={() => onPressSlot?.(slot, post)}
            style={[
              styles.slot,
              { backgroundColor: tint },
              filled && color
                ? { borderWidth: 1.5, borderColor: color.hex }
                : null,
            ]}>
            {uri ? (
              <Image
                source={{ uri }}
                style={[styles.image, job ? styles.dimmed : null]}
                contentFit="cover"
                transition={150}
                recyclingKey={recyclingKey}
              />
            ) : (
              editable && (
                <ThemedText
                  style={[styles.plus, { color: color ? color.hex : theme.textSecondary }]}>
                  ＋
                </ThemedText>
              )
            )}
            {job && (
              <View style={styles.badge}>
                <ThemedText type="small" style={styles.badgeText}>
                  {cell.state === 'failed' ? '再送' : '送信中'}
                </ThemedText>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** アルバム用の小さいベスト9（タップ不可・ラベルなし）。 */
export function BestNineMini({ posts, color }: { posts: Post[]; color: AssignedColor }) {
  const bySlot = new Map(posts.map((p) => [p.slotIndex, p]));
  return (
    <View style={styles.miniGrid}>
      {Array.from({ length: BEST_NINE_SLOTS }, (_, slot) => {
        const post = bySlot.get(slot) ?? null;
        return (
          <View key={slot} style={[styles.miniSlot, { backgroundColor: `${color.hex}33` }]}>
            {post && (
              <Image
                source={{ uri: post.thumbURL }}
                style={styles.image}
                contentFit="cover"
                transition={150}
                recyclingKey={post.id}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

const GAP = 6;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  slot: {
    // 3列 + gap。flexBasis を 31% にして gap 分の余白を確保する。
    flexBasis: '31%',
    flexGrow: 1,
    aspectRatio: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  // 送信中ジョブのプレースホルダは半透明にして「未確定」を示す。
  dimmed: {
    opacity: 0.6,
  },
  badge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    paddingVertical: 2,
  },
  badgeText: {
    color: '#fff',
  },
  plus: {
    fontSize: 28,
    fontWeight: '300',
  },
  miniGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 108,
    gap: 2,
  },
  miniSlot: {
    width: 34,
    height: 34,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
