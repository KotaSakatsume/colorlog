import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
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
  const isPrimary = variant === 'primary';
  const bg = isPrimary ? (color ?? '#208AEF') : 'transparent';
  const textColor = isPrimary ? '#FFFFFF' : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: isPrimary ? bg : theme.backgroundSelected,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
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
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
