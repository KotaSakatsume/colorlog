import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Tint, shadow } from '@/constants/theme';
import { useThemeScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  /** 背景色を明示指定（色チップ連動の主ボタンなどに使う）。 */
  color?: string;
  style?: ViewStyle;
};

/** アプリ共通のボタン。primary は塗り、secondary は枠線。 */
export function UIButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  color,
  style,
}: Props) {
  const theme = useTheme();
  const scheme = useThemeScheme();
  const isPrimary = variant === 'primary';
  // `color` prop 優先は維持（色チップ連動の主ボタン）。未指定時のみ tint に集約。
  const bg = isPrimary ? (color ?? Tint[scheme].tint) : 'transparent';
  // 押下時は明示色未指定の primary のみ tintPressed に沈める（color 指定時は色を尊重）。
  const pressedBg = isPrimary && !color ? Tint[scheme].tintPressed : bg;
  const textColor = isPrimary ? Tint[scheme].tintText : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        isPrimary && shadow(1, scheme),
        {
          backgroundColor: pressed ? pressedBg : bg,
          borderColor: isPrimary ? bg : theme.backgroundSelected,
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <ThemedText type="smallBold" style={{ color: textColor }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    paddingHorizontal: 20,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
