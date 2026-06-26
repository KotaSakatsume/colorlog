import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Tint, shadow } from '@/constants/theme';
import { useThemeScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const SPRING = { damping: 18, stiffness: 220, mass: 0.7 } as const;
const TIMING = { duration: 120 } as const;

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
  // 同色 no-op ガード: bg !== pressedBg のとき（color 未指定 primary）のみ色をアニメする。
  const animateBg = isPrimary && !color;

  const pressProgress = useSharedValue(0);
  const colorProgress = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(pressProgress.value, [0, 1], [1, 0.97]);
    if (animateBg) {
      return {
        transform: [{ scale }],
        backgroundColor: interpolateColor(colorProgress.value, [0, 1], [bg, pressedBg]),
      };
    }
    return {
      transform: [{ scale }],
    };
  }, [animateBg, bg, pressedBg]);

  // 押下中に disabled/loading へ切り替わると onPressOut が不発火で縮小状態が固着しうるため復元する。
  useEffect(() => {
    if (disabled || loading) {
      pressProgress.value = withSpring(0, SPRING);
      colorProgress.value = withTiming(0, TIMING);
    }
  }, [disabled, loading]);

  const handlePressIn = () => {
    if (disabled || loading) return;
    pressProgress.value = withSpring(1, SPRING);
    colorProgress.value = withTiming(1, TIMING);
  };

  const handlePressOut = () => {
    pressProgress.value = withSpring(0, SPRING);
    colorProgress.value = withTiming(0, TIMING);
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[
        styles.button,
        isPrimary && shadow(1, scheme),
        {
          // 静的背景色を常に置く。animateBg=true のときは animatedStyle の interpolateColor が上書きし、
          // worklet 再構築時のフォールバックとして機能する。
          backgroundColor: bg,
          borderColor: isPrimary ? bg : theme.backgroundSelected,
          opacity: disabled ? 0.4 : 1,
        },
        animatedStyle,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <ThemedText type="smallBold" style={{ color: textColor }}>
          {title}
        </ThemedText>
      )}
    </AnimatedPressable>
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
