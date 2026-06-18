import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AssignedColor } from '@/domain/colors';
import { BEST_NINE_SLOTS, type Post } from '@/domain/types';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  /** この所有者の投稿（任意の順序でよい。slotIndex で配置する）。 */
  posts: Post[];
  /** 空きスロットの淡い下地に使う色。 */
  color?: AssignedColor;
  /** スロットをタップしたとき。null は空きスロット。 */
  onPressSlot?: (slotIndex: number, post: Post | null) => void;
  /** 空きスロットに「＋」を出すか。 */
  editable?: boolean;
};

/** 3×3 のベスト9グリッド。空きスロットは「＋」（editable 時）。 */
export function BestNineGrid({ posts, color, onPressSlot, editable = false }: Props) {
  const theme = useTheme();
  const bySlot = new Map(posts.map((p) => [p.slotIndex, p]));

  return (
    <View style={styles.grid}>
      {Array.from({ length: BEST_NINE_SLOTS }, (_, slot) => {
        const post = bySlot.get(slot) ?? null;
        const tint = color ? `${color.hex}22` : theme.backgroundElement;
        return (
          <Pressable
            key={slot}
            disabled={!onPressSlot}
            onPress={() => onPressSlot?.(slot, post)}
            style={[styles.slot, { backgroundColor: tint }]}>
            {post ? (
              <Image
                source={{ uri: post.thumbURL }}
                style={styles.image}
                contentFit="cover"
                transition={150}
                recyclingKey={post.id}
              />
            ) : (
              editable && (
                <ThemedText
                  style={[styles.plus, { color: color ? color.hex : theme.textSecondary }]}>
                  ＋
                </ThemedText>
              )
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
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
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
