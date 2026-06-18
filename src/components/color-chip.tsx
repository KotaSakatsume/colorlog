import { StyleSheet, View, type ViewStyle } from 'react-native';

import { contrastTextColor, type AssignedColor } from '@/domain/colors';
import { ThemedText } from '@/components/themed-text';

type Props = {
  color: AssignedColor;
  /** 名前ラベルを併記するか（色覚多様性対応で既定 true）。 */
  showName?: boolean;
  size?: 'sm' | 'md';
  style?: ViewStyle;
};

/** 色 + 日本語名のペアで表示するチップ。常にペアで見せる（SPEC 6）。 */
export function ColorChip({ color, showName = true, size = 'md', style }: Props) {
  const textColor = contrastTextColor(color.hex);
  const isSmall = size === 'sm';
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: color.hex,
          paddingVertical: isSmall ? 3 : 6,
          paddingHorizontal: isSmall ? 8 : 12,
        },
        style,
      ]}>
      {showName && (
        <ThemedText
          type={isSmall ? 'small' : 'smallBold'}
          style={{ color: textColor }}>
          {color.name}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
