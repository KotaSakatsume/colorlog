import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { REACTION_EMOJIS, type ReactionEmoji, type ReactionSummary } from '@/domain/types';
import { ThemedText } from '@/components/themed-text';
import { Radius, Tint, shadow } from '@/constants/theme';
import { useThemeScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  /** 当該 post の集計。未取得なら counts 空・mine null の既定として扱える。 */
  summary?: ReactionSummary;
  /** 絵文字をタップしたとき。同じ絵文字なら解除、別なら付け替え（呼び出し側で toggle）。 */
  onToggle: (emoji: ReactionEmoji) => void;
};

/**
 * 確定集合の絵文字を横並びで表示し、件数と「自分が押した絵文字」をハイライトする行。
 * 1人1リアクション制なので mine は単数。
 *
 * 集計更新時に全 post の ReactionBar が再評価されるのを抑えるため React.memo 化している
 * （Mock 簡略化。Firebase では post 単位 onSnapshot に分割する → 03-implementation.md 参照）。
 * onToggle は呼び出し側で post.id 固定のクロージャを安定化させると memo が効く。
 */
function ReactionBarBase({ summary, onToggle }: Props) {
  const theme = useTheme();
  const scheme = useThemeScheme();
  const counts = summary?.counts ?? {};
  const mine = summary?.mine ?? null;

  return (
    <View style={styles.bar}>
      {REACTION_EMOJIS.map((emoji) => {
        const count = counts[emoji] ?? 0;
        const selected = mine === emoji;
        return (
          <Pressable
            key={emoji}
            onPress={() => onToggle(emoji)}
            style={({ pressed }) => [
              styles.chip,
              selected ? shadow(1, scheme) : null,
              {
                backgroundColor: selected
                  ? Tint[scheme].tintSubtle
                  : theme.backgroundElement,
                transform: [{ scale: pressed ? 0.94 : 1 }],
              },
            ]}>
            <ThemedText type="small">{emoji}</ThemedText>
            {count > 0 && (
              <ThemedText
                type="small"
                style={[
                  styles.count,
                  { color: selected ? theme.text : theme.textSecondary },
                ]}>
                {count}
              </ThemedText>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export const ReactionBar = memo(ReactionBarBase);

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
  },
  count: { fontVariant: ['tabular-nums'] },
});
